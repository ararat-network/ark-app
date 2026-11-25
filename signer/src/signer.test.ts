import assert from "node:assert/strict";
import { test } from "node:test";
import { fromBase64, fromHex, SECP256K1_PUBLIC_KEY_URL, toBase64, utf8Decode, utf8Encode } from "@ararat-network/sdk";
import type { KeyAdapter } from "./adapter.ts";
import type { Capability, Grant } from "./permissions.ts";
import { type RefusalKind, SignerRefusal } from "./refusal.ts";
import type { Review } from "./review/model.ts";
import { createSigner, type Decision, type SignerNetwork } from "./signer.ts";
import { DocumentError, type Domain, parseDocument, SIGNUP_DOMAIN, VOUCH_DOMAIN } from "./signup/document.ts";
import { signDocument, submissionToJson } from "./signup/proof.ts";
import { adr036SignBytes } from "./signup/signbytes.ts";
import { type MemoryAdapter, memoryAdapter } from "./testing/memory_adapter.ts";
import { type SignupVector, signupVectors } from "./testing/vectors.ts";

const { keys, vectors } = signupVectors();
const vector = (name: string) => vectors.find((v) => v.name === name)!;
const keyNamed = (name: string) => fromHex(keys.find((k) => k.name === name)!.private_key_hex);
const keyOf = (v: SignupVector) => fromHex(keys.find((k) => k.public_key === v.public_key)!.private_key_hex);

const ok = vector("challenge_ok");
const okData = utf8Encode(ok.data);
const MAINNET: SignerNetwork = { chainId: "ark-1", origin: "https://members.ararat.network" };
const SIGNUP: Grant = { caller: "signup", capabilities: ["connect", "read_addresses", "sign"], documents: [SIGNUP_DOMAIN] };

interface Rig {
  adapter: MemoryAdapter;
  reviews: Review[];
  signer: ReturnType<typeof createSigner>;
}

/** A signer over one key in memory, with a review screen that records what it is shown and answers as told. */
function rig(options: { key?: Uint8Array; adapters?: KeyAdapter[]; network?: SignerNetwork; now?: () => bigint; answer?: () => Promise<Decision> } = {}): Rig {
  const adapter = memoryAdapter(options.key ?? keyOf(ok));
  const reviews: Review[] = [];
  const signer = createSigner({
    adapters: options.adapters ?? [adapter],
    network: options.network ?? MAINNET,
    now: options.now ?? (() => BigInt(ok.now)),
    present: async (review) => {
      reviews.push(review);
      return options.answer ? options.answer() : "approved";
    },
  });
  return { adapter, reviews, signer };
}

async function refusal(promise: Promise<unknown>, kind: RefusalKind, name?: string): Promise<SignerRefusal> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof SignerRefusal, `${name ?? kind}: a SignerRefusal, got ${String(err)}`);
    assert.equal(err.kind, kind, `${name ?? kind}: ${err.message}`);
    return err;
  }
  assert.fail(`${name ?? kind}: nothing was refused`);
}

test("every vector goes through the pipeline: what its key validly signed is reproduced, and the rest is refused or signed anew", async () => {
  assert.equal(vectors.length, 16);
  let reproduced = 0;
  for (const v of vectors) {
    const data = utf8Encode(v.data);
    let doc: ReturnType<typeof parseDocument> | undefined;
    try {
      doc = parseDocument(data);
    } catch {
      doc = undefined;
    }
    // The signer signs for the network the document names, at the second it was issued.
    const r = rig({
      key: keyOf(v),
      network: doc ? { chainId: doc.chain_id, origin: doc.origin } : MAINNET,
      now: () => (doc ? BigInt(doc.issued) : BigInt(v.now)),
    });
    const handle = r.signer.grant({ caller: "test", capabilities: ["connect", "sign"], documents: [SIGNUP_DOMAIN, VOUCH_DOMAIN] });
    if (!doc) {
      const err = await refusal(handle.signArbitrary(v.signer, data), "invalid", v.name);
      assert.ok(err.cause instanceof DocumentError, v.name);
      assert.equal(r.reviews.length, 0, `${v.name}: nothing is reviewed`);
      assert.equal(r.adapter.signed.length, 0, `${v.name}: nothing reaches the key`);
      continue;
    }
    if (v.signer !== r.adapter.address) {
      await refusal(handle.signArbitrary(v.signer, data), "invalid", v.name);
      assert.equal(r.adapter.signed.length, 0, `${v.name}: nothing reaches the key`);
      continue;
    }
    const { signature, publicKey } = await handle.signArbitrary(v.signer, data);
    assert.equal(utf8Decode(r.adapter.signed[0]!), v.sign_bytes, `${v.name}: the sign bytes`);
    assert.equal(toBase64(publicKey), v.public_key, v.name);
    if (v.signature_valid) {
      assert.equal(toBase64(signature), v.signature, v.name);
      reproduced++;
    } else {
      assert.notEqual(toBase64(signature), v.signature, `${v.name}: the pipeline signs the data itself, low S`);
    }
  }
  assert.equal(reproduced, 10);
});

