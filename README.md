# ark-app

The Ark app: one app, mobile first, that holds the wallet and everything a member of
[Ark](https://github.com/ararat-network/ark) does. The phone is where the key lives and where everything a member does
is signed. A web client follows, its own app for a screen larger than a phone's and for the pages anyone reads, and
signs through the member's phone or a Ledger device, never through a key in the browser. The signer is a package of
the app, and every feature asks it for a signature without ever seeing a key. The
[tooling direction](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-app) says
what the app is for and where it sits among Ark's repositories.

The first package exists: [`signer/`](signer/README.md), with the signup protocol's documents and their proof.
Nothing else is built yet. [DESIGN.md](DESIGN.md) is the design the rest follows, and it is temporary: as each
package is built, its part of the design moves into that package's README.

## Layout

TypeScript throughout, with one native module. Each package is a top-level directory named by its role, as in `ark`,
and holds everything it is: its own README, licence, manifest, lockfile, and tooling configuration. There is no package
at the root and no shared lockfile, so a directory lifts out as a repository of its own without a change, and what two
packages both need is configured in each. A package that uses another depends on it by path.

| Package | Responsibility | Must not become |
| --- | --- | --- |
| `app/` | The React Native app for iOS and Android: signup, the grant view, the distribution screen, staking, voting, send; navigation, sessions, and configuration per network; its native projects generated at build time, never committed | A holder of key material; a place where chain policy is computed |
| `web/` | The web client, a React app built to static files from a tag: the distribution screen and the explorer pages for anyone, and the grant view, staking, and voting for a member, signing by handoff or a Ledger | A client with a key of its own; the first home of a member feature, which is the phone's |
| `signer/` | Key custody, consent, review, signing, the sign-arbitrary call, the handoff protocol, and the adapters, with the keystore's Swift and Kotlin inside it ([design §3](DESIGN.md#3-the-signer-package)) | A key store a feature reaches around; a client of a node or a service; an Ark policy engine; the authority for balances or outcomes |
| `i18n/` | The string resources, the locale formatting of amounts, dates, and currencies, and the check that every language carries every string | A second reading of a transaction: a translation renders the same decoded fields |
| `backend-client/` | A snapshot of the backend's API schemas, the membership service's first, and the client generated from them, both committed; a builder with access to the private `ark-backend` refreshes the snapshot, so no public build needs a credential | Hand-written API code; session logic, which is the app's |

`.github/` holds the automation. It and `signer/` change only on their owners' review
([CODEOWNERS](.github/CODEOWNERS)).

## Development

Each package is developed from its own directory with pnpm through corepack, on Node 22 or later; its README has the
commands. Dependency install scripts are blocked and every version is exact. `.github/` holds one workflow per package,
which runs only when that package changes.
