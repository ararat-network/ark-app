// What review hands a client to render before the member approves. A label
// and a choice are keys, never text, and a value is typed and raw, never
// formatted: each client renders them with its own components and the string
// resources of its language, so every client and every language shows the
// same fields. The keys are listed here so the check that every language
// carries every string can require one for each.

export const REVIEW_LABELS = ["document.origin", "document.kind", "document.chain_id", "document.expires", "document.admission"] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];

/** The values that are one of a closed set, each rendered as its own string. */
export const REVIEW_CHOICES = ["document.kind.signup", "document.kind.vouch"] as const;
export type ReviewChoice = (typeof REVIEW_CHOICES)[number];

export type ReviewValue =
  /** A web origin: scheme, host, and a port if not the default. Shown whole, never shortened. */
  | { readonly kind: "origin"; readonly origin: string }
  | { readonly kind: "choice"; readonly choice: ReviewChoice }
  /** Text from the document, shown verbatim and never as markup. */
  | { readonly kind: "text"; readonly text: string }
  /** A moment, Unix seconds as a decimal string, formatted by the client for its locale. */
  | { readonly kind: "time"; readonly unixSeconds: string };

export interface ReviewField {
  readonly label: ReviewLabel;
  readonly value: ReviewValue;
}

export interface Review {
  readonly kind: "document";
  /** The feature that asked, as its grant names it. */
  readonly caller: string;
  /** The address whose key would sign. */
  readonly account: string;
  /** In the order they are shown. */
  readonly fields: readonly ReviewField[];
}
