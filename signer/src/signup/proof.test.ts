import assert from "node:assert/strict";
import { test } from "node:test";
import { fromBase64, fromHex, publicKeyFromPrivate, publicKeyToAddress, signMessage, toBase64, utf8Decode, utf8Encode } from "@ararat-network/sdk";
import { signupVectors } from "../testing/vectors.ts";
import { DocumentError, parseDocument } from "./document.ts";
import {
  type ArbitrarySigner,
  checkSubmission,
  ProofError,
  type StatelessRefusal,
  signDocument,
  submissionFromJson,
  submissionToJson,
  verifySignature,
} from "./proof.ts";
import { adr036SignBytes } from "./signbytes.ts";

const { keys, vectors } = signupVectors();
const keyFor = (publicKey: string) => keys.find((k) => k.public_key === publicKey);
const STATELESS = new Set<string>(["signer_invalid", "key_mismatch", "signature_invalid", "data_invalid"]);

/** A signer over one private key, standing in for the keystore. */
function keySigner(privateKey: Uint8Array): ArbitrarySigner & { address: string } {
  const publicKey = publicKeyFromPrivate(privateKey);
  return {
    address: publicKeyToAddress(publicKey),
    async signArbitrary(address, data) {
      return { signature: signMessage(adr036SignBytes(address, data), privateKey), publicKey };
    },
  };
}

test("every vector's sign bytes are reproduced from signer and data", () => {
  assert.equal(vectors.length, 16);
  for (const v of vectors) {
    assert.equal(utf8Decode(adr036SignBytes(v.signer, utf8Encode(v.data))), v.sign_bytes, v.name);
  }
});

test("every valid signature is reproduced with the named key", () => {
  for (const v of vectors) {
    const key = keyFor(v.public_key);
    assert.ok(key, `${v.name}: the public key is one of the test keys`);
    const signature = signMessage(adr036SignBytes(v.signer, utf8Encode(v.data)), fromHex(key.private_key_hex));
    if (v.signature_valid) {
      assert.equal(toBase64(signature), v.signature, v.name);
    } else {
      assert.notEqual(toBase64(signature), v.signature, v.name);
    }
    const submission = submissionFromJson({ data: v.data, signer: v.signer, public_key: v.public_key, signature: v.signature });
    assert.equal(verifySignature(submission), v.signature_valid, `${v.name}: rule 3`);
  }
});

test("the stateless rules return the vectors' refusals in order", () => {
  for (const v of vectors) {
    const got = checkSubmission(submissionFromJson({ data: v.data, signer: v.signer, public_key: v.public_key, signature: v.signature }), v.prefix);
    const want: StatelessRefusal | undefined = STATELESS.has(v.expect) ? (v.expect as StatelessRefusal) : undefined;
    assert.equal(got, want, `${v.name}: expect ${v.expect}`);
  }
});

test("signDocument through a signer reproduces the ok vectors", async () => {
  for (const name of ["challenge_ok", "challenge_localnet_ok", "vouch_ok"]) {
    const v = vectors.find((x) => x.name === name)!;
    const key = keyFor(v.public_key)!;
    const signer = keySigner(fromHex(key.private_key_hex));
    const doc = parseDocument(utf8Encode(v.data));
    assert.deepEqual(doc, v.challenge);
    const submission = await signDocument(signer, signer.address, doc);
    const json = submissionToJson(submission);
    assert.deepEqual(json, { data: v.data, signer: v.signer, public_key: v.public_key, signature: v.signature }, name);
    assert.equal(checkSubmission(submission, v.prefix), undefined);
    const fromBytes = await signDocument(signer, signer.address, utf8Encode(v.data));
    assert.equal(toBase64(fromBytes.signature), v.signature);
  }
});

test("signDocument refuses bytes that are not a document, and a key that is not compressed secp256k1", async () => {
  const key = keys[0]!;
  const signer = keySigner(fromHex(key.private_key_hex));
  let asked = 0;
  const counting: ArbitrarySigner = {
    async signArbitrary(address, data) {
      asked++;
      return signer.signArbitrary(address, data);
    },
  };
  await assert.rejects(signDocument(counting, signer.address, utf8Encode("send 100noah to ark1...")), DocumentError);
  await assert.rejects(signDocument(counting, signer.address, utf8Encode(` ${vectors[0]!.data}`)), DocumentError);
  assert.equal(asked, 0, "nothing reaches the key for bytes that do not parse");

  const wrongKey: ArbitrarySigner = {
    async signArbitrary(address, data) {
      return { ...(await signer.signArbitrary(address, data)), publicKey: new Uint8Array(65) };
    },
  };
  await assert.rejects(signDocument(wrongKey, signer.address, utf8Encode(vectors[0]!.data)), ProofError);
});

test("the vector keys sign with the key their address names", () => {
  for (const k of keys) {
    const publicKey = publicKeyFromPrivate(fromHex(k.private_key_hex));
    assert.equal(publicKeyToAddress(publicKey), k.address);
    assert.equal(toBase64(publicKey), k.public_key);
  }
  assert.equal(fromBase64(keys[0]!.public_key).length, 33);
});
