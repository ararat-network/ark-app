#!/bin/sh
# Copies libsecp256k1 into keystore/native/secp256k1 at the release named in
# keystore/native/SECP256K1_VERSION: a tag, and the commit that tag must be.
# A tag can be moved and a commit cannot, so a tag that is no longer that
# commit is refused.
#
# What is copied is what the library is built from here, with no build system
# of its own: its public header, the three sources that are compiled, and the
# headers they include. Its tests, benchmarks, optional modules, and assembly
# are left out. To move to a new release, change SECP256K1_VERSION and run
# this.
set -eu

cd "$(dirname "$0")/../keystore/native"
read -r tag commit < SECP256K1_VERSION
repo=${SECP256K1_REPO:-https://github.com/bitcoin-core/secp256k1.git}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$repo" "$work/secp256k1" 2>/dev/null
found=$(git -C "$work/secp256k1" rev-parse HEAD)
if [ "$found" != "$commit" ]; then
  echo "$tag is $found, and SECP256K1_VERSION says $commit" >&2
  exit 1
fi

rm -rf secp256k1
mkdir -p secp256k1/include secp256k1/src
cp "$work/secp256k1/COPYING" secp256k1/
cp "$work/secp256k1/include/secp256k1.h" "$work/secp256k1/include/secp256k1_preallocated.h" secp256k1/include/
cp "$work/secp256k1/src/secp256k1.c" "$work/secp256k1/src/precomputed_ecmult.c" "$work/secp256k1/src/precomputed_ecmult_gen.c" secp256k1/src/
for header in "$work/secp256k1/src"/*.h; do
  case "$(basename "$header")" in
    bench*.h | test*.h | unit_test.h | *_compute_table*.h) ;;
    *) cp "$header" secp256k1/src/ ;;
  esac
done
echo "keystore/native/secp256k1: $(find secp256k1 -type f | wc -l | tr -d ' ') files from libsecp256k1 $tag ($commit)"
