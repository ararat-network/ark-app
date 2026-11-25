// The pipeline every signature goes through: consent, review, sign. A request
// names its caller, the account, and the document; nothing is signed until
// the member approves on the review screen, and one approval signs one
// document. One review is shown at a time: a request waits its turn behind
// those asked before it. The pipeline ends at the signature: it reaches no
// node and no service. It signs the signup protocol's two documents, and a
// transaction's sign document in either encoding, as the SDK's Signer.
import {
  type AminoSignature,
  type AminoSignDoc,
  type DirectSignature,
  isCompressedPublicKey,
  isLowS,
  publicKeyToAddress,
  SIGNATURE_LENGTH,
  type Signer,
  type SignerAccount,
  type SigningMode,
  secp256k1PublicKey,
  verifyMessage,
} from "@ararat-network/sdk";
import type { SignDoc } from "@ararat-network/sdk/gen/cosmos/tx/v1beta1/tx_pb.js";
import type { AdapterAccount, KeyAdapter } from "./adapter.ts";
import { type Grant, type HeldGrant, holdGrant, requireCapability, requireDocument, requireTransactions } from "./permissions.ts";
import { SignerRefusal } from "./refusal.ts";
import { reviewDocument } from "./review/document.ts";
import type { Review } from "./review/model.ts";
import { reviewTransaction } from "./review/transaction.ts";
import { type Domain, documentBytes, parseDocument, type SignupDocument } from "./signup/document.ts";
import { type ArbitrarySigner, checkSubmission } from "./signup/proof.ts";
import { adr036SignBytes } from "./signup/signbytes.ts";
import { type HeldTransaction, holdAmino, holdDirect } from "./transaction.ts";

/** The network the signer signs for. */
export interface SignerNetwork {
  readonly chainId: string;
  /** The membership service's origin on this network: the one origin a signup or vouch document may name. */
  readonly origin: string;
}

export type Decision = "approved" | "declined";

export interface SignerOptions {
  /**
   * What holds the keys. An account is signed for by the first adapter that reports it, and an adapter that cannot
   * list its accounts stops no other from signing for its own.
   */
  readonly adapters: readonly KeyAdapter[];
  /**
   * The client's review screen: shows the review and resolves once the member has approved or declined. The
   * attachment is what the caller attached to its request, if anything: the signer hands it over as it was given and
   * never reads it, so the screen trusts none of it that the review does not bear out. It is asked for one review at a
   * time, and not for the next until the one before is answered and what it approved is signed, so a screen that
   * never answers holds every request behind it.
   */
  readonly present: (review: Review, attachment?: unknown) => Promise<Decision>;
  readonly network: SignerNetwork;
  /** The clock a document's expiry is read against, Unix seconds; the system clock when omitted. */
  readonly now?: () => bigint;
}

/** An account as a handle reports it: the SDK's, and the encodings its key signs a transaction in. */
export interface HandleAccount extends SignerAccount {
  /** A Ledger's is amino alone, so its transactions are built in amino. */
  readonly modes: readonly SigningMode[];
}

/**
 * The signer as one caller holds it: every call is checked against that caller's grant. It is the SDK's Signer, so
 * a feature hands it to the SDK's `signTx`, which builds the document and asks for the signature.
 */
export interface SignerHandle extends ArbitrarySigner, Signer {
  /**
   * The signer's accounts, as the SDK's Signer reports them. Needs `connect` and `read_addresses`. An adapter that
   * cannot list its accounts is left out, since the SDK asks for the accounts before every signature and one adapter's
   * fault must not stop another's key from signing; with nothing to list, the call is refused as that adapter was.
   */
  accounts(): Promise<readonly HandleAccount[]>;
  /** Signs a transaction's direct sign document. Needs `connect`, `sign`, and a grant of transactions. */
  signDirect(address: string, signDoc: SignDoc): Promise<DirectSignature>;
  /** Signs a transaction's amino sign document. Needs `connect`, `sign`, and a grant of transactions. */
  signAmino(address: string, signDoc: AminoSignDoc): Promise<AminoSignature>;
  /**
   * This handle for one request, with a value the review screen is handed beside the review: a fee quote, so the
   * screen can show how the ceiling divides. It signs one document and then refuses, so no attachment is shown
   * beside a second.
   */
  attach(attachment: unknown): Signer;
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
function adapterRefusal(doing: string, err: unknown): SignerRefusal {
  return err instanceof SignerRefusal ? err : new SignerRefusal("invalid", `the key adapter failed ${doing}`, { cause: err });
}

async function fromAdapter<T>(doing: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw adapterRefusal(doing, err);
  }
}