test("signDocument through a handle produces the submission the service stores", async () => {
  for (const name of ["challenge_ok", "challenge_localnet_ok", "vouch_ok"]) {
    const v = vector(name);
    const r = rig({ key: keyOf(v), network: { chainId: v.challenge!.chain_id!, origin: v.challenge!.origin! }, now: () => BigInt(v.now) });
    const handle = r.signer.grant({ caller: "flow", capabilities: ["connect", "sign"], documents: [v.domain as Domain] });
    const submission = await signDocument(handle, v.signer, utf8Encode(v.data));
    assert.deepEqual(submissionToJson(submission), { data: v.data, signer: v.signer, public_key: v.public_key, signature: v.signature }, name);
  }
});

test("the review names the caller, the account, and the document's fields, and one approval signs one document", async () => {
  const r = rig();
  const handle = r.signer.grant(SIGNUP);
  await handle.signArbitrary(ok.signer, okData);
  assert.deepEqual(r.reviews, [
    {
      kind: "document",
      caller: "signup",
      account: ok.signer,
      fields: [
        { label: "document.origin", value: { kind: "origin", origin: "https://members.ararat.network" } },
        { label: "document.kind", value: { kind: "choice", choice: "document.kind.signup" } },
        { label: "document.chain_id", value: { kind: "text", text: "ark-1" } },
        { label: "document.expires", value: { kind: "time", unixSeconds: "1761400600" } },
      ],
    },
  ]);
  assert.equal(r.adapter.signed.length, 1);
  await handle.signArbitrary(ok.signer, okData);
  assert.equal(r.reviews.length, 2, "a second signature is a second review");
  assert.equal(r.adapter.signed.length, 2);
});

test("a decline reaches no key, and so does a review screen that fails or answers anything but approved", async () => {
  const declined = rig({ answer: async () => "declined" });
  await refusal(declined.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "declined");
  assert.equal(declined.reviews.length, 1);
  assert.equal(declined.adapter.signed.length, 0);

  const unclear = rig({ answer: async () => "yes" as Decision });
  await refusal(unclear.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "declined");
  assert.equal(unclear.adapter.signed.length, 0);

  const broken = rig({ answer: async () => Promise.reject(new Error("the screen was dismissed")) });
  const err = await refusal(broken.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "invalid");
  assert.match(String((err.cause as Error).message), /dismissed/);
  assert.equal(broken.adapter.signed.length, 0);
});

test("what is signed is the document as it was reviewed, whatever happens to the caller's bytes meanwhile", async () => {
  const data = utf8Encode(ok.data);
  const r = rig({
    answer: async () => {
      data.fill(0x20);
      return "approved";
    },
  });
  const { signature } = await r.signer.grant(SIGNUP).signArbitrary(ok.signer, data);
  assert.equal(toBase64(signature), ok.signature);
});

test("a document for another chain or from another origin is refused before review", async () => {
  for (const [name, network] of [
    ["another chain", { ...MAINNET, chainId: "ark-testnet-1" }],
    ["another origin", { ...MAINNET, origin: "https://members.example.org" }],
  ] as const) {
    const r = rig({ network });
    await refusal(r.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "invalid", name);
    assert.equal(r.reviews.length, 0, name);
    assert.equal(r.adapter.signed.length, 0, name);
  }
});

