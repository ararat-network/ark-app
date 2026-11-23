# web

The web client: a React app built to static files from a tag, for a screen larger than a phone's and for the pages
anyone reads. It shows the distribution screen and the explorer pages to anyone, and the grant view, staking, and
voting to a member.

Nothing here is built yet. This README is the design the package follows, and each part is rewritten as what is once it
is built. The [repository's README](../README.md) says where the package sits among the others and the order they are
built in. The web client is not a step of the first tranche: it ships after the phone, on the handoff and the Ledger
adapter the signer already has.

## Signing

The web client holds no key. It builds and reviews the transaction, then signs by handoff to the member's phone or
through a Ledger ([keystore per platform](../signer/README.md#keystore-per-platform)). It shares no components with the
phone app: what the two share is the signer's review model ([the core](../signer/README.md#the-core)), which each
renders with its own components. Fees and broadcast follow the phone app's rules
([fees and broadcast](../app/README.md#fees-and-broadcast)).

## Explorer pages

The web client's explorer pages read the indexer and need no account: each transaction decoded, the distribution, and
the network, as the direction lists them. They come with the indexer. The web client is their front, the indexer their
data, and neither is consensus state.

## Release

The web client is built from the same tag as the phone app and served from a first-party origin with a content security
policy, subresource integrity on what it loads, and no third-party script. It holds no key, so a compromised deployment
can show the member a wrong document, which the phone's review catches, and cannot sign.

## What it must not become

A client with a key of its own; the first home of a member feature, which is the phone's.
