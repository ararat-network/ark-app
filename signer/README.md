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
| The Ledger adapter | Built |
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
| [ledger/](ledger/adapter.ts) | The Ledger adapter, exported as `@ararat-network/signer/ledger`: pairing a Ledger, and the key adapter for the account it was paired as. |
| [ledger/emulator/](ledger/emulator/ledger.emu.ts) | The adapter's tests against the Ark device app on the emulator, with the ledger-ark release and the SHA-256 of each binary they load. |
| [testdata/ledger/exchanges.json](testdata/ledger/exchanges.json) | Every command and answer of an emulator run, recorded. The adapter's unit tests replay them, and CI fails when a fresh run records anything else. |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | The order the rest is built in. |

As it will be laid out once the keystore is built:

```text
signer/
  src/        the core: consent, review, the sign-arbitrary call, the handoff protocol
  keystore/   the device keystore adapter: its TypeScript entry, and ios/ and android/ for the native module
  ledger/     the Ledger adapter over a session of Ledger's Device Management Kit, which the client injects
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
  a transaction in, so a feature builds a Ledger account's transactions in amino. An adapter that cannot list its
  accounts is left out, and the call is refused only when there is then nothing to list;
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
   as `present`: a decline, an answer that is not an approval, and a screen that fails each sign nothing. One review
   is shown at a time: a request waits its turn behind those asked before it, whoever asked them, and holds it until
   its signature is back. A request that fails gives up its turn.
2. **Review.** A document of the signup protocol is parsed and shown with its origin, which of the two documents it
   is, its chain ID, and its expiry ([the sign-arbitrary call](#the-sign-arbitrary-call)). A transaction is shown as
   its messages and what it carries beside them ([the review of a transaction](#the-review-of-a-transaction)). What
   is signed is fixed when the request is made, before it waits and before the review is shown, so nothing done
   while it waits or while the member reads changes what the approval signs. What depends on the clock or on the
   signer's network is asked again when its turn comes, and a document that expired while it waited, or one for a
   network since left, is refused and not shown.
3. **Sign.** Through the adapter that holds the account. An adapter that can say whether its key can sign now is
   asked before the review is shown, so a Ledger that is locked or out of reach is learned of before the member
   reads and approves, not after. What the key returns is checked before the signature goes back to the caller.

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

- **Each message, in the order they run.** Seven have a summary: the four a member signs in the first tranche, a
  delegation, a vote, a send, and a withdrawal of rewards, and three a member may sign after it, an undelegation, a
  redelegation, and a move of their grant's payee. A summary states every member the message carries: one a summary
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
`device_unavailable`, `device_locked`, `wrong_app`, `app_outdated`, and `rejected_on_device`. Everything that means a
bug or an attack is `invalid`: bytes that are no document, a document for another network, a transaction review
cannot show whole, an account the signer does not hold, a key that returned a bad signature. An adapter's own refusal
passes through the pipeline, and anything else an adapter throws becomes `invalid` with the cause kept. A refusal's
message is an English diagnostic for a log; what a member reads is a string the app chooses by kind.

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
its accounts, a signature over the sign bytes it is given, and, where the key may be out of reach, whether it can
sign now. The core builds the sign bytes and checks every signature an adapter returns, so no adapter decides what
is signed, and the features never know which one signed. An adapter that cannot list its accounts stops no other
from signing: the core passes it over, and its refusal is the reason given for an account no other adapter holds.
The Ledger adapter is built; the keystore is not, and the core's tests use a key in memory.

The package is a TypeScript core with one subpath export per adapter, so a client imports what it has: the phone the
keystore and the Ledger adapter, the web the handoff and the Ledger adapter, and never the keystore, so nothing
native reaches a browser build.

**Device keystore.** The default, [keystore per platform](#keystore-per-platform).

**Ledger.** `@ararat-network/signer/ledger`, over Zondax's `@zondax/ledger-cosmos-js` as published, at an exact
version, which the adapter alone touches. ledger-ark forks the device app and not this package, which its emulator
tests use unmodified.

- **The connection is the client's.** The adapter is handed a session of Ledger's Device Management Kit and asks one
  thing of it, to send a command and return the answer. The kit is what connects, on the phone and in a browser
  alike, and it replaces Ledger's `hw-transport`, which the Zondax package reports Ledger has deprecated and warns
  against. Which of the kit's transports each client uses is the client's to choose.
- **Pairing, once.** `pairLedger` has the device show its address, at `m/44'/330'/0'/0/0` with the `ark` prefix, the
  only path the device app accepts. The member confirms it on the device, and the account comes back for the client
  to remember. The address a member checks is the one on the device.
- **The account is reported without the device.** `ledgerAdapter` takes the paired account, so a Ledger left in a
  drawer does not stop the signer listing its accounts. The device is reached only to sign.
