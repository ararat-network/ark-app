// The Ledger adapter against exchanges recorded from the Ark device app on
// the emulator (testdata/ledger/exchanges.json, written by the emulator tests
// with RECORD=1), and against answers the emulator does not give, a locked
// device, another app, an older app, a dropped connection, written here from
// the recorded ones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromHex, isLowS, publicKeyFromPrivate, publicKeyToAddress, toHex, utf8Encode, verifyMessage } from "@ararat-network/sdk";
import type { AdapterAccount } from "../src/adapter.ts";
import { type RefusalKind, SignerRefusal } from "../src/refusal.ts";
import { createSigner } from "../src/signer.ts";
import { SIGNUP_DOMAIN } from "../src/signup/document.ts";
import { checkSubmission, signDocument } from "../src/signup/proof.ts";
import { adr036SignBytes } from "../src/signup/signbytes.ts";
import { fixtureKey, txFixture } from "../src/testing/fixtures.ts";
import { signupVectors } from "../src/testing/vectors.ts";
import { LEDGER_BUFFER_SIZE, type LedgerSession, ledgerAdapter, pairLedger } from "./adapter.ts";
import { type Exchange, replay } from "./testing/replay.ts";

interface Scenario {
  exchanges: Exchange[];
  address?: string;
  publicKey?: string;
  signature?: string;
  signBytes?: string;
  data?: string;
}

const recording = JSON.parse(readFileSync(new URL("../testdata/ledger/exchanges.json", import.meta.url), "utf8")) as { scenarios: Record<string, Scenario> };
const scenario = (name: string): Scenario => {
  const found = recording.scenarios[name];
  if (!found) throw new Error(`no recorded scenario ${name}`);
  return found;
};

const paired = scenario("pair");
const ACCOUNT: AdapterAccount = { address: paired.address!, publicKey: fromHex(paired.publicKey!) };
const DELEGATE = utf8Encode(txFixture("staking_delegate").sign_mode_amino.sign_bytes);
const delegate = scenario("sign_staking_delegate");
const FIXTURES = ["staking_delegate", "gov_vote", "bank_send_taxed", "distribution_withdraw_delegator_reward", "multi_message"];

/** The three commands before a signature, as recorded: which app is open, its version, and the device's account. */
const [APP_INFO, VERSION, ADDRESS] = delegate.exchanges as [Exchange, Exchange, Exchange];

const adapterOver = (session: LedgerSession, account: AdapterAccount = ACCOUNT) => ledgerAdapter({ account, connect: async () => session });

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

const ascii = (text: string): string => toHex(utf8Encode(text));
const lengthByte = (hex: string): string => (hex.length / 2).toString(16).padStart(2, "0");
/** The device's answer to "which app is open", for an app of another name or version. */
function appInfo(name: string, version: string): Exchange {
  const [n, v] = [ascii(name), ascii(version)];
  return { ...APP_INFO, data: `01${lengthByte(n)}${n}${lengthByte(v)}${v}0100` };
}

/** The recorded version answer with another version, or with the device locked. */
function version(change: { version?: [number, number, number]; locked?: boolean }): Exchange {
  const data = fromHex(VERSION.data);
  // Test mode, then major, minor, and patch of one byte each or two, then whether the device is locked, then its target.
  const width = data.length === 9 ? 1 : data.length === 12 ? 2 : 0;
  assert.notEqual(width, 0, `the recorded version answer is ${data.length} bytes`);
  change.version?.forEach((part, i) => {
    const at = 1 + i * width;
    if (width === 2) data[at] = part >> 8;
    data[at + width - 1] = part & 0xff;
  });
  if (change.locked !== undefined) data[1 + 3 * width] = change.locked ? 1 : 0;
  return { ...VERSION, data: toHex(data) };
}

const answering = (exchange: Exchange, status: string, data = ""): Exchange => ({ ...exchange, status, data });

