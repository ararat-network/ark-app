// What holds a key, as the core sees it. The device keystore and the Ledger
// adapter each implement this, and the tests use a key in memory. An adapter
// signs the bytes it is given and nothing more: building the sign bytes,
// review, and consent are the core's, so no adapter decides what is signed.
import type { SigningMode } from "@ararat-network/sdk";

export interface AdapterAccount {
  readonly address: string;
  /** 33 bytes, compressed secp256k1. */
  readonly publicKey: Uint8Array;
}

export interface KeyAdapter {
  /** The sign modes its key signs in. A Ledger displays the document it signs, so it signs amino alone. */
  readonly modes: readonly SigningMode[];
  accounts(): Promise<readonly AdapterAccount[]>;
  /**
   * A signature by the account's key over SHA-256 of the sign bytes: 64 bytes, r || s, low S. An adapter that
   * cannot or may not sign rejects with a SignerRefusal naming why.
   */
  sign(address: string, signBytes: Uint8Array): Promise<Uint8Array>;
}