test("an expired document is refused before review, and after it when the member read past the expiry", async () => {
  const expires = BigInt(ok.challenge!.expires!);
  const lastSecond = rig({ now: () => expires - 1n });
  await lastSecond.signer.grant(SIGNUP).signArbitrary(ok.signer, okData);

  const late = rig({ now: () => expires });
  await refusal(late.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "expired");
  assert.equal(late.reviews.length, 0);

  let clock = expires - 1n;
  const slow = rig({
    now: () => clock,
    answer: async () => {
      clock = expires;
      return "approved";
    },
  });
  await refusal(slow.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "expired");
  assert.equal(slow.reviews.length, 1);
  assert.equal(slow.adapter.signed.length, 0);

  // The window's start is the service's to check: a device clock behind the service's still signs a fresh document.
  const behind = rig({ now: () => BigInt(ok.challenge!.issued!) - 30n });
  await behind.signer.grant(SIGNUP).signArbitrary(ok.signer, okData);
});

test("one review is shown at a time: a request waits for those asked before it, and for what they approved to be signed", async () => {
  const good = memoryAdapter(keyOf(ok));
  const events: string[] = [];
  let showing = 0;
  const answers: Decision[] = ["approved", "declined", "approved"];
  const r = rig({
    adapters: [
      {
        ...good,
        sign: async (address, signBytes) => {
          events.push("signing");
          // A key that takes its time, as a Ledger does while the member reads its screen.
          await new Promise((resolve) => setImmediate(resolve));
          events.push("signed");
          return good.sign(address, signBytes);
        },
      },
    ],
    answer: async () => {
      assert.equal(++showing, 1, "another review is still up");
      events.push("review");
      await new Promise((resolve) => setImmediate(resolve));
      showing--;
      return answers.shift()!;
    },
  });
  // Whoever asks: the turn is the signer's, not a caller's.
  const signup = r.signer.grant(SIGNUP);
  const again = r.signer.grant({ ...SIGNUP, caller: "signup again" });
  const [first, second, third] = await Promise.allSettled([
    signup.signArbitrary(ok.signer, okData),
    again.signArbitrary(ok.signer, okData),
    signup.signArbitrary(ok.signer, okData),
  ]);
  assert.equal(first.status === "fulfilled" && toBase64(first.value.signature), ok.signature);
  assert.equal(second.status === "rejected" && (second.reason as SignerRefusal).kind, "declined", "a request that fails gives up its turn");
  assert.equal(third.status === "fulfilled" && toBase64(third.value.signature), ok.signature);
  assert.deepEqual(
    r.reviews.map((review) => review.caller),
    ["signup", "signup again", "signup"],
    "in the order asked",
  );
  assert.deepEqual(events, ["review", "signing", "signed", "review", "review", "signing", "signed"]);
});

test("a request that waited is checked again when its turn comes: one that expired, or whose network was left, is not shown", async () => {
  const expires = BigInt(ok.challenge!.expires!);
  let clock = expires - 1n;
  const slow = rig({
    now: () => clock,
    answer: async () => {
      clock = expires;
      return "approved";
    },
  });
  const handle = slow.signer.grant(SIGNUP);
  const [read, waited] = await Promise.allSettled([handle.signArbitrary(ok.signer, okData), handle.signArbitrary(ok.signer, okData)]);
  assert.equal(read.status === "rejected" && (read.reason as SignerRefusal).kind, "expired");
  assert.equal(waited.status === "rejected" && (waited.reason as SignerRefusal).kind, "expired");
  assert.equal(slow.reviews.length, 1, "the document that expired while it waited is not shown");
  assert.equal(slow.adapter.signed.length, 0);

  const local = vector("challenge_localnet_ok");
  const settings = { caller: "settings", capabilities: ["change_network"] } as const;
  const switched = rig({
    answer: async () => {
      switched.signer.grant(settings).setNetwork({ chainId: local.challenge!.chain_id!, origin: local.challenge!.origin! });
      return "approved";
    },
  });
  const signup = switched.signer.grant(SIGNUP);
  const [approved, behind] = await Promise.allSettled([signup.signArbitrary(ok.signer, okData), signup.signArbitrary(ok.signer, okData)]);
  // What the member approved names its chain, and the approval stands.
  assert.equal(approved.status === "fulfilled" && toBase64(approved.value.signature), ok.signature);
  assert.equal(behind.status === "rejected" && (behind.reason as SignerRefusal).kind, "invalid");
  assert.equal(switched.reviews.length, 1);
  assert.equal(switched.adapter.signed.length, 1);
});

