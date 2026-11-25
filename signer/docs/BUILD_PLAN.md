# The signer's build plan

How the signer is built out from the signup documents it holds today to the done-line of the repository's first build
step. The [README](../README.md) is the design; this is the order, what each stage delivers, and the decisions still
open. A stage is one pull request that passes CI on its own and moves a row of the README's status table from Designed
to Built. A stage's section is removed here once it is built, since the README then says what is: stages 1 and 2, the
pipeline with the review of a document and the review of a transaction with the SDK's `Signer`, are built.

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
type Review =
  | { kind: "document"; caller: string; account: string; fields: readonly ReviewField[] }
  | {
      kind: "transaction";
      caller: string;
      account: string;
      messages: readonly MessageReview[];
      fields: readonly ReviewField[];
    };
interface ReviewField { label: ReviewLabel; value: ReviewValue }
type ReviewValue =
  | { kind: "origin"; origin: string }
  | { kind: "choice"; choice: ReviewChoice }
  | { kind: "text"; text: string }
  | { kind: "time"; unixSeconds: string }
  | { kind: "address"; address: string }
  | { kind: "amount"; denom: string; amount: string }
  | { kind: "number"; number: string };
```

A label and a choice are keys, never text, and a value is typed and raw, never formatted. `REVIEW_LABELS`,
`REVIEW_CHOICES`, and `REVIEW_MESSAGES` are exported, so `i18n`'s check can require a string for each in every
language, and the signer never imports `i18n`. A message is a summary of its fields, or the chain's JSON view of a
type that has no summary, or a type URL and bytes for a type the signer does not have.

**The pipeline.** `createSigner({ adapters, present, network })` returns the signer. `present(review, attachment)` is
the client's review screen, resolving to approved or declined, and one approval signs one document. A feature holds a
handle from `signer.grant({ caller, capabilities, documents, transactions })` and is refused past its grant. A handle
is the SDK's `Signer`.

**Refusals.** One class, `SignerRefusal`, with a `kind` only where the app does something different: `declined`,
`not_granted`, `expired`, `authentication_failed`, `locked_out`, `device_unavailable`, `wrong_app`,
`rejected_on_device`, and `invalid` for everything that means a bug or an attack. Its message is an English diagnostic
a member never reads; what a member reads is a string resource the app chooses by kind.

## Stages

### 3. The Ledger adapter

`ledger/`, exported as `@ararat-network/signer/ledger`. TypeScript over an injected transport, so it needs no app.
It waits on one thing from ledger-ark: a release that carries the device binaries, for the emulator job here. The
release workflow now attaches the emulator's binary for each device, `ark_zemu_<model>_v<version>.elf`, with a
checksum for every file, but no release has been cut since: 2.3.0 carries installers alone. The job pins the release
tag and each file's SHA-256. The adapter's unit tests wait on nothing.

It no longer waits on signup. ledger-ark's emulator tests sign a signup challenge and a vouch, the protocol's own
vectors, on every device and with no change to the device app
([transaction spec](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#signup-documents)). What
they show bears on the adapter:

- The device shows `data` as base64 and does not decode it, so the origin, which document it is, and the expiry are
  read in the app's review alone. A challenge and a vouch look alike on the device.
- The device signs a document naming any address as its signer. The core builds the sign bytes for the account whose
  key signs, and that is what keeps a Ledger from signing for another address.
- The review is the same in normal and expert mode, and is titled as a transaction.

It no longer waits on the device app for unordered transactions. From 2.3.0 the app signs an unordered transaction's
amino document and shows its expiry
([transaction spec](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#unordered-transactions)),
so a Ledger account sends as a device key does.

The adapter is built on Zondax's `@zondax/ledger-cosmos-js` as published, at an exact version, and it alone touches
the package. No fork is needed: ledger-ark forked the device app alone, and its emulator tests drive that app with
the package unmodified. It is CommonJS and returns DER signatures with nothing said of low S.

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

Stages 3 and 4 are independent of each other, and the Ledger is recommended first: it has no native code, needs no
app scaffold and no open decision of the app's, and it holds the adapter interface against a second, stricter
implementation before Swift and Kotlin are written to it.

The handoff protocol waits for the web client, as the repository's build order has it. `i18n` is a package of its own:
its first form, the English strings, the check against `REVIEW_LABELS` and the refusal kinds, and a pseudo-locale, can
land at any time. The first release's languages include no right-to-left script, so isolating addresses and
origins from the text around them is not a first-release concern.

## Decisions

| | Decision | Options | Recommendation | Blocks |
| --- | --- | --- | --- | --- |
| b | React Native tooling | As in the [phone app's decisions](../../app/README.md#decisions) | Expo's module API and generated projects | Stage 4 |
| c | Backup and recovery | As in [backup and recovery](../README.md#backup-and-recovery) | Both: the blob at signup, the mnemonic before the first stake | Stage 4 |
