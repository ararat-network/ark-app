# The signer's build plan

How the signer is built out from the signup documents it holds today to the done-line of the repository's first build
step. The [README](../README.md) is the design; this is the order, what each stage delivers, and the decisions still
open. A stage is one pull request that passes CI on its own and moves a row of the README's status table from Designed
to Built. A stage's section is removed here once it is built, since the README then says what is: stages 1 to 3, the
pipeline with the review of a document, the review of a transaction with the SDK's `Signer`, and the Ledger adapter,
are built.

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
  ready?(address: string): Promise<void>; // whether the key can sign now, asked before a review; a Ledger has it
}
```

The core builds the sign bytes, with the SDK's `directSignBytes` and `aminoSignDocBytes` and the signer's
`adr036SignBytes`, and checks every signature an adapter returns before it leaves the package. No adapter decides what
is signed. An adapter that cannot list its accounts is passed over, so one adapter's fault does not stop another's key
from signing.

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
the client's review screen, resolving to approved or declined, and one approval signs one document. It is asked for
one review at a time: a request waits its turn behind those asked before it. A feature holds a handle from
`signer.grant({ caller, capabilities, documents, transactions })` and is refused past its grant. A handle is the
SDK's `Signer`.

**Refusals.** One class, `SignerRefusal`, with a `kind` only where the app does something different: `declined`,
`not_granted`, `expired`, `authentication_failed`, `locked_out`, `device_unavailable`, `device_locked`, `wrong_app`,
`app_outdated`, `rejected_on_device`, and `invalid` for everything that means a bug or an attack. Its message is an
English diagnostic a member never reads; what a member reads is a string resource the app chooses by kind.

## Stages

### 4. The device keystore, with backup A

`keystore/`, exported as `@ararat-network/signer/keystore`: a TypeScript entry over Swift and Kotlin, over a C core.
It is built in four pull requests, of which the first three are done:

1. The platforms' documentation read against the design
   ([what the platforms document](../README.md#what-the-platforms-document)).
2. The core and the module ([the keystore's core](../README.md#the-keystores-core)): the seed to the key and the key
   to a signature in C, libsecp256k1 from pinned source, and the module linked into the phone app from this package,
   where a check of the core runs on the simulator and the emulator in CI.
3. Protection at rest ([README](../README.md#protection-at-rest)): the seed made in native code and encrypted under
   the hardware key, authentication for each signature, the two kinds of key, the refusals, and the key adapter the
   pipeline signs through, checked on the simulator and the emulator in CI.
4. Backup A.

What is left, in 4:

- Backup option A in the same module: the seed encrypted under a key derived by Argon2id from a recovery secret the
  member chooses, kept in the platform account's keychain. Its restore is also how a test loads a known key, so a
  release build holds no import made for tests, and with a fixture's seed restored the module's signatures are held
  to the core's byte for byte. Backup B, the mnemonic, is built with the staking flow that offers it.

What is left that no pull request closes:

- **[The phone checklist](KEYSTORE_PHONE_CHECKLIST.md) has not been run.** Nothing of the keystore has run on a
  phone: that the hardware key is in the Secure Enclave or StrongBox, authentication on iOS at all, a real
  fingerprint or face, and Android 9 and 10 are checked there, by hand.
- **What iOS reports for a key an enrolment invalidated is not known.** Apple documents the invalidation and not the
  error. The keystore reads a removed passcode with no prompt, and reads an enrolment only from the Enclave's refusal,
  which it takes as `key_invalidated` when the error says what the key needed is gone and as a failed authentication
  otherwise. The checklist's step 9 on an iPhone says which it is; if it is the second, the fix is to keep the
  biometric set's state beside the key and compare it, which the platform exposes.
- **The app's own line for Face ID** is in the app's configuration, in English, until `i18n` holds it.

Done: wrap and unwrap are tested on both platforms; with a fixture's seed restored the module's signatures equal
the core's, which the host tests hold to the signup vectors and the transaction fixtures byte for byte; a phone with
no passcode is tested on the emulator, and on iOS by the checklist, since the Simulator has no passcode to remove; and
what the simulator and the emulator cannot show, the hardware itself and an enrolment on iOS, is on a checklist that
is run on a phone.

### 5. End to end on a localnet

The done-line of the repository's first step: a transaction built and broadcast by a test through the SDK's
`prepareTx`, `signTx`, and `broadcastTx`, signed from a device key and from a Ledger, each unordered, on the pattern
of the SDK's localnet smoke workflow.

### Order, and what is outside it

Stage 4, then 5. Stage 4 is the first with native code, and the first that needs the phone app: a scaffold in `app/`
that builds and runs a native module. The Ledger adapter was built first so that the adapter interface was held
against a second, stricter implementation before Swift and Kotlin are written to it.

The handoff protocol waits for the web client, as the repository's build order has it. `i18n` is a package of its own:
its first form, the English strings, the check against `REVIEW_LABELS` and the refusal kinds, and a pseudo-locale, can
land at any time. The first release's languages include no right-to-left script, so isolating addresses and
origins from the text around them is not a first-release concern.

## Decisions

None is open. Those taken are written where they bear: the Ledger JS dependency in the
[README's adapters](../README.md#adapters), and React Native tooling, backup and recovery, and the keystore's own in
[stage 4](#4-the-device-keystore-with-backup-a) and in the README's
[keystore per platform](../README.md#keystore-per-platform) and [backup and recovery](../README.md#backup-and-recovery).
