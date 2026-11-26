// One transaction, end to end, on a chain: built and priced by the SDK from
// what the chain says, reviewed and signed through the signer's pipeline,
// broadcast, and found included. Everything before this is held to vectors,
// fixtures, and an emulator; here the chain itself says whether the sign
// bytes, the signature, the fee, and an unordered transaction are right.
//
// It runs twice, each time unordered, as the app sends: once signed by the
// keystore's C core, and once by the Ark device app on the emulator, which
// signs amino and shows the transaction on its own screen.
//
// The key the core signs with here is not on a phone. The core is the C the
// phone compiles, built on this machine, and what stores the seed on a phone
// and asks the member before each use is checked on the simulator and the
// emulator, where the phone's signature is held to the SDK's byte for byte.
//
// Against ark's Docker localnet (`make localnet-start` in ark, at the tag in
// ARK_VERSION). Runs only with ARK_LOCALNET_REST set, so that a machine with
// no chain skips it:
//   ARK_LOCALNET_REST=http://localhost:1317 pnpm test:localnet
// The key that funds the two accounts is node0's development key, from
// ARK_LOCALNET_MNEMONIC or from key_seed.json under ARK_LOCALNET_DATA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import {
  arkdPolicy,
  broadcastTx,
  classifyResult,
  coin,
  decodeTx,
  type FeeQuote,
  MemorySigner,
  prepareTx,
  QueryClient,
  type SigningMode,
  sendTx,
  signTx,
  typed,
} from "@ararat-network/sdk";
import { MsgSendSchema } from "@ararat-network/sdk/gen/cosmos/bank/v1beta1/tx_pb.js";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { coreAdapter } from "../keystore/testing/core_adapter.ts";
import { ledgerAdapter, pairLedger } from "../ledger/adapter.ts";
import { type Device, pullImage, startDevice } from "../ledger/emulator/device.ts";
import type { KeyAdapter } from "../src/adapter.ts";
import type { Review, TransactionReview } from "../src/review/model.ts";
import { createSigner, type SignerHandle } from "../src/signer.ts";

const rest = process.env.ARK_LOCALNET_REST;
const skip = rest ? false : "ARK_LOCALNET_REST is not set";

const NOAH = "anoah";
/** What each account is given, and what it then sends: enough over for the fee, which is charged in NOAH. */
const FUNDED = 5n * 10n ** 18n;
const SENT = 10n ** 18n;
/** How long after the chain's latest block an unordered transaction stays valid: room to read a review on a Ledger. */
const VALID_FOR_SECONDS = 300n;
const INCLUSION = { timeoutMs: 90_000, pollMs: 1_000 };

/** node0's mnemonic: from the environment where the data directory is not readable, else from its key seed file. */
function developmentMnemonic(): string {
  const fromEnv = process.env.ARK_LOCALNET_MNEMONIC;
  if (fromEnv) return fromEnv;
  const data = process.env.ARK_LOCALNET_DATA;
  assert.ok(data, "ARK_LOCALNET_MNEMONIC or ARK_LOCALNET_DATA names node0's development key");
  return (JSON.parse(readFileSync(`${data}/node0/arkd/key_seed.json`, "utf8")) as { secret: string }).secret;
}