/** An adapter's accounts, or the refusal it failed to list them with. */
async function listed(adapter: KeyAdapter): Promise<readonly AdapterAccount[] | SignerRefusal> {
  try {
    return await adapter.accounts();
  } catch (err) {
    return adapterRefusal("listing its accounts", err);
  }
}

export function createSigner(options: SignerOptions): ArkSigner {
  const adapters = [...options.adapters];
  const now = options.now ?? systemClock;
  let network: SignerNetwork = { chainId: options.network.chainId, origin: options.network.origin };

  // One review is up at a time. A request waits its turn behind those asked before it, whoever asked them, and holds
  // it until its signature is back, so the member is never shown two reviews at once and an approval is for the one
  // document on the screen.
  let turn: Promise<unknown> = Promise.resolve();
  function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const mine = turn.then(run);
    // A request that fails gives up its turn like any other.
    turn = mine.catch(() => undefined);
    return mine;
  }

  /** An adapter's account, refused when its key does not derive to its address. */
  function checked(account: AdapterAccount): AdapterAccount {
    if (!derivesTo(account.publicKey, account.address)) throw new SignerRefusal("invalid", `the key adapter reported a key that is not ${account.address}'s`);
    return account;
  }

  async function holder(address: string): Promise<{ adapter: KeyAdapter; account: AdapterAccount }> {
    let failed: SignerRefusal | undefined;
    for (const adapter of adapters) {
      const accounts = await listed(adapter);
      // An adapter that cannot list its accounts does not stop another from signing for one it holds.
      if (accounts instanceof SignerRefusal) {
        failed ??= accounts;
        continue;
      }
      const account = accounts.find((a) => a.address === address);
      if (account) return { adapter, account: checked(account) };
    }
    // No adapter that answered holds the account, so it may be the one that did not: its refusal is the reason given.
    throw failed ?? new SignerRefusal("invalid", `the signer holds no account ${address}`);
  }

  /** Shows the review and returns only on an approval: a decline, any other answer, and a screen that fails each sign nothing. */
  async function consent(review: Review, attachment: unknown): Promise<void> {
    let decision: Decision;
    try {
      decision = await options.present(review, attachment);
    } catch (err) {
      throw new SignerRefusal("invalid", "the review screen failed", { cause: err });
    }
    if (decision !== "approved") throw new SignerRefusal("declined", `the member declined the ${review.kind}`);
  }

  function parse(data: Uint8Array): SignupDocument {
    try {
      return parseDocument(data);
    } catch (err) {
      throw new SignerRefusal("invalid", "the data is not a signup or vouch document", { cause: err });
    }
  }

  function requireChain(what: string, chainId: string): void {
    if (chainId !== network.chainId) throw new SignerRefusal("invalid", `the ${what} is for ${chainId}, and the signer signs for ${network.chainId}`);
  }

  /** The document's chain is the signer's network, and its origin the membership service's on that network. */
  function requireNetwork(doc: SignupDocument): void {
    requireChain("document", doc.chain_id);
    if (doc.origin !== network.origin) throw new SignerRefusal("invalid", `the document is from ${doc.origin}, not ${network.origin}`);
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
    requireNetwork(doc);
    requireUnexpired(doc);
    const { adapter, account } = await holder(address);
    if (!adapter.modes.includes("amino")) throw new SignerRefusal("invalid", "the key adapter does not sign amino, which a document is signed in");

    // The bytes are fixed before the member sees the review: the document as parsed, in canonical encoding, so
    // nothing the caller or the review screen does while the member reads can change what the approval signs.
    const canonical = documentBytes(doc);
    const signBytes = adr036SignBytes(address, canonical);
    const review: Review = { kind: "document", caller: grant.caller, account: address, fields: reviewDocument(doc) };

    return inTurn(async () => {
      // The request may have waited behind another: the network may have been switched meanwhile, and the document
      // may have expired, and then it is not shown.
      requireNetwork(doc);
      requireUnexpired(doc);
      await consent(review, undefined);
      // The member may have read for longer than the document had left.
      requireUnexpired(doc);

      const signature = await fromAdapter("signing", () => adapter.sign(address, signBytes));
      // The stateless rules of §7 on what the key returned, so a faulty adapter is caught here and not by the service.
      const refused = checkSubmission({ data: canonical, signer: address, publicKey: account.publicKey, signature });
      if (refused !== undefined) throw new SignerRefusal("invalid", `the key returned a proof the service would refuse: ${refused}`);
      return { signature, publicKey: account.publicKey };
    });
  }

  async function signTransaction<Doc>(
    grant: HeldGrant,
    address: string,
    mode: SigningMode,
    hold: (publicKey: Uint8Array) => HeldTransaction<Doc>,
    attachment: unknown,
  ): Promise<{ signDoc: Doc; signature: Uint8Array }> {
    requireCapability(grant, "connect");
    requireCapability(grant, "sign");
    requireTransactions(grant);
    const { adapter, account } = await holder(address);
    if (!adapter.modes.includes(mode)) throw new SignerRefusal("invalid", `the key adapter does not sign ${mode}, which the document is in`);

    // The bytes are fixed before the member sees the review, and the review is read from those bytes.
    const held = hold(account.publicKey);
    requireChain("transaction", held.chainId);
    let reviewed: ReturnType<typeof reviewTransaction>;
    try {
      reviewed = reviewTransaction(held.chainId, held.body, held.fee);
    } catch (err) {
      throw new SignerRefusal("invalid", "the transaction has no review", { cause: err });
    }
    const review: Review = { kind: "transaction", caller: grant.caller, account: address, ...reviewed };

    return inTurn(async () => {
      // The request may have waited behind another, and the network may have been switched meanwhile.
      requireChain("transaction", held.chainId);
      await consent(review, attachment);

      const signature = await fromAdapter("signing", () => adapter.sign(address, held.signBytes));
      // What the chain's signature check asks, so a faulty adapter is caught here and not by a node.
      const good =
        signature instanceof Uint8Array &&
        signature.length === SIGNATURE_LENGTH &&
        isLowS(signature) &&
        verifyMessage(signature, held.signBytes, account.publicKey);
      if (!good) throw new SignerRefusal("invalid", "the key returned a signature the chain would refuse");
      return { signDoc: held.signDoc, signature };
    });
  }

  return {
    grant(grant: Grant): SignerHandle {
      const held = holdGrant(grant);
      async function accounts(): Promise<readonly HandleAccount[]> {
        requireCapability(held, "connect");
        requireCapability(held, "read_addresses");
        const all: HandleAccount[] = [];
        let failed: SignerRefusal | undefined;
        for (const adapter of adapters) {
          const accounts = await listed(adapter);
          if (accounts instanceof SignerRefusal) {
            failed ??= accounts;
            continue;
          }
          for (const account of accounts) {
            const { address, publicKey } = checked(account);
            all.push({ address, publicKey: secp256k1PublicKey(publicKey), modes: [...adapter.modes] });
          }
        }
        if (failed && all.length === 0) throw failed;
        return all;
      }
      const signDirect = (address: string, signDoc: SignDoc, attachment?: unknown): Promise<DirectSignature> =>
        signTransaction(held, address, "direct", (publicKey) => holdDirect(signDoc, publicKey), attachment);
      const signAmino = (address: string, signDoc: AminoSignDoc, attachment?: unknown): Promise<AminoSignature> =>
        signTransaction(held, address, "amino", () => holdAmino(signDoc), attachment);
      return {
        accounts,
        signDirect: (address, signDoc) => signDirect(address, signDoc),
        signAmino: (address, signDoc) => signAmino(address, signDoc),
        attach(attachment: unknown): Signer {
          let asked = false;
          const once = (): void => {
            if (asked) throw new SignerRefusal("invalid", "an attachment is for one request, and a document was already asked for with it");
            asked = true;
          };
          return {
            accounts,
            async signDirect(address, signDoc) {
              once();
              return signDirect(address, signDoc, attachment);
            },
            async signAmino(address, signDoc) {
              once();
              return signAmino(address, signDoc, attachment);
            },
          };
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
