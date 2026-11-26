# app

The phone app, for iOS and Android: the first home of everything a member does. It holds no key: every feature asks
the [signer](../signer/README.md) for a signature.

The [repository's README](../README.md) says where the package sits among the others and the order they are built
in. From [first-tranche scope](#first-tranche-scope) on, this README is the design the package follows, and each part
is rewritten as what is once it is built.

## Status

| Part | State |
| --- | --- |
| The scaffold: an Expo app that builds for iOS and Android and links the signer's keystore | Built |
| Everything a member does | Designed |

The scaffold is the app with nothing in it yet. It has one screen, which asks the signer's
[keystore](../signer/README.md#protection-at-rest) to check its core, shows the key the phone holds, and has a button
for each thing the keystore does: make a key, sign a test message, remove the key. It exists to show that the pieces
every later step needs are in place: the native projects generated from [app.json](app.json), the signer taken by
path as a sibling package, its Swift, Kotlin, and C built into the app, and CI that builds both platforms and runs
the keystore there. It is also how the keystore is
[tried by hand on a phone](../signer/docs/KEYSTORE_PHONE_CHECKLIST.md). A key made from it is for trying the keystore
and is no member's: nothing registers it.

## Layout

| Path | What it holds |
| --- | --- |
| [app.json](app.json) | The app's config, which the native projects are generated from. `ios/` and `android/` are never committed. |
| [src/app/](src/app/index.tsx) | The routes, in the `src` form Expo Router accepts. Today, the scaffold's one screen. |
| [src/strings.ts](src/strings.ts) | The strings the app shows, as resources and never as text in a component, until the `i18n` package holds them. |
| [src/keystore-status.ts](src/keystore-status.ts) | The strings for what the keystore says, its check, the key it holds, its prompt, and why a call was refused, apart from the screen so that they are tested with no device. |
| [metro.config.js](metro.config.js) | The bundler told to watch the signer's directory, since the app takes it by path and not from a registry. |
| [scripts/check-native.sh](scripts/check-native.sh) | Starts an installed build and waits for the lines in the device's log that say the keystore's core answered rightly and its device check passed. On the emulator it sets a PIN and types it into the system's prompt. |

## First-tranche scope

- **Signup.** The member process in front of the key: sign in with one Apple or Google account, attest the device (App
  Attest on iOS, Play Integrity on Android), verify a phone number, then name the member who vouches or pass the
  identity check once it exists. The app then generates the key, signs the membership service's challenge through the
  signer's sign-arbitrary call, and submits the address with the proof of possession
  ([signup protocol](../signer/docs/SIGNUP_PROTOCOL.md)). An existing member
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

## Later scope

The direction's later scope: simulation and comprehensible review for every message type, fee and tax presentation,
market operations with explicit pricing and slippage, a contributor's interactions with the Disbursement module, account
recovery beyond [the signer's backup](../signer/README.md#backup-and-recovery), external wallets behind the signer
interface, and multisignature signing for committees and shared accounts. None of it is in the first tranche, and the
[build order](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#build-order) says when
each comes.

## Reading the chain

- The network comes from [`ark-registry`](https://github.com/ararat-network/ark-registry) through the SDK: chain id,
  prefix, denominations, endpoints. The app checks a node's chain id against the registry's and refuses a mismatch.
- Every figure the app shows carries the height it was read at, and the app tells node unavailability, indexer lag, a
  refused transaction, and an unconfirmed broadcast apart.
- The member may choose the node. The registry's endpoints are the defaults, and no endpoint is one the member cannot
  replace.
- Nothing the app computes is authoritative: tax and gas come from the Treasury queries, the grant's figures from
  Disbursement, and the outcome from the chain.

## Fees and broadcast

The signer reviews and signs, and reaches no node ([the core](../signer/README.md#the-core)). Choosing a fee and
broadcasting are the feature's, through the SDK.

- **Fees.** The feature that builds the transaction takes the SDK's fee quote with headroom it passes explicitly; the
  SDK's named `arkd` constants are the app's defaults, and the review screen states them. In the first tranche the
  member holds NOAH alone, and NOAH is charged whole, so the app declares the NOAH requirement with its margin and
  tells the member the margin is a tip; a stable leg, once conversion opens, is padded for free
  ([client fees](https://github.com/ararat-network/ark/blob/main/docs/clients/CLIENT_FEES.md)). The fee's
  presentation is built for every denomination from the start, not for NOAH alone.
- **One quote, shown and then signed.** The feature runs the SDK's three steps. `prepareTx` gives the unsigned
  transaction and its quote, and signs nothing. `signTx` signs that same transaction as it stands, through the
  feature's handle on the signer, and asks the node nothing, so the fee a member is shown is the fee that is signed.
  `broadcastTx` sends what was signed. No fee is shown from one quote and signed from another. The three steps are
  in the SDK from 0.4.0.
- **The review screen.** The signer reviews what is signed, the messages and the fee ceiling, and never reads the
  quote: the feature attaches it to its request and the signer hands it to the review screen beside its review. The
  screen shows how the ceiling divides, each part apart: the tax in each denomination; the gas requirement and its
  denomination; the ceiling in each denomination, with what is charged and what stays with the member; the NOAH tip,
  charged whole; and the height the figures were read at. It shows a quote only when the quote's declared fee is the
  document's ceiling. A quote too old when the member approves, or one the chain refuses because a tax or a price
  moved, is prepared again and shown again.
- **Several at once.** Actions that belong together are one transaction of several messages: one review, one
  signature, run in order, all or nothing. Independent transactions are sent unordered, which the chain allows: each
  expires at a timestamp in place of holding a sequence, so any number are in flight at once and none can take
  another's place. The timestamp is set from the chain's latest block time, not the phone's clock, and is different
  for each transaction. Unordered transactions run in no promised order, so what must run in order is one
  transaction. A Ledger account sends the same way, from device app 2.3.0, which the
  [Ledger adapter](../signer/README.md#adapters) requires: the device shows that the transaction is unordered and
  the time it is valid until, in UTC. Reading a review on the device takes longer, so the time has to leave room for
  it. An unordered transaction has no sequence to be refused for; one whose time has passed is prepared again from
  fresh figures and reviewed again, and nothing is signed a second time unseen, since the three steps sign once.
- **Broadcast.** The feature broadcasts the signed transaction with the SDK's `broadcastTx`: sync, then wait for
  inclusion. The outcome keeps its class: an ante refusal, an execution failure, a module error, a timeout with the
  hash still pending, or a node that could not be reached. None is summarised away. Nothing is signed in this step,
  so after a broadcast whose outcome is unknown the same signed transaction is sent again, with no second review.

## Stack

The phone app is React Native through Expo: the Expo Modules API gives the keystore its typed bridge, and continuous
native generation produces the Xcode and Gradle projects at build time from the app's config, so the one native code in
the tree is the keystore's Swift and Kotlin, and the key never enters JavaScript. The native surface beyond the
keystore, the biometric prompt, the Ledger Bluetooth transport, device attestation, and the Apple and Google sign-in,
comes from pinned modules and holds no key.

Expo Router keeps its routes in a directory named `app`, so the phone app keeps them at `app/src/app/`, the `src` form
the router accepts, and keeps the name the direction uses. The Expo SDK is pinned like any other dependency, since the
generated native projects are only as fixed as it is.

**The alternative.** Native apps in Swift and Kotlin sharing a signer core in Rust, through UniFFI on the phones and
WebAssembly on the web, or in Kotlin Multiplatform, would keep the key and the signing off a JavaScript bridge, with a
smaller supply chain and no React Native release cadence to follow. It would cost two native user interfaces beside the
web's, so the screens and the strings written three times; bindings per platform for the core; three review surfaces
for the one-meaning rule; and a smaller pool of contributors. The design takes React Native and draws the native
boundary around the key. The tooling is Expo's module API with generated projects. Bare React Native, with the
native projects committed and the keystore a Turbo Module, was the other choice: every build setting would be in the
tree to review, at the cost of keeping the projects by hand through each React Native release. With the generated
projects, what is built is fixed by the pinned Expo SDK and the app's config, which is what a review reads.

## Security

### What the app holds

- The seed, wrapped as in [the keystore](../signer/README.md#keystore-per-platform), and under option A the backup blob
  in the platform keychain.
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

The signup protocol's [§10](../signer/docs/SIGNUP_PROTOCOL.md#10-security-notes) draws the line: the proof binds an
address to an admission and a key, not to a session, so a stolen session can submit the thief's address against the
victim's admission. The service's controls bound that, device attestation and the platform account on the session, and
the app adds three. The challenge is requested, signed, and submitted in one flow on the attested device, with no path
that signs a challenge for a session elsewhere. The grant view shows the registered address and the end of the hold, so
the member sees a wrong address while the committee can still suspend. And the session never reaches the key, which sits
behind the signer and the biometric prompt.

### Inputs

Everything the app receives is data: deep links, QR codes, the membership API's responses, node responses, Ledger
responses, and the clipboard. Each is parsed by a typed decoder and never executed or rendered as markup. The app
checks a node's chain id against the registry, and the SDK checks every response's shape.

### Updates and release signing

- Store builds are made in CI from a release tag on a reviewed `main` and signed as the stores require: Apple signs
  iOS distribution; Android is signed with an upload key held in CI's secrets, with Play App Signing holding the app
  signing key. Release tags are immutable and created only by administrators, under the rulesets `ark` uses.
- No over-the-air JavaScript updates in the first release. An over-the-air update is code the stores never reviewed,
  signed by a key the project holds, and the signer's code changes only through a reviewed release. The capability is
  left out of the build, not merely unused.
- The app declares the SDK and chain versions it was built against and degrades safely on an unknown message type,
  which review shows as unknown.

The web client's release is in [its README](../web/README.md#release).

## Development

From this directory, with pnpm through corepack on Node 22.13 or later:

```sh
pnpm install
(cd ../signer && pnpm install)   # the signer is taken by path, and brings none of its own dependencies
pnpm lint
pnpm check
pnpm test
pnpm check:ios        # builds, installs on the booted simulator, and runs the keystore's device check there
pnpm check:android    # the same on the running emulator
```

The signer's own dependencies are installed in its directory, since the app takes it by path and its source looks
for them there: without them the type check and the bundler cannot find the SDK the signer imports. CI installs the
ones it runs with and leaves out the ones it is developed with.

Linting, the type check, and the tests need nothing but Node. The last two need the native toolchains: Xcode with
an iOS simulator and CocoaPods; and for Android a JDK 17, the Android SDK with the NDK the pinned React Native names,
and an emulator, with `JAVA_HOME` and `ANDROID_HOME` set. `pnpm ios` and `pnpm android` build the debug app and start
the bundler for development.

The native projects are generated at build time from [app.json](app.json) and the pinned Expo SDK, into `ios/` and
`android/`, which are ignored. What is built is fixed by that config and that pin, so a change to either is what a
review reads; `pnpm prebuild` generates them afresh.

The two checks build the app with `EXPO_PUBLIC_ARK_DEVICE_CHECK=1`, and only such a build runs the keystore's
[device check](../signer/keystore/device-check.ts) when it opens: it makes a key, signs twice, and removes the key,
and stops before doing anything where a key is already held. On the emulator the check sets a PIN of its own, types
it into the system's prompt, and clears it when it ends, so it is run on an emulator with no screen lock that
matters. The Android check also builds with the Gradle property `arkKeystoreAllowSoftware`, without which the
keystore refuses an emulator's key store, which has no hardware behind it.

Five things about the build that are not obvious:

- The app's identifier on both platforms is `network.ararat.ark`, in [app.json](app.json). It is a working choice:
  nothing has been published under it, and a store fixes an identifier for good at the first upload, so it is
  confirmed before then.
- The oldest Android the app installs on is Android 9, set in [app.json](app.json). It is where the platform's
  current biometric prompt and StrongBox begin, which the [keystore](../signer/README.md#keystore-per-platform) is
  written to. Google's figures of October 2026 put 2.4% of devices below it.
- The Android build asks any `cmake` on the `PATH` for its version before it uses the Android SDK's own, so a
  `cmake` there that fails to run stops the build. The keystore names the CMake it builds with, and the build
  fetches that one from the SDK.
- CocoaPods needs a UTF-8 locale. In a shell with none, its install fails with an encoding error that names no
  cause; `LANG=en_US.UTF-8` in front of the command is the fix.
- The native code the app builds is the signer's, not its own. The app depends on `@ararat-network/signer` by path,
  and Expo links the keystore's native projects from that package as it would any module's
  ([expo-module.config.json](../signer/expo-module.config.json)).

The package stands alone: its manifest, lockfile, and tooling configuration are all here. The tests run on `node:test`
through `tsx`, beside the code they test, and cover what needs no device.

## Decisions

| Decision                          | Options                                                                                                                      | Recommendation                                                                                                      | Blocks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| How long an unordered transaction is valid | The longest the chain allows; a shorter fixed window                                                                 | A short fixed window, long enough for a review read on a Ledger, once the chain's limit and what it charges an unordered transaction in gas are read from `ark` | Staking and send                                                          |

## What it must not become

A holder of key material; a place where chain policy is computed.
