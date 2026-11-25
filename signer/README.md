# signer

The Ark app's signer: the one package that reviews a document with the member and signs it with their key. Every
feature asks it for a signature and never sees a key. It reaches no node and no service: the feature that asks builds
the transaction with the SDK, chooses the fee, and broadcasts what the signer returns.

## Status

| Part | State |
| --- | --- |
| The signup documents and their proof | Built |
| The pipeline: consent, permissions, and the review of a document | Built |
| The review of a transaction, and the SDK's `Signer` | Built |
| The device keystore, with backup and recovery | Designed |
| The Ledger adapter | Designed |
| The handoff protocol | Designed |

From [Interface](#interface) on, what is still design is marked as designed, and is rewritten as what is once it is
built. The [build plan](docs/BUILD_PLAN.md) has the order, what each stage delivers, and the decisions still open.

## Layout

| Path | What it holds |
| --- | --- |
| [docs/SIGNUP_PROTOCOL.md](docs/SIGNUP_PROTOCOL.md) | The member signup protocol: the challenge and the vouch document, the ADR-036 signature, the submission, and the verification rules. |
| [testdata/signup/vectors.json](testdata/signup/vectors.json) | The protocol's test vectors, part of the specification. The tests here and the membership service's verifier both reproduce them. |
| [src/signup/document.ts](src/signup/document.ts) | The document of §4: its grammar, its canonical bytes, and a parser that refuses anything not in canonical encoding. |
| [src/signup/signbytes.ts](src/signup/signbytes.ts) | The ADR-036 sign bytes of §5. |
| [src/signup/proof.ts](src/signup/proof.ts) | The submission of §6, signing a document through whatever holds the key, and the stateless rules 1 to 4 of §7. |
| [testdata/decoding/](testdata/decoding/) | `ark`'s decoding fixtures at the tag in [ARK_VERSION](ARK_VERSION), the tag the pinned SDK's types are generated from. Every transaction among them is signed through the pipeline in both encodings. |
| [src/signer.ts](src/signer.ts) | The pipeline: consent, review, and signing, with the SDK's `Signer` and the sign-arbitrary call through it. |
| [src/transaction.ts](src/transaction.ts) | A transaction's sign document as the signer holds it, in either encoding: its own copy, the bytes signed, and the body and fee those bytes describe. |
| [src/permissions.ts](src/permissions.ts) | The capabilities, and the grant a caller holds. |
| [src/review/](src/review/model.ts) | The review model a client renders, a document as its fields, and a transaction as its messages and its fields. |
| [src/refusal.ts](src/refusal.ts) | Why the signer did not sign, by kind. |
| [src/adapter.ts](src/adapter.ts) | The interface whatever holds a key implements. |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | The order the rest is built in. |

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
import { createSigner, SIGNUP_DOMAIN, signDocument, submissionToJson } from "@ararat-network/signer";

const signer = createSigner({
  adapters: [keystore], // whatever holds the key
  present: showReview, // the client's review screen
  network: { chainId: "ark-1", origin: "https://members.ararat.network" },
});
const signup = signer.grant({
  caller: "signup",
  capabilities: ["connect", "read_addresses", "sign"],
  documents: [SIGNUP_DOMAIN],
});

const submission = await signDocument(signup, address, challengeBytes); // reviewed, approved, signed, and checked
const body = submissionToJson(submission); // the four values the service stores
```

- `parseDocument` and `validateDocument` refuse a domain other than `ark-signup/v1` and `ark-vouch/v1`, and any
  encoding but the canonical one. Bytes that do not parse never reach a key.
- `signDocument` takes an `ArbitrarySigner`, one method that returns a signature and the compressed public key. A
  feature's handle on the signer is one, and the only one a feature holds.
- `verifySignature` and `checkSubmission` are a local check on what a keystore or a Ledger returned, and the pipeline
  runs `checkSubmission` before it hands a signature back. The membership service runs every rule and is the verifier.

Requesting the challenge, the session, device attestation, and submitting the proof are the signup flow's, in `app/`.

## Interface

`createSigner` takes the key adapters, the client's review screen, and the network, and `grant` hands a caller a
handle on the signer limited to its [permissions](#permissions). Feature code reaches the signer through a handle,
never through an adapter. A handle is the SDK's `Signer` as that interface stands, with nothing added to it: a
feature hands its handle to the SDK's `signTx`, which builds the document and asks for the signature, as every Cosmos
client does with its wallet. Its calls:

- `accounts`, which reports the signer's accounts as the SDK's `Signer` does, each with the encodings its key signs
  a transaction in, so a feature builds a Ledger account's transactions in amino;
- `signDirect` and `signAmino`, the SDK's two, each for a transaction's sign document in one encoding
  ([the review of a transaction](#the-review-of-a-transaction));
- `attach`, which gives the handle for one request, with a value the review screen is handed beside the review. It is
  how a fee quote reaches the screen: `signTx(prepared.tx, handle.attach(prepared.quote))`. The signer never reads the
  value, and what `attach` returns signs one document and then refuses, so no quote is shown beside a second;
- `signArbitrary`, a call of the signer's own for the signup protocol's documents
  ([the sign-arbitrary call](#the-sign-arbitrary-call)), which the SDK's interface does not have;
- `setNetwork`, which switches the network the signer signs for.

The SDK builds every transaction document and the signer builds the ADR-036 sign bytes; the signer signs both, and
nothing else sees the key.

## The core

Shared by every client and every adapter, as a pipeline:

1. **Consent.** A request names its caller, the account, and the document. Nothing is signed until the member approves
   on the review screen, and one approval signs one document. The review screen is the client's, passed to the signer
   as `present`: a decline, an answer that is not an approval, and a screen that fails each sign nothing.
2. **Review.** A document of the signup protocol is parsed and shown with its origin, which of the two documents it
   is, its chain ID, and its expiry ([the sign-arbitrary call](#the-sign-arbitrary-call)). A transaction is shown as
   its messages and what it carries beside them ([the review of a transaction](#the-review-of-a-transaction)). What
   is signed is fixed before the review is shown, so nothing done while the member reads changes what the approval
   signs.
3. **Sign.** Through the adapter that holds the account. What the key returns is checked before the signature goes
   back to the caller.

The pipeline ends at the signature. The signer reaches no node and no service: it reviews and signs the document it
is given, and choosing a fee and broadcasting are the caller's, through the SDK. Their rules are the phone app's
([fees and broadcast](../app/README.md#fees-and-broadcast)).

Every step is TypeScript, shared by the phone and the web. Review produces a model
([src/review/model.ts](src/review/model.ts)): the fields in the order they are shown, each a label and a value, and
for a transaction its messages before them. A label is a key, never text, and a value is typed and raw, never
formatted, so each client renders the model with its own components and its language's strings, and the two clients
share one reading and no components. `REVIEW_LABELS`, `REVIEW_CHOICES`, and `REVIEW_MESSAGES` list every key, for the
check in [`i18n`](../i18n/README.md) that every language carries every
string; the signer does not depend on `i18n`. The handoff protocol of [keystore per platform](#keystore-per-platform)
is the core's too, since both ends of it must share one implementation.

### The review of a transaction

Built on the SDK's decoder, which `ark`'s decoding fixtures test, from the body and the fee the sign document
describes. A direct document and an amino one of the same transaction give the same review.

- **Each message, in the order they run.** The four a member signs in the first tranche, a delegation, a vote, a
  send, and a withdrawal of rewards, have a summary, which states every member the message carries: one a summary
  cannot state whole is not summarised in part. Any other type the chain has is shown as its type URL and the chain's
  JSON view, marked as not summarised. A type the signer does not have is shown as unknown, with its type URL and its
  bytes.
- **A contract payload, marked unverified.** A message that holds one, in itself or in a message it carries, as a
  proposal carries the messages it would run, is marked. The payload is in the JSON view as it will be sent; what
  the contract does with it is not something the signer can read.
- **What the transaction carries beside its messages.** The chain ID; the memo; the fee as the ceiling it is, each
  denomination apart and in the order declared; the gas limit; a fee payer or granter; a timeout height; and for an
  unordered transaction, that it is unordered and the time it is valid until.

The ceiling is all the signer shows of a fee: a signature commits to the messages and the ceiling and to nothing
else. The tax, the gas, and the tip the ceiling divides into are the chain's figures, in the SDK's fee quote, which
the signer never reads. A feature attaches the quote to its request, and the signer hands it to the review screen
beside the review; showing its figures apart at the quote's height, as the direction's
[fees rule](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md) asks, is the review
screen's ([fees and broadcast](../app/README.md#fees-and-broadcast)).

What is reviewed is all of what is signed, or nothing is signed:

- **A direct document** is protobuf, decoded and then encoded again. It is refused unless it comes back byte for
  byte, and refused if it holds a field the signer's types do not have, in the body, in a message, or in a message
  another carries: review would show less than the key signs. Its auth info must be one signer's, the account's own
  key, signing direct.
- **An amino document** is JSON, decoded by the SDK's `decodeAminoSignDoc` into the same body and fee, and encoded
  again by the SDK's `makeAminoSignDoc`. It is refused unless the bytes are those the signer was asked to sign, so a
  fault in the decoder stops a signature and never shows a member something other than what is signed. A type the
  signer does not have has no amino document it can read, so it is refused in amino and shown as unknown in direct.
- **Either** is refused for a chain other than the signer's network, for an account the signer does not hold, in an
  encoding the account's key does not sign, with no message, with extension options, or unordered with no time it is
  valid until.

The signature the key returns is checked as the chain checks it, 64 bytes with a low S that verify under the
account's key, before it is handed back with the signer's own copy of the document.

### Refusals

Whatever stops a signature is a `SignerRefusal` with a kind. A kind exists only where the app does something
different for it: `declined`, `not_granted`, `expired`, and, from the adapters, `authentication_failed`, `locked_out`,
`device_unavailable`, `wrong_app`, and `rejected_on_device`. Everything that means a bug or an attack is `invalid`:
bytes that are no document, a document for another network, a transaction review cannot show whole, an account the
signer does not hold, a key that returned a bad signature. An adapter's own refusal passes through the pipeline, and
anything else an adapter throws becomes `invalid` with the cause kept. A refusal's message is an English diagnostic
for a log; what a member reads is a string the app chooses by kind.

## The sign-arbitrary call

`signArbitrary` is the signup protocol's producer and nothing else in the first tranche. The signer parses the data as a
document of the protocol's [§4](docs/SIGNUP_PROTOCOL.md#4-documents) and refuses bytes that do not parse: a signer that
signs arbitrary bytes is a phishing tool. Before review it refuses:

- a domain the caller's grant does not name, so a vouch is signed from the app's vouch flow alone, never from a link, a
  QR code, or a page, none of which holds a grant;
- a document for a chain other than the signer's network, or from an origin other than the membership service's on
  that network. The signup flow requests a challenge from that origin and refuses one from anywhere else, and the
  signer refuses it again;
- a document that has expired, which it also refuses after approval when the member read past the expiry. The start of
  the window is the service's to check against its own clock, so a device clock a little behind signs a fresh document.

It then shows the member the origin, which document it is, the chain ID, and the expiry, and shows a voucher the
admission they are answering.

## Adapters

Two adapters in the first tranche. Both implement the same interface, `KeyAdapter`: the sign modes the key signs in,
its accounts, and a signature over the sign bytes it is given. The core builds the sign bytes and checks every
signature an adapter returns, so no adapter decides what is signed, and the features never know which one signed.
Neither adapter is built yet; the tests use a key in memory.

The package is a TypeScript core with one subpath export per adapter, so a client imports what it has: the phone the
keystore and the Ledger adapter over Bluetooth, the web the handoff and the Ledger adapter over WebUSB, and never the
keystore, so nothing native reaches a browser build.

**Device keystore.** The default, [keystore per platform](#keystore-per-platform).

**Ledger.** Over Zondax's `@zondax/ledger-cosmos-js` as published, at an exact version, on an `hw-transport`: Bluetooth
on the phone, WebUSB or WebHID on the web. ledger-ark forks the device app and not this package, which its emulator
tests use unmodified. The package returns a DER signature, which the adapter converts to `r || s` and normalises to
low S. The adapter derives at `m/44'/330'/0'/0/0` with the `ark` prefix, the only path the
device app accepts, confirms the address on the device at first use, and signs in amino JSON alone: the device displays
the sign document, so `signDirect` is refused and the SDK's builder takes the amino path for a Ledger account. It
needs device app 2.3.0 or later, the first that signs an unordered transaction's document, and refuses an older one.
The device accepts an unordered document only as the chain writes it, signed at sequence zero, and ends its review
on two pages, `Unordered` and `Timeout Timestamp`
([transaction spec](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#unordered-transactions)).
An ADR-036 document goes to the device as its amino sign bytes, which the device shows in expert mode with the data as
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

| Capability       | Grants                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| `connect`        | The signer's accounts are made available to the caller                  |
| `read_addresses` | The caller reads an account's address and public key                    |
| `sign`           | The caller may request a signature, each one approved on review         |
| `change_network` | The caller may switch the network the signer signs for                  |

A grant names its caller, its capabilities, and, beside `sign`, what the caller may ask a signature for: the document
domains, and whether transactions. The signup flow is granted the challenge, the vouch flow the vouch document, a
feature that sends transactions is granted transactions, and a feature granted none of them can have nothing signed.
The signer keeps its own copy of a grant, so a caller cannot widen it afterwards. `accounts` needs `connect` and
`read_addresses`; `signDirect` and `signAmino` need `connect`, `sign`, and a grant of transactions; `signArbitrary`
needs `connect`, `sign`, and the document's domain; and `setNetwork` needs `change_network`.

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

Every transaction is reviewed from decoded messages ([the review of a transaction](#the-review-of-a-transaction)),
with the fee as the ceiling it is, and one review cannot show whole is not signed, in either encoding. What
will be charged beside it, the NOAH margin as the tip it is, and the tax apart from the amount are the chain's figures,
which the review screen shows from the SDK's quote, and only when that quote's declared fee is the document's ceiling.
The Ledger shows its own display, which the member reads on the device;
the app's review and the device's are the same document. For an unordered transaction the device shows the time it is
valid until in UTC, as it is signed, where the app shows the same moment in the member's own time. The device has no
clock, so it cannot say whether that time has passed or how far off it is.

## Ownership and tests

The package, its native module included, has its own CODEOWNERS and its own tests: the signup protocol's vectors,
byte-equal sign bytes and signatures; the decoding fixtures, for review; the keystore's wrap, unwrap, and zeroisation
on both platforms; the Ledger adapter against ledger-ark's emulator suite; and the handoff round trip. It changes
slowly and on its owners' review.

It leaves the repository when something outside it needs it: a browser extension, a third-party wallet, the wallet kit's
dapp protocol, or an audit that wants a frozen tag. Until then it is a package, and the app and the signer move in one
pull request.

## Dependencies

Today the runtime dependencies are two. `@ararat-network/sdk` at an exact version is for bytes, the chain's sorted
JSON, address derivation, secp256k1, and both encodings of a transaction, so none of them has a second implementation
here. `@bufbuild/protobuf` at the version the SDK itself depends on is for reading a message through its type, which
is how review finds a contract payload wherever a message holds one.

As the adapters are built, the runtime dependencies are kept to: the SDK, with noble and scure through it;
`@bufbuild/protobuf`; `@zondax/ledger-cosmos-js` and the Ledger transport packages; and libsecp256k1 at a pinned
release, built from source in the native module. A bump to any of them is reviewed by the signer's owners.

## Development

From this directory, with pnpm through corepack on Node 22 or later:

```sh
pnpm install
pnpm lint
pnpm check
pnpm test
pnpm fixtures:check   # the decoding fixtures are those of ark at the tag in ARK_VERSION
```

`ARK_VERSION` is the `ark` tag the pinned SDK's types are generated from, and moves with the SDK's pin: change both,
then `pnpm fixtures:sync`.

The package stands alone: its manifest, lockfile, and tooling configuration are all here, and nothing at the
repository root is needed to build or test it. The repository's [LICENSE](../LICENSE) covers it.

The tests run on `node:test` through `tsx`. The package exports its TypeScript source, so there is no build step.
