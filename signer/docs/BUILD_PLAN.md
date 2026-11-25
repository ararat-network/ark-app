# The signer's build plan

How the signer is built out from the signup documents it holds today to the done-line of the repository's first build
step. The [README](../README.md) is the design; this is the order, what each stage delivers, and the decisions still
open. A stage is one pull request that passes CI on its own and moves a row of the README's status table from Designed
to Built. A stage's section is removed here once it is built, since the README then says what is.

## Contents

- [The shape of the package](#the-shape-of-the-package)
- [Stages](#stages)
- [Decisions](#decisions)

## The shape of the package

Three interfaces hold the design together.

**The key adapter**, what the device keystore and the Ledger each implement:

```ts
interface KeyAdapter {
  readonly modes: readonly ("direct" | "amino")[]; // a Ledger: amino alone
  accounts(): Promise<readonly { address: string; publicKey: Uint8Array }[]>;
  sign(address: string, signBytes: Uint8Array): Promise<Uint8Array>; // 64 bytes, r || s, low S
}
```

The core builds the sign bytes, with the SDK's `directSignBytes` and `aminoSignDocBytes` and the signer's
`adr036SignBytes`, and checks every signature an adapter returns before it leaves the package. No adapter decides what
is signed.

**The review model**, what each client renders with its own components:

```ts
interface Review { kind: "document"; caller: string; account: string; fields: readonly ReviewField[] }
interface ReviewField { label: ReviewLabel; value: ReviewValue }
type ReviewValue =
  | { kind: "origin"; origin: string }
  | { kind: "choice"; choice: ReviewChoice }
  | { kind: "text"; text: string }
  | { kind: "time"; unixSeconds: string };
```

A label and a choice are keys, never text, and a value is typed and raw, never formatted. `REVIEW_LABELS` and
`REVIEW_CHOICES` are exported, so `i18n`'s check can require a string for each in every language, and the signer never
imports `i18n`. Transaction review adds `kind: "transaction"`, and amounts, addresses, and the chain's JSON view as
values.

**The pipeline.** `createSigner({ adapters, present, network })` returns the signer. `present(review)` is the client's
review screen, resolving to approved or declined, and one approval signs one document. A feature holds a handle from
`signer.grant({ caller, capabilities, documents })` and is refused past its grant.

**Refusals.** One class, `SignerRefusal`, with a `kind` only where the app does something different: `declined`,
`not_granted`, `expired`, `authentication_failed`, `locked_out`, `device_unavailable`, `wrong_app`,
`rejected_on_device`, and `invalid` for everything that means a bug or an attack. Its message is an English diagnostic
a member never reads; what a member reads is a string resource the app chooses by kind.

## Stages

### 1. The core pipeline and document review

TypeScript alone, in `src/`, tested with a key in memory. No dependency is added.

- The key adapter, the refusal, and the review model, as above.
- A signup or vouch document as review fields: the origin, which of the two it is, the chain ID, the expiry, and for a
  vouch the admission.
- The four capabilities of [permissions](../README.md#permissions), held per caller, with the document domains a
  caller may ask a signature for named in its grant, so a vouch is signed from the vouch flow alone.
- The pipeline, and `signArbitrary` through it: a document for another chain or from another origin is refused, an
  expired one is refused before review and again after approval, and what the key returns is checked under the
  stateless rules before it is handed back.

Done: the signup vectors are reproduced through the pipeline; a decline reaches no key; one approval yields one
signature; and each refusal above has a test.

### 2. Transaction review

Waits on nothing: it is built on the SDK as pinned, 0.4.0, which has the amino decoder and prepares, signs, and
broadcasts a transaction as three steps.

- The SDK's `Signer`: `accounts`, `signDirect`, and `signAmino`, implemented as the interface stands, with nothing
  added to it. A feature hands its handle on the signer to the SDK's `signTx`, which builds the document and asks the
  signer for the signature, as every Cosmos client does with its wallet. Direct is refused for an adapter that signs
  amino alone.
- The decoding fixtures synced here from the ark tag the pinned SDK names, with a check in CI that the copy is that
  tag's, since the SDK's npm package does not carry them. They are 85 transactions in `ark`'s
  `tests/fixtures/testdata/decoding`, each with its direct and its amino document, a `fee` object, and a
  deterministic signature.
- Review over the SDK's `decodeMessage`, the same for both encodings: a summary for each of the four messages a
  member signs in the first tranche, `MsgDelegate`, gov v1 `MsgVote`, `MsgSend`, and `MsgWithdrawDelegatorReward`;
  any other known type shown as its type URL and the chain's JSON view, labelled as not summarised; an unknown type
  URL shown as unknown; a contract payload shown as unverified. `MsgSetPayee` is later scope, and a member signs
  nothing to receive a payment.
- An amino document decoded to its body and fee by the SDK's `decodeAminoSignDoc`, the reverse of its amino encoder
  and driven by the same schemas, so one implementation reads every message type. The signer encodes what was decoded
  with the SDK's `makeAminoSignDoc` and refuses unless the bytes are those it was asked to sign, so a fault in the
  decoder stops a signature and never shows a member something other than what is signed. The body is then reviewed
  as a direct document's is: one reading, with no second reader to keep in step.
- The fee section: the declared fee, shown as the ceiling it is, each denomination apart. A signature commits to the
  messages and the ceiling and to nothing else, so those are what the signer reviews. How the ceiling divides into
  tax, gas, and tip is the chain's figure, in the SDK's fee quote, which the signer never reads.
- An attachment: a value a feature attaches to its request, handed to `present` beside the review and never read by
  the signer. It is how a fee quote reaches the review screen. With every denomination open the ceiling is not what
  is charged, so the division is shown where the member approves, and it is the division of the fee that is signed:
  the feature prices the transaction with `prepareTx`, which signs nothing, attaches the quote, and hands the
  transaction that was prepared to `signTx`, which signs it as it stands and asks the node nothing. The screen shows
  the quote only when its declared fee is the document's ceiling
  ([fees and broadcast](../../app/README.md#fees-and-broadcast)). This is built for every denomination from the
  start, not for the first tranche's NOAH alone.
- An unordered document shown with the time it is valid until. Independent transactions are sent unordered, from a
  device key and from a Ledger alike, which the chain allows: each expires at a timestamp in place of holding a
  sequence, so none can take another's and nothing is signed twice. Actions that belong together are one transaction
  of several messages: one review and one signature.
- A document for a chain other than the signer's network, or naming an account the signer does not hold, is refused.

Done: every transaction fixture signed through the pipeline, in each mode, reproduces its signature and its bytes;
the direct and the amino document of every fixture give the same review model; an amino document that does not encode
back to itself is refused; the fee section equals the fixture's declared fee; the four summaries and the
multi-message fixture have golden review models; an attachment reaches the review screen unchanged; and an unknown
type and an unordered document each have a test.

### 3. The Ledger adapter

`ledger/`, exported as `@ararat-network/signer/ledger`. TypeScript over an injected transport, so it needs no app.
It waits on two things from ledger-ark:

- An emulator test that a `sign/MsgSignData` document, whose chain ID is empty, parses and displays. An account on a
  Ledger signs up and vouches with it, and the [signup protocol](SIGNUP_PROTOCOL.md#5-signature) says the device shows
  the document, but nothing in ledger-ark's source, documents, or emulator tests covers one.
- Device binaries attached to its releases with their checksums, for the emulator job here. Its releases, 2.3.0
  among them, carry installers alone.

It no longer waits on the device app for unordered transactions. From 2.3.0 the app signs an unordered transaction's
amino document and shows its expiry
([transaction spec](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#unordered-transactions)),
so a Ledger account sends as a device key does.

The Ledger JS package is Zondax's `@zondax/ledger-cosmos-js` as published, and needs no fork: ledger-ark forked the
device app alone, and its emulator tests drive that app with the package unmodified. It is CommonJS and returns DER
signatures with nothing said of low S. Whether the adapter uses it or a small client of its own is
[decision a](#decisions), due here.

- Derives at `m/44'/330'/0'/0/0` with the `ark` prefix, confirms the address on the device at first use, and signs in
  amino alone.
- Converts the device's DER signature to `r || s` and normalises it to low S.
- Maps the device's return codes to refusal kinds: `0x6986` rejected on the device, `0x5515` locked, `0x6E00` and
  `0x6E01` the wrong app, a transport failure the device unavailable, and the rest invalid.
- Reads the device app's version on connecting and refuses one before 2.3.0, the first that signs an unordered
  document: an older app refuses the `unordered` and `timeout_timestamp` keys as outside its closed list. Every Ledger
  account then has one path. The refusal is a kind of its own, `app_outdated`, added with the adapter, since the
  member is told to update the app and `wrong_app` tells them to open it.
- Sends an unordered document as the core hands it over, rewriting nothing. The device accepts one only as the chain
  writes it: `unordered` the bare boolean `true`, a `timeout_timestamp` beside it, the time in UTC in Go's spelling
  of RFC 3339, and the sequence `"0"`. Anything else it refuses before review with `0x6984`. The SDK's amino encoder
  writes that form and the core signs only a document that encodes back to itself, so a refusal here is a fault and
  maps to `invalid`.
- Refuses before sending a document past the device's buffer.
- An unordered document has no sequence to be refused for. One whose time passes while the member reads on the device
  is refused by the chain, and is prepared again and reviewed again, never signed again unseen: one approval signs one
  document.

Done: unit tests on recorded exchanges pass, an app before 2.3.0 is refused, and a CI job signs fixture amino
documents, an unordered document, and a signup vector on the emulator, each signature verified against the emulator's
key.

### 4. The device keystore, with backup A

`keystore/`, exported as `@ararat-network/signer/keystore`: a TypeScript entry over Swift and Kotlin. It waits on
[decisions b and c](#decisions), and on a scaffold in `app/` that builds and runs a native module, which is the phone
app's first pull request.

- Generation, wrapping, signing, and zeroisation as in [keystore per platform](../README.md#keystore-per-platform),
  with libsecp256k1 at a pinned release built from source.
- The biometric prompt's text passed in from JavaScript, so it is a string resource like any other.
- Backup option A in the same module. Its restore is also how a test loads a known key, so a release build holds no
  import made for tests.

Done: wrap, unwrap, and zeroisation are tested on both platforms, and with the fixture keys restored the module's
signatures equal the signup vectors' and the transaction fixtures', byte for byte.

### 5. End to end on a localnet

The done-line of the repository's first step: a transaction built and broadcast by a test through the SDK's
`prepareTx`, `signTx`, and `broadcastTx`, signed from a device key and from a Ledger, each unordered, on the pattern
of the SDK's localnet smoke workflow.

### Order, and what is outside it

Stage 1, then 2. Stages 3 and 4 are independent of each other after that, and the Ledger is recommended first: it has
no native code, needs no app scaffold and no open decision of the app's, and it holds the adapter interface against a
second, stricter implementation before Swift and Kotlin are written to it.

The handoff protocol waits for the web client, as the repository's build order has it. `i18n` is a package of its own:
its first form, the English strings, the check against `REVIEW_LABELS` and the refusal kinds, and a pseudo-locale, can
land any time after stage 1. The first release's languages include no right-to-left script, so isolating addresses and
origins from the text around them is not a first-release concern.

## Decisions

| | Decision | Options | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| a | The Ledger JS dependency | Zondax's package at an exact version, touched by the adapter alone; or a small client of the device's commands written here against ledger-ark's `APDUSPEC.md`, with no CommonJS, `buffer`, or `ripemd160` | Zondax's package | Stage 3 |
| b | React Native tooling | As in the [phone app's decisions](../../app/README.md#decisions) | Expo's module API and generated projects | Stage 4 |
| c | Backup and recovery | As in [backup and recovery](../README.md#backup-and-recovery) | Both: the blob at signup, the mnemonic before the first stake | Stage 4 |
