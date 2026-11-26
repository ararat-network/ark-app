// The device keystore's TypeScript face, exported as
// `@ararat-network/signer/keystore`. The native module is Swift and Kotlin
// over a C core (native/), linked into the phone app by Expo. Nothing here
// imports Expo or React Native: the app looks the module up and hands it in,
// so the signer keeps no dependency on either, and a client with no native
// side, the web, never loads one.
//
// The seed is made in native code, encrypted under a key the phone's
// hardware holds, and opened for one signature at a time, after the member
// authenticates. JavaScript sees the address, the public key, and signatures.
// Backup, and with it restoring a key, is built on this next.
import type { KeystoreNative } from "./native.ts";

export * from "./keystore.ts";
export * from "./native.ts";

export const KEYSTORE_CHECKS = ["ok", "failed", "unavailable"] as const;
export type KeystoreCheck = (typeof KEYSTORE_CHECKS)[number];

/**
 * Whether this build's keystore core answers rightly: `unavailable` when the build has no native module, and `failed`
 * when the core gave a wrong answer or none. An app that gets anything but `ok` has no keystore to make a key with.
 */
export function checkKeystore(native: Pick<KeystoreNative, "selfCheck"> | null | undefined): KeystoreCheck {
  if (!native) return "unavailable";
  try {
    return native.selfCheck() === true ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
