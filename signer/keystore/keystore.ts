// The device keystore over its native module: the key the phone holds, the
// making and removing of it, and the key adapter the signer's pipeline takes.
// The native module is handed in, so this file imports nothing of Expo's.
//
// What native code answers is checked here before it is used: a public key
// that is no point, a protection this file does not know, a signature of the
// wrong length are each a fault, whichever build produced them.
import { isCompressedPublicKey, publicKeyToAddress } from "@ararat-network/sdk";
import type { AdapterAccount, KeyAdapter } from "../src/adapter.ts";
import { SignerRefusal } from "../src/refusal.ts";
import {
  KEY_HARDWARE,
  KEY_PROTECTIONS,
  KEYSTORE_UNAVAILABLE,
  type KeyHardware,
  type KeyProtection,
  KeystoreError,
  type KeystoreNative,
  type KeystorePrompt,
  type KeystoreUnavailable,
  type KeystoreWordsView,
  keystoreErrorOf,
  type NativeKey,
} from "./native.ts";

const SIGNATURE_LENGTH = 64;

/** The key the phone holds. */
export interface DeviceKey extends AdapterAccount {
  readonly protection: KeyProtection;
  readonly hardware: KeyHardware;
  /**
   * Whether the seed can no longer be opened, as far as can be told without asking the member to authenticate. Such
   * a key signs nothing again, and the member restores from backup. False is not a promise that it signs.
   */
  readonly invalidated: boolean;
}

export type KeystoreAvailability =
  | { readonly available: true; readonly protection: KeyProtection }
  | { readonly available: false; readonly reason: KeystoreUnavailable };

/** What a prompt is shown for: to make a key, to sign, to draw the key's words, or to store a key from its words. */
export const KEYSTORE_PROMPT_PURPOSES = ["create", "sign", "words", "restore"] as const;
export type KeystorePromptPurpose = (typeof KEYSTORE_PROMPT_PURPOSES)[number];

export interface DeviceKeystoreOptions {
  /** The prompt's text, asked for each time one is shown, so that it is in the language the app is in then. */
  prompt(purpose: KeystorePromptPurpose): KeystorePrompt;
}

export interface DeviceKeystore {
  /** Whether this phone can be given a key now, and with which protection. It makes nothing. */
  availability(): Promise<KeystoreAvailability>;
  /** The key the phone holds, or null. */
  key(): Promise<DeviceKey | null>;
  /**
   * Makes the member's key. It rejects with a KeystoreError: `exists` while a key is held, since a key is never
   * overwritten, and one of the unavailable kinds on a phone that can be given none.
   */
  create(): Promise<DeviceKey>;
  /** Destroys the key. With no backup it is gone for good, so the caller has made sure of one. */
  remove(): Promise<void>;
  /**
   * Has the native view draw the key's 24 words, after the member authenticates. They are drawn by native code and
   * never reach JavaScript. It rejects with a KeystoreError: `screen_captured` while the screen is recorded or
   * mirrored, and the kinds a signature is refused with.
   */
  showWords(view: KeystoreWordsView): Promise<void>;
  /**
   * Stores the key a seed's 24 words stand for, in a development build alone: how a test loads a key it knows.
   * It rejects as `failed` in any other build, which has no call that takes words from JavaScript.
   */
  restoreDevelopmentKey(words: string): Promise<DeviceKey>;
  /** The key as the signer's pipeline takes it. */
  readonly adapter: KeyAdapter;
}

