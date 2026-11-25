// What review hands a client to render before the member approves. A label
// and a choice are keys, never text, and a value is typed and raw, never
// formatted: each client renders them with its own components and the string
// resources of its language, so every client and every language shows the
// same fields. The keys are listed here so the check that every language
// carries every string can require one for each.
import type { JsonValue } from "@ararat-network/sdk";

export const REVIEW_LABELS = [
  "document.origin",
  "document.kind",
  "document.chain_id",
  "document.expires",
  "document.admission",
  "transaction.chain_id",
  "transaction.memo",
  "transaction.fee_ceiling",
  "transaction.gas_limit",
  "transaction.fee_payer",
  "transaction.fee_granter",
  "transaction.timeout_height",
  "transaction.ordering",
  "transaction.valid_until",
  "message.delegate.delegator",
  "message.delegate.validator",
  "message.delegate.amount",
  "message.undelegate.delegator",
  "message.undelegate.validator",
  "message.undelegate.amount",
  "message.redelegate.delegator",
  "message.redelegate.from_validator",
  "message.redelegate.to_validator",
  "message.redelegate.amount",
  "message.vote.proposal",
  "message.vote.voter",
  "message.vote.option",
  "message.vote.metadata",
  "message.send.from",
  "message.send.to",
  "message.send.amount",
  "message.withdraw_reward.delegator",
  "message.withdraw_reward.validator",
  "message.set_payee.sender",
  "message.set_payee.grant",
  "message.set_payee.payee",
] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];

/** The values that are one of a closed set, each rendered as its own string. */
export const REVIEW_CHOICES = [
  "document.kind.signup",
  "document.kind.vouch",
  "transaction.fee_ceiling.none",
  "transaction.ordering.unordered",
  "message.vote.option.yes",
  "message.vote.option.abstain",
  "message.vote.option.no",
  "message.vote.option.no_with_veto",
] as const;
export type ReviewChoice = (typeof REVIEW_CHOICES)[number];

/** The messages review summarises, each named by its own string. */
export const REVIEW_MESSAGES = [
  "message.delegate",
  "message.undelegate",
  "message.redelegate",
  "message.vote",
  "message.send",
  "message.withdraw_reward",
  "message.set_payee",
] as const;
export type ReviewMessage = (typeof REVIEW_MESSAGES)[number];

/** How a message is shown; a client has a string for each but `summary`, which is named by its message. */
export const MESSAGE_REVIEW_KINDS = ["summary", "not_summarised", "unknown"] as const;

export type ReviewValue =
  /** A web origin: scheme, host, and a port if not the default. Shown whole, never shortened. */
  | { readonly kind: "origin"; readonly origin: string }
  | { readonly kind: "choice"; readonly choice: ReviewChoice }
  /** Text from the document, shown verbatim and never as markup. */
  | { readonly kind: "text"; readonly text: string }
  /** A moment, Unix seconds as a decimal string, formatted by the client for its locale. */
  | { readonly kind: "time"; readonly unixSeconds: string }
  /** An account's or a validator's address, shown whole. */
  | { readonly kind: "address"; readonly address: string }
  /** An amount of one denomination in its base unit, a decimal string, formatted by the client from the asset's units. */
  | { readonly kind: "amount"; readonly denom: string; readonly amount: string }
  /** A whole number that is not an amount, a decimal string, formatted by the client for its locale. */
  | { readonly kind: "number"; readonly number: string };

export interface ReviewField {
  readonly label: ReviewLabel;
  readonly value: ReviewValue;
}

/** One message of a transaction, as much of it as the signer can say. */
export type MessageReview =
  /** A type review has a summary for: its fields, each one the message carries. */
  | { readonly kind: "summary"; readonly typeUrl: string; readonly message: ReviewMessage; readonly fields: readonly ReviewField[] }
  /**
   * A type the chain has and review has no summary for, as the chain's JSON view. A contract payload is in that view
   * as it will be sent, and `unverifiedPayload` says the message carries one: what the contract does with it is not
   * something the signer can read.
   */
  | { readonly kind: "not_summarised"; readonly typeUrl: string; readonly json: JsonValue; readonly unverifiedPayload: boolean }
  /** A type the signer does not have: its type URL and its bytes, and nothing of what it means. */
  | { readonly kind: "unknown"; readonly typeUrl: string; readonly json: JsonValue };

export interface DocumentReview {
  readonly kind: "document";
  /** The feature that asked, as its grant names it. */
  readonly caller: string;
  /** The address whose key would sign. */
  readonly account: string;
  /** In the order they are shown. */
  readonly fields: readonly ReviewField[];
}

export interface TransactionReview {
  readonly kind: "transaction";
  /** The feature that asked, as its grant names it. */
  readonly caller: string;
  /** The address whose key would sign. */
  readonly account: string;
  /** One for each message, in the transaction's order, which is the order they run in. */
  readonly messages: readonly MessageReview[];
  /** What the transaction carries beside its messages, in the order shown: its chain, its memo, its fee as the ceiling it is, and when it stops being valid. */
  readonly fields: readonly ReviewField[];
}

export type Review = DocumentReview | TransactionReview;
