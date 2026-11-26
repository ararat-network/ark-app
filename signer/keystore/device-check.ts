// A check of the keystore that runs on a device: it makes a key, signs with
// it, and removes it, through the same TypeScript the signer uses, and says
// on one line each what it found. The app's scaffold runs it in a build made
// for the check, on the Simulator and the emulator in CI and on a phone by
// hand, where a script or a person reads the lines.
//
// It never touches a key it did not make: with one already held it stops
// before doing anything, so no build that ran it by mistake costs a member
// their key.
import { isLowS, toHex, utf8Encode, verifyMessage } from "@ararat-network/sdk";
import { SignerRefusal } from "../src/refusal.ts";
import { type DeviceKey, type DeviceKeystore, deviceKeystore } from "./keystore.ts";
import { KeystoreError, type KeystoreNative, type KeystorePrompt, keystoreErrorOf } from "./native.ts";

/** The words every line of the check begins with: what a script looks for in the device's log. */
export const DEVICE_CHECK_PREFIX = "ark-keystore";

export interface DeviceCheckOptions {
  prompt(purpose: "create" | "sign"): KeystorePrompt;
  /** Takes each line as it is known. */
  log(line: string): void;
}

const kindOf = (thrown: unknown): string => {
  if (thrown instanceof KeystoreError || thrown instanceof SignerRefusal) return thrown.kind;
  return `error: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
};

/** Resolves to the kind a call was refused with, and rejects when it was not refused. */
async function refused(what: string, call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (thrown) {
    return kindOf(thrown);
  }
  throw new Error(`${what} was not refused`);
}

/**
 * Has the key sign a message made of the text, through the adapter the signer's pipeline uses, and resolves to
 * whether what came back is that key's low-S signature over it. It rejects with the adapter's refusal.
 */
export async function signsAndVerifies(keystore: DeviceKeystore, key: DeviceKey, text: string): Promise<boolean> {
  const message = utf8Encode(`ark-keystore device check: ${text}`);
  const signature = await keystore.adapter.sign(key.address, message);
  return isLowS(signature) && verifyMessage(signature, message, key.publicKey);
}

/**
 * Runs the check and resolves to whether it passed. Its last line is `device-check=ok`, with what was checked, or
 * `device-check=failed`, with the step and the reason, or `device-check=refused` when a key was already held.
 */
export async function checkOnDevice(native: KeystoreNative | null | undefined, options: DeviceCheckOptions): Promise<boolean> {
  const say = (line: string): void => options.log(`${DEVICE_CHECK_PREFIX} ${line}`);
  if (!native) {
    say("device-check=failed start: the build has no native keystore");
    return false;
  }
  const keystore = deviceKeystore(native, { prompt: options.prompt });
  let step = "start";
  let made = false;
  try {
    if ((await keystore.key()) !== null) {
      say("device-check=refused a key is already held, and the check touches no key it did not make");
      return false;
    }

    step = "availability";
    const availability = await keystore.availability();
    say(`availability=${availability.available ? availability.protection : availability.reason}`);

    if (!availability.available) {
      step = "create on a phone that can have no key";
      let kind = "";
      try {
        await keystore.create();
        made = true;
      } catch (thrown) {
        kind = kindOf(thrown);
      }
      if (made) throw new Error("making a key was not refused");
      say(`create-refused=${kind}`);
      if (kind !== availability.reason) throw new Error(`making a key was refused as ${kind}, and the phone had said ${availability.reason}`);
      if ((await keystore.key()) !== null) throw new Error("a refused create left a key");
      say(`device-check=ok unavailable=${availability.reason}`);
      return true;
    }

    step = "create";
    say("prompt=create");
    const key = await keystore.create();
    made = true;
    say(`created protection=${key.protection} hardware=${key.hardware} address=${key.address}`);
    if (key.protection !== availability.protection) throw new Error(`the key is ${key.protection}, and the phone had said ${availability.protection}`);

    step = "read the key back";
    const held = await keystore.key();
    if (!held || toHex(held.publicKey) !== toHex(key.publicKey) || held.protection !== key.protection || held.hardware !== key.hardware) {
      throw new Error("the key read back is not the key made");
    }
    if (held.invalidated) throw new Error("the key made is already invalidated");
    const accounts = await keystore.adapter.accounts();
    if (accounts.length !== 1 || accounts[0]?.address !== key.address) throw new Error("the adapter does not list the key's account");

    // Twice, each over its own message: every signature asks the member again, and each is this key's over that message.
    for (const [index, text] of ["the first message", "the second message, which is not the first"].entries()) {
      step = `sign ${index + 1}`;
      say("prompt=sign");
      if (!(await signsAndVerifies(keystore, key, text))) throw new Error("the signature is not the key's over the message");
      say(`signed=${index + 1}`);
    }

    step = "create while a key is held";
    const second = await refused("making a second key", () => keystore.create());
    say(`create-refused=${second}`);
    if (second !== "exists") throw new Error(`a second key was refused as ${second}, not as exists`);
    const still = await keystore.key();
    if (!still || toHex(still.publicKey) !== toHex(key.publicKey)) throw new Error("a refused create changed the key held");

    step = "remove";
    await keystore.remove();
    made = false;
    if ((await keystore.key()) !== null) throw new Error("a key is held after it was removed");
    say("removed");

    step = "sign with no key";
    const none = await refused("signing with no key", async () => {
      try {
        await native.sign(utf8Encode("nothing signs this"), options.prompt("sign"));
      } catch (thrown) {
        throw keystoreErrorOf(thrown);
      }
    });
    say(`sign-refused=${none}`);
    if (none !== "no_key") throw new Error(`signing with no key was refused as ${none}, not as no_key`);

    say(`device-check=ok protection=${key.protection} hardware=${key.hardware}`);
    return true;
  } catch (thrown) {
    const kind = thrown instanceof KeystoreError || thrown instanceof SignerRefusal ? `${thrown.kind}: ` : "";
    say(`device-check=failed ${step}: ${kind}${thrown instanceof Error ? thrown.message : String(thrown)}`);
    // The key this check made, and no other, is removed again.
    if (made) await keystore.remove().catch(() => undefined);
    return false;
  }
}
