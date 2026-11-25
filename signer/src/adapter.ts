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
   * Whether the account's key can sign now, asked before the member is shown a review, so that a Ledger that is
   * locked, in another app, or not connected is learned of before they read and approve, not after. It resolves when
   * the key can sign and rejects with a SignerRefusal naming why it cannot. It shows the member nothing and signs
   * nothing, and `sign` asks again for itself: the answer spares the member a review and nothing relies on it. An
   * adapter whose key is always at hand has none.
   */
  ready?(address: string): Promise<void>;
  /**
   * A signature by the account's key over SHA-256 of the sign bytes: 64 bytes, r || s, low S. An adapter that
   * cannot or may not sign rejects with a SignerRefusal naming why.
   */
  sign(address: string, signBytes: Uint8Array): Promise<Uint8Array>;
}
