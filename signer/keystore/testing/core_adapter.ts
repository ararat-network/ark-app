// A key adapter over the keystore's C core, built on the host: the seed to
// the key and the key to a signature in the same C the phone runs, with none
// of the phone around it. It stands in for the device keystore where a test
// needs the core's own signature and has no phone: what stores the seed on a
// phone, and asks the member before each use, is not here, and is checked on
// the simulator and the emulator. Test-only: the seed is an argument to a
// command line.
import { fromHex, publicKeyToAddress, type SigningMode, toHex } from "@ararat-network/sdk";
import type { AdapterAccount, KeyAdapter } from "../../src/adapter.ts";
import { runCore } from "./core_cli.ts";

export interface CoreAdapter extends KeyAdapter {
  readonly address: string;
  readonly publicKey: Uint8Array;
  /** The sign bytes it has signed, in order. */
  readonly signed: Uint8Array[];
}

/** An adapter for the key of a seed, 32 bytes as hex, or of a seed the core makes from the system's randomness. */
export function coreAdapter(seed?: string, modes: readonly SigningMode[] = ["direct", "amino"]): CoreAdapter {
  const [held, madeKey] = seed ? [seed, runCore("public", seed)] : (runCore("generate").split(" ") as [string, string]);
  const publicKey = fromHex(madeKey);
  const address = publicKeyToAddress(publicKey);
  const signed: Uint8Array[] = [];
  return {
    address,
    publicKey,
    signed,
    modes,
    async accounts(): Promise<readonly AdapterAccount[]> {
      return [{ address, publicKey }];
    },
    async sign(asked: string, signBytes: Uint8Array): Promise<Uint8Array> {
      if (asked !== address) throw new Error(`the adapter holds ${address}, not ${asked}`);
      signed.push(signBytes);
      return fromHex(runCore("sign", held, toHex(signBytes)));
    },
  };
}