describe("one transaction, end to end, on a local chain", { skip, concurrency: false }, () => {
  let client: QueryClient;
  let chainId = "";
  let funder: MemorySigner;

  before(async () => {
    client = new QueryClient(rest ?? "", {});
    chainId = (await client.node.info()).defaultNodeInfo?.network ?? "";
    assert.notEqual(chainId, "", "the node names its chain");
    funder = MemorySigner.fromMnemonic(developmentMnemonic());
  });

  /** What an address holds in NOAH's base unit. */
  async function balanceOf(address: string): Promise<bigint> {
    return BigInt((await client.bank.balance(address, NOAH)).balance?.amount ?? "0");
  }

  /** Gives an address what it sends and pays with, from the validator's development key, and waits for the block. */
  async function fund(address: string): Promise<void> {
    const held = await balanceOf(address);
    const send = typed(MsgSendSchema, create(MsgSendSchema, { fromAddress: funder.address, toAddress: address, amount: [coin(NOAH, FUNDED)] }));
    const sent = await sendTx(
      {
        client,
        signer: funder,
        address: funder.address,
        chainId,
        messages: [send],
        feeDenom: NOAH,
        headroom: arkdPolicy.headroom,
        gasAdjustment: arkdPolicy.gasAdjustment,
      },
      { ...INCLUSION, retryOnSequenceMismatch: true },
    );
    assert.deepEqual(classifyResult(sent.response), { kind: "ok" }, sent.response.rawLog);
    assert.equal(await balanceOf(address), held + FUNDED);
  }

  /** The signer over one adapter, with a review screen that approves and keeps what it was shown. */
  function signerOver(adapter: KeyAdapter): { handle: SignerHandle; shown: { review: Review; attachment: unknown }[] } {
    const shown: { review: Review; attachment: unknown }[] = [];
    const signer = createSigner({
      adapters: [adapter],
      network: { chainId, origin: "https://membership.invalid" },
      present: async (review, attachment) => {
        shown.push({ review, attachment });
        return "approved";
      },
    });
    return { handle: signer.grant({ caller: "wallet", capabilities: ["connect", "read_addresses", "sign"], transactions: true }), shown };
  }

  /**
   * The three steps the app runs, on a send that is unordered: prepared from the chain's own figures, signed through
   * the signer with the quote handed to the review beside it, and broadcast. `approving` is whatever stands between
   * the request and the signature: nothing for the core, and the review on the device's own screen for a Ledger.
   */
  async function sendUnordered(
    handle: SignerHandle,
    shown: { review: Review; attachment: unknown }[],
    mode: SigningMode,
    approving: <T>(start: () => Promise<T>) => Promise<T>,
  ): Promise<void> {
    const [account] = await handle.accounts();
    assert.ok(account);
    assert.ok(account.modes.includes(mode), `the account signs ${mode}`);
    const recipient = MemorySigner.random().address;
    const message = typed(MsgSendSchema, create(MsgSendSchema, { fromAddress: account.address, toAddress: recipient, amount: [coin(NOAH, SENT)] }));

    // Valid until a time read from the chain's latest block, not from this machine's clock.
    const blockTime = (await client.node.latestBlock()).block?.header?.time;
    assert.ok(blockTime, "the latest block has a time");
    const validUntil = create(TimestampSchema, { seconds: blockTime.seconds + VALID_FOR_SECONDS });

    // Measured from what the account holds and where its sequence stands now: the emulator's key is the same on every
    // run, so on a chain that has run this before its account is not new.
    const heldBefore = await balanceOf(account.address);
    const sequenceBefore = (await client.auth.accountInfo(account.address)).info?.sequence;
    assert.ok(sequenceBefore !== undefined, "the account exists once funded");

    const prepared = await prepareTx({
      client,
      signerAccount: account,
      chainId,
      messages: [message],
      memo: "ark-app end to end",
      unordered: true,
      timeoutTimestamp: validUntil,
      feeDenom: NOAH,
      headroom: arkdPolicy.headroom,
      gasAdjustment: arkdPolicy.gasAdjustment,
      mode,
    });
    assert.equal(prepared.tx.sequence, 0n, "an unordered transaction is signed at sequence zero");
    assert.ok(prepared.simulatedGas && prepared.simulatedGas > 0n, "the chain simulated it");

    const signed = await approving(() => signTx(prepared.tx, handle.attach(prepared.quote)));

    // What the member was shown before the key signed: the send, in full, that it is unordered and until when, and
    // the chain's quote beside it, which is the one the fee signed was taken from.
    assert.equal(shown.length, 1, "one review for one signature");
    const { review, attachment } = shown[0] as { review: TransactionReview; attachment: FeeQuote };
    assert.equal(review.kind, "transaction");
    assert.equal(review.account, account.address);
    assert.deepEqual(
      review.messages.map((m) => (m.kind === "summary" ? [m.message, m.fields.map((f) => f.value)] : m.kind)),
      [
        [
          "message.send",
          [
            { kind: "address", address: account.address },
            { kind: "address", address: recipient },
            { kind: "amount", denom: NOAH, amount: SENT.toString() },
          ],
        ],
      ],
    );
    const field = (label: string) => review.fields.find((f) => f.label === label)?.value;
    assert.deepEqual(field("transaction.chain_id"), { kind: "text", text: chainId });
    assert.deepEqual(field("transaction.ordering"), { kind: "choice", choice: "transaction.ordering.unordered" });
    assert.deepEqual(field("transaction.valid_until"), { kind: "time", unixSeconds: validUntil.seconds.toString() });
    const declared = prepared.quote.declared.find((c) => c.denom === NOAH);
    assert.ok(declared, "the quote declares a fee in NOAH");
    assert.deepEqual(field("transaction.fee_ceiling"), { kind: "amount", denom: NOAH, amount: declared.amount });
    assert.equal(attachment, prepared.quote);

    const { broadcast, response } = await broadcastTx(client, signed, INCLUSION);
    assert.equal(broadcast.hash, signed.hash);
    assert.deepEqual(classifyResult(response), { kind: "ok" }, response.rawLog);
    assert.ok(response.height > 0n);

    // The chain did what was signed: the recipient has the amount, the sender paid it and a fee within the ceiling,
    // and the account's sequence is where it was, since an unordered transaction takes none.
    assert.equal((await client.bank.balance(recipient, NOAH)).balance?.amount, SENT.toString());
    const charged = heldBefore - SENT - (await balanceOf(account.address));
    assert.ok(charged > 0n && charged <= BigInt(declared.amount), `the fee charged, ${charged}, is within the ceiling, ${declared.amount}`);
    assert.equal((await client.auth.accountInfo(account.address)).info?.sequence, sequenceBefore);
    const included = decodeTx(signed.txBytes);
    assert.equal(included.body.unordered, true);
    assert.equal(included.memo, "ark-app end to end");
    assert.deepEqual(included.signatures, [signed.signature]);
    console.log(`${mode}: ${signed.hash} included at height ${response.height}, gas ${response.gasUsed} of ${response.gasWanted}, fee ${charged}${NOAH}`);
  }

  test("signed by the keystore's core, in direct mode", { timeout: 300_000 }, async () => {
    // A seed the core makes from this machine's randomness: a key nothing else has held.
    const adapter = coreAdapter();
    await fund(adapter.address);
    const { handle, shown } = signerOver(adapter);
    await sendUnordered(handle, shown, "direct", (start) => start());
    assert.equal(adapter.signed.length, 1, "the core signed once");
  });

  describe("signed by the Ark device app on the emulator, in amino", { concurrency: false }, () => {
    let device: Device | undefined;

    before(
      async () => {
        await pullImage();
        device = await startDevice("nanosp");
      },
      { timeout: 600_000 },
    );
    after(async () => {
      await device?.close();
    });

    test("the device shows the transaction, and the chain takes what it signed", { timeout: 600_000 }, async () => {
      assert.ok(device);
      const emulator = device;
      const account = await emulator.confirmAddress(() => pairLedger(emulator.session));
      await fund(account.address);
      const { handle, shown } = signerOver(ledgerAdapter({ account, connect: async () => emulator.session }));
      // The device reads the document on its own screen and signs when its review is approved there.
      await sendUnordered(handle, shown, "amino", (start) => emulator.approve(start));
    });
  });
});
