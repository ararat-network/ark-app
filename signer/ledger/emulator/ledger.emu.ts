// The Ledger adapter against the Ark device app on the emulator: pairing, the
// fixtures' amino documents, an unordered transaction and a signup document
// through the whole pipeline, and what the device refuses. Each signature is
// verified under the emulator's own key. Run with `pnpm test:emulator`, which
// needs Docker; RECORD=1 also writes the exchanges the unit tests replay.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import {
  aminoSignDocBytes,
  decodeTx,
  fromHex,
  isLowS,
  makeFee,
  publicKeyFromPrivate,
  publicKeyToAddress,
  registry,
  signTx,
  toHex,
  typed,
  utf8Decode,
  utf8Encode,
  verifyMessage,
} from "@ararat-network/sdk";
import { MsgSendSchema } from "@ararat-network/sdk/gen/cosmos/bank/v1beta1/tx_pb.js";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { TModel } from "@zondax/zemu";
import type { AdapterAccount, KeyAdapter } from "../../src/adapter.ts";
import { SignerRefusal } from "../../src/refusal.ts";
import { createSigner } from "../../src/signer.ts";
import { SIGNUP_DOMAIN } from "../../src/signup/document.ts";
import { checkSubmission, signDocument } from "../../src/signup/proof.ts";
import { fixtureKey, txFixture } from "../../src/testing/fixtures.ts";
import { signupVectors } from "../../src/testing/vectors.ts";
import { ledgerAdapter, pairLedger } from "../adapter.ts";
import { type Device, type Exchange, pullImage, startDevice } from "./device.ts";

const MODELS: TModel[] = ["nanosp", "flex"];
/** The model whose exchanges are recorded: a command and its answer are the same on every model. */
const RECORDED: TModel = "nanosp";
const FIXTURES = ["staking_delegate", "gov_vote", "bank_send_taxed", "distribution_withdraw_delegator_reward", "multi_message"];
const CHAIN = "ark-fixtures-1";
const challenge = signupVectors().vectors.find((v) => v.name === "challenge_ok")!;

const recorded: Record<string, unknown> = {};

before(pullImage, { timeout: 600_000 });

