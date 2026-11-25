// Transactions through the pipeline: every fixture of ark's signed in each
// encoding as the SDK's builder asks for it, and what the signer refuses.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AminoSignDoc,
  aminoSignDocBytes,
  bytesEqual,
  decodeAminoSignDoc,
  directSignBytes,
  encodeAuthInfo,
  encodeTxBody,
  fromBase64,
  fromHex,
  makeAminoSignDoc,
  makeAuthInfo,
  makeFee,
  makeSignDoc,
  makeSignerInfo,
  makeTxBody,
  publicKeyFromPrivate,
  registry,
  SignMode,
  secp256k1PublicKey,
  signMessage,
  signTx,
  type TxBodyInput,
  type TxMessage,
  toBase64,
  typed,
  type UnsignedTx,
  utf8Decode,
  utf8Encode,
  verifyMessage,
} from "@ararat-network/sdk";
import { MsgExecSchema } from "@ararat-network/sdk/gen/cosmos/authz/v1beta1/tx_pb.js";
import { MsgSendSchema } from "@ararat-network/sdk/gen/cosmos/bank/v1beta1/tx_pb.js";
import type { SignDoc } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";
import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { KeyAdapter } from "./adapter.ts";
import type { Grant } from "./permissions.ts";
import { type RefusalKind, SignerRefusal } from "./refusal.ts";
import type { Review } from "./review/model.ts";
import { ReviewError } from "./review/transaction.ts";
import { createSigner, type Decision, type SignerHandle } from "./signer.ts";
import { SIGNUP_DOMAIN, VOUCH_DOMAIN } from "./signup/document.ts";
import { adr036SignBytes } from "./signup/signbytes.ts";
import { fixtureKey, txFixture, txFixtures, unsignedTx } from "./testing/fixtures.ts";
import { type MemoryAdapter, memoryAdapter } from "./testing/memory_adapter.ts";
import { signupVectors } from "./testing/vectors.ts";
import { holdAmino } from "./transaction.ts";

const CHAIN = "ark-fixtures-1";
const NETWORK = { chainId: CHAIN, origin: "https://members.ararat.network" };
const WALLET: Grant = { caller: "wallet", capabilities: ["connect", "read_addresses", "sign"], transactions: true };
const MEMBER_KEY = fromHex(fixtureKey("member").private_key_hex);
const OTHER_KEY = fromHex(fixtureKey("validator").private_key_hex);
const MEMBER = fixtureKey("member").address;
const OTHER = fixtureKey("validator").address;
const FEE = makeFee({ amount: [{ denom: "anoah", amount: "26250000000000000" }], gasLimit: 250000n });

interface Rig {
  adapter: MemoryAdapter;
  reviews: Review[];
  attachments: unknown[];
  handle: SignerHandle;
}

