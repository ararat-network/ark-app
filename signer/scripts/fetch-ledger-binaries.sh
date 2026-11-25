#!/bin/sh
# Downloads the Ark device app's emulator binaries from ledger-ark's release
# at the tag in ledger/emulator/RELEASE into ledger/emulator/binaries, and
# refuses any whose SHA-256 is not the one in ledger/emulator/binaries.sha256.
# The checksums are pinned here, not read from the release, so a release that
# changed would fail the check. To move to a new release, change RELEASE and
# the checksum file together.
set -eu

cd "$(dirname "$0")/../ledger/emulator"
tag=$(cat RELEASE)
base=${LEDGER_ARK_RELEASES:-https://github.com/ararat-network/ledger-ark/releases/download}

mkdir -p binaries
while read -r _ name; do
  [ -f "binaries/$name" ] || curl --fail --silent --show-error --location --output "binaries/$name" "$base/$tag/$name"
done < binaries.sha256

cd binaries
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check --strict ../binaries.sha256
else
  shasum --algorithm 256 --check --strict ../binaries.sha256
fi
