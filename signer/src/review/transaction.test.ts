import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFee, makeTxBody, type TxBodyInput, type TxMessage, typed } from "@ararat-network/sdk";
import { MsgSendSchema } from "@ararat-network/sdk/gen/cosmos/bank/v1beta1/tx_pb.js";
import { VoteOption } from "@ararat-network/sdk/gen/cosmos/gov/v1/gov_pb.js";
import { MsgVoteSchema } from "@ararat-network/sdk/gen/cosmos/gov/v1/tx_pb.js";
import { MsgDelegateSchema } from "@ararat-network/sdk/gen/cosmos/staking/v1beta1/tx_pb.js";
import type { Fee } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";
import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { SignupDocument } from "../signup/document.ts";
import { type TxFixture, txFixture, txFixtures, unsignedTx } from "../testing/fixtures.ts";
import { signupVectors } from "../testing/vectors.ts";
import { reviewDocument } from "./document.ts";
import { type MessageReview, REVIEW_CHOICES, REVIEW_LABELS, REVIEW_MESSAGES, type ReviewField } from "./model.ts";
import { ReviewError, reviewTransaction } from "./transaction.ts";

const CHAIN = "ark-fixtures-1";
const MEMBER = "ark102p6s52n97e7zcmxc49ufwx04lntre5ktqkkzp";
const OTHER = "ark1lw7jrngdgm88ruz8v7k6s70gssu6vryufel8nq";
const VALIDATOR = "arkvaloper107sn6n6ylxxl6md3wtwy9n4u0j5a3azeu70grj";
const NOAH_FEE = makeFee({ amount: [{ denom: "anoah", amount: "26250000000000000" }], gasLimit: 250000n });

type Reviewed = ReturnType<typeof reviewTransaction>;

function ofFixture(f: TxFixture): Reviewed {
  const tx = unsignedTx(f, "direct");
  return reviewTransaction(f.chain_id, makeTxBody(tx), tx.fee);
}

function of(body: TxBodyInput, fee: Fee = NOAH_FEE): Reviewed {
  return reviewTransaction(CHAIN, makeTxBody(body), fee);
}

const address = (label: ReviewField["label"], value: string): ReviewField => ({ label, value: { kind: "address", address: value } });
const amount = (label: ReviewField["label"], denom: string, value: string): ReviewField => ({ label, value: { kind: "amount", denom, amount: value } });
const number = (label: ReviewField["label"], value: string): ReviewField => ({ label, value: { kind: "number", number: value } });
const chain: ReviewField = { label: "transaction.chain_id", value: { kind: "text", text: CHAIN } };

const delegate = (stake: string): MessageReview => ({
  kind: "summary",
  typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
  message: "message.delegate",
  fields: [address("message.delegate.delegator", MEMBER), address("message.delegate.validator", VALIDATOR), amount("message.delegate.amount", "anoah", stake)],
});

test("a delegation is its delegator, its validator, and the amount staked, with the fee as a ceiling", () => {
  assert.deepEqual(ofFixture(txFixture("staking_delegate")), {
    messages: [delegate("10000000000000000000")],
    fields: [chain, amount("transaction.fee_ceiling", "anoah", "26250000000000000"), number("transaction.gas_limit", "250000")],
  });
});

test("a vote is the proposal, the voter, and the option", () => {
  assert.deepEqual(ofFixture(txFixture("gov_vote")), {
    messages: [
      {
        kind: "summary",
        typeUrl: "/cosmos.gov.v1.MsgVote",
        message: "message.vote",
        fields: [
          number("message.vote.proposal", "1"),
          address("message.vote.voter", MEMBER),
          { label: "message.vote.option", value: { kind: "choice", choice: "message.vote.option.yes" } },
        ],
      },
    ],
    fields: [chain, amount("transaction.fee_ceiling", "anoah", "26250000000000000"), number("transaction.gas_limit", "250000")],
  });
});

test("a send is its sender, its recipient, and each amount, and a taxed one shows the ceiling in the denomination that pays", () => {
  assert.deepEqual(ofFixture(txFixture("bank_send_taxed")), {
    messages: [
      {
        kind: "summary",
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        message: "message.send",
        fields: [
          address("message.send.from", "ark1fec7dnxl3fre9zmc3kyvtt357de3ek9fnlu96j"),
          address("message.send.to", MEMBER),
          amount("message.send.amount", "ausd", "10000000000000000000"),
        ],
      },
    ],
    fields: [chain, amount("transaction.fee_ceiling", "ausd", "75058351568198397"), number("transaction.gas_limit", "250000")],
  });
});