/** A signer over one key in memory, with a review screen that records what it is shown and answers as told. */
function rig(
  options: { key?: Uint8Array; adapters?: KeyAdapter[]; grant?: Grant; chainId?: string; answer?: (review: Review) => Promise<Decision> } = {},
): Rig {
  const adapter = memoryAdapter(options.key ?? MEMBER_KEY);
  const reviews: Review[] = [];
  const attachments: unknown[] = [];
  const signer = createSigner({
    adapters: options.adapters ?? [adapter],
    network: { ...NETWORK, chainId: options.chainId ?? CHAIN },
    present: async (review, attachment) => {
      reviews.push(review);
      attachments.push(attachment);
      return options.answer ? options.answer(review) : "approved";
    },
  });
  return { adapter, reviews, attachments, handle: signer.grant(options.grant ?? WALLET) };
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

const send = (amount = "5"): TxMessage =>
  typed(MsgSendSchema, create(MsgSendSchema, { fromAddress: MEMBER, toAddress: OTHER, amount: [{ denom: "anoah", amount }] }));

/** A transaction of the member's, as the SDK's builder takes it. */
function tx(body: Partial<TxBodyInput> = {}, mode: "direct" | "amino" = "direct"): UnsignedTx {
  return { messages: [send()], ...body, address: MEMBER, chainId: CHAIN, accountNumber: 2n, sequence: body.unordered ? 0n : 4n, fee: FEE, mode, registry };
}

/** A direct sign document built by hand, so a test can write one the SDK's builder would not. */
function directDoc(options: { bodyBytes?: Uint8Array; key?: Uint8Array; mode?: SignMode; signers?: number; chainId?: string } = {}): SignDoc {
  const publicKey = secp256k1PublicKey(publicKeyFromPrivate(options.key ?? MEMBER_KEY));
  const signer = makeSignerInfo(publicKey, 4n, options.mode ?? SignMode.DIRECT);
  return makeSignDoc({
    bodyBytes: options.bodyBytes ?? encodeTxBody(makeTxBody({ messages: [send()] })),
    authInfoBytes: encodeAuthInfo(
      makeAuthInfo(
        Array.from({ length: options.signers ?? 1 }, () => signer),
        FEE,
      ),
    ),
    chainId: options.chainId ?? CHAIN,
    accountNumber: 2n,
  });
}

function aminoDoc(body: Partial<TxBodyInput> = {}): AminoSignDoc {
  return makeAminoSignDoc({ body: makeTxBody({ messages: [send()], ...body }), fee: FEE, chainId: CHAIN, accountNumber: 2n, sequence: 4n });
}

for (const f of txFixtures()) {
  test(`${f.name}: signed through the pipeline in each encoding, from one review`, async () => {
    const key = fromHex(fixtureKey(f.signer.key).private_key_hex);

    const direct = rig({ key, chainId: f.chain_id });
    const signed = await signTx(unsignedTx(f, "direct"), direct.handle);
    assert.equal(toBase64(direct.adapter.signed[0]!), f.sign_mode_direct.sign_doc, "the direct sign bytes");
    assert.equal(toBase64(signed.signature), f.signature, "the signature");
    assert.equal(toBase64(signed.txBytes), f.tx_bytes, "the transaction's bytes");
    assert.equal(signed.hash, f.tx_hash, "the hash");

    const amino = rig({ key, chainId: f.chain_id });
    const signedAmino = await signTx(unsignedTx(f, "amino"), amino.handle);
    assert.equal(utf8Decode(amino.adapter.signed[0]!), f.sign_mode_amino.sign_bytes, "the amino sign bytes");
    assert.ok(verifyMessage(signedAmino.signature, amino.adapter.signed[0]!, amino.adapter.publicKey), "the amino signature");

    assert.equal(direct.adapter.signed.length + amino.adapter.signed.length, 2, "one signature for each approval");
    assert.equal(direct.reviews.length, 1);
    assert.equal(direct.reviews[0]!.kind, "transaction");
    assert.equal(direct.reviews[0]!.caller, "wallet");
    assert.equal(direct.reviews[0]!.account, f.signer.address);
    assert.deepEqual(amino.reviews, direct.reviews, "the amino document's review is the direct document's");
  });
}

test("an attachment reaches the review screen as it was given, beside the review of one document and no other", async () => {
  const { handle, reviews, attachments, adapter } = rig();
  const quote = { declared: [{ denom: "anoah", amount: "26250000000000000" }] };
  const request = handle.attach(quote);
  assert.deepEqual(await request.accounts(), await handle.accounts());
  await signTx(tx(), request);
  assert.equal(attachments[0], quote);

  await refusal(signTx(tx(), request), "invalid", "a second document with the attachment");
  await refusal(request.signAmino(MEMBER, aminoDoc()), "invalid", "a second document, in the other encoding");
  assert.equal(reviews.length, 1);
  assert.equal(adapter.signed.length, 1);

  await signTx(tx(), handle);
  assert.equal(attachments[1], undefined, "nothing is attached to a request made on the handle itself");
});

test("a decline, an answer that is not an approval, and a review screen that fails each sign nothing", async () => {
  const answers: [() => Promise<Decision>, RefusalKind][] = [
    [async () => "declined", "declined"],
    [async () => "yes" as Decision, "declined"],
    [async () => Promise.reject(new Error("the screen crashed")), "invalid"],
  ];
  for (const [answer, kind] of answers) {
    for (const mode of ["direct", "amino"] as const) {
      const { handle, adapter, reviews } = rig({ answer });
      await refusal(signTx(tx({}, mode), handle), kind);
      assert.equal(reviews.length, 1);
      assert.equal(adapter.signed.length, 0);
    }
  }
});

test("a transaction is signed for a caller granted transactions, and for no other", async () => {
  const grants: Grant[] = [
    { caller: "wallet", capabilities: ["connect", "read_addresses", "sign"] },
    { caller: "signup", capabilities: ["connect", "read_addresses", "sign"], documents: [SIGNUP_DOMAIN] },
    { caller: "wallet", capabilities: ["connect", "read_addresses"], transactions: true },
    { caller: "wallet", capabilities: ["sign"], transactions: true },
  ];
  for (const grant of grants) {
    const { handle, adapter, reviews } = rig({ grant });
    await refusal(handle.signDirect(MEMBER, directDoc()), "not_granted", JSON.stringify(grant));
    await refusal(handle.signAmino(MEMBER, aminoDoc()), "not_granted", JSON.stringify(grant));
    await refusal(handle.attach({}).signDirect(MEMBER, directDoc()), "not_granted", JSON.stringify(grant));
    assert.equal(reviews.length + adapter.signed.length, 0);
  }
});

test("a transaction for another chain, or for an account the signer does not hold, is refused before review", async () => {
  const { handle, adapter, reviews } = rig();
  await refusal(handle.signDirect(MEMBER, directDoc({ chainId: "ark-1" })), "invalid");
  await refusal(handle.signAmino(MEMBER, { ...aminoDoc(), chain_id: "ark-1" }), "invalid");
  await refusal(handle.signDirect(OTHER, directDoc({ key: OTHER_KEY })), "invalid");
  await refusal(handle.signAmino(OTHER, aminoDoc()), "invalid");
  assert.equal(reviews.length + adapter.signed.length, 0);
});

test("an account reports the encodings its key signs, and direct is refused for a key that signs amino alone", async () => {
  const ledgerLike = memoryAdapter(MEMBER_KEY, ["amino"]);
  const { handle, reviews } = rig({ adapters: [ledgerLike] });
  assert.deepEqual(
    (await handle.accounts()).map((a) => a.modes),
    [["amino"]],
  );
  await refusal(signTx(tx({}, "direct"), handle), "invalid");
  assert.equal(reviews.length, 0);
  const signed = await signTx(tx({}, "amino"), handle);
  assert.ok(verifyMessage(signed.signature, ledgerLike.signed[0]!, ledgerLike.publicKey));
});

test("what is signed is fixed before review: a document changed while the member reads is not what is signed", async () => {
  const direct = directDoc();
  const before = directSignBytes(direct);
  const first = rig({
    answer: async () => {
      direct.bodyBytes[direct.bodyBytes.length - 1]! ^= 1;
      direct.chainId = "ark-1";
      return "approved";
    },
  });
  const signedDirect = await first.handle.signDirect(MEMBER, direct);
  assert.ok(bytesEqual(first.adapter.signed[0]!, before));
  assert.ok(bytesEqual(directSignBytes(signedDirect.signDoc), before), "the document handed back is the one signed");

  const amino = aminoDoc();
  const beforeAmino = aminoSignDocBytes(amino);
  const second = rig({
    answer: async () => {
      amino.memo = "changed";
      amino.fee.amount[0]!.amount = "1";
      return "approved";
    },
  });
  const signedAmino = await second.handle.signAmino(MEMBER, amino);
  assert.ok(bytesEqual(second.adapter.signed[0]!, beforeAmino));
  assert.ok(bytesEqual(aminoSignDocBytes(signedAmino.signDoc), beforeAmino), "the document handed back is the one signed");
});

test("a signature the chain would refuse is not handed back", async () => {
  const good = memoryAdapter(MEMBER_KEY);
  const faults: [string, (signBytes: Uint8Array) => Uint8Array][] = [
    ["another key's", (b) => signMessage(b, OTHER_KEY)],
    ["over other bytes", () => signMessage(new Uint8Array([1]), MEMBER_KEY)],
    ["too short", (b) => signMessage(b, MEMBER_KEY).slice(0, 63)],
    ["not bytes", () => "signature" as unknown as Uint8Array],
  ];
  for (const [name, sign] of faults) {
    const faulty: KeyAdapter = { modes: good.modes, accounts: () => good.accounts(), sign: async (_address, signBytes) => sign(signBytes) };
    const { handle } = rig({ adapters: [faulty] });
    await refusal(signTx(tx(), handle), "invalid", name);
    await refusal(signTx(tx({}, "amino"), handle), "invalid", name);
  }
});

test("a key adapter's own refusal passes through", async () => {
  const good = memoryAdapter(MEMBER_KEY);
  const rejecting: KeyAdapter = {
    modes: good.modes,
    accounts: () => good.accounts(),
    sign: async () => Promise.reject(new SignerRefusal("rejected_on_device", "rejected on the device")),
  };
  const { handle } = rig({ adapters: [rejecting] });
  await refusal(signTx(tx(), handle), "rejected_on_device");
});

test("a transaction is built and signed through the SDK beside an adapter that cannot list its accounts", async () => {
  const good = memoryAdapter(MEMBER_KEY);
  const failing: KeyAdapter = { ...memoryAdapter(OTHER_KEY), accounts: async () => Promise.reject(new SignerRefusal("locked_out", "too many attempts")) };
  // The SDK asks for the signer's accounts before it builds the document.
  const { handle, reviews } = rig({ adapters: [failing, good] });
  for (const mode of ["direct", "amino"] as const) {
    const signed = await signTx(tx({}, mode), handle);
    assert.ok(verifyMessage(signed.signature, good.signed.at(-1)!, good.publicKey), mode);
  }
  assert.equal(reviews.length, 2);
  await refusal(handle.signDirect(OTHER, directDoc({ key: OTHER_KEY })), "locked_out");
});

/** A protobuf field no type here has: number 1000, a varint. */
const UNKNOWN_FIELD = new Uint8Array([0xc0, 0x3e, 0x01]);
const withUnknownField = (bytes: Uint8Array): Uint8Array => new Uint8Array([...bytes, ...UNKNOWN_FIELD]);

test("a direct document review could not show whole is refused before review", async () => {
  const sendBytes = toBinary(MsgSendSchema, create(MsgSendSchema, { fromAddress: MEMBER, toAddress: OTHER, amount: [{ denom: "anoah", amount: "5" }] }));
  const sendWithMore = create(AnySchema, { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: withUnknownField(sendBytes) });
  const carried = typed(MsgExecSchema, create(MsgExecSchema, { grantee: MEMBER, msgs: [sendWithMore] }));
  const memoThenMessages = new Uint8Array([...encodeTxBody(makeTxBody({ messages: [], memo: "m" })), ...encodeTxBody(makeTxBody({ messages: [send()] }))]);
  const refused: [string, SignDoc][] = [
    ["another key as its signer", directDoc({ key: OTHER_KEY })],
    ["a signer that signs amino", directDoc({ mode: SignMode.LEGACY_AMINO_JSON })],
    ["two signers", directDoc({ signers: 2 })],
    ["no signer", directDoc({ signers: 0 })],
    ["a field of the body the signer's types do not have", directDoc({ bodyBytes: withUnknownField(encodeTxBody(makeTxBody({ messages: [send()] }))) })],
    ["a field of a message the signer's types do not have", directDoc({ bodyBytes: encodeTxBody(makeTxBody({ messages: [sendWithMore] })) })],
    ["such a field in a message another carries", directDoc({ bodyBytes: encodeTxBody(makeTxBody({ messages: [carried] })) })],
    ["a body not in the encoding the chain writes", directDoc({ bodyBytes: memoThenMessages })],
    ["bytes that are no body", directDoc({ bodyBytes: new Uint8Array([0xff, 0xff, 0xff]) })],
    ["no message", directDoc({ bodyBytes: encodeTxBody(makeTxBody({ messages: [] })) })],
  ];
  const { handle, adapter, reviews } = rig();
  for (const [name, doc] of refused) await refusal(handle.signDirect(MEMBER, doc), "invalid", name);
  const none = await refusal(handle.signDirect(MEMBER, refused.at(-1)![1]), "invalid");
  assert.ok(none.cause instanceof ReviewError);
  await refusal(handle.signDirect(MEMBER, {} as SignDoc), "invalid", "no document at all");
  assert.equal(reviews.length + adapter.signed.length, 0);
});

test("an amino document that cannot be read whole is refused before review", async () => {
  const doc = aminoDoc();
  const refused: [string, AminoSignDoc][] = [
    ["a member the document does not have", { ...doc, tip: "1" } as AminoSignDoc],
    [
      "a member of a message its type does not have",
      { ...doc, msgs: [{ type: "cosmos-sdk/MsgSend", value: { ...(doc.msgs[0]!.value as object), more: "1" } }] },
    ],
    ["a type the signer does not have", { ...doc, msgs: [{ type: "ark/MsgNew", value: {} }] }],
    ["no message", { ...doc, msgs: [] }],
    ["an unordered document with no time", { ...doc, unordered: true, sequence: "0" }],
  ];
  const { handle, adapter, reviews } = rig();
  for (const [name, bad] of refused) await refusal(handle.signAmino(MEMBER, bad), "invalid", name);
  await refusal(handle.signAmino(MEMBER, { msgs: 1n } as unknown as AminoSignDoc), "invalid", "no document at all");
  assert.equal(reviews.length + adapter.signed.length, 0);
});

test("a signup or vouch document is not signed as a transaction: its ADR-036 sign document is refused before review", async () => {
  // Signed as a transaction, a document would pass none of what the sign-arbitrary call asks of it: a grant of its
  // domain, the membership service's origin, and an expiry still ahead.
  const grants: Grant[] = [WALLET, { ...WALLET, documents: [SIGNUP_DOMAIN, VOUCH_DOMAIN] }];
  for (const name of ["challenge_ok", "vouch_ok"]) {
    const data = utf8Encode(signupVectors().vectors.find((v) => v.name === name)!.data);
    const doc = JSON.parse(utf8Decode(adr036SignBytes(MEMBER, data))) as AminoSignDoc;
    assert.equal(doc.chain_id, "", "an ADR-036 sign document names no chain");
    // On a signer whose network named no chain either, the chain would not be what refuses it.
    for (const chainId of [CHAIN, ""]) {
      for (const grant of grants) {
        const { handle, adapter, reviews } = rig({ grant, chainId });
        await refusal(handle.signAmino(MEMBER, doc), "invalid", `${name} on "${chainId}"`);
        await refusal(handle.attach({}).signAmino(MEMBER, doc), "invalid", `${name} on "${chainId}", with an attachment`);
        assert.equal(reviews.length + adapter.signed.length, 0, name);
      }
    }
  }
});

test("an amino document that does not encode back to itself is refused, so a faulty decoder stops a signature", () => {
  const doc = aminoDoc({ memo: "to the validator" });
  assert.ok(bytesEqual(holdAmino(doc).signBytes, aminoSignDocBytes(doc)));
  const faults: [string, typeof decodeAminoSignDoc][] = [
    [
      "drops the memo",
      (d) => {
        const decoded = decodeAminoSignDoc(d);
        decoded.body.memo = "";
        return decoded;
      },
    ],
    ["reads another amount", (d) => ({ ...decodeAminoSignDoc(d), body: makeTxBody({ messages: [send("6")], memo: "to the validator" }) })],
    ["reads another fee", (d) => ({ ...decodeAminoSignDoc(d), fee: makeFee({ amount: [], gasLimit: 250000n }) })],
  ];
  for (const [name, decode] of faults) {
    assert.throws(
      () => holdAmino(doc, decode),
      (err) => err instanceof SignerRefusal && err.kind === "invalid" && /does not encode back to itself/.test(err.message),
      name,
    );
  }
});

test("a type the signer does not have is signed direct once reviewed as unknown, and has no amino document to sign", async () => {
  const future = create(AnySchema, { typeUrl: "/ark.future.v1.MsgNew", value: new Uint8Array([10, 3, 97, 114, 107]) });
  const { handle, adapter, reviews } = rig();
  const signed = await signTx(tx({ messages: [future] }), handle);
  assert.ok(verifyMessage(signed.signature, adapter.signed[0]!, adapter.publicKey));
  const review = reviews[0]!;
  assert.equal(review.kind, "transaction");
  if (review.kind !== "transaction") return;
  assert.deepEqual(review.messages, [{ kind: "unknown", typeUrl: "/ark.future.v1.MsgNew", json: { "@type": "/ark.future.v1.MsgNew", value: "CgNhcms=" } }]);
});

test("an unordered transaction is signed in each encoding from one review, which shows the time it is valid until", async () => {
  const until = timestampFromDate(new Date("2026-11-25T12:00:30Z"));
  const direct = rig();
  const amino = rig();
  const signed = await signTx(tx({ unordered: true, timeoutTimestamp: until }, "direct"), direct.handle);
  const signedAmino = await signTx(tx({ unordered: true, timeoutTimestamp: until }, "amino"), amino.handle);
  assert.ok(verifyMessage(signed.signature, direct.adapter.signed[0]!, direct.adapter.publicKey));
  assert.ok(verifyMessage(signedAmino.signature, amino.adapter.signed[0]!, amino.adapter.publicKey));
  assert.match(utf8Decode(amino.adapter.signed[0]!), /"sequence":"0","timeout_timestamp":"2026-11-25T12:00:30Z","unordered":true\}$/);
  assert.deepEqual(amino.reviews, direct.reviews);
  assert.deepEqual(direct.reviews[0]!.fields.slice(-2), [
    { label: "transaction.ordering", value: { kind: "choice", choice: "transaction.ordering.unordered" } },
    { label: "transaction.valid_until", value: { kind: "time", unixSeconds: "1795608030" } },
  ]);
});

test("the fixture's own direct document is signed as given, with nothing built again", async () => {
  const f = txFixture("staking_delegate");
  const { handle } = rig();
  const doc = makeSignDoc({
    bodyBytes: fromBase64(f.sign_mode_direct.body_bytes),
    authInfoBytes: fromBase64(f.sign_mode_direct.auth_info_bytes),
    chainId: f.chain_id,
    accountNumber: BigInt(f.signer.account_number),
  });
  assert.equal(toBase64((await handle.signDirect(MEMBER, doc)).signature), f.signature);
});
