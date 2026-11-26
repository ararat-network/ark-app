import assert from "node:assert/strict";
import { test } from "node:test";
import { checkKeystore, KEYSTORE_MODULE, type KeystoreNative } from "./index.ts";

test("a build with no native module has no keystore", () => {
  assert.equal(checkKeystore(null), "unavailable");
  assert.equal(checkKeystore(undefined), "unavailable");
});

test("the core's own answer decides, and only a plain true is a pass", () => {
  assert.equal(checkKeystore({ selfCheck: () => true }), "ok");
  assert.equal(checkKeystore({ selfCheck: () => false }), "failed");
  assert.equal(checkKeystore({ selfCheck: () => 1 as unknown as boolean }), "failed");
  assert.equal(checkKeystore({ selfCheck: () => undefined as unknown as boolean }), "failed");
});

test("a core that throws has failed", () => {
  const throwing: Pick<KeystoreNative, "selfCheck"> = {
    selfCheck: () => {
      throw new Error("the library did not load");
    },
  };
  assert.equal(checkKeystore(throwing), "failed");
});

test("the module's name is the one Swift and Kotlin register", () => {
  assert.equal(KEYSTORE_MODULE, "ArkKeystore");
});
