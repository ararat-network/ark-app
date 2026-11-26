# ark-app

The Ark app: one app, mobile first, that holds the wallet and everything a member of
[Ark](https://github.com/ararat-network/ark) does. The phone is where the key lives and where everything a member does
is signed. A web client follows, its own app for a screen larger than a phone's and for the pages anyone reads, and
signs through the member's phone or a Ledger device, never through a key in the browser. The signer is a package of
the app, and every feature asks it for a signature without ever seeing a key. The
[tooling direction](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-app) says
what the app is for and where it sits among Ark's repositories.

The first package exists: [`signer/`](signer/README.md), with the signup protocol's documents and their proof.
Nothing else is built yet: each other directory holds a README with the design it follows, and that README is
rewritten as what is once the package is built.

**The first user.** The
[disbursement plan](https://github.com/ararat-network/ark/blob/main/docs/governance/DISBURSEMENT_PLAN.md#admission) sets
them: a member who holds a grant the Disbursement module pays out over a year, who has never seen a key, and who must
stake and vote each payment. Everything in the first tranche is sized to that person. They never see a key, a fee they
have to fund, or a transaction they cannot read.

## Layout

TypeScript throughout, with one native module. Each package is a top-level directory named by its role, as in `ark`,
and holds everything it is: its own README, manifest, lockfile, and tooling configuration. There is no package at the
root and no shared lockfile, so a directory lifts out as a repository of its own with nothing added but the licence,
and what two packages both need is configured in each. A package that uses another depends on it by path. The one
[LICENSE](LICENSE) at the root covers every package.

| Package | Responsibility | Must not become |
| --- | --- | --- |
| [`app/`](app/README.md) | The React Native app for iOS and Android: signup, the grant view, the distribution screen, staking, voting, send; navigation, sessions, and configuration per network; its native projects generated at build time, never committed | A holder of key material; a place where chain policy is computed |
| [`web/`](web/README.md) | The web client, a React app built to static files from a tag: the distribution screen and the explorer pages for anyone, and the grant view, staking, and voting for a member, signing by handoff or a Ledger | A client with a key of its own; the first home of a member feature, which is the phone's |
| [`signer/`](signer/README.md) | Key custody, consent, review, signing, the sign-arbitrary call, the handoff protocol, and the adapters, with the keystore's Swift and Kotlin inside it | A key store a feature reaches around; a client of a node or a service; an Ark policy engine; the authority for balances or outcomes |
| [`i18n/`](i18n/README.md) | The string resources, the locale formatting of amounts, dates, and currencies, and the check that every language carries every string | A second reading of a transaction: a translation renders the same decoded fields |
| [`backend-client/`](backend-client/README.md) | A snapshot of the backend's API schemas, the membership service's first, and the client generated from them, both committed; a builder with access to the private `ark-backend` refreshes the snapshot, so no public build needs a credential | Hand-written API code; session logic, which is the app's |

`.github/` holds the automation. It and `signer/` change only on their owners' review
([CODEOWNERS](.github/CODEOWNERS)).

The two clients share no components: the phone renders React Native views and the web renders the DOM, and what they
must share, the decoded transaction as a model to render, is the signer's review step
([the core](signer/README.md#the-core)).

`@ararat-network/sdk` is a dependency, pinned at an exact version from npm. It owns encoding, queries, transaction
building, fees, broadcast, decoding, and formatting; the app adds no second implementation of any of them. The signup
protocol is not the SDK's: its documents, their ADR-036 sign bytes, and its vectors are the signer's
([signer](signer/README.md)).

The toolchain is the SDK's: pnpm with dependency install scripts blocked, exact versions, Node 22, and tests beside
the code they test. CI type-checks, lints, and tests every package and checks the SDK pin; the backend client's own
check is in [its README](backend-client/README.md).

## What it must not become

- **A key store outside the signer interface.** Every feature asks the signer for a signature and never sees a key, and
  no feature keeps key material of its own.
- **A second source of chain state.** The app caches reads with their heights and never shows a figure the chain did
  not give it.
- **The only way to inspect chain activity.** The explorer pages read public interfaces anyone can read, and the SDK
  and the decoding fixtures give any third party the same reading of every transaction.

## Build order

Aligned with the direction's first two steps. Each step names what done looks like, and none waits on a later one.

1. **Signer core and keystore.** The signer package implementing the SDK's `Signer`; the device keystore on iOS and
   Android; consent and review on decoded messages; the sign-arbitrary call; the Ledger adapter. Done: the signup
   vectors and the decoding fixtures pass, the emulator suite signs through the adapter, and a localnet transaction,
   built and broadcast by a test through the SDK, signs from a device key and from a Ledger.
2. **Signup.** The schema snapshot and the backend client generated from it, committed; sign-in with Apple and
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

Backup and the string resources are not steps: [backup](signer/README.md#backup-and-recovery) ships with the
keystore in step 1, both options, and every string is a resource from step 1. The web client is not a step of
the first tranche: its directory exists from the first commit, and it ships after the phone, on the handoff and the
Ledger adapter the signer already has.

## Security

Each package's README holds its own part: what the phone app holds and never holds, its session, its inputs, and its
releases ([app](app/README.md#security)); the web client's release ([web](web/README.md#release)); and the key, the
review, and the documents a member may be asked to sign ([signer](signer/README.md#security)).

Every package pins the same way: exact versions, a frozen lockfile in CI, dependency install scripts blocked by pnpm,
Dependabot, and every CI action pinned by commit SHA.

The chain-side controls, the ante, the lanes, the committee and registrar bounds, and the release pipeline, are in ark's
[threat model](https://github.com/ararat-network/ark/blob/main/docs/security/THREAT_MODEL.md), which lists clients and
wallets as outside its scope. The packages' security sections are the app's side of that boundary. A change that adds an
input, a stored secret, a transport, or a release step updates its package's section in the same change.

## Development

Each package is developed from its own directory with pnpm through corepack, on Node 22 or later; its README has the
commands. Dependency install scripts are blocked and every version is exact.

One workflow, [ci.yml](.github/workflows/ci.yml), serves every package: it runs a package's jobs only when that package
or the automation changed, and its last job, `ci`, is the one check a pull request must pass. A change to the files at
the root alone runs no package's jobs.
