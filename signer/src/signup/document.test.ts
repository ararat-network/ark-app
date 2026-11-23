import assert from "node:assert/strict";
import { test } from "node:test";
import { fromHex, publicKeyToAddress, utf8Decode, utf8Encode } from "@ararat-network/sdk";
import { signupVectors } from "../testing/vectors.ts";
import { DocumentError, documentBytes, parseDocument, type SignupDocument, validateDocument } from "./document.ts";
import { checkSubmission, submissionFromJson } from "./proof.ts";

const { vectors } = signupVectors();

const good: SignupDocument = {
  admission: "adm_0001",
  chain_id: "ark-1",
  domain: "ark-signup/v1",
  expires: "1761400600",
  issued: "1761400000",
  nonce: "201d7a011b4bdf066236967eb24b4d7a478aab24e4993ea2a169f422f7d82ce2",
  origin: "https://members.ararat.network",
};

test("the document grammar refuses what §4 forbids", () => {
  assert.doesNotThrow(() => validateDocument(good));
  assert.equal(utf8Decode(documentBytes(good)), vectors[0]!.data);
  const cases: [string, (d: SignupDocument) => void][] = [
    ["empty admission", (d) => (d.admission = "")],
    ["admission with a space", (d) => (d.admission = "adm 1")],
    ["admission too long", (d) => (d.admission = "a".repeat(129))],
    ["quote in a value", (d) => (d.chain_id = 'ark"1')],
    ["ampersand in a value", (d) => (d.admission = "a&b")],
    ["angle bracket in a value", (d) => (d.admission = "<adm>")],
    ["non-ASCII", (d) => (d.admission = "admé")],
    ["unknown domain", (d) => (d.domain = "ark-signup/v2")],
    ["expires not seconds", (d) => (d.expires = "2026-10-27")],
    ["expires before issued", (d) => (d.expires = "1761399999")],
    ["nonce uppercase", (d) => (d.nonce = d.nonce.toUpperCase())],
    ["nonce short", (d) => (d.nonce = d.nonce.slice(1))],
    ["origin with a path", (d) => (d.origin = "https://members.ararat.network/")],
    ["origin uppercase", (d) => (d.origin = "https://Members.ararat.network")],
    ["origin without a scheme", (d) => (d.origin = "members.ararat.network")],
  ];
  for (const [name, mutate] of cases) {
    const d = { ...good };
    mutate(d);
    assert.throws(() => validateDocument(d), DocumentError, name);
  }
  assert.doesNotThrow(() => validateDocument({ ...good, origin: "http://localhost:8080", chain_id: "localark" }));
});

test("an origin names a port only when it is not the scheme's default, and seconds fit a uint64", () => {
  assert.doesNotThrow(() => validateDocument({ ...good, origin: "https://members.ararat.network:8443" }));
  const cases: [string, Partial<SignupDocument>][] = [
    ["https on its default port", { origin: "https://members.ararat.network:443" }],
    ["http on its default port", { origin: "http://localhost:80", chain_id: "localark" }],
    ["a port past 65535", { origin: "https://members.ararat.network:70000" }],
    ["issued past a uint64", { issued: "18446744073709551616", expires: "18446744073709551617" }],
    ["expires past a uint64", { expires: "99999999999999999999" }],
  ];
  for (const [name, change] of cases) assert.throws(() => validateDocument({ ...good, ...change }), DocumentError, name);
});

test("parseDocument requires the canonical encoding", () => {
  assert.throws(() => parseDocument(utf8Encode("not json")), DocumentError);
  assert.throws(() => parseDocument(utf8Encode('{"hello":"world"}')), DocumentError);
  assert.throws(() => parseDocument(utf8Encode(JSON.stringify(good, null, 1))), /canonical/);
  const extra = { ...good, extra: "x" };
  assert.throws(() => parseDocument(utf8Encode(JSON.stringify(extra))), /exactly/);
  assert.deepEqual(parseDocument(documentBytes(good)), good);
});

test("rule 2 refuses a 33-byte key that is not a point as a key mismatch, before any signature is checked", () => {
  const ok = vectors.find((v) => v.name === "challenge_ok")!;
  // 0x05 is no compressed-point prefix, so the bytes name no point, though they hash to an address like any other.
  const notAPoint = fromHex(`05${"11".repeat(32)}`);
  const submission = { ...submissionFromJson(ok), publicKey: notAPoint, signer: publicKeyToAddress(notAPoint) };
  assert.equal(checkSubmission(submission), "key_mismatch");
});
