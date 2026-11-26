import assert from "node:assert/strict";
import { test } from "node:test";
import { publicKeyFromPrivate, publicKeyToAddress, randomPrivateKey, utf8Encode, verifyMessage } from "@ararat-network/sdk";
import { REFUSAL_KINDS, SignerRefusal } from "../src/refusal.ts";
import { deviceKeystore, isDevelopmentKey, type KeystorePromptPurpose } from "./keystore.ts";
import { KEYSTORE_ERROR_CODE, KEYSTORE_ERRORS, KeystoreError, type KeystoreNative, type KeystorePrompt, keystoreErrorOf, type NativeKey } from "./native.ts";
import { fakeNative, nativeError } from "./testing/fake_native.ts";

const prompt = (purpose: KeystorePromptPurpose): KeystorePrompt => ({ title: `title of ${purpose}`, reason: `reason to ${purpose}`, cancel: "cancel" });
const message = utf8Encode("what is signed");

const rejection = async (call: () => Promise<unknown>): Promise<unknown> => {
  try {
    await call();
  } catch (thrown) {
    return thrown;
  }
  return assert.fail("the call was not refused");
};
const keystoreError = async (call: () => Promise<unknown>): Promise<KeystoreError> => {
  const thrown = await rejection(call);
  assert.ok(thrown instanceof KeystoreError, `a KeystoreError, not ${String(thrown)}`);
  return thrown;
};
const refusal = async (call: () => Promise<unknown>): Promise<SignerRefusal> => {
  const thrown = await rejection(call);
  assert.ok(thrown instanceof SignerRefusal, `a SignerRefusal, not ${String(thrown)}`);
  return thrown;
};

test("a phone with no key has none, and its adapter no account", async () => {
  const keystore = deviceKeystore(fakeNative(), { prompt });
  assert.equal(await keystore.key(), null);
  assert.deepEqual(await keystore.adapter.accounts(), []);
  assert.deepEqual(keystore.adapter.modes, ["direct", "amino"]);
});

test("a key is made once, with the address of its public key and the protection the phone gave it", async () => {
  const native = fakeNative({ available: "passcode", hardware: "strongbox" });
  const keystore = deviceKeystore(native, { prompt });
  assert.deepEqual(await keystore.availability(), { available: true, protection: "passcode" });

  const key = await keystore.create();
  assert.equal(key.address, publicKeyToAddress(key.publicKey));
  assert.equal(key.protection, "passcode");
  assert.equal(key.hardware, "strongbox");
  assert.equal(key.invalidated, false);
  assert.equal(isDevelopmentKey(key), false);
  assert.deepEqual(native.prompts, [prompt("create")]);
  assert.deepEqual(await keystore.key(), key);
  assert.deepEqual(await keystore.adapter.accounts(), [{ address: key.address, publicKey: key.publicKey }]);

  assert.equal((await keystoreError(() => keystore.create())).kind, "exists");
  assert.deepEqual(await keystore.key(), key, "a refused create leaves the key held");
});

test("a phone that can be given no key says why, and making one is refused with the same reason", async () => {
  for (const reason of ["no_passcode", "no_biometrics", "no_hardware"] as const) {
    const keystore = deviceKeystore(fakeNative({ available: reason }), { prompt });
    assert.deepEqual(await keystore.availability(), { available: false, reason });
    assert.equal((await keystoreError(() => keystore.create())).kind, reason);
    assert.equal(await keystore.key(), null);
  }
});

test("the adapter signs the bytes it is given with the held key, after a prompt for each", async () => {
  const privateKey = randomPrivateKey();
  const native = fakeNative({ privateKey });
  const { adapter } = deviceKeystore(native, { prompt });
  const address = publicKeyToAddress(publicKeyFromPrivate(privateKey));

  await adapter.ready?.(address);
  assert.deepEqual(native.prompts, [], "saying it can sign shows the member nothing");

  const first = await adapter.sign(address, message);
  const second = await adapter.sign(address, utf8Encode("another"));
  assert.equal(first.length, 64);
  assert.ok(verifyMessage(first, message, publicKeyFromPrivate(privateKey)));
  assert.ok(verifyMessage(second, utf8Encode("another"), publicKeyFromPrivate(privateKey)));
  assert.deepEqual(native.prompts, [prompt("sign"), prompt("sign")]);
  assert.deepEqual(native.signed, [message, utf8Encode("another")]);
});

