// A signup challenge or a vouch document as the fields a member reads before
// signing (docs/SIGNUP_PROTOCOL.md §10): where it came from, which of the two
// it is, the chain it is for, and when it stops being valid. A vouch names
// the admission too, since that is the request the voucher is answering. The
// nonce and the issue time bind the document and tell a member nothing.
import { type SignupDocument, VOUCH_DOMAIN, validateDocument } from "../signup/document.ts";
import type { ReviewField } from "./model.ts";

/** The review fields of a document; throws unless it meets the §4 grammar. */
export function reviewDocument(doc: SignupDocument): ReviewField[] {
  validateDocument(doc);
  const vouch = doc.domain === VOUCH_DOMAIN;
  const fields: ReviewField[] = [
    { label: "document.origin", value: { kind: "origin", origin: doc.origin } },
    { label: "document.kind", value: { kind: "choice", choice: vouch ? "document.kind.vouch" : "document.kind.signup" } },
    { label: "document.chain_id", value: { kind: "text", text: doc.chain_id } },
    { label: "document.expires", value: { kind: "time", unixSeconds: doc.expires } },
  ];
  if (vouch) fields.push({ label: "document.admission", value: { kind: "text", text: doc.admission } });
  return fields;
}
