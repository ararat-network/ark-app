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
- The encrypted seed in a Keychain item on iOS, which survives the app being uninstalled, and in the app's storage on
  Android, which does not. What a reinstall finds on each is written in the README.
- The member authenticates for each signature, with no window in which the key stays usable.
- The hardware key invalidated when a fingerprint or a face is enrolled, so someone who enrols their own cannot sign,
  and the member restores from backup.
- A phone with no passcode, or no hardware-backed key store, refused a key, with a refusal the app can explain.
- The biometric prompt's text passed in from JavaScript, so it is a string resource like any other.
- Backup option A in the same module. Its restore is also how a test loads a known key, so a release build holds no
  import made for tests. Backup B, the mnemonic, is built with the staking flow that offers it.

Before the native code is written, what the two platforms do is read against their current documentation: which
changes invalidate a hardware key, what a key that needs authentication allows as a fallback, what the Secure Enclave
and the Android Keystore encrypt directly, and what an uninstall removes. The bullets above were decided from
knowledge of the two key stores and not from that reading, and one that rested on something untrue is decided again.

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
[README's adapters](../README.md#adapters), and React Native tooling, backup and recovery, and the six of the
keystore's own in [stage 4](#4-the-device-keystore-with-backup-a) and in the README's
[keystore per platform](../README.md#keystore-per-platform) and [backup and recovery](../README.md#backup-and-recovery).
