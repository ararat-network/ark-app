# signer

The Ark app's signer: the one package that reviews a document with the member and signs it with their key. Every
feature asks it for a signature and never sees a key. It reaches no node and no service: the feature that asks builds
the transaction with the SDK, chooses the fee, and broadcasts what the signer returns.

The [design](../DESIGN.md#3-the-signer-package) describes the whole package: consent, review, the adapters for the
device keystore and the Ledger, and the handoff protocol. What is built so far is the signup protocol's documents and
their proof; each other part moves from the design into this README as it is built.

## Layout

| Path | What it holds |
| --- | --- |
| [docs/SIGNUP_PROTOCOL.md](docs/SIGNUP_PROTOCOL.md) | The member signup protocol: the challenge and the vouch document, the ADR-036 signature, the submission, and the verification rules. |
| [testdata/signup/vectors.json](testdata/signup/vectors.json) | The protocol's test vectors, part of the specification. The tests here and the membership service's verifier both reproduce them. |
| [src/signup/document.ts](src/signup/document.ts) | The document of §4: its grammar, its canonical bytes, and a parser that refuses anything not in canonical encoding. |
| [src/signup/signbytes.ts](src/signup/signbytes.ts) | The ADR-036 sign bytes of §5. |
| [src/signup/proof.ts](src/signup/proof.ts) | The submission of §6, signing a document through whatever holds the key, and the stateless rules 1 to 4 of §7. |

## The signup documents

Signup is completed in the app alone. The signer signs two documents and nothing else that is not a transaction: the
challenge the membership service issues for an admission, and the vouch document an existing member signs for one.

```ts
import { checkSubmission, parseDocument, signDocument, submissionToJson } from "@ararat-network/signer";

const document = parseDocument(challengeBytes); // refuses bytes that are not a canonical document
const submission = await signDocument(keySigner, address, document);
if (checkSubmission(submission) !== undefined) throw new Error("the key returned a proof the service would refuse");
const body = submissionToJson(submission); // the four values the service stores
```

- `parseDocument` and `validateDocument` refuse a domain other than `ark-signup/v1` and `ark-vouch/v1`, and any
  encoding but the canonical one. Bytes that do not parse never reach a key.
- `signDocument` takes an `ArbitrarySigner`, one method that returns a signature and the compressed public key. The
  device keystore and the Ledger adapter will implement it; the tests use a key in memory.
- `verifySignature` and `checkSubmission` are a local check on what a keystore or a Ledger returned. The membership
  service runs every rule and is the verifier.

Requesting the challenge, the session, device attestation, and submitting the proof are the signup flow's, in `app/`.

## Dependencies

`@ararat-network/sdk` at an exact version, for bytes, the chain's sorted JSON, address derivation, and secp256k1, so
none of them has a second implementation here. A bump to it is reviewed by this package's owners.

## Development

From this directory, with pnpm through corepack on Node 22 or later:

```sh
pnpm install
pnpm lint
pnpm check
pnpm test
```

The package stands alone: its manifest, lockfile, and tooling configuration are all here, and nothing at the
repository root is needed to build or test it. The repository's [LICENSE](../LICENSE) covers it.

The tests run on `node:test` through `tsx`. The package exports its TypeScript source, so there is no build step.
