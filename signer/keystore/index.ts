// The device keystore's TypeScript face, exported as
// `@ararat-network/signer/keystore`. The native module is Swift and Kotlin
// over a C core (native/), linked into the phone app by Expo. This file
// imports nothing of Expo's or React Native's: the app looks the module up
// and hands it in, so the signer keeps no dependency on either, and a client
// with no native side, the web, never loads one.
//
// Today the keystore is its core alone: the seed to the key, and the key to a
// signature, in C, with a check that a build of it gives the answers it must.
// Storing the seed under the phone's hardware, and signing behind the
// member's authentication, are built on it next, and with them the key
// adapter the signer's pipeline takes.

/** The name the native module is registered under: what the app asks Expo for. */
export const KEYSTORE_MODULE = "ArkKeystore";

/** The native module, as much of it as is built. */
export interface KeystoreNative {
  /** Whether the C core in this build derives the key and makes the signature a fixed seed must give. */
  selfCheck(): boolean;
}

export const KEYSTORE_CHECKS = ["ok", "failed", "unavailable"] as const;
export type KeystoreCheck = (typeof KEYSTORE_CHECKS)[number];

/**
 * Whether this build's keystore core answers rightly: `unavailable` when the build has no native module, and `failed`
 * when the core gave a wrong answer or none. An app that gets anything but `ok` has no keystore to make a key with.
 */
export function checkKeystore(native: KeystoreNative | null | undefined): KeystoreCheck {
  if (!native) return "unavailable";
  try {
    return native.selfCheck() === true ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
