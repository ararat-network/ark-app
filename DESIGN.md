# Ark app design

For the app's contributors, the signer package's reviewers, and the membership service's builders, who meet the app at
its API. This document is the design the first commit follows: nothing in the repository is built, and every section
describes what will be, not what is. It is temporary: as each workspace is built, its part moves into that workspace's
README, and the file is deleted once nothing is left in it. The
[tooling direction](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md) owns what the
app is for and where it sits among Ark's repositories; this document owns how the app is built, and links to the
direction rather than restating it.

## Contents

- [1. What the app is](#1-what-the-app-is)
- [2. Repository shape](#2-repository-shape)
- [3. The signer package](#3-the-signer-package)
- [4. Security](#4-security)
- [5. Decisions](#5-decisions)
- [6. Build order](#6-build-order)

## 1. What the app is

One app, mobile first. The phone is where the key lives and where everything a member does is signed. A web client
follows, its own app for a screen larger than a phone's and for the pages anyone reads, and signs through the member's
phone or a Ledger device, never through a key in the browser ([§3.5](#35-keystore-per-platform)). The direction's
[`ark-app` section](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-app) fixes
its purpose: a first-party app that holds the wallet and everything a member does, and grows past both.

**The first user.** The
[disbursement plan](https://github.com/ararat-network/ark/blob/main/docs/governance/DISBURSEMENT_PLAN.md#admission)
sets them: a member who holds a grant the Disbursement module pays out over a year, who has never seen a key, and who
must stake and vote each payment. Everything in the first tranche is sized to that person. They never see a key, a fee
they have to fund, or a transaction they cannot read.

### First-tranche scope

- **Signup.** The member process in front of the key: sign in with one Apple or Google account, attest the device (App
  Attest on iOS, Play Integrity on Android), verify a phone number, then name the member who vouches or pass the
  identity check once it exists. The app then generates the key, signs the membership service's challenge through the
  signer's sign-arbitrary call, and submits the address with the proof of possession
  ([signup protocol](https://github.com/ararat-network/ark-sdk/blob/main/docs/SIGNUP_PROTOCOL.md)). An existing member
  vouches from the same app, signing the vouch document for the admission they are answering. The cheap signals price a
  fake in effort and name nobody; the service verifies them, the app only collects them.
- **The grant view.** The grant as the member sees it, from the Disbursement module's `Member`, `Grant`, and
  `GrantJournal` queries: amount, paid and remaining, the schedule, the next payment and when, the member's status, and
  the end of the two-week hold before the first tenth.
- **The distribution screen.** Readable before signup and without an account: the open tranche and the pools from
  `Balance`, the member count against the step's headcount, and the figures the step review published in the proposal
  that opened the step, each with the height it was read at.
- **Staking.** Each payment that arrives is put in front of the member to delegate. The validator picker shows each
  validator's share of bonded stake as its distance from a third, the share the member's delegation would give it, and
  defaults away from the founding set, read from the chain as the operators whose beneficiary records
  [carry a seat](https://github.com/ararat-network/ark/blob/main/x/disbursement/README.md#ownership-and-founding-seats);
  the member chooses.
- **Voting.** Every open proposal is put in front of the member, with the vote their delegation would otherwise inherit
  from its validator.
- **Send.** Paid coins out to an address, with the tax and the fee shown apart from the amount.
- **Gas from the tenth.** The first tenth pays two weeks after registration; the app pays every fee from it, in NOAH,
  and the member funds nothing.
- **Strings outside code.** Every string a member reads is a resource from the first release, so a language is a
  translation, not a build
  ([languages](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#languages)).

### Later scope

The direction's later scope: simulation and comprehensible review for every message type, fee and tax presentation,
market operations with explicit pricing and slippage, a contributor's interactions with the Disbursement module, account
recovery beyond [§3.6](#36-backup-and-recovery), external wallets behind the signer interface, and multisignature
signing for committees and shared accounts. None of it is in the first tranche, and the
[build order](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#build-order) says
when each comes.

### Explorer pages

The web client's explorer pages read the indexer and need no account: each transaction decoded, the distribution, and
the network, as the direction lists them. They come with the indexer. The web client is their front, the indexer their
data, and neither is consensus state.

### Reading the chain

- The network comes from [`ark-registry`](https://github.com/ararat-network/ark-registry) through the SDK: chain id,
  prefix, denominations, endpoints. The app checks a node's chain id against the registry's and refuses a mismatch.
- Every figure the app shows carries the height it was read at, and the app tells node unavailability, indexer lag, a
  refused transaction, and an unconfirmed broadcast apart.
- The member may choose the node. The registry's endpoints are the defaults, and no endpoint is one the member cannot
  replace.
- Nothing the app computes is authoritative: tax and gas come from the Treasury queries, the grant's figures from
  Disbursement, and the outcome from the chain.

### What it must not become

- **A key store outside the signer interface.** Every feature asks the signer for a signature and never sees a key, and
  no feature keeps key material of its own.
- **A second source of chain state.** The app caches reads with their heights and never shows a figure the chain did
  not give it.
- **The only way to inspect chain activity.** The explorer pages read public interfaces anyone can read, and the SDK
  and the decoding fixtures give any third party the same reading of every transaction.

## 2. Repository shape

The [README's layout](README.md#layout) names the workspaces, what each is responsible for, and what each must not
become.

The two clients share no components: the phone renders React Native views and the web renders the DOM, and what they
must share, the decoded transaction as a model to render, is the signer's review step ([§3.2](#32-the-core)). Expo
Router keeps its routes in a directory named `app`, so the phone app keeps them at `app/src/app/`, the `src` form the
router accepts, and keeps the name the direction uses.

`@ararat-network/sdk` is a dependency, pinned by git tag until it is published. It owns encoding, queries, transaction
building, fees, broadcast, the ADR-036 producer, decoding, and formatting; the app adds no second implementation of any
of them.

The toolchain is the SDK's: pnpm with dependency install scripts blocked, exact versions, Node 22, and tests beside
the code they test. CI type-checks, lints, and tests every workspace, checks that the committed membership client
regenerates from the committed schema snapshot, and checks the SDK pin; it holds no credential, so whether the snapshot
is current is the refreshing builder's check, not CI's. The phone app is React Native through Expo: the Expo Modules
API gives the keystore its typed bridge, and continuous native generation produces the Xcode and Gradle projects at
build time from the app's config, so the one native code in the tree is the keystore's Swift and Kotlin, and the key
never enters JavaScript. The native surface beyond the keystore, the biometric prompt, the Ledger Bluetooth transport,
device attestation, and the Apple and Google sign-in, comes from pinned modules and holds no key.

**The alternative.** Native apps in Swift and Kotlin sharing a signer core in Rust, through UniFFI on the phones and
WebAssembly on the web, or in Kotlin Multiplatform, would keep the key and the signing off a JavaScript bridge, with a
smaller supply chain and no React Native release cadence to follow. It would cost two native user interfaces beside the
web's, so the screens and the strings written three times; bindings per platform for the core; three review surfaces
for the one-meaning rule; and a smaller pool of contributors. The design takes React Native and draws the native
boundary around the key; which React Native tooling is the decision left ([§5](#5-decisions)).

## 3. The signer package

### 3.1 Interface

The package implements the SDK's `Signer`: `accounts`, `signDirect`, `signAmino`, and `signArbitrary`. The SDK builds
every document, the signer signs it, and nothing else sees the key. Feature code reaches the signer through the
capabilities of [§3.7](#37-permissions), never through an adapter.

### 3.2 The core

Shared by every client and every adapter, as a pipeline:

1. **Consent.** A request names its caller, the account, and the document. Nothing is signed until the member approves
   on the review screen, and one approval signs one document.
2. **Review.** Built from the SDK decoder, which ark's decoding fixtures test: each message rendered by type; an
   unknown type URL shown as unknown, with the URL; a contract payload shown as unverified; an ADR-036 document parsed
   and shown with its origin, domain, chain id, and expiry; and the intended amount, the fee ceiling, the tax, and what
   will be charged shown apart, as the direction's
   [fees rule](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md) asks.
3. **Fees.** The SDK's fee quote with headroom the app passes explicitly; the SDK's named `arkd` constants are the
   app's defaults, and the review states them. In the first tranche the member holds NOAH alone, and NOAH is charged
   whole, so the app declares the NOAH requirement with its margin and tells the member the margin is a tip; a stable
   leg, once conversion opens, is padded for free
   ([client fees](https://github.com/ararat-network/ark/blob/main/docs/clients/CLIENT_FEES.md)).
4. **Sign.** Through the adapter the account belongs to.
5. **Broadcast.** Sync, then wait for inclusion. The outcome keeps its class: an ante refusal, an execution failure, a
   module error, a timeout with the hash still pending, or a node that could not be reached. None is summarised away.

Every step is TypeScript, shared by the phone and the web. Review produces a model, the decoded fields with their
labels and amounts, which each client renders with its own components, so the two clients share one reading and no
components. The handoff protocol of [§3.5](#35-keystore-per-platform) is the core's too, since both ends of it must
share one implementation.

### 3.3 The sign-arbitrary call

`signArbitrary` is the signup protocol's producer and nothing else in the first tranche. The signer parses the data as
a document of the protocol's
[§4](https://github.com/ararat-network/ark-sdk/blob/main/docs/SIGNUP_PROTOCOL.md#4-documents), refuses a domain it
does not know, and shows the member the origin, the chain id, and the expiry before they sign. The signup flow requests
a challenge from the service origin configured for the network and refuses one from anywhere else. A vouch document
shows the voucher which admission they are answering, and the signer signs it only from the app's vouch flow, never
from a link, a QR code, or a page. Bytes that do not parse are refused: a signer that signs arbitrary bytes is a
phishing tool.

### 3.4 Adapters

Two adapters in the first tranche. Both implement the same interface, and the features never know which one signed.

The package is a TypeScript core with one subpath export per adapter, so a client imports what it has: the phone the
keystore and the Ledger adapter over Bluetooth, the web the handoff and the Ledger adapter over WebUSB, and never the
keystore, so nothing native reaches a browser build.

```text
signer/
  src/        the core: consent, review, fees, broadcast, the sign-arbitrary call, the handoff protocol
  keystore/   the device keystore adapter: its TypeScript entry, and ios/ and android/ for the native module
  ledger/     the Ledger adapter over an injected transport: Bluetooth on the phone, WebUSB or WebHID on the web
```

**Device keystore.** The default, [§3.5](#35-keystore-per-platform).

**Ledger.** Over ledger-ark's JS package, its fork of `@zondax/ledger-cosmos-js`, on an `hw-transport`: Bluetooth on
the phone, WebUSB or WebHID on the web. The adapter derives at `m/44'/330'/0'/0/0` with the `ark` prefix, the only
path the device app accepts, confirms the address on the device at first use, and signs in amino JSON alone: the
device displays the sign document, so `signDirect` is refused and the SDK's builder takes the amino path for a Ledger
account. An ADR-036 document goes to the device as its amino sign bytes, which the device shows in expert mode with the
data as base64
([signup protocol §5](https://github.com/ararat-network/ark-sdk/blob/main/docs/SIGNUP_PROTOCOL.md#5-signature)). The
devices are those a member can sideload until Ledger lists the app
([install guide](https://github.com/ararat-network/ledger-ark/blob/main/docs/SIDELOAD.md)); a device without
Bluetooth, the Nano S+, signs from the web client or from an Android phone over USB. Multisignature signing, the relay,
and external-wallet adapters come later ([§5](#5-decisions)).

### 3.5 Keystore per platform

Neither the Secure Enclave nor the Android Keystore signs secp256k1, so the key lives in software and the hardware
wraps it.

**Mobile.**

- **Generation.** 256 bits from the OS random source, in native code, kept as the seed. The key derives at
  `m/44'/330'/0'/0/0`, the path the Ledger and `arkd` use, so it can move ([§3.6](#36-backup-and-recovery)).
- **At rest.** The seed encrypted with AES-GCM under a data key; the data key wrapped by a hardware key, a Secure
  Enclave key on iOS and an Android Keystore key in StrongBox where the device has it, created with user authentication
  required: the OS biometric prompt, with the device passcode as fallback.
- **In use.** Unwrapped only for a signing call, in the native module, which hashes, signs with libsecp256k1 (RFC 6979,
  low-S), zeroises the seed and the key, and returns the signature. JavaScript sees the address, the public key, and
  signatures.
- **Not exported.** No call returns the seed or the key except the backup flow of §3.6, which runs in the same module.
  The data key is bound to the device and never leaves it; a new device gets a new one.

**Web.** No software key in the first version: a browser cannot zeroise memory or attest itself, and a web origin is
the phishing surface. The web client builds and reviews the transaction, then signs by handoff or a Ledger.

- **Handoff.** The sign document goes to the phone as a QR code, the phone's signer reviews and signs it, and the
  signature comes back the same way. The phone shows the document before it signs, so the review that matters happens
  on the device that holds the key, and no server sees the request. The relay that carries multisig partial signatures
  ([§5](#5-decisions)) can carry handoffs once it exists.
- **Ledger.** Over WebUSB or WebHID, through the same adapter as the phone's.

### 3.6 Backup and recovery

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
The scheme is a decision ([§5](#5-decisions)).

### 3.7 Permissions

Four capabilities, each granted separately and none implied by another:

| Capability     | Grants                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| connect        | An account is made available to the caller                              |
| read addresses | The caller reads the account's address and public key                   |
| sign           | The caller may request a signature, each one approved on review         |
| change network | The caller may switch the network the signer reads from and signs for   |

In the first tranche the callers are the app's own features, each holding the capabilities it needs and nothing more,
and the signer refuses a feature that reaches past its grant. There is no blanket session. When the wallet kit arrives,
the same capabilities are granted per dapp origin: the model does not change, only who asks.

### 3.8 Ownership and tests

The package, its native module included, has its own CODEOWNERS and its own tests: the signup protocol's vectors,
byte-equal sign bytes and signatures; the decoding fixtures, for review; the keystore's wrap, unwrap, and zeroisation
on both platforms; the Ledger adapter against ledger-ark's emulator suite; and the handoff round trip. It changes
slowly and on its owners' review.

It leaves the repository when something outside it needs it: a browser extension, a third-party wallet, the wallet kit's
dapp protocol, or an audit that wants a frozen tag. Until then it is a package, and the app and the signer move in one
pull request.

## 4. Security

### What the app holds

- The seed, wrapped as in [§3.5](#35-keystore-per-platform), and under option A the backup blob in the platform
  keychain.
- The member's address and public key.
- The membership session, a token the service issues and binds as the service decides, and the Apple or Google
  sign-in token during signup.
- Cached chain reads with their heights.
- The member's language, node, and preferences.

### What it never holds

- A plaintext seed, key, or mnemonic at rest. The mnemonic is shown once and never stored.
- The phone number after its verification, or anything else that names a person. What the service keeps is its own
  design, and nothing in it names a person either
  ([identity data](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#identity-data)).
- The vouch graph, other members' standings, or admission records.
- Chain state as truth.
- A third-party analytics or crash-reporting SDK that sees the member. What is reported is opt-in and names no address.

### Session versus key

The signup protocol's
[§10](https://github.com/ararat-network/ark-sdk/blob/main/docs/SIGNUP_PROTOCOL.md#10-security-notes) draws the line:
the proof binds an address to an admission and a key, not to a session, so a stolen session can submit the thief's
address against the victim's admission. The service's controls bound that, device attestation and the platform account
on the session, and the app adds three. The challenge is requested, signed, and submitted in one flow on the attested
device, with no path that signs a challenge for a session elsewhere. The grant view shows the registered address and
the end of the hold, so the member sees a wrong address while the committee can still suspend. And the session never
reaches the key, which sits behind the signer and the biometric prompt.

### Phishing of ADR-036 documents

The documents are made to be read: origin, domain, chain id, expiry. [§3.3](#33-the-sign-arbitrary-call) parses and
shows them, refuses unknown domains, requests challenges only from the configured origin, and signs vouches only from
the app's own flow. The web client never signs, so a phishing page cannot obtain an ADR-036 signature from a browser,
and a handoff is reviewed on the phone. A member asked anywhere else to sign an `ark-signup/v1` or `ark-vouch/v1`
document has no way to do it from the app.

### Transaction review

Every transaction is reviewed from decoded messages ([§3.2](#32-the-core)): the fee as the ceiling it is, beside what
will be charged; the NOAH margin as the tip it is; the tax apart from the amount. The Ledger shows its own display,
which the member reads on the device; the app's review and the device's are the same document.

### Updates and release signing

- Store builds are made in CI from a release tag on a reviewed `main` and signed as the stores require: Apple signs
  iOS distribution; Android is signed with an upload key held in CI's secrets, with Play App Signing holding the app
  signing key. Release tags are immutable and created only by administrators, under the rulesets `ark` uses.
- No over-the-air JavaScript updates in the first release. An over-the-air update is code the stores never reviewed,
  signed by a key the project holds, and the signer's code changes only through a reviewed release. The capability is
  left out of the build, not merely unused.
- The web client is built from the same tag and served from a first-party origin with a content security policy,
  subresource integrity on what it loads, and no third-party script. It holds no key, so a compromised deployment can
  show the member a wrong document, which the phone's review catches, and cannot sign.
- The app declares the SDK and chain versions it was built against and degrades safely on an unknown message type,
  which review shows as unknown.

### Dependency pinning

Exact versions, a frozen lockfile in CI, dependency install scripts blocked by pnpm, Dependabot, and every CI action
pinned by commit SHA. The Expo SDK is pinned like any other dependency, since the generated native projects are only as
fixed as it is. The signer's runtime dependencies are listed in its README and kept to: the SDK, with noble and scure
through it; `@bufbuild/protobuf`; ledger-ark's JS package and the Ledger transport packages; and libsecp256k1 at a
pinned release, built from source in the native module. A bump to any of them is reviewed by the signer's owners.

### Inputs

Everything the app receives is data: deep links, QR codes, the membership API's responses, node responses, Ledger
responses, and the clipboard. Each is parsed by a typed decoder and never executed or rendered as markup. The app
checks a node's chain id against the registry, and the SDK checks every response's shape.

### The chain's side

The chain-side controls, the ante, the lanes, the committee and registrar bounds, and the release pipeline, are in
ark's [threat model](https://github.com/ararat-network/ark/blob/main/docs/security/THREAT_MODEL.md), which lists
clients and wallets as outside its scope. This section is the app's side of that boundary. A change that adds an input,
a stored secret, a transport, or a release step updates this section in the same change.

## 5. Decisions

| Decision                          | Options                                                                                                                      | Recommendation                                                                                                      | Blocks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| React Native tooling              | React Native is settled ([§2](#2-repository-shape)); Expo's module API with generated native projects, or bare React Native with committed projects and a Turbo Module | Expo's module API and generated projects                                                                            | The scaffold                                                              |
| Backup and recovery               | A cloud keychain blob under a recovery secret; a mnemonic; both ([§3.6](#36-backup-and-recovery))                            | Both: the blob at signup, the mnemonic before the first stake                                                       | The keystore and signup                                                   |
| The languages of the first release | Every language of the starting assets; the first cohort's languages, the rest as translations arrive                          | The first cohort's, with English complete and the pipeline proving a language is a resource                         | The string freeze before release; nothing in code                         |
| The relay's home (later)          | A service in this repository; its own repository; part of the membership service                                              | Its own small service, holding unsigned bytes and signatures and never a key; decided when multisignature is built  | Multisignature signing and handoff over a network; nothing in the first tranche |

The membership service's KMS provider is the service's decision, not the app's, and is not recorded here.

## 6. Build order

Aligned with the direction's first two steps. Each step names what done looks like, and none waits on a later one.

1. **Signer core and keystore.** The signer package implementing the SDK's `Signer`; the device keystore on iOS and
   Android; consent and review on decoded messages; fee selection and broadcast; the sign-arbitrary call; the Ledger
   adapter. Done: the signup vectors and the decoding fixtures pass, the emulator suite signs through the adapter, and a
   localnet transaction signs from a device key and from a Ledger.
2. **Signup.** The schema snapshot and the membership client generated from it, committed; sign-in with Apple and
   Google; device attestation; the phone number; the vouch flow for an existing member; the challenge signed and
   submitted. Done: the tracks meet, a member registers through the membership service from a device key and from a
   Ledger, and the chain lists the address.
3. **Grant view and distribution screen.** Done: a registered member sees their grant, status, schedule, and the hold's
   end, and anyone sees the distribution without an account, each figure at a height.
4. **Staking and voting.** The validator picker; each payment delegated; every open proposal voted; gas from the tenth.
   Done: on a testnet, the first tenth pays two weeks after registration and is staked and voted from the app with the
   fee paid from it.
5. **Send.** Done: paid coins leave with the tax and the fee shown apart.
6. **Rehearsal.** The whole flow on the testnet with the daily comparison running: register, wait out the hold, receive
   the tenth, stake and vote it, from a device key and from a Ledger.

Backup and the string resources are not steps: option A ships with the keystore in step 1, option B with step 3, and
every string is a resource from step 1. The web client is not a step of the first tranche: its directory exists from
the first commit, and it ships after the phone, on the handoff and the Ledger adapter the signer already has.
