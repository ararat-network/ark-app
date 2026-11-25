// Reader for ark's decoding fixtures, synced into testdata/decoding at the
// tag in ARK_VERSION. Test-only.
import { readdirSync, readFileSync } from "node:fs";
import { fromProtoJson, type JsonObject, makeFee, registry, type SigningMode, type UnsignedTx } from "@ararat-network/sdk";
import { TxBodySchema } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";

const root = new URL("../../testdata/decoding/", import.meta.url);

export interface FixtureKey {
  name: string;
  private_key_hex: string;
  public_key: string;
  address: string;
}

/** A transaction's fixture: its signer, its declared fee, its sign document in each encoding, and the bytes as signed. */
export interface TxFixture {
  name: string;
  description: string;
  chain_id: string;
  signer: { key: string; address: string; public_key: string; account_number: string; sequence: string };
  fee: { gas_limit: string; declared: { denom: string; amount: string }[] };
  sign_mode_direct: { sign_doc: string; body_bytes: string; auth_info_bytes: string };
  sign_mode_amino: { sign_bytes: string };
  signature: string;
  tx_bytes: string;
  tx_hash: string;
  tx: { body: JsonObject & { messages: JsonObject[]; memo: string }; auth_info: JsonObject; signatures: string[] };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, root), "utf8")) as T;
}

export function fixtureKey(name: string): FixtureKey {
  const key = readJson<{ accounts: FixtureKey[] }>("keys.json").accounts.find((a) => a.name === name);
  if (!key) throw new Error(`no fixture key ${name}`);
  return key;
}

/** Every fixture that holds a transaction, in file order. */
export function txFixtures(): TxFixture[] {
  return readdirSync(root)
    .filter((f) => f.endsWith(".json") && f !== "keys.json")
    .sort()
    .map((f) => readJson<TxFixture>(f))
    .filter((f) => "tx_bytes" in f);
}

export function txFixture(name: string): TxFixture {
  const f = readJson<TxFixture>(`${name}.json`);
  if (!("tx_bytes" in f)) throw new Error(`fixture ${name} holds no transaction`);
  return f;
}

/** The fixture's transaction as the SDK's builder takes it, to sign in either encoding. */
export function unsignedTx(f: TxFixture, mode: SigningMode): UnsignedTx {
  const body = fromProtoJson(TxBodySchema, f.tx.body);
  return {
    address: f.signer.address,
    chainId: f.chain_id,
    accountNumber: BigInt(f.signer.account_number),
    sequence: BigInt(f.signer.sequence),
    messages: body.messages,
    memo: body.memo,
    fee: makeFee({ amount: f.fee.declared, gasLimit: BigInt(f.fee.gas_limit) }),
    mode,
    registry,
  };
}