- **Before each signature** the adapter asks the device which app is open, since the Cosmos app this one was forked
  from answers the same commands; that it is unlocked and at 2.3.0 or later, the first that signs an unordered
  transaction's document; and that its account is the paired one. Another Ledger is refused and sent no document.
- **Before each review** the adapter asks the same of the device, with no document sent and nothing shown on it, so
  a device that cannot sign is refused by its kind before the member reads the app's review. The signature asks
  again for itself, and nothing relies on the first answer.
- **Amino JSON alone.** The device displays the sign document, so `signDirect` is refused and the SDK's builder takes
  the amino path for a Ledger account. The adapter sends the sign bytes as the core hands them over and rewrites
  nothing, and refuses a document past the device's 16384 bytes before sending it.
- **The signature** comes back in DER, which the adapter converts to `r || s` and normalises to low S, through a
  strict parser.
- **Refusals by kind.** Rejected on the device, locked, another app or none, an app too old, and a device that
  cannot be reached each have their own; any other answer is a fault and is `invalid`.

The device accepts an unordered document only as the chain writes it, signed at sequence zero, and ends its review
on two pages, `Unordered` and `Timeout Timestamp`
([transaction spec](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#unordered-transactions)).
An ADR-036 document goes to the device as its amino sign bytes, which the device shows whole, in normal and expert
mode alike, with the data as base64 and not decoded: what the document says is read in the app's review
([signup protocol §5](docs/SIGNUP_PROTOCOL.md#5-signature),
[the device's display](https://github.com/ararat-network/ledger-ark/blob/main/docs/TXSPEC.md#signup-documents)). The
device signs a document naming any address, so it is the core, which builds the sign bytes for the account whose key
signs, that keeps a Ledger from signing for another.

The devices are those a member can sideload until Ledger lists the app
([install guide](https://github.com/ararat-network/ledger-ark/blob/main/docs/SIDELOAD.md)); a device without
Bluetooth, the Nano S+, signs from the web client or from an Android phone over USB. Multisignature signing, the
relay, and external-wallet adapters come later.

## Keystore per platform

Neither the Secure Enclave nor the Android Keystore signs secp256k1, so the key lives in software and the hardware
wraps it.

**Mobile.**

- **Generation.** 256 bits from the OS random source, in native code, kept as the seed. The key derives at
  `m/44'/330'/0'/0/0`, the path the Ledger and `arkd` use, so it can move ([backup and recovery](#backup-and-recovery)).
- **At rest.** The seed encrypted under a hardware key directly, in one layer: an AES key in the Android Keystore, in
  StrongBox where the device has it, and the Secure Enclave's own hybrid scheme on iOS. The encrypted seed is a
  Keychain item on iOS and a file in the app's no-backup directory on Android: Android copies an app's other files
  to a new phone and the hardware key does not go with them, so a seed kept among them would arrive with nothing
  that opens it.
- **Authentication.** The hardware key needs user authentication for every use, and the member authenticates for
  each signature: there is no window in which the key stays usable. On iOS that holds only while no authenticated
  context is kept between signatures, so each decryption makes its own.
- **Biometrics where the phone has them, and the passcode where it has not.** Neither platform gives both a passcode
  fallback and a key that a newly enrolled fingerprint or face invalidates
  ([what the platforms document](#what-the-platforms-document)), so the key is made one way or the other when it is
  created. On a phone with strong biometrics enrolled it takes biometrics alone and is invalidated when one is
  enrolled: a thief who has watched the passcode typed can neither sign nor enrol a finger of their own, and the
  member restores from backup. On a phone without, it takes the passcode, so that a member is not left with no key
  for want of a sensor or of fingerprints that register; that key outlasts an enrolment, and whoever has the
  passcode can sign. The app tells the member which their key is.
- **Android 9 and later.** The app's floor is Android 9, where the platform's current biometric prompt and StrongBox
  begin, so the keystore has one path to write and test. A key that takes the passcode needs Android 11, so on
  Android 9 and 10 a phone with no strong biometrics has no key, and a Ledger is what is left to its member.
- **No passcode, no key.** Both platforms refuse to make such a key on a phone with no passcode, and both destroy it
  when the passcode is removed. The member then restores from backup.
- **An uninstall.** On Android it removes the file and the key. On iOS Apple documents nothing of what an uninstall
  does to the Keychain: an item has outlasted one in practice, and Apple's engineers call that a detail that may
  change. The keystore relies on neither outcome. At first launch, an item it finds that the hardware key still
  opens is the member's key, and anything else is no key.
- **In use.** Unwrapped only for a signing call, in the native module, which hashes, signs with libsecp256k1 (RFC 6979,
  low-S), zeroises the seed and the key, and returns the signature. The raw key is handled in C alone, beside
  libsecp256k1: Swift and Kotlin pass bytes through, since neither can be relied on to zeroise memory. JavaScript
  sees the address, the public key, and signatures.
- **Not exported.** No call returns the seed or the key except the backup flow below, which runs in the same module.
  The hardware key is bound to the device and never leaves it; a new device gets a new one.

**What this does not protect, and the alternative.** The key is in the app's memory while it signs, so a phone whose
operating system is compromised can read it then: the hardware protects the key at rest and gates its use, and no
more. A key generated inside the secure hardware would never enter the app's memory. That hardware signs P-256 alone,
which membership does not accept ([signup protocol §5](docs/SIGNUP_PROTOCOL.md#5-signature)), and such a key cannot
be exported, so it has no backup: with registration permanent, it would need a way on the chain to move a member to
a new key, and there is none. The design keeps the software key, as wallets on this curve do. A member who wants the
key off the phone uses a Ledger.

This is designed and not built.

### What the platforms document

What the design says of iOS and Android, read against Apple's and Google's documentation in November 2026. A cell
that says nothing is documented means that: the behaviour is found by trying it, and is not relied on until it is.

| | iOS | Android |
| --- | --- | --- |
| What the hardware encrypts | The Secure Enclave holds NIST P-256 keys alone and never gives one up. A key of its own decrypts through ECIES, with no limit on the length of what is encrypted ([Secure Enclave keys](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave), [encryption](https://developer.apple.com/documentation/security/using-keys-for-encryption)). | The Keystore holds an AES key for GCM whose material an app cannot read. StrongBox takes AES at 128 and 256 bits, and a request it cannot meet throws, to be made again without it ([Keystore](https://developer.android.com/privacy-and-security/keystore)). |
| Authentication for every use | With no context given, "a new context will be created, used once, and discarded"; one that is given and already authenticated signs with no prompt ([authentication context](https://developer.apple.com/documentation/security/ksecuseauthenticationcontext)). | A timeout of 0 means "user authentication must take place for every use of the key" ([KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder)). |
| A passcode fallback | `userPresence` is biometry or the passcode ([flags](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence)). | A key used once per authentication takes the device credential beside biometrics from Android 11 alone; before it, such a key is biometric only ([PromptInfo.Builder](https://developer.android.com/reference/androidx/biometric/BiometricPrompt.PromptInfo.Builder)). |
| A newly enrolled fingerprint or face | `biometryCurrentSet`: "The item is invalidated if fingers are added or removed for Touch ID, or if the user re-enrolls for Face ID" ([flag](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset)). With the passcode joined to it by `or`, nothing is documented; by what `or` means, the passcode would still open the key. | A key is invalidated on enrolment unless it also takes the device credential: naming the credential exempts it ([KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder)). |
| No passcode | "No items can be stored in this class on devices without a passcode. Disabling the device passcode causes all items in this class to be deleted" ([accessibility](https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly)). | "The key can only be generated if secure lock screen is set up", and it is invalidated for good when the lock screen is disabled ([KeyGenParameterSpec.Builder](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder)). |
| An uninstall | Nothing is documented. | The app's internal storage is deleted ([security practices](https://developer.android.com/privacy-and-security/security-best-practices)), and its keys are cleared ([Keystore, in the platform's own docs](https://source.android.com/docs/security/features/keystore)). |
| A backup, or a move to a new phone | Items of this class are not backed up and do not sync ([Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)). | App files are copied unless they are in the no-backup directory ([Auto Backup](https://developer.android.com/identity/data/autobackup)); keys are not. |
| The simulator and the emulator | Nothing is documented of a Secure Enclave on the Simulator. | Nothing is documented of a hardware-backed Keystore on the emulator; its fingerprint sensor is simulated ([extended controls](https://developer.android.com/studio/run/emulator-extended-controls)). |

**Web.** No software key in the first version: a browser cannot zeroise memory or attest itself, and a web origin is
the phishing surface. The web client builds and reviews the transaction, then signs by handoff or a Ledger.

- **Handoff.** The sign document goes to the phone as a QR code, the phone's signer reviews and signs it, and the
  signature comes back the same way. The phone shows the document before it signs, so the review that matters happens
  on the device that holds the key, and no server sees the request. The relay that carries multisig partial signatures
  ([`ark-backend`](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-backend))
  can carry handoffs once it exists.
- **Ledger.** Through the same adapter as the phone's, over the connection Ledger's kit makes from a browser.

## Backup and recovery

The stakes: registration is permanent, one grant per person, and moving a grant's payee needs the member's own
signature. A member who loses the key with no backup loses the remaining payments and cannot register again. The
member has never seen a key, so the backup cannot be theirs to invent.

| Option                   | How it works                                                                                                                                                                                                                           | Protects against                                      | Costs                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Cloud keychain blob   | The seed encrypted under a key derived by Argon2id, with a random salt, from a recovery secret the member chooses, stored in the platform account's keychain: iCloud Keychain, or Google's Block Store and app backup. It appears on a new device of the same account, and the secret unlocks it. | A lost phone or a new one                              | The secret can be forgotten; the platform is a wall, with no move between Apple and Google; the secret's strength is the blob's, so the app requires a phrase, not a PIN |
| B. Mnemonic              | The seed shown as 24 BIP-39 words, once, with a check that the member wrote them down. It restores on any device and in any wallet on coin type 330.                                                                                   | A lost phone, a lost platform account, leaving the app | The member keeps a secret they have never had; shown at signup, it is the failure the first user is defined by                                                 |
| C. Both                  | A at signup; B offered once the first payment arrives and before the first stake.                                                                                                                                                      | Both                                                  | Two flows to build and explain                                                                                                                                 |

Decided: C. A at signup, since a lost phone during the hold must cost the member nothing but a restore, and B once
there is something to protect and the member has seen a payment arrive, as the way out of the platform account and of
the app. Neither Apple, Google, nor Ark can read the blob, and the hardware key is never backed up. The keystore keeps
the whole 256-bit seed, not the derived key alone, so the 24 words can be shown when B is offered.

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
on both platforms; the Ledger adapter against the Ark device app on the emulator; and the handoff round trip. It
changes slowly and on its owners' review.

The Ledger adapter is tested twice. On the emulator, a CI job loads the device app's binaries from a ledger-ark
release, each checked against a SHA-256 pinned here, and on a Nano S+ and a Flex pairs, signs five fixtures' amino
documents, signs an unordered transaction and a signup challenge through the whole pipeline, and has a document
rejected on the device; every signature is verified under the emulator's own key. That run records every command and
answer, and the unit tests replay the recording, with the answers the emulator does not give, a locked device,
another app, an older one, a dropped connection, written from the recorded ones. No test here runs on hardware:
ledger-ark's [hardware checklist](https://github.com/ararat-network/ledger-ark/blob/main/docs/DEVICE_TESTING.md) is
where a device is checked by hand.

It leaves the repository when something outside it needs it: a browser extension, a third-party wallet, the wallet kit's
dapp protocol, or an audit that wants a frozen tag. Until then it is a package, and the app and the signer move in one
pull request.

## Dependencies

Today the runtime dependencies are five, each at an exact version. `@ararat-network/sdk` is for bytes, the chain's
sorted JSON, address derivation, secp256k1, and both encodings of a transaction, so none of them has a second
implementation here. `@bufbuild/protobuf`, at the version the SDK itself depends on, is for reading a message through
its type, which is how review finds a contract payload wherever a message holds one. The Ledger adapter has the other
three: `@zondax/ledger-cosmos-js`, the device app's commands; `@zondax/ledger-js`, which that package is built on and
which carries the transport over a Device Management Kit session; and `buffer`, which the Zondax packages take the
sign bytes as. None of Ledger's own packages is a dependency: the client that connects a device brings the kit.

`@zondax/zemu`, the emulator harness, is a development dependency, and brings Docker's client and an HTTP stack with
it. Three packages in that tree are overridden to the releases that fix advisories against them
([pnpm-workspace.yaml](pnpm-workspace.yaml)), and none of it reaches a client.

Once the keystore is built, libsecp256k1 at a pinned release joins them, built from source in the native module. A
bump to any of them is reviewed by the signer's owners.

## Development

From this directory, with pnpm through corepack on Node 22 or later:

```sh
pnpm install
pnpm lint
pnpm check
pnpm test
pnpm fixtures:check   # the decoding fixtures are those of ark at the tag in ARK_VERSION
pnpm test:emulator    # the Ledger adapter on the emulator; needs Docker
```

`ARK_VERSION` is the `ark` tag the pinned SDK's types are generated from, and moves with the SDK's pin: change both,
then `pnpm fixtures:sync`.

The emulator tests load the device app's binaries from the ledger-ark release named in
[ledger/emulator/RELEASE](ledger/emulator/RELEASE), and refuse one whose SHA-256 is not the one in
[ledger/emulator/binaries.sha256](ledger/emulator/binaries.sha256). To move to a new release, change both. Run with
`RECORD=1` to write the exchanges the unit tests replay; `pnpm test:emulator:record` does that and fails when the
recording differs from what is committed, which is what CI runs.

The package stands alone: its manifest, lockfile, and tooling configuration are all here, and nothing at the
repository root is needed to build or test it. The repository's [LICENSE](../LICENSE) covers it.

The tests run on `node:test` through `tsx`. The package exports its TypeScript source, so there is no build step.