test("a withdrawal of rewards is its delegator and its validator", () => {
  assert.deepEqual(ofFixture(txFixture("distribution_withdraw_delegator_reward")), {
    messages: [
      {
        kind: "summary",
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        message: "message.withdraw_reward",
        fields: [address("message.withdraw_reward.delegator", MEMBER), address("message.withdraw_reward.validator", VALIDATOR)],
      },
    ],
    fields: [chain, amount("transaction.fee_ceiling", "anoah", "31500000000000000"), number("transaction.gas_limit", "300000")],
  });
});

test("several messages are reviewed in the order they run, with the memo", () => {
  assert.deepEqual(ofFixture(txFixture("multi_message")), {
    messages: [
      {
        kind: "summary",
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        message: "message.send",
        fields: [address("message.send.from", MEMBER), address("message.send.to", OTHER), amount("message.send.amount", "anoah", "1000000000000000000")],
      },
      delegate("1000000000000000000"),
    ],
    fields: [
      chain,
      { label: "transaction.memo", value: { kind: "text", text: "fixture memo" } },
      amount("transaction.fee_ceiling", "anoah", "42000000000000000"),
      number("transaction.gas_limit", "400000"),
    ],
  });
});

test("the fee section of every fixture is its declared fee, each denomination apart and in the order declared", () => {
  for (const f of txFixtures()) {
    const ceiling = ofFixture(f).fields.filter((field) => field.label === "transaction.fee_ceiling");
    assert.deepEqual(
      ceiling.map((field) => field.value),
      f.fee.declared.map((c) => ({ kind: "amount", denom: c.denom, amount: c.amount })),
      f.name,
    );
  }
});

test("a type the chain has and review has no summary for is shown as the chain's JSON view", () => {
  const f = txFixture("staking_undelegate");
  const [message, ...rest] = ofFixture(f).messages;
  assert.equal(rest.length, 0);
  assert.deepEqual(message, {
    kind: "not_summarised",
    typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
    json: f.tx.body.messages[0],
    unverifiedPayload: false,
  });
});

test("a contract payload is marked unverified, in a message and in one a proposal carries, and a contract message without one is not", () => {
  for (const name of ["wasm_execute_contract", "wasm_instantiate_contract", "wasm_instantiate_contract2", "gov_proposal_wasm", "gov_proposal_wasm_migrate"]) {
    const [message] = ofFixture(txFixture(name)).messages;
    assert.equal(message?.kind === "not_summarised" && message.unverifiedPayload, true, name);
  }
  for (const name of ["wasm_update_admin", "wasm_clear_admin", "wasm_store_code", "gov_proposal_cosmos", "authz_exec"]) {
    const [message] = ofFixture(txFixture(name)).messages;
    assert.equal(message?.kind === "not_summarised" && !message.unverifiedPayload, true, name);
  }
});

test("a type the signer does not have is shown as unknown, with its type URL and its bytes", () => {
  const future = create(AnySchema, { typeUrl: "/ark.future.v1.MsgNew", value: new Uint8Array([10, 3, 97, 114, 107]) });
  const { messages } = of({ messages: [future] });
  assert.deepEqual(messages, [{ kind: "unknown", typeUrl: "/ark.future.v1.MsgNew", json: { "@type": "/ark.future.v1.MsgNew", value: "CgNhcms=" } }]);
});

const voteFor = (option: VoteOption, metadata = ""): TxMessage =>
  typed(MsgVoteSchema, create(MsgVoteSchema, { proposalId: 7n, voter: MEMBER, option, metadata }));

test("each vote option has its own choice, and metadata is shown when the vote carries some", () => {
  const options: [VoteOption, string][] = [
    [VoteOption.YES, "message.vote.option.yes"],
    [VoteOption.ABSTAIN, "message.vote.option.abstain"],
    [VoteOption.NO, "message.vote.option.no"],
    [VoteOption.NO_WITH_VETO, "message.vote.option.no_with_veto"],
  ];
  for (const [option, choice] of options) {
    const [message] = of({ messages: [voteFor(option, "why")] }).messages;
    assert.equal(message?.kind, "summary");
    if (message?.kind !== "summary") continue;
    assert.deepEqual(message.fields[2], { label: "message.vote.option", value: { kind: "choice", choice } });
    assert.deepEqual(message.fields[3], { label: "message.vote.metadata", value: { kind: "text", text: "why" } });
  }
});

