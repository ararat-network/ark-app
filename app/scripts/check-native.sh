#!/bin/sh
# Shows that an installed build called native code and got the right answer,
# with nobody watching the screen.
#
#   check-native.sh ios|android
#
# The app's first screen sends a probe to the native module, which writes one
# line to the device's log when it answers. This starts the app on the booted
# simulator or the running emulator and waits for that line. The line is
# worked out from the probe by the same TypeScript the app runs, so it cannot
# drift from what the app sends.
set -eu

cd "$(dirname "$0")/.."
platform=${1:?usage: check-native.sh ios|android}
app_id=network.ararat.ark
expected=$(node --import tsx -e 'import("./modules/native-check/src/probe.ts").then((m) => console.log(m.expectedLogLine()))')
echo "waiting for: $expected"

case "$platform" in
  ios)
    xcrun simctl terminate booted "$app_id" >/dev/null 2>&1 || true
    xcrun simctl launch booted "$app_id" >/dev/null
    read_log() {
      # The app's own lines alone: the log tool records its own command line, which holds the same words.
      xcrun simctl spawn booted log show --last 3m --style compact --predicate 'process == "Ark" AND eventMessage CONTAINS "ark-native-check"' 2>/dev/null
    }
    ;;
  android)
    adb logcat -c
    adb shell am force-stop "$app_id"
    adb shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    read_log() {
      adb logcat -d -s ArkNativeCheck:I 2>/dev/null
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
    echo "native code was called and answered rightly"
    exit 0
  fi
  tries=$((tries + 1))
  sleep 2
done

echo "the line did not appear in the device's log within a minute; what the log holds:" >&2
read_log >&2 || true
exit 1
