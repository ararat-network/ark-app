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

const PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";

test("the seed phrase is opened for the word pieces after a prompt, and what stops it is a kind", async () => {
  const native = fakeNative({ privateKey: randomPrivateKey() });
  const keystore = deviceKeystore(native, { prompt });
  await keystore.showSeedPhrase();
  assert.equal(native.seedPhraseShown, true);
  assert.deepEqual(native.prompts, [prompt("seed_phrase")]);
  await keystore.hideSeedPhrase();
  assert.equal(native.seedPhraseShown, false);

  native.captured = true;
  assert.equal((await keystoreError(() => keystore.showSeedPhrase())).kind, "screen_captured");
  native.captured = false;
  native.failNext = nativeError("authentication_failed");
  assert.equal((await keystoreError(() => keystore.showSeedPhrase())).kind, "authentication_failed");
  assert.equal(native.seedPhraseShown, false);

  native.invalidate();
  assert.equal((await keystoreError(() => keystore.showSeedPhrase())).kind, "key_invalidated");
  assert.equal((await keystoreError(() => deviceKeystore(fakeNative(), { prompt }).showSeedPhrase())).kind, "no_key");
});

test("the app hears why the seed phrase closed by itself, until it stops listening, and nothing that is no reason", async () => {
  const native = fakeNative({ privateKey: randomPrivateKey() });
  const keystore = deviceKeystore(native, { prompt });
  const heard: string[] = [];
  const stop = keystore.onSeedPhraseHidden((reason) => heard.push(reason));

  await keystore.showSeedPhrase();
  native.closeByItself("background");
  await keystore.showSeedPhrase();
  native.closeByItself("capture");
  for (const payload of [{ reason: "boredom" }, { reason: 7 }, {}, null, "background"]) native.send("onSeedPhraseClosed", payload);
  assert.deepEqual(heard, ["background", "capture"]);

  stop();
  await keystore.showSeedPhrase();
  native.closeByItself("background");
  assert.deepEqual(heard, ["background", "capture"]);
});

test("a key is restored from a seed phrase handed over in a development build alone", async () => {
  const phone = deviceKeystore(fakeNative({ hardware: "strongbox" }), { prompt });
  assert.equal((await keystoreError(() => phone.restoreDevelopmentKey(PHRASE))).kind, "failed");
  assert.equal(await phone.key(), null);

  const native = fakeNative({ available: "none", hardware: "software", development: true });
  const keystore = deviceKeystore(native, { prompt });
  const key = await keystore.restoreDevelopmentKey(PHRASE);
  assert.equal(key.address, publicKeyToAddress(key.publicKey));
  assert.deepEqual(native.prompts, [prompt("restore")]);
  assert.deepEqual(await keystore.key(), key);
  assert.equal((await keystoreError(() => keystore.restoreDevelopmentKey(PHRASE))).kind, "exists");
  assert.equal(
    (await keystoreError(() => deviceKeystore(fakeNative({ development: true }), { prompt }).restoreDevelopmentKey("not words"))).kind,
    "invalid_seed_phrase",
  );
});

test("the entry moves on by itself as words are taken, and the app hears where it is and never a letter", async () => {
  const native = fakeNative();
  const keystore = deviceKeystore(native, { prompt });
  const changes: unknown[] = [];
  const words: unknown[] = [];
  const stopChanges = keystore.onEntryChange((change) => changes.push(change));
  const stopWords = keystore.onEntryWord((word) => words.push(word));

  native.type("le");
  native.enter("legal");
  native.enter("winner");
  assert.deepEqual(changes, [{ position: 0, typing: "typing", suggestions: 1 }]);
  assert.deepEqual(words, [
    { position: 0, next: 1, entered: 1 },
    { position: 1, next: 2, entered: 2 },
  ]);
  assert.equal(native.entryPosition, 2, "moved by the native side, before the app said anything");

  // Back to a word, to change it: the app moves the entry, and the word taken there moves it on again.
  await keystore.moveEntry(0);
  native.enter("zoo");
  assert.deepEqual(words.at(-1), { position: 0, next: 1, entered: 2 });
  await keystore.moveEntry(99);
  assert.equal(native.entryPosition, 23, "no further than the last word");

  // What native code sends is checked: an event that is not what it must be is not passed on.
  const [before, beforeWords] = [changes.length, words.length];
  for (const payload of [
    { position: 24, typing: "typing", suggestions: 1 },
    { position: 0, typing: "shouting", suggestions: 1 },
    { position: 0, typing: "typing" },
    null,
  ]) {
    native.send("onEntryChange", payload);
  }
  for (const payload of [{ position: 0, next: 24, entered: 1 }, { position: 0, next: 1, entered: 25 }, { position: -1, next: 0, entered: 1 }, "word"]) {
    native.send("onEntryWord", payload);
  }
  assert.equal(changes.length, before);
  assert.equal(words.length, beforeWords);

  stopChanges();
  stopWords();
  native.type("x");
  native.enter("abandon");
  assert.equal(changes.length, before);
  assert.equal(words.length, beforeWords);
});