test("the recording was made by the commands this adapter sends: which app, its version, the account, then the document", () => {
  assert.equal(APP_INFO.apdu, "b001000000");
  assert.equal(VERSION.apdu, "5500000000");
  assert.match(ADDRESS.apdu, /^55040000/);
  assert.ok(delegate.exchanges.slice(3).every((e) => e.apdu.startsWith("5502")));
  // The document is sent as it was handed over, after the path and the prefix, in pieces of at most 250 bytes.
  const sent = delegate.exchanges
    .slice(4)
    .map((e) => e.apdu.slice(10))
    .join("");
  assert.equal(sent, toHex(DELEGATE));
});

test("pairing shows the address on the device and returns the account the member confirmed there", async () => {
  const device = replay(paired.exchanges);
  assert.deepEqual(await pairLedger(device.session), ACCOUNT);
  assert.equal(device.used(), paired.exchanges.length);
  assert.match(device.sent.at(-1)!, /^55040100/, "the address is asked for with the device showing it");
  assert.equal(publicKeyToAddress(ACCOUNT.publicKey), ACCOUNT.address);
});

test("an account is reported without the device, and the adapter signs amino alone", async () => {
  const adapter = ledgerAdapter({ account: ACCOUNT, connect: () => Promise.reject(new Error("the device was asked")) });
  assert.deepEqual(adapter.modes, ["amino"]);
  assert.deepEqual(await adapter.accounts(), [ACCOUNT]);
});

for (const name of FIXTURES) {
  test(`${name}: the recorded device signs the fixture's amino document, as 64 bytes with a low S`, async () => {
    const recorded = scenario(`sign_${name}`);
    const signBytes = utf8Encode(txFixture(name).sign_mode_amino.sign_bytes);
    const device = replay(recorded.exchanges);
    const signature = await adapterOver(device.session).sign(ACCOUNT.address, signBytes);
    assert.equal(toHex(signature), recorded.signature);
    assert.equal(signature.length, 64);
    assert.ok(isLowS(signature));
    assert.ok(verifyMessage(signature, signBytes, ACCOUNT.publicKey));
    assert.equal(device.used(), recorded.exchanges.length);
  });
}

test("an unordered document is sent as it is handed over, and signed", async () => {
  const recorded = scenario("sign_unordered");
  const signBytes = utf8Encode(recorded.signBytes!);
  assert.match(recorded.signBytes!, /"sequence":"0","timeout_timestamp":"[^"]+","unordered":true\}$/);
  const device = replay(recorded.exchanges);
  const signature = await adapterOver(device.session).sign(ACCOUNT.address, signBytes);
  assert.equal(toHex(signature), recorded.signature);
  assert.ok(verifyMessage(signature, signBytes, ACCOUNT.publicKey));
});

test("a signup challenge goes through the pipeline to the device, and the proof passes the protocol's stateless rules", async () => {
  const recorded = scenario("sign_signup_challenge");
  const challenge = signupVectors().vectors.find((v) => v.name === "challenge_ok")!;
  assert.equal(recorded.data, challenge.data);
  const device = replay(recorded.exchanges);
  const signer = createSigner({
    adapters: [adapterOver(device.session)],
    network: { chainId: challenge.challenge!.chain_id!, origin: challenge.challenge!.origin! },
    now: () => BigInt(challenge.now),
    present: async () => "approved",
  });
  const signup = signer.grant({ caller: "signup", capabilities: ["connect", "read_addresses", "sign"], documents: [SIGNUP_DOMAIN] });
  const submission = await signDocument(signup, ACCOUNT.address, utf8Encode(challenge.data));
  assert.equal(checkSubmission(submission), undefined);
  assert.equal(toHex(submission.signature), recorded.signature);
  assert.ok(verifyMessage(submission.signature, adr036SignBytes(ACCOUNT.address, submission.data), ACCOUNT.publicKey));
});