/** A key made where there is no hardware: on the Simulator or an emulator, by a build made to run there. */
export function isDevelopmentKey(key: Pick<DeviceKey, "hardware">): boolean {
  return key.hardware === "software";
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function checked(key: NativeKey): DeviceKey {
  const fault = (what: string): KeystoreError => new KeystoreError("failed", `the native keystore reported ${what}`);
  if (typeof key !== "object" || key === null) throw fault("a key that is no object");
  const { publicKey, protection, hardware, invalidated } = key;
  if (!(publicKey instanceof Uint8Array) || !isCompressedPublicKey(publicKey)) throw fault("a public key that is no compressed secp256k1 point");
  if (!isOneOf(KEY_PROTECTIONS, protection)) throw fault(`a protection it does not have: ${String(protection)}`);
  if (!isOneOf(KEY_HARDWARE, hardware)) throw fault(`hardware it does not have: ${String(hardware)}`);
  if (typeof invalidated !== "boolean") throw fault("no word on whether the key is invalidated");
  // No phone's hardware makes a key that asks nothing of the member: that is the Simulator's alone.
  if (protection === "none" && hardware !== "software") throw fault(`a key with no authentication on it in ${hardware}`);
  return { address: publicKeyToAddress(publicKey), publicKey: Uint8Array.from(publicKey), protection, hardware, invalidated };
}

function refusalOf(error: KeystoreError): SignerRefusal {
  switch (error.kind) {
    case "authentication_failed":
    case "locked_out":
    case "key_invalidated":
      return new SignerRefusal(error.kind, error.message, { cause: error });
    default:
      return new SignerRefusal("invalid", `the device keystore failed: ${error.kind}: ${error.message}`, { cause: error });
  }
}

export function deviceKeystore(native: KeystoreNative, options: DeviceKeystoreOptions): DeviceKeystore {
  const key = async (): Promise<DeviceKey | null> => {
    let held: NativeKey | null;
    try {
      held = await native.key();
    } catch (thrown) {
      throw keystoreErrorOf(thrown);
    }
    return held === null || held === undefined ? null : checked(held);
  };

  /** The held key if it is the one asked for and can still sign; a refusal otherwise. */
  const signing = async (address: string): Promise<DeviceKey> => {
    let held: DeviceKey | null;
    try {
      held = await key();
    } catch (thrown) {
      throw refusalOf(keystoreErrorOf(thrown));
    }
    if (!held) throw new SignerRefusal("invalid", "the device keystore holds no key");
    if (held.address !== address) throw new SignerRefusal("invalid", `the device keystore holds ${held.address}, not ${address}`);
    if (held.invalidated)
      throw new SignerRefusal("key_invalidated", "the phone no longer opens the key: a fingerprint or face was enrolled, or the passcode removed");
    return held;
  };

  const adapter: KeyAdapter = {
    modes: ["direct", "amino"],
    async accounts(): Promise<readonly AdapterAccount[]> {
      const held = await key();
      // A key the phone no longer opens is still the member's account: asked to sign, it says why it cannot.
      return held ? [{ address: held.address, publicKey: held.publicKey }] : [];
    },
    async ready(address: string): Promise<void> {
      await signing(address);
    },
    async sign(address: string, signBytes: Uint8Array): Promise<Uint8Array> {
      await signing(address);
      let signature: Uint8Array;
      try {
        signature = await native.sign(signBytes, options.prompt("sign"));
      } catch (thrown) {
        throw refusalOf(keystoreErrorOf(thrown));
      }
      if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) {
        throw new SignerRefusal("invalid", "the native keystore returned what is no 64-byte signature");
      }
      return Uint8Array.from(signature);
    },
  };

  return {
    adapter,
    key,
    async availability(): Promise<KeystoreAvailability> {
      let answer: string;
      try {
        answer = await native.availability();
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
      if (isOneOf(KEY_PROTECTIONS, answer)) return { available: true, protection: answer };
      if (isOneOf(KEYSTORE_UNAVAILABLE, answer)) return { available: false, reason: answer };
      throw new KeystoreError("failed", `the native keystore reported an availability it does not have: ${String(answer)}`);
    },
    async create(): Promise<DeviceKey> {
      let made: NativeKey;
      try {
        made = await native.create(options.prompt("create"));
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
      return checked(made);
    },
    async remove(): Promise<void> {
      try {
        await native.remove();
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
    },
    async showWords(view: KeystoreWordsView): Promise<void> {
      try {
        await view.show(options.prompt("words"));
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
    },
    async restoreDevelopmentKey(words: string): Promise<DeviceKey> {
      if (typeof native.restoreWords !== "function")
        throw new KeystoreError("failed", "this build takes no words from JavaScript: only a development build does");
      let restored: NativeKey;
      try {
        restored = await native.restoreWords(words, options.prompt("restore"));
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
      return checked(restored);
    },
  };
}