test("what a member enters is held against the key: right, wrong, and unfinished", async () => {
  const native = fakeNative({ development: true });
  const keystore = deviceKeystore(native, { prompt });
  await keystore.restoreDevelopmentKey(PHRASE);

  assert.equal(await keystore.checkSeedPhrase(), "incomplete");
  for (const word of PHRASE.split(" ")) native.enter(word);
  assert.equal(await keystore.checkSeedPhrase(), "match");
  assert.deepEqual(await keystore.seedPhraseMistakes(), []);

  await keystore.moveEntry(6);
  native.enter("worthy");
  await keystore.moveEntry(2);
  native.enter("legal");
  assert.equal(await keystore.checkSeedPhrase(), "no_match");
  assert.deepEqual(await keystore.seedPhraseMistakes(), [2, 6], "the positions that are wrong, in order");

  // Checking asks nothing of the member; finding the mistakes asks them to authenticate, each time.
  assert.deepEqual(native.prompts, [prompt("restore"), prompt("seed_phrase"), prompt("seed_phrase")]);
});

test("what stops the mistakes being found is a kind, and an answer that is no positions is a fault", async () => {
  const native = fakeNative({ development: true });
  const keystore = deviceKeystore(native, { prompt });
  assert.equal((await keystoreError(() => keystore.seedPhraseMistakes())).kind, "no_key");
  await keystore.restoreDevelopmentKey(PHRASE);
  native.failNext = nativeError("authentication_failed");
  assert.equal((await keystoreError(() => keystore.seedPhraseMistakes())).kind, "authentication_failed");

  for (const answer of [[24], [-1], [1.5], [3, 3], ["3"], "3", null]) {
    native.entryMistakes = async () => answer as number[];
    assert.equal((await keystoreError(() => keystore.seedPhraseMistakes())).kind, "failed", JSON.stringify(answer));
  }
  native.checkEntry = async () => "probably";
  assert.equal((await keystoreError(() => keystore.checkSeedPhrase())).kind, "failed");
});

test("a key is restored from the seed phrase a member entered, and from nothing less", async () => {
  const native = fakeNative({ available: "passcode", hardware: "strongbox" });
  const keystore = deviceKeystore(native, { prompt });
  const words = PHRASE.split(" ");

  for (const word of words.slice(0, 23)) native.enter(word);
  assert.equal((await keystoreError(() => keystore.restoreFromSeedPhrase())).kind, "invalid_seed_phrase");
  native.enter("zoo");
  assert.equal((await keystoreError(() => keystore.restoreFromSeedPhrase())).kind, "invalid_seed_phrase", "24 words whose checksum fails");
  assert.equal(await keystore.key(), null);

  native.enter("title");
  const key = await keystore.restoreFromSeedPhrase();
  assert.equal(key.hardware, "strongbox", "a phone's own build restores, from what was entered and from nothing JavaScript holds");
  assert.deepEqual(await keystore.key(), key);
  assert.equal(await keystore.checkSeedPhrase(), "match");
  assert.equal((await keystoreError(() => keystore.restoreFromSeedPhrase())).kind, "exists");

  await keystore.clearEntry();
  assert.equal(await keystore.checkSeedPhrase(), "incomplete");
  assert.equal(native.entryPosition, 0);
});
