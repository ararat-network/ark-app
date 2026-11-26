// A native module in memory, for the tests: it answers as Swift and Kotlin
// do, with a private key held in JavaScript where theirs is under the phone's
// hardware. Test-only.
import { publicKeyFromPrivate, randomPrivateKey, signMessage } from "@ararat-network/sdk";
import { KEYSTORE_ERROR_CODE, type KeystoreErrorKind, type KeystoreNative, type KeystorePrompt, type NativeKey } from "../native.ts";

/** A rejection as a native call makes it: an error with a code. */
export function nativeError(kind: KeystoreErrorKind, message = `the fake refuses: ${kind}`): Error {
  return Object.assign(new Error(message), { code: `${KEYSTORE_ERROR_CODE}${kind.toUpperCase()}` });
}

export interface FakeNative extends KeystoreNative {
  /** What `availability` answers and what `create` makes or refuses with. */
  available: string;
  hardware: string;
  /** Thrown by the next `sign` or `create` in place of its answer, once. */
  failNext: unknown;
  /** Marks the held key as one the hardware no longer opens. */
  invalidate(): void;
  /** Every prompt shown, in order. */
  readonly prompts: KeystorePrompt[];
  /** Every message signed, in order. */
  readonly signed: Uint8Array[];
}

export function fakeNative(initial: { available?: string; hardware?: string; privateKey?: Uint8Array } = {}): FakeNative {
  let privateKey: Uint8Array | null = null;
  let held: NativeKey | null = null;
  const hold = (key: Uint8Array, protection: string, hardware: string): NativeKey => {
    privateKey = key;
    held = { publicKey: publicKeyFromPrivate(key), protection, hardware, invalidated: false };
    return held;
  };
  const fake: FakeNative = {
    available: initial.available ?? "biometric",
    hardware: initial.hardware ?? "secure_enclave",
    failNext: undefined,
    prompts: [],
    signed: [],
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
      fake.prompts.push(prompt);
      if (fake.failNext !== undefined) {
        const failure = fake.failNext;
        fake.failNext = undefined;
        throw failure;
      }
      return hold(randomPrivateKey(), fake.available, fake.hardware);
    },
    async sign(message: Uint8Array, prompt: KeystorePrompt): Promise<Uint8Array> {
      if (!held || !privateKey) throw nativeError("no_key");
      if (held.invalidated) throw nativeError("key_invalidated");
      fake.prompts.push(prompt);
      if (fake.failNext !== undefined) {
        const failure = fake.failNext;
        fake.failNext = undefined;
        throw failure;
      }
      fake.signed.push(message);
      return signMessage(message, privateKey);
    },
    async remove(): Promise<void> {
      privateKey = null;
      held = null;
    },
  };
  if (initial.privateKey) hold(initial.privateKey, fake.available, fake.hardware);
  return fake;
}
