// A native module in memory, for the tests: it answers as Swift and Kotlin
// do, with a private key held in JavaScript where theirs is under the phone's
// hardware. Test-only.
import { isValidMnemonic, privateKeyFromMnemonic, publicKeyFromPrivate, randomPrivateKey, signMessage } from "@ararat-network/sdk";
import {
  KEYSTORE_ERROR_CODE,
  type KeystoreErrorKind,
  type KeystoreEvent,
  type KeystoreNative,
  type KeystorePrompt,
  type NativeKey,
  SEED_PHRASE_WORDS,
} from "../native.ts";

/** A rejection as a native call makes it: an error with a code. */
export function nativeError(kind: KeystoreErrorKind, message = `the fake refuses: ${kind}`): Error {
  return Object.assign(new Error(message), { code: `${KEYSTORE_ERROR_CODE}${kind.toUpperCase()}` });
}

export interface FakeNative extends KeystoreNative {
  /** What `availability` answers and what `create` makes or refuses with. */
  available: string;
  hardware: string;
  /** Thrown by the next call that prompts, in place of its answer, once. */
  failNext: unknown;
  /** Marks the held key as one the hardware no longer opens. */
  invalidate(): void;
  /** Every prompt shown, in order. */
  readonly prompts: KeystorePrompt[];
  /** Every message signed, in order. */
  readonly signed: Uint8Array[];
  /** Whether the seed phrase is open for the word pieces to draw. */
  seedPhraseShown: boolean;
  /** Whether the screen is being recorded, which refuses the seed phrase. */
  captured: boolean;
  /** The app is left, or a recording starts: the seed phrase closes by itself and says why. */
  closeByItself(reason: string): void;
  /** The position the entry is at, and what is entered at each. */
  entryPosition: number;
  readonly entered: (string | undefined)[];
  /** The member types letters into the field: what a native field does with them, short of drawing anything. */
  type(letters: string): void;
  /** The member takes a word, by choosing it or by the return key: the entry moves on by itself. */
  enter(word: string): void;
  /** Sends an event as native code would, whatever it carries. */
  send(event: KeystoreEvent, payload: unknown): void;
}