test("an address that is not the held key's is refused, and nothing is signed or shown", async () => {
  const native = fakeNative({ privateKey: randomPrivateKey() });
  const { adapter } = deviceKeystore(native, { prompt });
  const other = publicKeyToAddress(publicKeyFromPrivate(randomPrivateKey()));
  assert.equal((await refusal(() => adapter.sign(other, message))).kind, "invalid");
  assert.equal((await refusal(async () => adapter.ready?.(other))).kind, "invalid");
  assert.deepEqual(native.prompts, []);

  const empty = deviceKeystore(fakeNative(), { prompt }).adapter;
  assert.equal((await refusal(() => empty.sign(other, message))).kind, "invalid");
});

test("a key the phone no longer opens is still the member's account, and is refused by its kind before any prompt", async () => {
  const privateKey = randomPrivateKey();
  const native = fakeNative({ privateKey });
  const keystore = deviceKeystore(native, { prompt });
  const address = publicKeyToAddress(publicKeyFromPrivate(privateKey));
  native.invalidate();

  assert.equal((await keystore.key())?.invalidated, true);
  assert.equal((await keystore.adapter.accounts()).length, 1);
  assert.equal((await refusal(async () => keystore.adapter.ready?.(address))).kind, "key_invalidated");
  assert.equal((await refusal(() => keystore.adapter.sign(address, message))).kind, "key_invalidated");
  assert.deepEqual(native.prompts, []);
});

test("what stops a signature on the phone is a refusal of the kind the app acts on, and a fault is invalid", async () => {
  const privateKey = randomPrivateKey();
  const address = publicKeyToAddress(publicKeyFromPrivate(privateKey));
  const cases = [
    ["authentication_failed", "authentication_failed"],
    ["locked_out", "locked_out"],
    // Found only when the member has authenticated: the hardware refuses the key it had not said was gone.
    ["key_invalidated", "key_invalidated"],
    ["failed", "invalid"],
    ["no_hardware", "invalid"],
  ] as const;
  for (const [thrown, kind] of cases) {
    const native = fakeNative({ privateKey });
    native.failNext = nativeError(thrown);
    const refused = await refusal(() => deviceKeystore(native, { prompt }).adapter.sign(address, message));
    assert.equal(refused.kind, kind, thrown);
    assert.ok(refused.cause instanceof KeystoreError);
    assert.deepEqual(native.signed, []);
  }
  const native = fakeNative({ privateKey });
  native.failNext = new Error("no code at all");
  assert.equal((await refusal(() => deviceKeystore(native, { prompt }).adapter.sign(address, message))).kind, "invalid");
});

test("every kind the adapter refuses with is one the signer has", () => {
  for (const kind of ["authentication_failed", "locked_out", "key_invalidated", "invalid"])
    assert.ok((REFUSAL_KINDS as readonly string[]).includes(kind), kind);
});

test("an answer from native code that is not what it must be is a fault", async () => {
  const good: NativeKey = { publicKey: publicKeyFromPrivate(randomPrivateKey()), protection: "biometric", hardware: "secure_enclave", invalidated: false };
  const withKey = (key: unknown): KeystoreNative => ({ ...fakeNative(), key: async () => key as NativeKey });
  const bad: [string, unknown][] = [
    ["a public key of the wrong length", { ...good, publicKey: good.publicKey.slice(1) }],
    ["a public key that is no point", { ...good, publicKey: new Uint8Array(33) }],
    ["a public key that is no bytes", { ...good, publicKey: "02ab" }],
    ["a protection it does not know", { ...good, protection: "pattern" }],
    ["hardware it does not know", { ...good, hardware: "cloud" }],
    ["no word on invalidation", { ...good, invalidated: undefined }],
    ["a key with no authentication in real hardware", { ...good, protection: "none" }],
    ["a string", "key"],
  ];
  for (const [what, key] of bad) {
    assert.equal((await keystoreError(() => deviceKeystore(withKey(key), { prompt }).key())).kind, "failed", what);
    assert.equal((await refusal(() => deviceKeystore(withKey(key), { prompt }).adapter.sign("ark1", message))).kind, "invalid", what);
  }

  assert.equal((await keystoreError(() => deviceKeystore(fakeNative({ available: "sometimes" }), { prompt }).availability())).kind, "failed");

  for (const signature of [new Uint8Array(63), new Uint8Array(65), "signature", null]) {
    const native = fakeNative({ privateKey: randomPrivateKey() });
    const held = await native.key();
    native.sign = async () => signature as Uint8Array;
    const refused = await refusal(() => deviceKeystore(native, { prompt }).adapter.sign(publicKeyToAddress(held?.publicKey ?? new Uint8Array()), message));
    assert.equal(refused.kind, "invalid");
  }
});

