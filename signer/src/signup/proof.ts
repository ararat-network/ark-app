// Producing and checking the ADR-036 proof the signup protocol submits: a key
// signs the sign bytes for the document, and the platform stores the four
// values of §6. The stateless rules 1 to 4 of §7 are checked here too, so the
// app can refuse what a keystore or a Ledger returned before sending it; the
// platform's verifier runs every rule.
import {
  ADDRESS_LENGTH,
  decodeAddress,
  fromBase64,
  isCompressedPublicKey,
  isLowS,
  publicKeyToAddress,
  SIGNATURE_LENGTH,
  toBase64,
  utf8Decode,
  utf8Encode,
  verifyMessage,
} from "@ararat-network/sdk";
import { documentBytes, parseDocument, type SignupDocument } from "./document.ts";
import { adr036SignBytes } from "./signbytes.ts";

/** The four values of §6. */
export interface Submission {
  /** The document bytes, verbatim. */
  data: Uint8Array;
  signer: string;
  /** 33 bytes, compressed secp256k1. */
  publicKey: Uint8Array;
  /** 64 bytes, r || s, low S. */
  signature: Uint8Array;
}

/** The submission as the platform's API carries it: data as text, bytes in standard base64. */
export interface SubmissionJson {
  data: string;
  signer: string;
  public_key: string;
  signature: string;
}

export function submissionToJson(s: Submission): SubmissionJson {
  return { data: utf8Decode(s.data), signer: s.signer, public_key: toBase64(s.publicKey), signature: toBase64(s.signature) };
}

export function submissionFromJson(j: SubmissionJson): Submission {
  return { data: utf8Encode(j.data), signer: j.signer, publicKey: fromBase64(j.public_key), signature: fromBase64(j.signature) };
}

/** What signing a document asks of whatever holds the key: the device keystore or a Ledger. */
export interface ArbitrarySigner {
  /** ADR-036: a signature over the sign bytes for `data` by this address, with the compressed key that made it. */
  signArbitrary(address: string, data: Uint8Array): Promise<{ signature: Uint8Array; publicKey: Uint8Array }>;
}

export class ProofError extends Error {
  override readonly name: string = "ProofError";
}

/** Signs a challenge or vouch document with the signer's key for `address`. Bytes that are not a document are refused. */
export async function signDocument(signer: ArbitrarySigner, address: string, document: SignupDocument | Uint8Array): Promise<Submission> {
  const data = document instanceof Uint8Array ? documentBytes(parseDocument(document)) : documentBytes(document);
  const { signature, publicKey } = await signer.signArbitrary(address, data);
  if (!isCompressedPublicKey(publicKey)) throw new ProofError("the signer returned a key that is not a compressed secp256k1 key");
  return { data, signer: address, publicKey, signature };
}

/** Rule 3 alone: 64 bytes, low S, verifying over the sign bytes for signer and data. */
export function verifySignature(s: Submission): boolean {
  if (s.signature.length !== SIGNATURE_LENGTH || !isLowS(s.signature)) return false;
  return verifyMessage(s.signature, adr036SignBytes(s.signer, s.data), s.publicKey);
}

export type StatelessRefusal = "signer_invalid" | "key_mismatch" | "signature_invalid" | "data_invalid";

/** Rules 1 to 4 of §7 in order; undefined when all hold. The platform applies the stateful rules after. */
export function checkSubmission(s: Submission, prefix = "ark"): StatelessRefusal | undefined {
  try {
    decodeAddress(s.signer, { prefix, lengths: [ADDRESS_LENGTH] });
  } catch {
    return "signer_invalid";
  }
  if (!isCompressedPublicKey(s.publicKey)) return "key_mismatch";
  let derived: string;
  try {
    derived = publicKeyToAddress(s.publicKey, prefix);
  } catch {
    return "key_mismatch";
  }
  if (derived !== s.signer) return "key_mismatch";
  if (!verifySignature(s)) return "signature_invalid";
  try {
    parseDocument(s.data);
  } catch {
    return "data_invalid";
  }
  return undefined;
}
