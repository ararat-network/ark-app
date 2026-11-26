// The native module as JavaScript sees it: the calls Swift and Kotlin both
// answer, and the words they answer in. Everything here crosses from native
// code, so the keystore (keystore.ts) checks each answer before it uses it.
// No call takes or returns a seed or a key.

/** The name the native module is registered under: what the app asks Expo for. */
export const KEYSTORE_MODULE = "ArkKeystore";

/**
 * What the member authenticates with for each signature, fixed when the key is made. `biometric` is a fingerprint or
 * a face alone, and the key is invalidated when one is enrolled. `passcode` is the phone's passcode, or a fingerprint
 * or face in its place, and the key outlasts an enrolment. `none` is a key with no authentication on it, which only a
 * build for the iOS Simulator makes: the Simulator refuses every key that has any.
 */
export const KEY_PROTECTIONS = ["biometric", "passcode", "none"] as const;
export type KeyProtection = (typeof KEY_PROTECTIONS)[number];

/**
 * Where the key that encrypts the seed is held. `software` is no hardware at all, the Simulator's stand-in for a
 * Secure Enclave or an emulator's Keystore, and a build refuses it unless it was built to run there.
 */
export const KEY_HARDWARE = ["secure_enclave", "strongbox", "trusted_environment", "software"] as const;
export type KeyHardware = (typeof KEY_HARDWARE)[number];

/** Why a phone can be given no key. */
export const KEYSTORE_UNAVAILABLE = [
  /** The phone has no passcode, and neither platform makes such a key without one. */
  "no_passcode",
  /** Android 9 or 10 with no fingerprint or face of the strong class enrolled: a key that takes the passcode needs Android 11. */
  "no_biometrics",
  /** The phone has no hardware-backed key store. */
  "no_hardware",
] as const;
export type KeystoreUnavailable = (typeof KEYSTORE_UNAVAILABLE)[number];

/** How many words a seed phrase has. */
export const SEED_PHRASE_WORDS = 24;

/**
 * The names of the native pieces a seed phrase is drawn and entered with: what the app asks Expo for, beside the
 * module's name. Each is small, so that the app lays them out as it likes: a piece that draws one word, the field a
 * word is typed into, and a piece that draws one of the words offered for what is typed. Swift and Kotlin draw what
 * is in them, and nothing of it crosses to JavaScript.
 */
export const KEYSTORE_SEED_PHRASE_WORD_VIEW = "ArkKeystoreSeedPhraseWordView";
export const KEYSTORE_SEED_PHRASE_FIELD_VIEW = "ArkKeystoreSeedPhraseFieldView";
export const KEYSTORE_SEED_PHRASE_SUGGESTION_VIEW = "ArkKeystoreSeedPhraseSuggestionView";

/** How a piece's text is drawn, which the app chooses and the native piece applies: React Native styles no native text. */
export interface SeedPhraseTextStyle {
  /** As "#RRGGBB"; the system's own text colour where none is given. */
  readonly color?: string;
  /** In points, scaled with the member's text size. */
  readonly fontSize?: number;
  readonly fontWeight?: "regular" | "medium" | "semibold" | "bold";
  readonly textAlign?: "left" | "center" | "right";
}

/** The piece that draws one word of the seed phrase, while it is shown: the word at `position`, counted from 0. */
export interface SeedPhraseWordProps extends SeedPhraseTextStyle {
  readonly position: number;
}

/** The field a word of a seed phrase is typed into. It holds the word at the position the entry is at. */
export type SeedPhraseFieldProps = SeedPhraseTextStyle;

/**
 * The piece that draws one of the list's words that begin with what is typed: the one at `index` among them, from 0,
 * and nothing where there are fewer. Touched, it is taken as the word.
 */
export interface SeedPhraseSuggestionProps extends SeedPhraseTextStyle {
  readonly index: number;
}