test("the Simulator's key, with no authentication on it, is a development key and no other is", async () => {
  const keystore = deviceKeystore(fakeNative({ available: "none", hardware: "software" }), { prompt });
  const key = await keystore.create();
  assert.equal(key.protection, "none");
  assert.ok(isDevelopmentKey(key));
  assert.ok(isDevelopmentKey({ hardware: "software" }));
  for (const hardware of ["secure_enclave", "strongbox", "trusted_environment"] as const) assert.ok(!isDevelopmentKey({ hardware }));
});

test("a removed key is gone, and another can be made", async () => {
  const keystore = deviceKeystore(fakeNative(), { prompt });
  const first = await keystore.create();
  await keystore.remove();
  assert.equal(await keystore.key(), null);
  const second = await keystore.create();
  assert.notEqual(second.address, first.address);
});

test("a native rejection is read by its code, and anything else is a fault", () => {
  for (const kind of KEYSTORE_ERRORS) {
    const error = keystoreErrorOf(nativeError(kind, "why"));
    assert.equal(error.kind, kind);
    assert.equal(error.message, "why");
  }
  assert.equal(keystoreErrorOf(Object.assign(new Error("x"), { code: `${KEYSTORE_ERROR_CODE}UNHEARD_OF` })).kind, "failed");
  assert.equal(keystoreErrorOf(Object.assign(new Error("x"), { code: "ERR_SOMETHING_ELSE" })).kind, "failed");
  assert.equal(keystoreErrorOf(Object.assign(new Error("x"), { code: 7 })).kind, "failed");
  assert.equal(keystoreErrorOf("a string").kind, "failed");
  assert.equal(keystoreErrorOf(null).kind, "failed");
  const already = new KeystoreError("locked_out", "kept");
  assert.equal(keystoreErrorOf(already), already);
});

test("the words are drawn by the native view after a prompt, and what stops it is a kind", async () => {
  const native = fakeNative({ privateKey: randomPrivateKey() });
  const keystore = deviceKeystore(native, { prompt });
  await keystore.showWords(native.wordsView);
  assert.equal(native.wordsView.shown, true);
  assert.deepEqual(native.prompts, [prompt("words")]);

  await native.wordsView.hide();
  native.wordsView.captured = true;
  assert.equal((await keystoreError(() => keystore.showWords(native.wordsView))).kind, "screen_captured");
  native.wordsView.captured = false;
  native.failNext = nativeError("authentication_failed");
  assert.equal((await keystoreError(() => keystore.showWords(native.wordsView))).kind, "authentication_failed");
  assert.equal(native.wordsView.shown, false);

  native.invalidate();
  assert.equal((await keystoreError(() => keystore.showWords(native.wordsView))).kind, "key_invalidated");
  const empty = fakeNative();
  assert.equal((await keystoreError(() => deviceKeystore(empty, { prompt }).showWords(empty.wordsView))).kind, "no_key");
});

test("a key is restored from its words in a development build alone", async () => {
  const words =
    "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";
  const phone = deviceKeystore(fakeNative({ hardware: "strongbox" }), { prompt });
  assert.equal((await keystoreError(() => phone.restoreDevelopmentKey(words))).kind, "failed");
  assert.equal(await phone.key(), null);

  const native = fakeNative({ available: "none", hardware: "software", development: true });
  const keystore = deviceKeystore(native, { prompt });
  const key = await keystore.restoreDevelopmentKey(words);
  assert.equal(key.address, publicKeyToAddress(key.publicKey));
  assert.deepEqual(native.prompts, [prompt("restore")]);
  assert.deepEqual(await keystore.key(), key);
  assert.equal((await keystoreError(() => keystore.restoreDevelopmentKey(words))).kind, "exists");
  assert.equal((await keystoreError(() => deviceKeystore(fakeNative({ development: true }), { prompt }).restoreDevelopmentKey("not words"))).kind, "failed");
});
