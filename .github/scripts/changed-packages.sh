#!/bin/sh
# Says which packages a change touches, one `name=true|false` line each, for
# ci.yml to run only those packages' jobs.
#
#   changed-packages.sh <base commit> <package directory>...
#
# A package is touched when a file under its directory changed between the
# base and HEAD. A change under .github/ touches every package, since the
# automation itself changed. With no usable base (a new branch, a shallow
# clone) every package is touched: running too much is the safe mistake.
set -eu

base="${1:-}"
shift

all=false
if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  all=true
  files=""
else
  files=$(git diff --name-only "$base...HEAD")
  if printf '%s\n' "$files" | grep -q '^\.github/'; then all=true; fi
fi

for package in "$@"; do
  if [ "$all" = true ] || printf '%s\n' "$files" | grep -q "^$package/"; then
    echo "$package=true"
  else
    echo "$package=false"
  fi
done
