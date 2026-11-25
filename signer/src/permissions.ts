// What a caller may ask of the signer. Four capabilities, each granted
// separately and none implied by another, and beside `sign` the document
// domains the caller may ask a signature for: the signup flow is granted the
// challenge, the vouch flow the vouch document, and a feature granted neither
// can have no document signed at all. The callers are the app's own features
// today; the same grant is made per dapp origin once there are dapps.
import { SignerRefusal } from "./refusal.ts";
import { type Domain, SIGNUP_DOMAIN, VOUCH_DOMAIN } from "./signup/document.ts";

export const CAPABILITIES = [
  /** The signer's accounts are made available to the caller. */
  "connect",
  /** The caller reads an account's address and public key. */
  "read_addresses",
  /** The caller may request a signature, each one approved on review. */
  "sign",
  /** The caller may switch the network the signer signs for. */
  "change_network",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface Grant {
  /** Names the feature that asks; review carries it. */
  readonly caller: string;
  readonly capabilities: readonly Capability[];
  /** The document domains a caller holding `sign` may ask a signature for; none when omitted. */
  readonly documents?: readonly Domain[];
}

/** A grant as the signer holds it: its own copy, which the caller cannot widen afterwards. */
export interface HeldGrant {
  readonly caller: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly documents: ReadonlySet<Domain>;
}

const DOMAINS: readonly string[] = [SIGNUP_DOMAIN, VOUCH_DOMAIN];

/** Copies a grant, refusing one that names no caller, or a capability or a domain there is none of. */
export function holdGrant(grant: Grant): HeldGrant {
  if (typeof grant.caller !== "string" || grant.caller === "") throw new SignerRefusal("invalid", "a grant names its caller");
  for (const capability of grant.capabilities) {
    if (!CAPABILITIES.includes(capability)) throw new SignerRefusal("invalid", `no capability ${String(capability)}`);
  }
  const documents = grant.documents ?? [];
  for (const domain of documents) {
    if (!DOMAINS.includes(domain)) throw new SignerRefusal("invalid", `no document domain ${String(domain)}`);
  }
  return { caller: grant.caller, capabilities: new Set(grant.capabilities), documents: new Set(documents) };
}

export function requireCapability(grant: HeldGrant, capability: Capability): void {
  if (!grant.capabilities.has(capability)) throw new SignerRefusal("not_granted", `${grant.caller} is not granted ${capability}`);
}

export function requireDocument(grant: HeldGrant, domain: Domain): void {
  if (!grant.documents.has(domain)) throw new SignerRefusal("not_granted", `${grant.caller} is not granted a signature on a ${domain} document`);
}
