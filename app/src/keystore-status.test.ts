import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYSTORE_CHECKS } from "@ararat-network/signer/keystore";
import { keystoreStatus } from "./keystore-status";
import { strings } from "./strings";

test("every outcome of the keystore's check has a string of its own", () => {
  const keys = KEYSTORE_CHECKS.map(keystoreStatus);
  assert.equal(new Set(keys).size, KEYSTORE_CHECKS.length);
  for (const key of keys) assert.ok(strings[key].length > 0, key);
});