export function fakeNative(initial: { available?: string; hardware?: string; privateKey?: Uint8Array; development?: boolean } = {}): FakeNative {
  let privateKey: Uint8Array | null = null;
  let held: NativeKey | null = null;
  /** The held key's seed phrase, where the key came from one: a key made here at random has none to compare with. */
  let heldWords: string[] | null = null;
  const entered: (string | undefined)[] = [];
  const listeners = new Map<KeystoreEvent, Set<(payload: unknown) => void>>();

  const hold = (key: Uint8Array, protection: string, hardware: string, words: string[] | null = null): NativeKey => {
    privateKey = key;
    heldWords = words;
    held = { publicKey: publicKeyFromPrivate(key), protection, hardware, invalidated: false };
    return held;
  };
  const enteredPhrase = (): string | null => {
    const words = Array.from({ length: SEED_PHRASE_WORDS }, (_, i) => entered[i]);
    return words.every((word) => word !== undefined) ? words.join(" ") : null;
  };
  /** A prompt is shown, and fails once if the test asked it to. */
  const prompted = (prompt: KeystorePrompt): void => {
    fake.prompts.push(prompt);
    if (fake.failNext !== undefined) {
      const failure = fake.failNext;
      fake.failNext = undefined;
      throw failure;
    }
  };
  const restoreFrom = (words: string, prompt: KeystorePrompt): NativeKey => {
    if (!isValidMnemonic(words)) throw nativeError("invalid_seed_phrase", "the text is not a seed phrase");
    if (held) throw nativeError("exists");
    if (fake.available.startsWith("no_")) throw nativeError(fake.available as KeystoreErrorKind);
    prompted(prompt);
    return hold(privateKeyFromMnemonic(words), fake.available, fake.hardware, words.split(" "));
  };

  const fake: FakeNative = {
    available: initial.available ?? "biometric",
    hardware: initial.hardware ?? "secure_enclave",
    failNext: undefined,
    prompts: [],
    signed: [],
    seedPhraseShown: false,
    captured: false,
    entryPosition: 0,
    entered,
    selfCheck: () => true,
    invalidate(): void {
      if (held) held = { ...held, invalidated: true };
    },
    async availability(): Promise<string> {
      return fake.available;
    },
    async key(): Promise<NativeKey | null> {
      return held;
    },
    async create(prompt: KeystorePrompt): Promise<NativeKey> {
      if (held) throw nativeError("exists");
      if (fake.available.startsWith("no_")) throw nativeError(fake.available as KeystoreErrorKind);
      prompted(prompt);
      return hold(randomPrivateKey(), fake.available, fake.hardware);
    },
    async sign(message: Uint8Array, prompt: KeystorePrompt): Promise<Uint8Array> {
      if (!held || !privateKey) throw nativeError("no_key");
      if (held.invalidated) throw nativeError("key_invalidated");
      prompted(prompt);
      fake.signed.push(message);
      return signMessage(message, privateKey);
    },
    async remove(): Promise<void> {
      privateKey = null;
      held = null;
      heldWords = null;
      fake.seedPhraseShown = false;
    },

    async openSeedPhrase(prompt: KeystorePrompt): Promise<void> {
      if (fake.captured) throw nativeError("screen_captured");
      if (!held) throw nativeError("no_key");
      if (held.invalidated) throw nativeError("key_invalidated");
      prompted(prompt);
      fake.seedPhraseShown = true;
    },
    async closeSeedPhrase(): Promise<void> {
      fake.seedPhraseShown = false;
    },
    closeByItself(reason: string): void {
      if (!fake.seedPhraseShown) return;
      fake.seedPhraseShown = false;
      fake.send("onSeedPhraseClosed", { reason });
    },

    async moveEntry(position: number): Promise<void> {
      fake.entryPosition = Math.min(Math.max(position, 0), SEED_PHRASE_WORDS - 1);
    },
    type(letters: string): void {
      // What is in the field is no longer a word taken here, until one is.
      entered[fake.entryPosition] = undefined;
      fake.send("onEntryChange", { position: fake.entryPosition, typing: letters === "" ? "empty" : "typing", suggestions: letters === "" ? 0 : 1 });
    },
    enter(word: string): void {
      const taken = fake.entryPosition;
      entered[taken] = word;
      fake.entryPosition = Math.min(taken + 1, SEED_PHRASE_WORDS - 1);
      fake.send("onEntryWord", { position: taken, next: fake.entryPosition, entered: entered.filter((each) => each !== undefined).length });
    },
    async checkEntry(): Promise<string> {
      const phrase = enteredPhrase();
      if (phrase === null) return "incomplete";
      if (!held || !isValidMnemonic(phrase)) return "no_match";
      const same = publicKeyFromPrivate(privateKeyFromMnemonic(phrase)).every((byte, i) => byte === held?.publicKey[i]);
      return same ? "match" : "no_match";
    },
    async entryMistakes(prompt: KeystorePrompt): Promise<number[]> {
      if (!held || !heldWords) throw nativeError("no_key");
      if (held.invalidated) throw nativeError("key_invalidated");
      prompted(prompt);
      return heldWords.flatMap((word, i) => (entered[i] === word ? [] : [i]));
    },
    async restoreFromEntry(prompt: KeystorePrompt): Promise<NativeKey> {
      return restoreFrom(enteredPhrase() ?? "", prompt);
    },
    async clearEntry(): Promise<void> {
      entered.length = 0;
      fake.entryPosition = 0;
    },

    addListener(event: KeystoreEvent, listener: (payload: unknown) => void): { remove(): void } {
      const hearing = listeners.get(event) ?? new Set();
      listeners.set(event, hearing);
      hearing.add(listener);
      return { remove: () => void hearing.delete(listener) };
    },
    send(event: KeystoreEvent, payload: unknown): void {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };

  // Only a development build has the calls that take a seed phrase from JavaScript.
  if (initial.development) {
    fake.restoreSeedPhrase = async (seedPhrase: string, prompt: KeystorePrompt): Promise<NativeKey> => restoreFrom(seedPhrase, prompt);
    fake.fillEntry = async (seedPhrase: string): Promise<void> => {
      entered.length = 0;
      for (const [i, word] of seedPhrase.split(" ").entries()) entered[i] = word;
    };
  }
  if (initial.privateKey) hold(initial.privateKey, fake.available, fake.hardware);
  return fake;
}
