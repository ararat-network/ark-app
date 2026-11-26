import assert from "node:assert/strict";
import { test } from "node:test";
import { randomPrivateKey, signMessage } from "@ararat-network/sdk";
import { checkOnDevice } from "./device-check.ts";
import type { KeystorePrompt } from "./native.ts";
import { fakeNative, nativeError } from "./testing/fake_native.ts";

const prompt = (purpose: "create" | "sign"): KeystorePrompt => ({ title: purpose, reason: purpose, cancel: "cancel" });

async function run(native: Parameters<typeof checkOnDevice>[0]): Promise<{ passed: boolean; lines: string[] }> {
  const lines: string[] = [];
  const passed = await checkOnDevice(native, { prompt, log: (line) => lines.push(line) });
  return { passed, lines };
}

test("on a phone that can hold a key the check makes one, signs twice, and leaves none behind", async () => {
  const native = fakeNative({ available: "passcode", hardware: "software" });
  const { passed, lines } = await run(native);
  assert.ok(passed, lines.join("\n"));
  const address = lines.find((line) => line.includes("created"))?.split("address=")[1];
  assert.deepEqual(lines, [
    "ark-keystore availability=passcode",
    "ark-keystore prompt=create",
    `ark-keystore created protection=passcode hardware=software address=${address}`,
    "ark-keystore prompt=sign",
    "ark-keystore signed=1",
    "ark-keystore prompt=sign",
    "ark-keystore signed=2",
    "ark-keystore create-refused=exists",
    "ark-keystore removed",
    "ark-keystore sign-refused=no_key",
    "ark-keystore device-check=ok protection=passcode hardware=software",
  ]);
  assert.equal(await native.key(), null);
  assert.equal(native.prompts.length, 3, "one prompt to make the key and one for each signature");
});

test("on a phone that can hold none the check passes when making one is refused for the reason given", async () => {
  const { passed, lines } = await run(fakeNative({ available: "no_passcode" }));
  assert.ok(passed);
  assert.deepEqual(lines, [
    "ark-keystore availability=no_passcode",
    "ark-keystore create-refused=no_passcode",
    "ark-keystore device-check=ok unavailable=no_passcode",
  ]);
});

test("a key already held is never touched: the check stops before doing anything", async () => {
  const native = fakeNative({ privateKey: randomPrivateKey() });
  const before = await native.key();
  const { passed, lines } = await run(native);
  assert.equal(passed, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /^ark-keystore device-check=refused /);
  assert.equal(await native.key(), before);
  assert.deepEqual(native.prompts, []);
});

test("a build with no native module fails the check", async () => {
  const { passed, lines } = await run(null);
  assert.equal(passed, false);
  assert.match(lines.at(-1) ?? "", /^ark-keystore device-check=failed start: /);
});

test("a signature that is not the key's fails the check, which removes the key it made", async () => {
  const native = fakeNative();
  const other = randomPrivateKey();
  native.sign = async (message) => signMessage(message, other);
  const { passed, lines } = await run(native);
  assert.equal(passed, false);
  assert.match(lines.at(-1) ?? "", /^ark-keystore device-check=failed sign 1: the signature is not the key's over the message$/);
  assert.equal(await native.key(), null);
});

test("a cancelled prompt fails the check at its step, by its kind", async () => {
  const atCreate = fakeNative();
  atCreate.failNext = nativeError("authentication_failed", "the member cancelled");
  const created = await run(atCreate);
  assert.equal(created.passed, false);
  assert.equal(created.lines.at(-1), "ark-keystore device-check=failed create: authentication_failed: the member cancelled");

  const atSign = fakeNative();
  const sign = atSign.sign;
  let calls = 0;
  atSign.sign = async (message, shown) => {
    calls += 1;
    if (calls === 2) throw nativeError("locked_out", "too many attempts");
    return sign(message, shown);
  };
  const signed = await run(atSign);
  assert.equal(signed.passed, false);
  assert.equal(signed.lines.at(-1), "ark-keystore device-check=failed sign 2: locked_out: too many attempts");
  assert.equal(await atSign.key(), null);
});

test("a phone that makes a key of another protection than it said fails the check", async () => {
  const native = fakeNative({ available: "biometric" });
  const create = native.create;
  native.create = async (shown) => {
    native.available = "passcode";
    return create(shown);
  };
  const { passed, lines } = await run(native);
  assert.equal(passed, false);
  assert.match(lines.at(-1) ?? "", /device-check=failed create: the key is passcode, and the phone had said biometric$/);
  assert.equal(await native.key(), null);
});

test("a create that is not refused where the phone said it would be fails the check and leaves no key", async () => {
  const native = fakeNative({ available: "no_passcode" });
  const create = native.create;
  native.create = async (shown) => {
    native.available = "passcode";
    return create(shown);
  };
  const { passed, lines } = await run(native);
  assert.equal(passed, false);
  assert.match(lines.at(-1) ?? "", /device-check=failed create on a phone that can have no key: making a key was not refused$/);
  assert.equal(await native.key(), null, "the key it should not have been given is removed");
});