test("each capability is refused without its grant, and none implies another", async () => {
  const r = rig();
  const all: Capability[] = ["connect", "read_addresses", "sign", "change_network"];
  const without = (missing: Capability) => r.signer.grant({ caller: "feature", capabilities: all.filter((c) => c !== missing), documents: [SIGNUP_DOMAIN] });

  await refusal(without("connect").signArbitrary(ok.signer, okData), "not_granted", "sign without connect");
  await refusal(without("sign").signArbitrary(ok.signer, okData), "not_granted", "sign without sign");
  await refusal(without("connect").accounts(), "not_granted", "accounts without connect");
  await refusal(without("read_addresses").accounts(), "not_granted", "accounts without read_addresses");
  assert.throws(
    () => without("change_network").setNetwork(MAINNET),
    (err) => err instanceof SignerRefusal && err.kind === "not_granted",
  );
  assert.equal(r.reviews.length, 0);
  assert.equal(r.adapter.signed.length, 0);

  // Reading addresses does not need sign, and signing does not need to read them.
  const accounts = await without("sign").accounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]!.address, ok.signer);
  assert.equal(accounts[0]!.publicKey.typeUrl, SECP256K1_PUBLIC_KEY_URL);
  await without("read_addresses").signArbitrary(ok.signer, okData);
});

test("a caller is signed a document only of a domain its grant names", async () => {
  const vouch = vector("vouch_ok");
  const network = { chainId: vouch.challenge!.chain_id!, origin: vouch.challenge!.origin! };
  const r = rig({ key: keyOf(vouch), network, now: () => BigInt(vouch.now) });
  const data = utf8Encode(vouch.data);

  await refusal(r.signer.grant(SIGNUP).signArbitrary(vouch.signer, data), "not_granted", "a vouch from the signup flow");
  await refusal(r.signer.grant({ caller: "staking", capabilities: ["connect", "sign"] }).signArbitrary(vouch.signer, data), "not_granted", "no domain granted");
  assert.equal(r.reviews.length, 0);

  const flow = r.signer.grant({ caller: "vouch", capabilities: ["connect", "sign"], documents: [VOUCH_DOMAIN] });
  const { signature } = await flow.signArbitrary(vouch.signer, data);
  assert.equal(toBase64(signature), vouch.signature);
  assert.deepEqual(r.reviews[0]!.fields.at(-1), { label: "document.admission", value: { kind: "text", text: vouch.challenge!.admission } });
  assert.deepEqual(r.reviews[0]!.fields[1], { label: "document.kind", value: { kind: "choice", choice: "document.kind.vouch" } });
});

test("a grant is the signer's own copy, and one that names nothing real is refused", async () => {
  const r = rig();
  const capabilities: Capability[] = ["connect"];
  const handle = r.signer.grant({ caller: "feature", capabilities, documents: [SIGNUP_DOMAIN] });
  capabilities.push("sign");
  await refusal(handle.signArbitrary(ok.signer, okData), "not_granted", "widened after the grant");

  const invalid = (grant: Grant) =>
    assert.throws(
      () => r.signer.grant(grant),
      (err) => err instanceof SignerRefusal && err.kind === "invalid",
    );
  invalid({ caller: "", capabilities: [] });
  invalid({ caller: "feature", capabilities: ["everything" as Capability] });
  invalid({ caller: "feature", capabilities: ["sign"], documents: ["ark-signup/v2" as Domain] });
});

