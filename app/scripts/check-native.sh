#!/bin/sh
# Shows that an installed build holds the signer's keystore and that its C
# core answers rightly there, with nobody watching the screen.
#
#   check-native.sh ios|android
#
# The app's first screen asks the keystore to check its core, which derives a
# key from a fixed seed and signs with it, on the device, and compares both
# with the answers fixed in the C. The native module writes the outcome to the
# device's log. This starts the app on the booted simulator or the running
# emulator and waits for the line that says the check passed.
set -eu

cd "$(dirname "$0")/.."
platform=${1:?usage: check-native.sh ios|android}
app_id=network.ararat.ark
expected="ark-keystore self-check=1"
echo "waiting for: $expected"

case "$platform" in
  ios)
    xcrun simctl terminate booted "$app_id" >/dev/null 2>&1 || true
    xcrun simctl launch booted "$app_id" >/dev/null
    read_log() {
      # The app's own lines alone: the log tool records its own command line, which holds the same words.
      xcrun simctl spawn booted log show --last 3m --style compact --predicate 'process == "Ark" AND eventMessage CONTAINS "ark-keystore"' 2>/dev/null
    }
    ;;
  android)
    adb logcat -c
    adb shell am force-stop "$app_id"
    adb shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    read_log() {
      adb logcat -d -s ArkKeystore:I 2>/dev/null
    }
    ;;
  *)
    echo "unknown platform: $platform" >&2
    exit 2
    ;;
esac

tries=0
while [ "$tries" -lt 30 ]; do
  if read_log | grep -F -q "$expected"; then
    echo "the keystore's core is in the build and answers rightly"
    exit 0
  fi
  tries=$((tries + 1))
  sleep 2
done

echo "the line did not appear in the device's log within a minute; what the log holds:" >&2
read_log >&2 || true
exit 1