test("a message a summary cannot state whole is shown as JSON, not summarised in part", () => {
  const unstated: TxMessage[] = [
    voteFor(VoteOption.UNSPECIFIED),
    // Packed by hand: the SDK's builder writes an amount of nothing where the message has none, as the chain does.
    create(AnySchema, {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: toBinary(MsgDelegateSchema, create(MsgDelegateSchema, { delegatorAddress: MEMBER, validatorAddress: VALIDATOR })),
    }),
    typed(MsgSendSchema, create(MsgSendSchema, { fromAddress: MEMBER, toAddress: OTHER })),
  ];
  for (const message of unstated) assert.equal(of({ messages: [message] }).messages[0]?.kind, "not_summarised");
});

test("a fee of no denomination, a payer, a granter, and a timeout height are each shown", () => {
  const fee = makeFee({ amount: [], gasLimit: 9n, payer: OTHER, granter: MEMBER });
  assert.deepEqual(of({ messages: [voteFor(VoteOption.YES)], timeoutHeight: 120n }, fee).fields, [
    chain,
    { label: "transaction.fee_ceiling", value: { kind: "choice", choice: "transaction.fee_ceiling.none" } },
    number("transaction.gas_limit", "9"),
    address("transaction.fee_payer", OTHER),
    address("transaction.fee_granter", MEMBER),
    number("transaction.timeout_height", "120"),
  ]);
});

test("an unordered transaction is shown as unordered, with the time it is valid until", () => {
  const until = timestampFromDate(new Date("2026-11-25T12:00:30.750Z"));
  const { fields } = of({ messages: [voteFor(VoteOption.YES)], unordered: true, timeoutTimestamp: until });
  assert.deepEqual(fields.slice(-2), [
    { label: "transaction.ordering", value: { kind: "choice", choice: "transaction.ordering.unordered" } },
    { label: "transaction.valid_until", value: { kind: "time", unixSeconds: "1795608030" } },
  ]);
});

test("a transaction review cannot show whole has none", () => {
  assert.throws(() => of({ messages: [] }), ReviewError);
  assert.throws(() => of({ messages: [voteFor(VoteOption.YES)], unordered: true }), ReviewError);
  const extended = makeTxBody({ messages: [voteFor(VoteOption.YES)] });
  extended.extensionOptions = [create(AnySchema, { typeUrl: "/ark.future.v1.Option" })];
  assert.throws(() => reviewTransaction(CHAIN, extended, NOAH_FEE), ReviewError);
});

test("every label, choice, and message listed is one some review carries, so a language is asked for no string nothing shows", () => {
  const { vectors } = signupVectors();
  const documents = ["challenge_ok", "vouch_ok"].flatMap((name) =>
    reviewDocument(vectors.find((v) => v.name === name)!.challenge as unknown as SignupDocument),
  );
  const fee = makeFee({ amount: [], gasLimit: 9n, payer: OTHER, granter: MEMBER });
  const transactions = [
    ...txFixtures().map(ofFixture),
    of({ messages: [VoteOption.ABSTAIN, VoteOption.NO, VoteOption.NO_WITH_VETO].map((option) => voteFor(option, "why")), timeoutHeight: 120n }, fee),
    of({ messages: [voteFor(VoteOption.YES)], unordered: true, timeoutTimestamp: timestampFromDate(new Date(0)) }),
  ];
  const summaries = transactions.flatMap((t) => t.messages).filter((m) => m.kind === "summary");
  const fields = [...documents, ...transactions.flatMap((t) => t.fields), ...summaries.flatMap((m) => m.fields)];
  const labels = new Set<string>(fields.map((f) => f.label));
  const choices = new Set<string>(fields.flatMap((f) => (f.value.kind === "choice" ? [f.value.choice] : [])));
  assert.deepEqual([...labels].sort(), [...REVIEW_LABELS].sort());
  assert.deepEqual([...choices].sort(), [...REVIEW_CHOICES].sort());
  assert.deepEqual([...new Set<string>(summaries.map((m) => m.message))].sort(), [...REVIEW_MESSAGES].sort());
});
