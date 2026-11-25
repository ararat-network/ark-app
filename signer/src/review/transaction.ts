// A transaction as what a member reads before signing: each message, then
// what the transaction carries beside them. It is built from the decoded body
// and fee, so a direct document and an amino one of the same transaction give
// the same review. Seven messages have a summary: the four a member signs in
// the first tranche, a delegation, a vote, a send, and a withdrawal of
// rewards, and three a member may sign after it, an undelegation, a
// redelegation, and a move of their grant's payee. Every other type the chain
// has is shown as the chain's JSON view, and a type the signer does not have
// as its type URL and bytes.
//
// The fee is shown as the ceiling it is: a signature commits to the messages
// and the ceiling and to nothing else. How the ceiling divides into tax, gas,
// and tip is the chain's figure, which review does not read.

import { type DecodedMessage, decodeMessage, typeUrlOf } from "@ararat-network/sdk";
import { encoding } from "@ararat-network/sdk/gen/amino/amino_pb.js";
import { type MsgSetPayee, MsgSetPayeeSchema } from "@ararat-network/sdk/gen/ark/disbursement/v1/tx_pb.js";
import { type MsgSend, MsgSendSchema } from "@ararat-network/sdk/gen/cosmos/bank/v1beta1/tx_pb.js";
import { type MsgWithdrawDelegatorReward, MsgWithdrawDelegatorRewardSchema } from "@ararat-network/sdk/gen/cosmos/distribution/v1beta1/tx_pb.js";
import { VoteOption } from "@ararat-network/sdk/gen/cosmos/gov/v1/gov_pb.js";
import { type MsgVote, MsgVoteSchema } from "@ararat-network/sdk/gen/cosmos/gov/v1/tx_pb.js";
import {
  type MsgBeginRedelegate,
  MsgBeginRedelegateSchema,
  type MsgDelegate,
  MsgDelegateSchema,
  type MsgUndelegate,
  MsgUndelegateSchema,
} from "@ararat-network/sdk/gen/cosmos/staking/v1beta1/tx_pb.js";
import type { Fee, TxBody } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";
import { type DescMessage, getOption, hasOption, type Message } from "@bufbuild/protobuf";
import { isReflectList, isReflectMap, isReflectMessage, type ReflectMessage, reflect } from "@bufbuild/protobuf/reflect";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { MessageReview, ReviewChoice, ReviewField, ReviewLabel, ReviewMessage } from "./model.ts";

/** Why a transaction has no review: it holds something review cannot show, so it is not signed. */
export class ReviewError extends Error {
  override readonly name: string = "ReviewError";
}

const address = (label: ReviewLabel, value: string): ReviewField => ({ label, value: { kind: "address", address: value } });
const amount = (label: ReviewLabel, coin: { denom: string; amount: string }): ReviewField => ({
  label,
  value: { kind: "amount", denom: coin.denom, amount: coin.amount },
});
const number = (label: ReviewLabel, value: bigint): ReviewField => ({ label, value: { kind: "number", number: value.toString() } });
const text = (label: ReviewLabel, value: string): ReviewField => ({ label, value: { kind: "text", text: value } });
const choice = (label: ReviewLabel, value: ReviewChoice): ReviewField => ({ label, value: { kind: "choice", choice: value } });

interface Summary {
  readonly message: ReviewMessage;
  readonly fields: ReviewField[];
}

/** A summary states every member the message carries, or there is none: a message it cannot state whole is shown as JSON. */
type Summarise = (message: Message) => Summary | undefined;

function delegate(m: MsgDelegate): Summary | undefined {
  if (!m.amount) return undefined;
  return {
    message: "message.delegate",
    fields: [
      address("message.delegate.delegator", m.delegatorAddress),
      address("message.delegate.validator", m.validatorAddress),
      amount("message.delegate.amount", m.amount),
    ],
  };
}

function undelegate(m: MsgUndelegate): Summary | undefined {
  if (!m.amount) return undefined;
  return {
    message: "message.undelegate",
    fields: [
      address("message.undelegate.delegator", m.delegatorAddress),
      address("message.undelegate.validator", m.validatorAddress),
      amount("message.undelegate.amount", m.amount),
    ],
  };
}

function redelegate(m: MsgBeginRedelegate): Summary | undefined {
  if (!m.amount) return undefined;
  return {
    message: "message.redelegate",
    fields: [
      address("message.redelegate.delegator", m.delegatorAddress),
      address("message.redelegate.from_validator", m.validatorSrcAddress),
      address("message.redelegate.to_validator", m.validatorDstAddress),
      amount("message.redelegate.amount", m.amount),
    ],
  };
}

const VOTE_OPTIONS: ReadonlyMap<VoteOption, ReviewChoice> = new Map([
  [VoteOption.YES, "message.vote.option.yes"],
  [VoteOption.ABSTAIN, "message.vote.option.abstain"],
  [VoteOption.NO, "message.vote.option.no"],
  [VoteOption.NO_WITH_VETO, "message.vote.option.no_with_veto"],
]);

function vote(m: MsgVote): Summary | undefined {
  const option = VOTE_OPTIONS.get(m.option);
  if (!option) return undefined;
  const fields = [number("message.vote.proposal", m.proposalId), address("message.vote.voter", m.voter), choice("message.vote.option", option)];
  if (m.metadata !== "") fields.push(text("message.vote.metadata", m.metadata));
  return { message: "message.vote", fields };
}

