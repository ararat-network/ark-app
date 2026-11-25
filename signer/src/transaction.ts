// A transaction's sign document as the signer holds it: its own copy, the
// bytes that copy is signed as, and the body and fee those bytes describe.
// The bytes are fixed here, before review, so nothing a caller does to its
// document afterwards changes what an approval signs.
//
// What is reviewed must be all of what is signed. A direct document is
// protobuf, decoded and then encoded again: one that does not come back byte
// for byte, or that holds a field the signer's types do not have, is refused,
// since review would show less than the key signs. An amino document is JSON,
// decoded by the SDK into the same body and fee and encoded again by the
// SDK's encoder: one that does not come back byte for byte is refused, so a
// fault in the decoder stops a signature and never shows a member something
// other than what is signed.

import {
  type AminoSignDoc,
  aminoSignDocBytes,
  bytesEqual,
  decodeAminoSignDoc,
  decodeMessage,
  decodeTx,
  directSignBytes,
  encodeAuthInfo,
  encodeTxBody,
  encodeTxRaw,
  makeAminoSignDoc,
  makeSignDoc,
  SignMode,
  secp256k1PublicKey,
  utf8Decode,
} from "@ararat-network/sdk";
import type { AuthInfo, Fee, SignDoc, TxBody } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";
import type { Any } from "@bufbuild/protobuf/wkt";
import { SignerRefusal } from "./refusal.ts";

export interface HeldTransaction<Doc> {
  /** The signer's copy of the document, which is what it hands back as signed. */
  readonly signDoc: Doc;
  /** What the key signs. */
  readonly signBytes: Uint8Array;
  readonly chainId: string;
  readonly body: TxBody;
  readonly fee: Fee;
}

function refuse(message: string, cause?: unknown): never {
  throw new SignerRefusal("invalid", message, cause === undefined ? undefined : { cause });
}

const ANY = "google.protobuf.Any";

/** Whether a decoded message, or one it carries, packed or not, holds a field its type does not have. */
function holdsUnknownFields(value: unknown): boolean {
  if (value === null || typeof value !== "object" || value instanceof Uint8Array) return false;
  if (Array.isArray(value)) return value.some(holdsUnknownFields);
  const members = value as Record<string, unknown>;
  if (Array.isArray(members.$unknown) && members.$unknown.length > 0) return true;
  if (members.$typeName === ANY) {
    // A type the signer does not have stays packed, and review shows it as unknown, bytes and all.
    const inner = decodeMessage(value as Any);
    return inner.message !== undefined && holdsUnknownFields(inner.message);
  }
  return Object.values(members).some(holdsUnknownFields);
}

/** The fee of a direct document's auth info, which must be one signer's, this account's, signing direct. */
function directFee(authInfo: AuthInfo, publicKey: Uint8Array): Fee {
  const [signer, ...others] = authInfo.signerInfos;
  if (!signer || others.length > 0) refuse("the document is not one signer's: a transaction of several signers is not signed here");
  const key = secp256k1PublicKey(publicKey);
  if (signer.publicKey?.typeUrl !== key.typeUrl || !bytesEqual(signer.publicKey.value, key.value)) refuse("the document names another key as its signer");
  if (signer.modeInfo?.sum.case !== "single" || signer.modeInfo.sum.value.mode !== SignMode.DIRECT) refuse("the document's signer does not sign direct");
  if (authInfo.tip) refuse("the document holds a tip in its auth info, which review does not show");
  if (!authInfo.fee) refuse("the document declares no fee");
  return authInfo.fee;
}

/** Holds a direct sign document for the account whose compressed key is given. */
export function holdDirect(given: SignDoc, publicKey: Uint8Array): HeldTransaction<SignDoc> {
  let held: SignDoc;
  let signBytes: Uint8Array;
  let body: TxBody;
  let authInfo: AuthInfo;
  let canonical: boolean;
  try {
    held = makeSignDoc({
      bodyBytes: Uint8Array.from(given.bodyBytes),
      authInfoBytes: Uint8Array.from(given.authInfoBytes),
      chainId: given.chainId,
      accountNumber: given.accountNumber,
    });
    signBytes = directSignBytes(held);
    ({ body, authInfo } = decodeTx(encodeTxRaw({ bodyBytes: held.bodyBytes, authInfoBytes: held.authInfoBytes, signatures: [] })));
    canonical = bytesEqual(encodeTxBody(body), held.bodyBytes) && bytesEqual(encodeAuthInfo(authInfo), held.authInfoBytes);
  } catch (err) {
    refuse("the document is not a direct sign document", err);
  }
  if (!canonical) refuse("the document is not in the encoding the chain writes, so what it decodes to is not all that would be signed");
  if (holdsUnknownFields(body) || holdsUnknownFields(authInfo)) refuse("the document holds a field the signer's types do not have, which review cannot show");
  return { signDoc: held, signBytes, chainId: held.chainId, body, fee: directFee(authInfo, publicKey) };
}

/** Holds an amino sign document. `decode` is the SDK's decoder; a test passes a faulty one. */
export function holdAmino(given: AminoSignDoc, decode: typeof decodeAminoSignDoc = decodeAminoSignDoc): HeldTransaction<AminoSignDoc> {
  let held: AminoSignDoc;
  let signBytes: Uint8Array;
  try {
    signBytes = aminoSignDocBytes(given);
    held = JSON.parse(utf8Decode(signBytes)) as AminoSignDoc;
  } catch (err) {
    refuse("the document is not an amino sign document", err);
  }
  let chainId: string;
  let body: TxBody;
  let fee: Fee;
  let again: Uint8Array;
  try {
    const decoded = decode(held);
    ({ chainId, body, fee } = decoded);
    again = aminoSignDocBytes(makeAminoSignDoc(decoded));
  } catch (err) {
    refuse("the amino document could not be read whole, so it cannot be reviewed", err);
  }
  if (!bytesEqual(again, signBytes)) refuse("the amino document does not encode back to itself, so what it decodes to is not what would be signed");
  return { signDoc: held, signBytes, chainId, body, fee };
}