/**
 * The text of the system's authentication prompt, passed in so that it is a string resource like any other. Android
 * shows the title and the reason, and the cancel button on a prompt that takes biometrics alone; iOS shows the
 * reason where it shows any, and the cancel button.
 */
export interface KeystorePrompt {
  readonly title: string;
  readonly reason: string;
  readonly cancel: string;
}

/** The key the phone holds, as the native module reports it. */
export interface NativeKey {
  /** 33 bytes, compressed secp256k1. */
  readonly publicKey: Uint8Array;
  readonly protection: string;
  readonly hardware: string;
  /** Whether the hardware key is known to be gone or invalidated, so that the seed can no longer be opened. */
  readonly invalidated: boolean;
}

/** What entering a seed phrase has come to, when it is held against the key the phone holds. */
export const SEED_PHRASE_CHECKS = [
  /** All 24 words are entered, and they are the seed phrase of the key held. */
  "match",
  /** All 24 words are entered, and they are not: a word is wrong, or they are another key's. */
  "no_match",
  /** Fewer than 24 words are entered. */
  "incomplete",
] as const;
export type SeedPhraseCheck = (typeof SEED_PHRASE_CHECKS)[number];

/** What the word being typed is, as the `onEntryChange` event says: never the letters themselves. */
export const SEED_PHRASE_TYPING = [
  /** Nothing is typed. */
  "empty",
  /** What is typed begins a word of the list, or is one. */
  "typing",
  /** No word of the list begins with what is typed. */
  "unknown",
] as const;
export type SeedPhraseTyping = (typeof SEED_PHRASE_TYPING)[number];

/** Why the seed phrase stopped being shown with nobody asking, as the `onSeedPhraseClosed` event says. */
export const SEED_PHRASE_HIDDEN = ["background", "capture"] as const;
export type SeedPhraseHidden = (typeof SEED_PHRASE_HIDDEN)[number];

/**
 * The events the native module sends. None carries a word or a letter of one.
 *
 * - `onSeedPhraseClosed`: the seed phrase stopped being shown with nobody asking, and `reason` says why.
 * - `onEntryChange`: what is being typed at `position` is now `typing`, and `suggestions` of the list's words begin
 *   with it.
 * - `onEntryWord`: a word of the list was taken at `position`, the entry has moved on to `next` by itself, and
 *   `entered` positions now hold a word.
 */
export const KEYSTORE_EVENTS = ["onSeedPhraseClosed", "onEntryChange", "onEntryWord"] as const;
export type KeystoreEvent = (typeof KEYSTORE_EVENTS)[number];

export interface SeedPhraseChange {
  readonly position: number;
  readonly typing: SeedPhraseTyping;
  readonly suggestions: number;
}

export interface SeedPhraseWord {
  readonly position: number;
  readonly next: number;
  readonly entered: number;
}

export interface KeystoreNative {
  /** Whether the C core in this build derives the key and makes the signature a fixed seed must give. */
  selfCheck(): boolean;
  /** The protection a key made now would have, or why none can be made: a `KeyProtection` or a `KeystoreUnavailable`. */
  availability(): Promise<string>;
  /** The key the phone holds, or null. It prompts for nothing. */
  key(): Promise<NativeKey | null>;
  /** Makes a seed, encrypts it under a new hardware key, and stores it. It refuses while a key is held. */
  create(prompt: KeystorePrompt): Promise<NativeKey>;
  /** A signature by the held key over SHA-256 of the message, 64 bytes, after the member authenticates. */
  sign(message: Uint8Array, prompt: KeystorePrompt): Promise<Uint8Array>;
  /** Destroys the hardware key and the encrypted seed. With no backup, the key is gone for good. */
  remove(): Promise<void>;

  /**
   * Opens the held key's seed phrase, after the member authenticates, for the word pieces on the screen to draw:
   * each draws the word at its position until the seed phrase is closed. It returns no word. It refuses while the
   * screen is recorded or mirrored.
   */
  openSeedPhrase(prompt: KeystorePrompt): Promise<void>;
  /**
   * Closes it: every word piece draws nothing. It also closes by itself when the app is left, when a recording
   * starts, and when no word piece is left on the screen.
   */
  closeSeedPhrase(): Promise<void>;

