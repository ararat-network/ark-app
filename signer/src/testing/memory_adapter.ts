// A key adapter over a private key in memory, standing in for the device
// keystore and the Ledger. Test-only: a real key lives behind an adapter that
// never hands it to JavaScript.
import { publicKeyFromPrivate, publicKeyToAddress, type SigningMode, signMessage } from "@ararat-network/sdk";
import type { AdapterAccount, KeyAdapter } from "../adapter.ts";

export interface MemoryAdapter extends KeyAdapter {
  readonly address: string;
  readonly publicKey: Uint8Array;
  /** The sign bytes it has signed, in order. */
  readonly signed: Uint8Array[];
}

export function memoryAdapter(privateKey: Uint8Array, modes: readonly SigningMode[] = ["direct", "amino"]): MemoryAdapter {
  const publicKey = publicKeyFromPrivate(privateKey);
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
      return signMessage(signBytes, privateKey);
    },
  };
}
