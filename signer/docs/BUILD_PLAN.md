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

### 4. The device keystore, with its backups

`keystore/`, exported as `@ararat-network/signer/keystore`: a TypeScript entry over Swift and Kotlin, over a C core.
It is built in six pull requests, of which the first four are done:

1. The platforms' documentation read against the design
   ([what the platforms document](../README.md#what-the-platforms-document)).
2. The core and the module ([the keystore's core](../README.md#the-keystores-core)): the seed to the key and the key
   to a signature in C, libsecp256k1 from pinned source, and the module linked into the phone app from this package,
   where a check of the core runs on the simulator and the emulator in CI.
3. Protection at rest ([README](../README.md#protection-at-rest)): the seed made in native code and encrypted under
   the hardware key, authentication for each signature, the two kinds of key, the refusals, and the key adapter the
   pipeline signs through, checked on the simulator and the emulator in CI.
4. Backup B, the seed phrase, shown ([README](../README.md#the-seed-phrase)): its 24 words read back into a seed in
   the C,
   a native view that draws them, so that they never reach JavaScript, and a key stored from its words, which only a
   development build takes from JavaScript and which is how the device check holds a phone to a key it knows.
5. Backup B, the seed phrase, entered: a native view the member types its words into, which restores from them and
   checks them against the key held, with nothing of them in JavaScript.
6. Backup A.

The order was A alone, with B left to the staking flow that offers it. It is B first: the keystore can show and take
the words from the start, they need no cloud, no key derivation, and no new dependency, everything of them runs on
the simulator and the emulator, and storing a key from a seed is the half of A's restore that A then need not build.
When the app offers B is still the app's to decide, and is not decided by this.

What is left, in 5 and 6:

- **A native view for entering the seed phrase.** A text field of the platform's own, with its suggestions and learning
  off, which says how many words it holds and whether they are a seed's and never what they are. It restores a key
  from them, as a new key is stored, and says whether they are the words of the key held, which is the check that a
  member wrote them down. The core already reads a text as words and says which word is not of the list.
- **Backup option A** in the same module: the seed encrypted under a key derived by Argon2id from a backup secret
  the member chooses, kept in the platform account's keychain, and restored through the same storing of a seed. A
  phone that still holds its key sets a new backup secret with no need of the old one.

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
- **iOS gives an app no way to refuse a screenshot.** The view that draws the words clears them when a recording or
  mirroring starts and when the app is left, and Android leaves them out of screenshots altogether; a screenshot
  taken on an iPhone while they are drawn holds them. The app's screen says so to the member.

Done: wrap and unwrap are tested on both platforms; with a known seed restored the module's signatures equal the
SDK's byte for byte, on the simulator and the emulator, and the core's are held by the host tests to the signup
vectors and the transaction fixtures; a phone with
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