test("a document the member rejected on the device is refused as rejected there", async () => {
  const recorded = scenario("reject");
  assert.equal(recorded.exchanges.at(-1)!.status, "6986");
  await refusal(adapterOver(replay(recorded.exchanges).session).sign(ACCOUNT.address, DELEGATE), "rejected_on_device");
});

test("a Ledger that holds another account is not the one that signs, and is sent no document", async () => {
  const recorded = scenario("another_account");
  const publicKey = publicKeyFromPrivate(fromHex(fixtureKey("member").private_key_hex));
  const other: AdapterAccount = { address: publicKeyToAddress(publicKey), publicKey };
  const device = replay(recorded.exchanges);
  await refusal(adapterOver(device.session, other).sign(other.address, DELEGATE), "device_unavailable");
  assert.ok(device.sent.every((apdu) => !apdu.startsWith("5502")));
});

test("another app, no app, a locked device, and an app before 2.3.0 are each refused by their own kind, and sent no document", async () => {
  const cases: [string, RefusalKind, Exchange[]][] = [
    ["the Cosmos app, which answers the same commands", "wrong_app", [appInfo("Cosmos", "2.38.0")]],
    ["no app open", "wrong_app", [appInfo("BOLOS", "1.6.1")]],
    ["an app that does not know the command", "wrong_app", [answering(APP_INFO, "6e00")]],
    ["an app that is not open", "wrong_app", [answering(APP_INFO, "6e01")]],
    ["a locked device", "device_locked", [answering(APP_INFO, "5515")]],
    ["a device that says it is locked", "device_locked", [APP_INFO, version({ locked: true })]],
    ["an app at 2.2.9", "app_outdated", [APP_INFO, version({ version: [2, 2, 9] })]],
    ["an app at 1.9.9", "app_outdated", [APP_INFO, version({ version: [1, 9, 9] })]],
  ];
  for (const [name, kind, exchanges] of cases) {
    const device = replay(exchanges);
    await refusal(adapterOver(device.session).sign(ACCOUNT.address, DELEGATE), kind, name);
    await refusal(pairLedger(replay(exchanges).session), kind, `pairing with ${name}`);
    assert.ok(
      device.sent.every((apdu) => !apdu.startsWith("5502")),
      name,
    );
  }
});

test("the first app that signs an unordered document, and any after it, is signed with", async () => {
  for (const at of [
    [2, 3, 0],
    [2, 4, 0],
    [3, 0, 0],
  ] as [number, number, number][]) {
    const exchanges = [APP_INFO, version({ version: at }), ...delegate.exchanges.slice(2)];
    assert.equal(toHex(await adapterOver(replay(exchanges).session).sign(ACCOUNT.address, DELEGATE)), delegate.signature, at.join("."));
  }
});

test("a device that cannot be reached, or stops answering, is unavailable", async () => {
  const dropped = new Error("the connection dropped");
  for (const at of [0, 1, 2, 3, delegate.exchanges.length - 1]) {
    await refusal(
      adapterOver(replay(delegate.exchanges, { at, error: dropped }).session).sign(ACCOUNT.address, DELEGATE),
      "device_unavailable",
      `dropped at ${at}`,
    );
  }
  await refusal(pairLedger(replay(paired.exchanges, { at: 2, error: dropped }).session), "device_unavailable");
  const unreachable = ledgerAdapter({ account: ACCOUNT, connect: () => Promise.reject(new Error("no device in range")) });
  await refusal(unreachable.sign(ACCOUNT.address, DELEGATE), "device_unavailable");
  const refusing = ledgerAdapter({ account: ACCOUNT, connect: () => Promise.reject(new SignerRefusal("device_locked", "the phone's Bluetooth is off")) });
  await refusal(refusing.sign(ACCOUNT.address, DELEGATE), "device_locked", "the client's own refusal passes through");
});