test("changing the network changes which documents are signed, for every caller", async () => {
  const local = vector("challenge_localnet_ok");
  const r = rig({ now: () => BigInt(local.now) });
  const signup = r.signer.grant(SIGNUP);
  await refusal(signup.signArbitrary(local.signer, utf8Encode(local.data)), "invalid");

  r.signer
    .grant({ caller: "settings", capabilities: ["change_network"] })
    .setNetwork({ chainId: local.challenge!.chain_id!, origin: local.challenge!.origin! });
  const { signature } = await signup.signArbitrary(local.signer, utf8Encode(local.data));
  assert.equal(toBase64(signature), local.signature);
  await refusal(signup.signArbitrary(ok.signer, okData), "invalid", "the network left behind");
});

test("an account is signed for by the adapter that holds it, and one no adapter holds is refused", async () => {
  const member = memoryAdapter(keyNamed("member"));
  const other = memoryAdapter(keyNamed("other"));
  const r = rig({ adapters: [other, member] });
  const handle = r.signer.grant(SIGNUP);
  await handle.signArbitrary(ok.signer, okData);
  assert.equal(member.signed.length, 1);
  assert.equal(other.signed.length, 0);
  assert.deepEqual(
    (await handle.accounts()).map((a) => a.address),
    [other.address, member.address],
  );

  await refusal(handle.signArbitrary(memoryAdapter(keyNamed("voucher")).address, okData), "invalid");
  assert.equal(r.reviews.length, 1);
});

test("an adapter that cannot list its accounts stops no other from signing, and is why an account no other holds is refused", async () => {
  const member = memoryAdapter(keyOf(ok));
  const other = memoryAdapter(keyNamed("other"));
  const lockedOut: KeyAdapter = { ...other, accounts: async () => Promise.reject(new SignerRefusal("locked_out", "too many attempts")) };
  const crashed: KeyAdapter = { ...other, accounts: async () => Promise.reject(new TypeError("the native module is not linked")) };

  for (const [name, adapters] of [
    ["the adapter that fails is asked first", [lockedOut, member]],
    ["the adapter that fails is asked second", [member, lockedOut]],
  ] as [string, KeyAdapter[]][]) {
    const r = rig({ adapters });
    const handle = r.signer.grant(SIGNUP);
    const { signature } = await handle.signArbitrary(ok.signer, okData);
    assert.equal(toBase64(signature), ok.signature, name);
    assert.deepEqual(
      (await handle.accounts()).map((a) => a.address),
      [member.address],
      name,
    );
    // The account asked for may be the one the failing adapter holds, so its refusal is the reason given.
    await refusal(handle.signArbitrary(other.address, okData), "locked_out", name);
    assert.equal(r.reviews.length, 1, name);
    assert.equal(other.signed.length, 0, name);
  }

  const beside = rig({ adapters: [crashed, member] }).signer.grant(SIGNUP);
  await beside.signArbitrary(ok.signer, okData);
  const err = await refusal(beside.signArbitrary(other.address, okData), "invalid");
  assert.ok(err.cause instanceof TypeError);

  // With nothing listed there is no account to report, and the first adapter's refusal says why.
  await refusal(
    rig({ adapters: [lockedOut, crashed] })
      .signer.grant(SIGNUP)
      .accounts(),
    "locked_out",
  );
  await refusal(
    rig({ adapters: [crashed, lockedOut] })
      .signer.grant(SIGNUP)
      .accounts(),
    "invalid",
  );
  await refusal(
    rig({ adapters: [lockedOut, { ...member, accounts: async () => [] }] })
      .signer.grant(SIGNUP)
      .accounts(),
    "locked_out",
  );
});

