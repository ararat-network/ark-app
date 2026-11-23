# signer

The Ark app's signer: the one package that reviews a document with the member and signs it with their key. Every
feature asks it for a signature and never sees a key. It reaches no node and no service: the feature that asks builds
the transaction with the SDK, chooses the fee, and broadcasts what the signer returns.

## Status

| Part | State |
| --- | --- |
| The signup documents and their proof | Built |
| Consent, review, and permissions | Designed |
| The device keystore, with backup and recovery | Designed |
| The Ledger adapter | Designed |
| The handoff protocol | Designed |

The sections from [Interface](#interface) on are the design the package follows. Each is rewritten as what is once it
is built.

## Layout

| Path | What it holds |
| --- | --- |
| [docs/SIGNUP_PROTOCOL.md](docs/SIGNUP_PROTOCOL.md) | The member signup protocol: the challenge and the vouch document, the ADR-036 signature, the submission, and the verification rules. |
| [testdata/signup/vectors.json](testdata/signup/vectors.json) | The protocol's test vectors, part of the specification. The tests here and the membership service's verifier both reproduce them. |
| [src/signup/document.ts](src/signup/document.ts) | The document of §4: its grammar, its canonical bytes, and a parser that refuses anything not in canonical encoding. |
| [src/signup/signbytes.ts](src/signup/signbytes.ts) | The ADR-036 sign bytes of §5. |
| [src/signup/proof.ts](src/signup/proof.ts) | The submission of §6, signing a document through whatever holds the key, and the stateless rules 1 to 4 of §7. |

As it will be laid out once the adapters are built:

```text
signer/
  src/        the core: consent, review, the sign-arbitrary call, the handoff protocol
  keystore/   the device keystore adapter: its TypeScript entry, and ios/ and android/ for the native module
  ledger/     the Ledger adapter over an injected transport: Bluetooth on the phone, WebUSB or WebHID on the web
```

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

## Interface

The package implements the SDK's `Signer`: `accounts`, `signDirect`, and `signAmino`. It adds `signArbitrary`, a call of
its own for the signup protocol's documents ([the sign-arbitrary call](#the-sign-arbitrary-call)), which the SDK's
interface does not have. The SDK builds every transaction document and the signer builds the ADR-036 sign bytes; the
signer signs both, and nothing else sees the key. Feature code reaches the signer through the capabilities of
[permissions](#permissions), never through an adapter.

## The core

Shared by every client and every adapter, as a pipeline:

1. **Consent.** A request names its caller, the account, and the document. Nothing is signed until the member approves
   on the review screen, and one approval signs one document.
2. **Review.** Built from the SDK decoder, which ark's decoding fixtures test: each message rendered by type; an unknown
   type URL shown as unknown, with the URL; a contract payload shown as unverified; an ADR-036 document parsed and shown
   with its origin, domain, chain id, and expiry; and the intended amount, the fee ceiling, the tax, and what will be
   charged shown apart, as the direction's
   [fees rule](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md) asks. The amount and
   the fee ceiling are read from the document. The tax and what will be charged are the chain's, so they come from the
   fee quote the caller passes with the request, and review shows them as the chain's figures at the quote's height, not
   as the signer's own.
3. **Sign.** Through the adapter the account belongs to. The signature goes back to the caller.

The pipeline ends at the signature. The signer reaches no node and no service: it reviews and signs the document it
is given, and choosing a fee and broadcasting are the caller's, through the SDK. Their rules are the phone app's
([fees and broadcast](../app/README.md#fees-and-broadcast)).

Every step is TypeScript, shared by the phone and the web. Review produces a model, the decoded fields with their labels
and amounts, which each client renders with its own components, so the two clients share one reading and no components.
The handoff protocol of [keystore per platform](#keystore-per-platform) is the core's too, since both ends of it must
share one implementation.

## The sign-arbitrary call

`signArbitrary` is the signup protocol's producer and nothing else in the first tranche. The signer parses the data as a
document of the protocol's [§4](docs/SIGNUP_PROTOCOL.md#4-documents), refuses a domain it does not know, and shows the
member the origin, the chain id, and the expiry before they sign. The signup flow requests a challenge from the service
origin configured for the network and refuses one from anywhere else. A vouch document shows the voucher which admission
they are answering, and the signer signs it only from the app's vouch flow, never from a link, a QR code, or a page.
Bytes that do not parse are refused: a signer that signs arbitrary bytes is a phishing tool.

## Adapters

Two adapters in the first tranche. Both implement the same interface, and the features never know which one signed.

The package is a TypeScript core with one subpath export per adapter, so a client imports what it has: the phone the
keystore and the Ledger adapter over Bluetooth, the web the handoff and the Ledger adapter over WebUSB, and never the
keystore, so nothing native reaches a browser build.

**Device keystore.** The default, [keystore per platform](#keystore-per-platform).

**Ledger.** Over ledger-ark's JS package, its fork of `@zondax/ledger-cosmos-js`, on an `hw-transport`: Bluetooth on the
phone, WebUSB or WebHID on the web. The adapter derives at `m/44'/330'/0'/0/0` with the `ark` prefix, the only path the
device app accepts, confirms the address on the device at first use, and signs in amino JSON alone: the device displays
the sign document, so `signDirect` is refused and the SDK's builder takes the amino path for a Ledger account. An
ADR-036 document goes to the device as its amino sign bytes, which the device shows in expert mode with the data as
base64 ([signup protocol §5](docs/SIGNUP_PROTOCOL.md#5-signature)). The devices are those a member can sideload until
Ledger lists the app ([install guide](https://github.com/ararat-network/ledger-ark/blob/main/docs/SIDELOAD.md)); a
device without Bluetooth, the Nano S+, signs from the web client or from an Android phone over USB. Multisignature
signing, the relay, and external-wallet adapters come later.

## Keystore per platform

Neither the Secure Enclave nor the Android Keystore signs secp256k1, so the key lives in software and the hardware
wraps it.

**Mobile.**

- **Generation.** 256 bits from the OS random source, in native code, kept as the seed. The key derives at
  `m/44'/330'/0'/0/0`, the path the Ledger and `arkd` use, so it can move ([backup and recovery](#backup-and-recovery)).
- **At rest.** The seed encrypted with AES-GCM under a data key; the data key wrapped by a hardware key, a Secure
  Enclave key on iOS and an Android Keystore key in StrongBox where the device has it, created with user authentication
  required: the OS biometric prompt, with the device passcode as fallback.
- **In use.** Unwrapped only for a signing call, in the native module, which hashes, signs with libsecp256k1 (RFC 6979,
  low-S), zeroises the seed and the key, and returns the signature. JavaScript sees the address, the public key, and
  signatures.
- **Not exported.** No call returns the seed or the key except the backup flow below, which runs in the same module.
  The data key is bound to the device and never leaves it; a new device gets a new one.

**Web.** No software key in the first version: a browser cannot zeroise memory or attest itself, and a web origin is
the phishing surface. The web client builds and reviews the transaction, then signs by handoff or a Ledger.

- **Handoff.** The sign document goes to the phone as a QR code, the phone's signer reviews and signs it, and the
  signature comes back the same way. The phone shows the document before it signs, so the review that matters happens
  on the device that holds the key, and no server sees the request. The relay that carries multisig partial signatures
  ([`ark-backend`](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-backend))
  can carry handoffs once it exists.
- **Ledger.** Over WebUSB or WebHID, through the same adapter as the phone's.

## Backup and recovery

The stakes: registration is permanent, one grant per person, and moving a grant's payee needs the member's own
signature. A member who loses the key with no backup loses the remaining payments and cannot register again. The
member has never seen a key, so the backup cannot be theirs to invent.

| Option                   | How it works                                                                                                                                                                                                                           | Protects against                                      | Costs                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Cloud keychain blob   | The seed encrypted under a key derived by Argon2id, with a random salt, from a recovery secret the member chooses, stored in the platform account's keychain: iCloud Keychain, or Google's Block Store and app backup. It appears on a new device of the same account, and the secret unlocks it. | A lost phone or a new one                              | The secret can be forgotten; the platform is a wall, with no move between Apple and Google; the secret's strength is the blob's, so the app requires a phrase, not a PIN |
| B. Mnemonic              | The seed shown as 24 BIP-39 words, once, with a check that the member wrote them down. It restores on any device and in any wallet on coin type 330.                                                                                   | A lost phone, a lost platform account, leaving the app | The member keeps a secret they have never had; shown at signup, it is the failure the first user is defined by                                                 |
| C. Both                  | A at signup; B offered once the first payment arrives and before the first stake.                                                                                                                                                      | Both                                                  | Two flows to build and explain                                                                                                                                 |

Recommendation: C. A at signup, since a lost phone during the hold must cost the member nothing but a restore, and B
once there is something to protect and the member has seen a payment arrive, as the way out of the platform account and
of the app. Neither Apple, Google, nor Ark can read the blob, and the hardware-wrapped data key is never backed up.
The scheme is a decision still to make:

| Decision                          | Options                                                                                                                      | Recommendation                                                                                                      | Blocks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Backup and recovery               | A cloud keychain blob under a recovery secret; a mnemonic; both                            | Both: the blob at signup, the mnemonic before the first stake                                                       | The keystore and signup                                                   |

## Permissions

Four capabilities, each granted separately and none implied by another:

| Capability     | Grants                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| connect        | An account is made available to the caller                              |
| read addresses | The caller reads the account's address and public key                   |
| sign           | The caller may request a signature, each one approved on review         |
| change network | The caller may switch the network the signer signs for                  |

In the first tranche the callers are the app's own features, each holding the capabilities it needs and nothing more,
and the signer refuses a feature that reaches past its grant. There is no blanket session. When the wallet kit arrives,
the same capabilities are granted per dapp origin: the model does not change, only who asks.

## Security

### Phishing of ADR-036 documents

The documents are made to be read: origin, domain, chain id, expiry. [The sign-arbitrary call](#the-sign-arbitrary-call)
parses and shows them, refuses unknown domains, requests challenges only from the configured origin, and signs vouches
only from the app's own flow. The web client never signs, so a phishing page cannot obtain an ADR-036 signature from a
browser, and a handoff is reviewed on the phone. A member asked anywhere else to sign an `ark-signup/v1` or
`ark-vouch/v1` document has no way to do it from the app.

### Transaction review

Every transaction is reviewed from decoded messages ([the core](#the-core)): the fee as the ceiling it is, beside what
will be charged; the NOAH margin as the tip it is; the tax apart from the amount. The Ledger shows its own display,
which the member reads on the device; the app's review and the device's are the same document.

## Ownership and tests

The package, its native module included, has its own CODEOWNERS and its own tests: the signup protocol's vectors,
byte-equal sign bytes and signatures; the decoding fixtures, for review; the keystore's wrap, unwrap, and zeroisation
on both platforms; the Ledger adapter against ledger-ark's emulator suite; and the handoff round trip. It changes
slowly and on its owners' review.

It leaves the repository when something outside it needs it: a browser extension, a third-party wallet, the wallet kit's
dapp protocol, or an audit that wants a frozen tag. Until then it is a package, and the app and the signer move in one
pull request.

## Dependencies

Today the one runtime dependency is `@ararat-network/sdk` at an exact version, for bytes, the chain's sorted JSON,
address derivation, and secp256k1, so none of them has a second implementation here.

As the adapters are built, the runtime dependencies are kept to: the SDK, with noble and scure through it;
`@bufbuild/protobuf`; ledger-ark's JS package and the Ledger transport packages; and libsecp256k1 at a pinned release,
built from source in the native module. A bump to any of them is reviewed by the signer's owners.

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
