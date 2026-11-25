// The pipeline every signature goes through: consent, review, sign. A request
// names its caller, the account, and the document; nothing is signed until
// the member approves on the review screen, and one approval signs one
// document. The pipeline ends at the signature: it reaches no node and no
// service. Today it signs the signup protocol's two documents; transactions
// join it with their review.
import { isCompressedPublicKey, publicKeyToAddress, type SignerAccount, secp256k1PublicKey } from "@ararat-network/sdk";
import type { AdapterAccount, KeyAdapter } from "./adapter.ts";
import { type Grant, type HeldGrant, holdGrant, requireCapability, requireDocument } from "./permissions.ts";
import { SignerRefusal } from "./refusal.ts";
import { reviewDocument } from "./review/document.ts";
import type { Review } from "./review/model.ts";
import { type Domain, documentBytes, parseDocument, type SignupDocument } from "./signup/document.ts";
import { type ArbitrarySigner, checkSubmission } from "./signup/proof.ts";
import { adr036SignBytes } from "./signup/signbytes.ts";

/** The network the signer signs for. */
export interface SignerNetwork {
  readonly chainId: string;
  /** The membership service's origin on this network: the one origin a signup or vouch document may name. */
  readonly origin: string;
}

export type Decision = "approved" | "declined";

export interface SignerOptions {
  /** What holds the keys. An account is signed for by the first adapter that reports it. */
  readonly adapters: readonly KeyAdapter[];
  /** The client's review screen: shows the review and resolves once the member has approved or declined. */
  readonly present: (review: Review) => Promise<Decision>;
  readonly network: SignerNetwork;
  /** The clock a document's expiry is read against, Unix seconds; the system clock when omitted. */
  readonly now?: () => bigint;
}

/** The signer as one caller holds it: every call is checked against that caller's grant. */
export interface SignerHandle extends ArbitrarySigner {
  /** The signer's accounts, as the SDK's Signer reports them. Needs `connect` and `read_addresses`. */
  accounts(): Promise<readonly SignerAccount[]>;
  /** Switches the network the signer signs for, for every caller. Needs `change_network`. */
  setNetwork(network: SignerNetwork): void;
}

export interface ArkSigner {
  /** Hands a caller the signer, limited to what the grant names. */
  grant(grant: Grant): SignerHandle;
}

function systemClock(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

function derivesTo(publicKey: Uint8Array, address: string): boolean {
  if (!isCompressedPublicKey(publicKey)) return false;
  try {
    return publicKeyToAddress(publicKey) === address;
  } catch {
    return false;
  }
}

/** An adapter's own refusal passes through; anything else it throws is its fault, not a reason a member can act on. */
async function fromAdapter<T>(doing: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof SignerRefusal) throw err;
    throw new SignerRefusal("invalid", `the key adapter failed ${doing}`, { cause: err });
  }
}

export function createSigner(options: SignerOptions): ArkSigner {
  const adapters = [...options.adapters];
  const now = options.now ?? systemClock;
  let network: SignerNetwork = { chainId: options.network.chainId, origin: options.network.origin };

  /** An adapter's account, refused when its key does not derive to its address. */
  function checked(account: AdapterAccount): AdapterAccount {
    if (!derivesTo(account.publicKey, account.address)) throw new SignerRefusal("invalid", `the key adapter reported a key that is not ${account.address}'s`);
    return account;
  }

  async function holder(address: string): Promise<{ adapter: KeyAdapter; account: AdapterAccount }> {
    for (const adapter of adapters) {
      const account = (await fromAdapter("listing its accounts", () => adapter.accounts())).find((a) => a.address === address);
      if (account) return { adapter, account: checked(account) };
    }
    throw new SignerRefusal("invalid", `the signer holds no account ${address}`);
  }

  function parse(data: Uint8Array): SignupDocument {
    try {
      return parseDocument(data);
    } catch (err) {
      throw new SignerRefusal("invalid", "the data is not a signup or vouch document", { cause: err });
    }
  }

  /** The window's end alone: the service checks the whole window against its own clock, and a device clock a little behind must not refuse a fresh document. */
  function requireUnexpired(doc: SignupDocument): void {
    if (now() >= BigInt(doc.expires)) throw new SignerRefusal("expired", `the document expired at ${doc.expires}`);
  }

  async function signArbitrary(grant: HeldGrant, address: string, data: Uint8Array): Promise<{ signature: Uint8Array; publicKey: Uint8Array }> {
    requireCapability(grant, "connect");
    requireCapability(grant, "sign");
    const doc = parse(data);
    requireDocument(grant, doc.domain as Domain);
    if (doc.chain_id !== network.chainId)
      throw new SignerRefusal("invalid", `the document is for ${doc.chain_id}, and the signer signs for ${network.chainId}`);
    if (doc.origin !== network.origin) throw new SignerRefusal("invalid", `the document is from ${doc.origin}, not ${network.origin}`);
    requireUnexpired(doc);
    const { adapter, account } = await holder(address);
    if (!adapter.modes.includes("amino")) throw new SignerRefusal("invalid", "the key adapter does not sign amino, which a document is signed in");

    // The bytes are fixed before the member sees the review: the document as parsed, in canonical encoding, so
    // nothing the caller or the review screen does while the member reads can change what the approval signs.
    const canonical = documentBytes(doc);
    const signBytes = adr036SignBytes(address, canonical);
    const review: Review = { kind: "document", caller: grant.caller, account: address, fields: reviewDocument(doc) };

    let decision: Decision;
    try {
      decision = await options.present(review);
    } catch (err) {
      throw new SignerRefusal("invalid", "the review screen failed", { cause: err });
    }
    if (decision !== "approved") throw new SignerRefusal("declined", "the member declined the document");
    // The member may have read for longer than the document had left.
    requireUnexpired(doc);

    const signature = await fromAdapter("signing", () => adapter.sign(address, signBytes));
    // The stateless rules of §7 on what the key returned, so a faulty adapter is caught here and not by the service.
    const refused = checkSubmission({ data: canonical, signer: address, publicKey: account.publicKey, signature });
    if (refused !== undefined) throw new SignerRefusal("invalid", `the key returned a proof the service would refuse: ${refused}`);
    return { signature, publicKey: account.publicKey };
  }

  return {
    grant(grant: Grant): SignerHandle {
      const held = holdGrant(grant);
      return {
        async accounts(): Promise<readonly SignerAccount[]> {
          requireCapability(held, "connect");
          requireCapability(held, "read_addresses");
          const all: SignerAccount[] = [];
          for (const adapter of adapters) {
            for (const account of await fromAdapter("listing its accounts", () => adapter.accounts())) {
              const { address, publicKey } = checked(account);
              all.push({ address, publicKey: secp256k1PublicKey(publicKey) });
            }
          }
          return all;
        },
        signArbitrary(address: string, data: Uint8Array): Promise<{ signature: Uint8Array; publicKey: Uint8Array }> {
          return signArbitrary(held, address, data);
        },
        setNetwork(next: SignerNetwork): void {
          requireCapability(held, "change_network");
          network = { chainId: next.chainId, origin: next.origin };
        },
      };
    },
  };
}
