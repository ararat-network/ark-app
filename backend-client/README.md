# backend-client

A snapshot of the backend's API schemas, the membership service's first, and the client generated from them, both
committed.

Nothing here is built yet. This README is the design the package follows, and each part is rewritten as what is
once it is built. The [repository's README](../README.md) says where the package sits among the others and the
order they are built in.

## Refreshing the snapshot

The backend,
[`ark-backend`](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#ark-backend), is
private. A builder with access to it refreshes the snapshot here and commits the client generated from it, so no public
build needs a credential. CI checks that the committed client regenerates from the committed snapshot; it holds no
credential, so whether the snapshot is current is the refreshing builder's check, not CI's.

The snapshot and the client arrive with signup, the second step of the build order.

The membership service's KMS provider is the service's decision, not the app's, and is not recorded here.

## What it must not become

Hand-written API code; session logic, which is the app's.
