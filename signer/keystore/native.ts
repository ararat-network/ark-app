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

/**
 * The name of the native view that draws the key's 24 words: what the app asks Expo for, beside the module's name.
 */
export const KEYSTORE_WORDS_VIEW = "ArkKeystoreWordsView";

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

/**
 * The native view that draws the held key's 24 words, as the app's reference to it answers. Swift and Kotlin draw
 * them: no call here returns them, and nothing of them crosses to JavaScript.
 */
export interface KeystoreWordsView {
  /** Draws the words, after the member authenticates. It refuses while the screen is recorded or mirrored. */
  show(prompt: KeystorePrompt): Promise<void>;
  /** Clears them. The view also clears them itself when the app leaves the foreground or a recording starts. */
  hide(): Promise<void>;
}

/** Why the view cleared the words itself, as its `onHide` event says. */
export const WORDS_HIDDEN = ["background", "capture"] as const;
export type WordsHidden = (typeof WORDS_HIDDEN)[number];

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
   * Stores the key a seed's 24 words stand for, as `create` stores a new one. Only a development build has this
   * call, one made for the Simulator or an emulator: it is how a test loads a key it knows. No build for a phone
   * takes a member's words from JavaScript.
   */
  restoreWords?(words: string, prompt: KeystorePrompt): Promise<NativeKey>;
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