function send(m: MsgSend): Summary | undefined {
  if (m.amount.length === 0) return undefined;
  return {
    message: "message.send",
    fields: [address("message.send.from", m.fromAddress), address("message.send.to", m.toAddress), ...m.amount.map((c) => amount("message.send.amount", c))],
  };
}

function withdrawReward(m: MsgWithdrawDelegatorReward): Summary {
  return {
    message: "message.withdraw_reward",
    fields: [address("message.withdraw_reward.delegator", m.delegatorAddress), address("message.withdraw_reward.validator", m.validatorAddress)],
  };
}

/** The grant by its number, as the chain names it, and the address its payments would go to from then on. */
function setPayee(m: MsgSetPayee): Summary {
  return {
    message: "message.set_payee",
    fields: [address("message.set_payee.sender", m.sender), number("message.set_payee.grant", m.grantId), address("message.set_payee.payee", m.payee)],
  };
}

const SUMMARIES: ReadonlyMap<string, Summarise> = new Map<string, Summarise>([
  [typeUrlOf(MsgDelegateSchema), (m) => delegate(m as MsgDelegate)],
  [typeUrlOf(MsgUndelegateSchema), (m) => undelegate(m as MsgUndelegate)],
  [typeUrlOf(MsgBeginRedelegateSchema), (m) => redelegate(m as MsgBeginRedelegate)],
  [typeUrlOf(MsgVoteSchema), (m) => vote(m as MsgVote)],
  [typeUrlOf(MsgSendSchema), (m) => send(m as MsgSend)],
  [typeUrlOf(MsgWithdrawDelegatorRewardSchema), (m) => withdrawReward(m as MsgWithdrawDelegatorReward)],
  [typeUrlOf(MsgSetPayeeSchema), (m) => setPayee(m as MsgSetPayee)],
]);

const ANY = "google.protobuf.Any";
/** The amino encoding the chain gives a field that holds a contract's payload: JSON the contract reads, bytes to the chain. */
const CONTRACT_PAYLOAD = "inline_json";

/** Whether a message holds a contract payload, in itself or in a message it carries, packed or not. */
function holdsContractPayload(r: ReflectMessage): boolean {
  if (r.desc.typeName === ANY) {
    const inner = decodeMessage(r.message as Any);
    return inner.schema !== undefined && inner.message !== undefined && holdsContractPayload(reflect(inner.schema, inner.message));
  }
  for (const field of r.fields) {
    if (!r.isSet(field)) continue;
    if (hasOption(field, encoding) && getOption(field, encoding) === CONTRACT_PAYLOAD) return true;
    const value: unknown = r.get(field);
    if (isReflectMessage(value)) {
      if (holdsContractPayload(value)) return true;
    } else if (isReflectList(value) || isReflectMap(value)) {
      for (const item of value.values()) {
        if (isReflectMessage(item) && holdsContractPayload(item)) return true;
      }
    }
  }
  return false;
}

function reviewMessage(decoded: DecodedMessage): MessageReview {
  const { typeUrl, json } = decoded;
  if (!decoded.known || decoded.schema === undefined || decoded.message === undefined) return { kind: "unknown", typeUrl, json };
  const summary = SUMMARIES.get(typeUrl)?.(decoded.message);
  if (summary) return { kind: "summary", typeUrl, message: summary.message, fields: summary.fields };
  const schema: DescMessage = decoded.schema;
  return { kind: "not_summarised", typeUrl, json, unverifiedPayload: holdsContractPayload(reflect(schema, decoded.message)) };
}

/** What the transaction carries beside its messages, in the order shown. */
function transactionFields(chainId: string, body: TxBody, fee: Fee): ReviewField[] {
  const fields: ReviewField[] = [text("transaction.chain_id", chainId)];
  if (body.memo !== "") fields.push(text("transaction.memo", body.memo));
  // Each denomination apart, in the order declared: the ceiling is one figure for each, and they are not summed.
  if (fee.amount.length === 0) fields.push(choice("transaction.fee_ceiling", "transaction.fee_ceiling.none"));
  for (const coin of fee.amount) fields.push(amount("transaction.fee_ceiling", coin));
  fields.push(number("transaction.gas_limit", fee.gasLimit));
  if (fee.payer !== "") fields.push(address("transaction.fee_payer", fee.payer));
  if (fee.granter !== "") fields.push(address("transaction.fee_granter", fee.granter));
  if (body.timeoutHeight !== 0n) fields.push(number("transaction.timeout_height", body.timeoutHeight));
  if (body.unordered) fields.push(choice("transaction.ordering", "transaction.ordering.unordered"));
  // To the second, rounded down: the chain refuses it from that second's end at the latest.
  if (body.timeoutTimestamp) fields.push({ label: "transaction.valid_until", value: { kind: "time", unixSeconds: body.timeoutTimestamp.seconds.toString() } });
  return fields;
}

/** The review of a transaction's body and fee; throws a ReviewError for one that holds what review cannot show. */
export function reviewTransaction(chainId: string, body: TxBody, fee: Fee): { messages: MessageReview[]; fields: ReviewField[] } {
  if (body.messages.length === 0) throw new ReviewError("the transaction holds no message");
  if (body.extensionOptions.length > 0 || body.nonCriticalExtensionOptions.length > 0) {
    throw new ReviewError("the transaction holds extension options, which review does not show");
  }
  if (body.unordered && !body.timeoutTimestamp) throw new ReviewError("the transaction is unordered and names no time it is valid until");
  return { messages: body.messages.map((m) => reviewMessage(decodeMessage(m))), fields: transactionFields(chainId, body, fee) };
}