test("an adapter that can say whether its key can sign is asked before the review, and a key that cannot is refused with nothing shown", async () => {
  const good = memoryAdapter(keyOf(ok));
  const events: string[] = [];
  const asked: string[] = [];
  const saying: KeyAdapter = {
    ...good,
    ready: async (address) => {
      asked.push(address);
      events.push("ready");
    },
    sign: async (address, signBytes) => {
      events.push("sign");
      return good.sign(address, signBytes);
    },
  };
  const r = rig({
    adapters: [saying],
    answer: async () => {
      events.push("review");
      return "approved";
    },
  });
  const handle = r.signer.grant(SIGNUP);
  // Asked when the request's turn comes, not when it is made: the answer is of the moment the review is shown.
  await Promise.all([handle.signArbitrary(ok.signer, okData), handle.signArbitrary(ok.signer, okData)]);
  assert.deepEqual(events, ["ready", "review", "sign", "ready", "review", "sign"]);
  assert.deepEqual(asked, [ok.signer, ok.signer]);

  // A request refused for what it asks never reaches the key, to sign or to say whether it could.
  await refusal(r.signer.grant({ ...SIGNUP, documents: [VOUCH_DOMAIN] }).signArbitrary(ok.signer, okData), "not_granted");
  assert.equal(asked.length, 2);

  const cannot: [string, RefusalKind, () => Promise<void>][] = [
    ["a locked Ledger", "device_locked", async () => Promise.reject(new SignerRefusal("device_locked", "the Ledger is locked"))],
    ["a Ledger out of reach", "device_unavailable", async () => Promise.reject(new SignerRefusal("device_unavailable", "no device"))],
    ["an adapter that fails", "invalid", async () => Promise.reject(new TypeError("undefined is not a function"))],
  ];
  for (const [name, kind, ready] of cannot) {
    const key = memoryAdapter(keyOf(ok));
    const refused = rig({ adapters: [{ ...key, ready }] });
    const err = await refusal(refused.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), kind, name);
    if (kind === "invalid") assert.ok(err.cause instanceof TypeError, name);
    assert.equal(refused.reviews.length, 0, `${name}: nothing is shown`);
    assert.equal(key.signed.length, 0, `${name}: nothing reaches the key`);
  }
});

test("what a faulty adapter returns never leaves the signer", async () => {
  const good = memoryAdapter(keyOf(ok));
  const other = memoryAdapter(keyNamed("other"));
  const highS = fromBase64(vector("signature_high_s").signature);
  assert.equal(vector("signature_high_s").data, ok.data);
  const faulty: [string, KeyAdapter][] = [
    ["a high-S signature", { ...good, sign: async () => highS }],
    ["another key's signature", { ...good, sign: async (_address, signBytes) => other.sign(other.address, signBytes) }],
    ["a signature over other bytes", { ...good, sign: async (address) => good.sign(address, adr036SignBytes(address, utf8Encode("{}"))) }],
    ["a short signature", { ...good, sign: async () => new Uint8Array(63) }],
    ["a key that is not the address's", { ...good, accounts: async () => [{ address: good.address, publicKey: other.publicKey }] }],
    ["a key that is no key", { ...good, accounts: async () => [{ address: good.address, publicKey: new Uint8Array(33) }] }],
    ["no amino mode", { ...good, modes: ["direct"] }],
  ];
  for (const [name, adapter] of faulty) {
    const r = rig({ adapters: [adapter] });
    await refusal(r.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "invalid", name);
  }
  const lying = rig({ adapters: [{ ...good, accounts: async () => [{ address: good.address, publicKey: other.publicKey }] }] });
  await refusal(lying.signer.grant(SIGNUP).accounts(), "invalid", "accounts with a key that is not the address's");
});

test("an adapter's own refusal passes through, and anything else it throws is invalid with the cause kept", async () => {
  const good = memoryAdapter(keyOf(ok));
  const rejecting = rig({
    adapters: [{ ...good, sign: async () => Promise.reject(new SignerRefusal("rejected_on_device", "the member rejected the document on the device")) }],
  });
  await refusal(rejecting.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "rejected_on_device");

  const unplugged = rig({ adapters: [{ ...good, accounts: async () => Promise.reject(new SignerRefusal("device_unavailable", "no device")) }] });
  await refusal(unplugged.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "device_unavailable");
  await refusal(unplugged.signer.grant(SIGNUP).accounts(), "device_unavailable");

  const crashing = rig({ adapters: [{ ...good, sign: async () => Promise.reject(new TypeError("undefined is not a function")) }] });
  const err = await refusal(crashing.signer.grant(SIGNUP).signArbitrary(ok.signer, okData), "invalid");
  assert.ok(err.cause instanceof TypeError);
});
