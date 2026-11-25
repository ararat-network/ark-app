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
`not_granted`, `expired`, `authentication_failed`, `locked_out`, `device_unavailable`, `device_locked`, `wrong_app`,
`app_outdated`, `rejected_on_device`, and `invalid` for everything that means a bug or an attack. Its message is an
English diagnostic a member never reads; what a member reads is a string resource the app chooses by kind.

## Stages

### 4. The device keystore, with backup A

`keystore/`, exported as `@ararat-network/signer/keystore`: a TypeScript entry over Swift and Kotlin. It is built on
the phone app's [scaffold](../../app/README.md#status), an Expo app whose build already compiles Swift, Kotlin, and
one C source for both platforms and calls them from JavaScript with bytes passed through whole. The scaffold leaves
two things to this stage, since its native module is inside `app/` and the keystore is not: the app finding a native
module in a sibling package, and the app's bundler resolving that package's TypeScript and its own dependencies.

- Generation, wrapping, signing, and zeroisation as in [keystore per platform](../README.md#keystore-per-platform),
  with libsecp256k1 at a pinned release built from source.
- The raw key in C alone. Derivation and signing are beside libsecp256k1, and Swift and Kotlin pass bytes through,
  since neither can be relied on to zeroise memory.
- The seed kept, all 256 bits, and not the derived key alone, so the 24 words of backup B can be shown later.
- One layer of encryption at rest: the seed under the hardware key directly, an AES key in the Android Keystore and
  the Secure Enclave's own hybrid scheme on iOS. A second layer is added only if a reason for one is found.
- The encrypted seed in a Keychain item on iOS and in the app's no-backup directory on Android. An uninstall removes
  it on Android; on iOS nothing is documented, so the keystore relies on neither outcome.
- The member authenticates for each signature, with no window in which the key stays usable. On iOS each decryption
  makes its own authentication context, since one kept and already authenticated would sign with no prompt.
- Two kinds of key, chosen when the key is made, since no platform gives both a passcode fallback and a key that
  enrolment invalidates. Where the phone has strong biometrics enrolled, the key takes biometrics alone and a newly
  enrolled fingerprint or face invalidates it. Where it has not, the key takes the passcode and outlasts an
  enrolment. The module reports which it made, so the app can tell the member.
- Android from 9, the floor the app's config sets. The passcode kind of key is made from Android 11, the first that
  lets a key used once per authentication take the passcode; on Android 9 and 10 a phone with no strong biometrics
  is refused a key.
- A phone with no passcode, or no hardware-backed key store, refused a key, with a refusal the app can explain. Both
  platforms destroy the key when the passcode is removed, and the member restores from backup.
- The biometric prompt's text passed in from JavaScript, so it is a string resource like any other.
- Backup option A in the same module. Its restore is also how a test loads a known key, so a release build holds no
  import made for tests. Backup B, the mnemonic, is built with the staking flow that offers it.

What the two platforms do has been read against their documentation
([what the platforms document](../README.md#what-the-platforms-document)). It bore out one layer of encryption,
authentication for each signature, and no key without a passcode. It corrected two things, written above: where the
seed is kept on Android, and that iOS promises nothing of an uninstall. And it overturned one: a passcode fallback
and a key that enrolment invalidates were taken together, and neither platform gives both, so the key is now one
kind or the other. Two things the
documentation does not say are found by trying them, before the code relies on either: whether the Simulator has a
Secure Enclave, and whether the emulator has a hardware-backed Keystore.

Done: wrap, unwrap, and zeroisation are tested on both platforms; with the fixture keys restored the module's
signatures equal the signup vectors' and the transaction fixtures', byte for byte; and a changed biometric and a
phone with no passcode are each tested as far as the simulator and the emulator allow, with what they cannot show
said in the README.

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
