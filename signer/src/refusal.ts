// Why the signer did not sign. A refusal has a kind only where the app does
// something different for it; everything that means a bug or an attack is
// `invalid`. The message is an English diagnostic for a log, never shown to a
// member: what a member reads is a string resource the app chooses by kind.

export const REFUSAL_KINDS = [
  /** The member declined on the review screen. */
  "declined",
  /** The caller asked past its grant. */
  "not_granted",
  /** The document's window closed before it was signed; a new one can be requested. */
  "expired",
  /** The biometric or passcode check failed or was cancelled. */
  "authentication_failed",
  /** The device refuses further attempts for now. */
  "locked_out",
  /** The phone no longer opens its key, a fingerprint or face enrolled or the passcode removed, and the member restores from backup. */
  "key_invalidated",
  /** The Ledger that holds the account is not connected, or the connection dropped. */
  "device_unavailable",
  /** The Ledger is locked, and the member unlocks it. */
  "device_locked",
  /** The Ledger is connected with another app open, or none. */
  "wrong_app",
  /** The Ledger's Ark app is older than the signer signs with, and the member updates it. */
  "app_outdated",
  /** The member rejected the document on the Ledger. */
  "rejected_on_device",
  /** Anything else: bytes that are no document, a document for another network, an account the signer does not hold, a key that returned a bad signature. */
  "invalid",
] as const;

export type RefusalKind = (typeof REFUSAL_KINDS)[number];

export class SignerRefusal extends Error {
  override readonly name: string = "SignerRefusal";
  readonly kind: RefusalKind;

  constructor(kind: RefusalKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}