  /**
   * Moves the entry to a position, from 0: the field then holds the word entered there. The entry moves on by itself
   * when a word is taken, so that no letter waits on JavaScript; this takes it anywhere else.
   */
  moveEntry(position: number): Promise<void>;
  /** Whether what is entered is the seed phrase of the key held. It asks nothing of the member and opens nothing. */
  checkEntry(): Promise<string>;
  /**
   * The positions, from 0, at which what is entered is not the held key's seed phrase, after the member
   * authenticates: empty when it is right. A position with nothing entered is among them.
   */
  entryMistakes(prompt: KeystorePrompt): Promise<number[]>;
  /** Stores the key the entered seed phrase stands for, as `create` stores a new one. It refuses while a key is held. */
  restoreFromEntry(prompt: KeystorePrompt): Promise<NativeKey>;
  /** Forgets everything entered, and goes back to the first position. */
  clearEntry(): Promise<void>;

  /** Listens for one of the module's events. */
  addListener(event: KeystoreEvent, listener: (payload: unknown) => void): { remove(): void };

  /**
   * Stores the key a seed phrase stands for, as `create` stores a new one. Only a development build has this call,
   * one made for the Simulator or an emulator: it is how a test loads a key it knows. No build for a phone takes a
   * seed phrase from JavaScript.
   */
  restoreSeedPhrase?(seedPhrase: string, prompt: KeystorePrompt): Promise<NativeKey>;
  /**
   * Enters a whole seed phrase at once. Only a development build has this call, which is how a check enters one
   * where nothing can type.
   */
  fillEntry?(seedPhrase: string): Promise<void>;
}

/**
 * What a native call that fails says, as the `code` of the error it rejects with, after the prefix. A kind is here
 * only where the app does something different for it; any other failure is `failed`.
 */
export const KEYSTORE_ERRORS = [
  ...KEYSTORE_UNAVAILABLE,
  /** A key was asked for while one is held. */
  "exists",
  /** A signature was asked for while no key is held. */
  "no_key",
  /** The member failed or cancelled the fingerprint, face, or passcode check. */
  "authentication_failed",
  /** The phone refuses further attempts for now. */
  "locked_out",
  /** The hardware key no longer opens the seed: a fingerprint or face was enrolled, or the passcode removed. */
  "key_invalidated",
  /** The words were not drawn because the screen is being recorded or mirrored. */
  "screen_captured",
  /** A key was to be stored from a seed phrase that is not one: words are missing, or their checksum does not hold. */
  "invalid_seed_phrase",
  /** Anything else: a fault. */
  "failed",
] as const;
export type KeystoreErrorKind = (typeof KEYSTORE_ERRORS)[number];

/** The prefix of the `code` a native rejection carries, before its kind in capitals. */
export const KEYSTORE_ERROR_CODE = "ERR_ARK_KEYSTORE_";

export class KeystoreError extends Error {
  override readonly name: string = "KeystoreError";
  readonly kind: KeystoreErrorKind;

  constructor(kind: KeystoreErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}

/** What a native call threw, as a KeystoreError: by its code where it carries one of ours, and `failed` otherwise. */
export function keystoreErrorOf(thrown: unknown): KeystoreError {
  if (thrown instanceof KeystoreError) return thrown;
  const code = typeof thrown === "object" && thrown !== null && "code" in thrown ? thrown.code : undefined;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (typeof code === "string" && code.startsWith(KEYSTORE_ERROR_CODE)) {
    const kind = code.slice(KEYSTORE_ERROR_CODE.length).toLowerCase();
    if ((KEYSTORE_ERRORS as readonly string[]).includes(kind)) return new KeystoreError(kind as KeystoreErrorKind, message, { cause: thrown });
  }
  return new KeystoreError("failed", message, { cause: thrown });
}
