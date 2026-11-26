import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidMnemonic, privateKeyFromMnemonic, publicKeyFromPrivate, publicKeyToAddress, randomPrivateKey, signMessage } from "@ararat-network/sdk";
import { checkOnDevice, DEVICE_CHECK_SEED_PHRASE } from "./device-check.ts";
import type { KeystorePromptPurpose } from "./keystore.ts";
import type { KeystorePrompt } from "./native.ts";
import { fakeNative, nativeError } from "./testing/fake_native.ts";

const prompt = (purpose: KeystorePromptPurpose): KeystorePrompt => ({ title: purpose, reason: purpose, cancel: "cancel" });

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

test("the words the check restores from are a seed's, and published", () => {
  assert.ok(isValidMnemonic(DEVICE_CHECK_SEED_PHRASE));
  assert.equal(DEVICE_CHECK_SEED_PHRASE.split(" ").length, 24);
});

test("a development build is also held to a key the check knows: restored, signed with as the SDK signs, shown, entered, and restored again", async () => {
  const native = fakeNative({ available: "none", hardware: "software", development: true });
  const lines: string[] = [];
  let waited = 0;
  const passed = await checkOnDevice(native, {
    prompt,
    log: (line) => lines.push(line),
    whileSeedPhraseShown: async () => {
      assert.equal(native.seedPhraseShown, true, "the seed phrase is open while the check waits");
      waited += 1;
    },
  });
  assert.ok(passed, lines.join("\n"));
  const address = publicKeyToAddress(publicKeyFromPrivate(privateKeyFromMnemonic(DEVICE_CHECK_SEED_PHRASE)));
  assert.deepEqual(lines.slice(lines.indexOf("ark-keystore sign-refused=no_key") + 1), [
    "ark-keystore prompt=restore",
    `ark-keystore restored address=${address}`,
    "ark-keystore prompt=sign",
    "ark-keystore signed-as-sdk=1",
    "ark-keystore prompt=seed-phrase",
    "ark-keystore seed-phrase-shown=1",
    "ark-keystore seed-phrase-hidden=1",
    "ark-keystore restore-refused=exists",
    "ark-keystore entered-matches=1",
    "ark-keystore prompt=mistakes",
    "ark-keystore entered-mistake=23",
    "ark-keystore entry-restore-refused=invalid_seed_phrase",
    "ark-keystore prompt=restore",
    "ark-keystore restored-from-entry=1",
    "ark-keystore device-check=ok protection=none hardware=software restored=1 seed-phrase=1 entry=1",
  ]);
  assert.equal(waited, 1);
  assert.equal(native.seedPhraseShown, false);
  assert.equal(await native.key(), null, "nothing is left behind");
  assert.deepEqual(native.entered, [], "and nothing entered");
});

test("an entry that calls a wrong seed phrase right fails the check, which removes the key", async () => {
  const native = fakeNative({ development: true });
  native.checkEntry = async () => "match";
  const lines: string[] = [];
  assert.equal(await checkOnDevice(native, { prompt, log: (line) => lines.push(line) }), false);
  assert.equal(lines.at(-1), "ark-keystore device-check=failed find the mistake in an entered seed phrase: a seed phrase with a wrong word, entered, is match");
  assert.equal(await native.key(), null);
});

test("a build that can be handed a key and no entry is checked without the entry", async () => {
  const native = fakeNative({ development: true });
  native.fillEntry = undefined;
  const lines: string[] = [];
  assert.ok(await checkOnDevice(native, { prompt, log: (line) => lines.push(line) }));
  assert.ok(!lines.some((line) => line.includes("entered-")));
  assert.equal(lines.at(-1), "ark-keystore device-check=ok protection=biometric hardware=secure_enclave restored=1 seed-phrase=1");
});

test("a restored key that signs otherwise than the SDK fails the check, which removes it", async () => {
  const native = fakeNative({ development: true });
  const sign = native.sign;
  let calls = 0;
  const other = randomPrivateKey();
  native.sign = async (message, shown) => {
    calls += 1;
    // Two for the key it made, one refused once that key is removed, and the fourth is the restored key's.
    return calls === 4 ? signMessage(message, other) : sign(message, shown);
  };
  const lines: string[] = [];
  assert.equal(await checkOnDevice(native, { prompt, log: (line) => lines.push(line) }), false);
  assert.equal(lines.at(-1), "ark-keystore device-check=failed sign as the SDK signs: the signature is not the one the SDK makes with the same key");
  assert.equal(await native.key(), null);
});

test("a seed phrase that is not opened fails the check at that step, by the kind, and the restored key is removed", async () => {
  const native = fakeNative({ development: true });
  native.captured = true;
  const lines: string[] = [];
  assert.equal(await checkOnDevice(native, { prompt, log: (line) => lines.push(line) }), false);
  assert.match(lines.at(-1) ?? "", /^ark-keystore device-check=failed draw the seed phrase: screen_captured: /);
  assert.equal(await native.key(), null);
});