test("an answer that is a fault, not something a member can act on, is invalid", async () => {
  const last = delegate.exchanges.length - 1;
  const withLast = (exchange: Exchange): Exchange[] => [...delegate.exchanges.slice(0, last), exchange];
  const final = delegate.exchanges[last]!;
  const faults: [string, Exchange[]][] = [
    ["a document the device could not parse", withLast(answering(final, "6984"))],
    ["a document past the device's buffer", withLast(answering(final, "6988"))],
    ["a path the device does not derive at", [APP_INFO, VERSION, answering(ADDRESS, "698b")]],
    ["a signature that is not DER", withLast({ ...final, data: "00".repeat(64) })],
    ["a signature with bytes after it", withLast({ ...final, data: `${final.data}00` })],
    ["a key that is not the address's", [APP_INFO, VERSION, { ...ADDRESS, data: `02${"11".repeat(32)}${ADDRESS.data.slice(66)}` }]],
    ["no version at all", [APP_INFO, { ...VERSION, data: "" }]],
  ];
  for (const [name, exchanges] of faults) {
    await refusal(adapterOver(replay(exchanges).session).sign(ACCOUNT.address, DELEGATE), "invalid", name);
  }
});

test("a document past the device's buffer, and one for an address the adapter does not hold, are refused with the device not asked", async () => {
  let asked = 0;
  const adapter = ledgerAdapter({
    account: ACCOUNT,
    connect: () => {
      asked++;
      return Promise.reject(new Error("the device was asked"));
    },
  });
  await refusal(adapter.sign(ACCOUNT.address, new Uint8Array(LEDGER_BUFFER_SIZE + 1)), "invalid");
  await refusal(adapter.sign(fixtureKey("member").address, DELEGATE), "invalid");
  assert.equal(asked, 0);
  // At the buffer's size the device is asked.
  await refusal(adapter.sign(ACCOUNT.address, new Uint8Array(LEDGER_BUFFER_SIZE)), "device_unavailable");
  assert.equal(asked, 1);
});

test("an account whose key is not its address's is not an account to make an adapter for", () => {
  const connect = () => Promise.reject(new Error("unused"));
  assert.throws(
    () => ledgerAdapter({ account: { address: fixtureKey("member").address, publicKey: ACCOUNT.publicKey }, connect }),
    (err) => err instanceof SignerRefusal && err.kind === "invalid",
  );
  assert.throws(
    () => ledgerAdapter({ account: { address: ACCOUNT.address, publicKey: new Uint8Array(33) }, connect }),
    (err) => err instanceof SignerRefusal && err.kind === "invalid",
  );
});

test("the device reviews one document at a time: a second signature waits for the first, and a failed one does not stop the next", async () => {
  const vote = scenario("sign_gov_vote");
  const voteBytes = utf8Encode(txFixture("gov_vote").sign_mode_amino.sign_bytes);
  const rejected = scenario("reject");
  // A replay fails on a command out of order, so the three succeed only if none overlaps another.
  const device = replay([...delegate.exchanges, ...rejected.exchanges, ...vote.exchanges]);
  const adapter = adapterOver(device.session);
  const [first, second, third] = await Promise.allSettled([
    adapter.sign(ACCOUNT.address, DELEGATE),
    adapter.sign(ACCOUNT.address, DELEGATE),
    adapter.sign(ACCOUNT.address, voteBytes),
  ]);
  assert.equal(first.status === "fulfilled" && toHex(first.value), delegate.signature);
  assert.equal(second.status === "rejected" && (second.reason as SignerRefusal).kind, "rejected_on_device");
  assert.equal(third.status === "fulfilled" && toHex(third.value), vote.signature);
});

test("the bytes signed are the adapter's own copy: changing them after the call changes nothing sent", async () => {
  const bytes = Uint8Array.from(DELEGATE);
  const device = replay(delegate.exchanges);
  const signing = adapterOver(device.session).sign(ACCOUNT.address, bytes);
  bytes.fill(0);
  assert.equal(toHex(await signing), delegate.signature);
});