for (const model of MODELS) {
  describe(`the Ark device app on ${model}`, { concurrency: false }, () => {
    let device: Device;
    let account: AdapterAccount;
    let adapter: KeyAdapter;
    const record = (name: string, extra: Record<string, unknown> = {}): void => {
      const exchanges: Exchange[] = device.takeExchanges();
      if (model === RECORDED) recorded[name] = { ...extra, exchanges };
    };

    before(
      async () => {
        device = await startDevice(model);
      },
      { timeout: 300_000 },
    );
    after(async () => {
      await device?.close();
    });

    test("pairs: the device shows its address, and the account it answers with is the key's", { timeout: 120_000 }, async () => {
      account = await device.confirmAddress(() => pairLedger(device.session));
      assert.equal(publicKeyToAddress(account.publicKey), account.address);
      adapter = ledgerAdapter({ account, connect: async () => device.session });
      assert.deepEqual(adapter.modes, ["amino"]);
      assert.deepEqual(await adapter.accounts(), [account]);
      record("pair", { address: account.address, publicKey: toHex(account.publicKey) });
    });

    for (const name of FIXTURES) {
      test(`signs the amino document of ${name}`, { timeout: 300_000 }, async () => {
        const signBytes = utf8Encode(txFixture(name).sign_mode_amino.sign_bytes);
        const signature = await device.approve(() => adapter.sign(account.address, signBytes));
        assert.equal(signature.length, 64);
        assert.ok(isLowS(signature));
        assert.ok(verifyMessage(signature, signBytes, account.publicKey), "the signature verifies under the device's key");
        record(`sign_${name}`, { signature: toHex(signature) });
      });
    }

    test("signs an unordered transaction through the pipeline, built by the SDK", { timeout: 300_000 }, async () => {
      const reviews: unknown[] = [];
      const signer = createSigner({
        adapters: [adapter],
        network: { chainId: CHAIN, origin: challenge.challenge!.origin! },
        present: async (review) => {
          reviews.push(review);
          return "approved";
        },
      });
      const handle = signer.grant({ caller: "wallet", capabilities: ["connect", "read_addresses", "sign"], transactions: true });
      assert.deepEqual(
        (await handle.accounts()).map((a) => [a.address, a.modes]),
        [[account.address, ["amino"]]],
      );
      const message = typed(
        MsgSendSchema,
        create(MsgSendSchema, {
          fromAddress: account.address,
          toAddress: fixtureKey("validator").address,
          amount: [{ denom: "anoah", amount: "1000000000000000000" }],
        }),
      );
      const signed = await device.approve(() =>
        signTx(
          {
            address: account.address,
            chainId: CHAIN,
            accountNumber: 7n,
            sequence: 0n,
            messages: [message],
            unordered: true,
            timeoutTimestamp: timestampFromDate(new Date("2026-11-25T12:10:00Z")),
            fee: makeFee({ amount: [{ denom: "anoah", amount: "26250000000000000" }], gasLimit: 250000n }),
            mode: "amino",
            registry,
          },
          handle,
        ),
      );
      const signBytes = aminoSignDocBytes(signed.aminoSignDoc!);
      assert.match(utf8Decode(signBytes), /"timeout_timestamp":"2026-11-25T12:10:00Z","unordered":true\}$/);
      assert.ok(verifyMessage(signed.signature, signBytes, account.publicKey));
      assert.deepEqual(decodeTx(signed.txBytes).signatures, [signed.signature]);
      assert.equal(reviews.length, 1);
      record("sign_unordered", { signBytes: utf8Decode(signBytes), signature: toHex(signed.signature) });
    });

    test("signs a signup challenge through the pipeline, and the proof passes the protocol's stateless rules", { timeout: 300_000 }, async () => {
      const doc = challenge.challenge!;
      const signer = createSigner({
        adapters: [adapter],
        network: { chainId: doc.chain_id!, origin: doc.origin! },
        now: () => BigInt(challenge.now),
        present: async () => "approved",
      });
      const signup = signer.grant({ caller: "signup", capabilities: ["connect", "read_addresses", "sign"], documents: [SIGNUP_DOMAIN] });
      const submission = await device.approve(() => signDocument(signup, account.address, utf8Encode(challenge.data)));
      assert.equal(checkSubmission(submission), undefined);
      assert.equal(utf8Decode(submission.data), challenge.data);
      record("sign_signup_challenge", { data: challenge.data, signature: toHex(submission.signature) });
    });

    test("a document rejected on the device is refused as rejected there", { timeout: 300_000 }, async (t) => {
      // The touch models reject through a second screen the harness drives by coordinates; the answer is the same command.
      if (model !== RECORDED) return t.skip("rejection is driven on the model whose exchanges are recorded");
      const signBytes = utf8Encode(txFixture("staking_delegate").sign_mode_amino.sign_bytes);
      const err = await device.reject(() => adapter.sign(account.address, signBytes));
      assert.ok(err instanceof SignerRefusal, String(err));
      assert.equal(err.kind, "rejected_on_device");
      record("reject");
    });

    test("a Ledger that holds another account is refused before the device shows anything", { timeout: 60_000 }, async () => {
      const publicKey = publicKeyFromPrivate(fromHex(fixtureKey("member").private_key_hex));
      const other = ledgerAdapter({ account: { address: publicKeyToAddress(publicKey), publicKey }, connect: async () => device.session });
      await assert.rejects(
        other.sign(publicKeyToAddress(publicKey), utf8Encode("{}")),
        (err) => err instanceof SignerRefusal && err.kind === "device_unavailable",
      );
      record("another_account");
    });
  });
}

after(() => {
  if (process.env.RECORD !== "1") return;
  const out = new URL("../../testdata/ledger/exchanges.json", import.meta.url);
  writeFileSync(out, `${JSON.stringify({ model: RECORDED, release: "v2.3.1", scenarios: recorded }, null, 2)}\n`);
});
