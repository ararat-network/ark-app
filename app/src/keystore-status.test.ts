import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KEY_HARDWARE,
  KEY_PROTECTIONS,
  KEYSTORE_CHECKS,
  KEYSTORE_ERRORS,
  KEYSTORE_PROMPT_PURPOSES,
  KeystoreError,
  SEED_PHRASE_HIDDEN,
} from "@ararat-network/signer/keystore";
import { keyStatus, keystoreErrorString, keystorePrompt, keystoreStatus, seedPhraseHiddenString } from "./keystore-status";
import { type StringKey, strings } from "./strings";

const has = (key: string): key is StringKey => key in strings && strings[key as StringKey].length > 0;

test("every outcome of the keystore's check has a string of its own", () => {
  const keys = KEYSTORE_CHECKS.map(keystoreStatus);
  assert.equal(new Set(keys).size, KEYSTORE_CHECKS.length);
  for (const key of keys) assert.ok(has(key), key);
});

test("every protection and every hardware a key can have has a string of its own", () => {
  const seen = new Set<string>();
  for (const protection of KEY_PROTECTIONS) {
    for (const hardware of KEY_HARDWARE) {
      const keys = keyStatus({ protection, hardware, invalidated: false });
      assert.equal(keys.length, 2);
      for (const key of keys) {
        assert.ok(has(key), key);
        seen.add(key);
      }
    }
  }
  assert.equal(seen.size, KEY_PROTECTIONS.length + KEY_HARDWARE.length);
});

test("no key, and a key the phone no longer opens, are each said", () => {
  assert.deepEqual(keyStatus(null), ["scaffold.key.none"]);
  assert.deepEqual(keyStatus({ protection: "biometric", hardware: "strongbox", invalidated: true }), [
    "scaffold.key.invalidated",
    "scaffold.key.protection.biometric",
    "scaffold.key.hardware.strongbox",
  ]);
});

test("every kind of keystore error has a string of its own, and anything else the general one", () => {
  const keys = KEYSTORE_ERRORS.map((kind) => keystoreErrorString(new KeystoreError(kind, "a diagnostic no member reads")));
  assert.equal(new Set(keys).size, KEYSTORE_ERRORS.length);
  for (const key of keys) assert.ok(has(key), key);
  // A refusal from the signer's pipeline carries a kind too, and the kinds the keystore shares with it read the same.
  assert.equal(keystoreErrorString({ kind: "locked_out" }), "keystore.error.locked_out");
  for (const other of [new Error("no kind"), { kind: "declined" }, { kind: 7 }, "text", null, undefined]) {
    assert.equal(keystoreErrorString(other), "keystore.error.failed");
  }
});

test("every prompt has a title, a reason, and a cancel button, and one made to sign reads otherwise than one made to show the words", () => {
  for (const purpose of KEYSTORE_PROMPT_PURPOSES) {
    const prompt = keystorePrompt(purpose);
    for (const text of [prompt.title, prompt.reason, prompt.cancel]) assert.ok(text.length > 0, purpose);
  }
  const reasons = new Set(["create", "sign", "seed_phrase"].map((purpose) => keystorePrompt(purpose as "create" | "sign" | "seed_phrase").reason));
  assert.equal(reasons.size, 3);
});

test("every reason the words are hidden for has a string of its own", () => {
  const keys = SEED_PHRASE_HIDDEN.map(seedPhraseHiddenString);
  assert.equal(new Set(keys).size, SEED_PHRASE_HIDDEN.length);
  for (const key of keys) assert.ok(has(key), key);
});
