#!/bin/sh
# Shows that an installed build holds the signer's keystore, that its C core
# answers rightly there, and that the keystore makes a key, signs with it
# behind the device's own protection, and removes it, with nobody watching
# the screen.
#
#   check-native.sh ios|android
#
# The build is one made with EXPO_PUBLIC_ARK_DEVICE_CHECK=1, whose first
# screen runs the keystore's device check and writes each line of it to the
# device's log. This starts the app on the booted simulator or the running
# emulator and waits for the lines that say it passed.
#
# The check makes a key, signs with it twice, and removes it. Then, since
# these are development builds, it stores a key from 24 published words, has
# it sign what the SDK signs with the same key and compares the two byte for
# byte, and has the native view draw the words.
#
# On the Simulator the key has no authentication on it, since the Simulator
# refuses every key that has: what is shown there is the seed made, encrypted
# under the Simulator's Secure Enclave, opened, and used.
#
# On the emulator the check runs twice. With no screen lock, where the phone
# must refuse a key and say why; then with a PIN, where the key takes the PIN
# for each use and this script types it into the system's prompt, each time
# the check says it is about to show one. While the words are drawn it reads
# the screen's accessibility tree and looks for the first and the last of
# them. The emulator's key store is software, which the build was told to take
# with the Gradle property the check sets.
set -eu

cd "$(dirname "$0")/.."
platform=${1:?usage: check-native.sh ios|android}
app_id=network.ararat.ark
pin=1234

# Waits for a line in the device's log, and stops at once if the check says it failed.
#   await <the words to wait for> <seconds>
await() {
  echo "waiting for: $1"
  waited=0
  while [ "$waited" -lt "$2" ]; do
    log=$(read_log || true)
    if printf '%s\n' "$log" | grep -F -q -- "$1"; then return 0; fi
    if printf '%s\n' "$log" | grep -E -q 'device-check=(failed|refused)'; then break; fi
    during_wait
    waited=$((waited + 2))
    sleep 2
  done
  echo "the line did not appear in the device's log; what the log holds:" >&2
  read_log >&2 || true
  return 1
}
during_wait() { :; }

case "$platform" in
  ios)
    xcrun simctl terminate booted "$app_id" >/dev/null 2>&1 || true
    # The launch prints the app's identifier and its process: the lines read are that process's alone, so that
    # neither an earlier run's nor the log tool's own command line, which holds the same words, is taken for them.
    pid=$(xcrun simctl launch booted "$app_id" | awk '{print $NF}')
    read_log() {
      # With the lines logged for information, which is how those written from JavaScript arrive.
      xcrun simctl spawn booted log show --last 5m --info --style compact --predicate "processIdentifier == $pid AND eventMessage CONTAINS \"ark-keystore\"" 2>/dev/null
    }
    await "ark-keystore self-check=1" 60
    await "ark-keystore device-check=ok protection=none hardware=software restored=1 words=1" 90
    ;;
  android)
    read_log() {
      adb logcat -d -s ArkKeystore:I ReactNativeJS:I 2>/dev/null
    }
    launch() {
      adb logcat -c
      adb shell am force-stop "$app_id"
      adb shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    }
    unlock() {
      adb shell input keyevent KEYCODE_WAKEUP
      adb shell wm dismiss-keyguard
    }
    clear_pin() { adb shell locksettings clear --old "$pin" >/dev/null 2>&1 || true; }
    trap clear_pin EXIT

    clear_pin
    unlock
    launch
    await "ark-keystore self-check=1" 60
    await "ark-keystore device-check=ok unavailable=no_passcode" 60

    adb shell locksettings set-pin "$pin" >/dev/null
    # Each prompt the check announces is answered once, when the system's prompt is the window in front. And once the
    # check says the words are drawn, the screen is read for the first and the last of the words it restored from.
    answered=0
    words_seen=0
    during_wait() {
      asked=$(read_log | grep -c 'ark-keystore prompt=' || true)
      if [ "$asked" -gt "$answered" ] && adb shell dumpsys window displays 2>/dev/null | grep -E 'mCurrentFocus|mFocusedWindow' | grep -q -i -E 'biometric|credential'; then
        sleep 1
        adb shell input text "$pin"
        adb shell input keyevent KEYCODE_ENTER
        answered=$((answered + 1))
      fi
      if [ "$words_seen" -eq 0 ] && read_log | grep -F -q 'ark-keystore words-shown=1'; then
        screen=$(adb exec-out uiautomator dump /dev/tty 2>/dev/null || true)
        if printf '%s' "$screen" | grep -F -q 'content-desc="1, legal"' && printf '%s' "$screen" | grep -F -q 'content-desc="24, title"'; then
          words_seen=1
          echo "the words are on the screen"
        fi
      fi
    }
    launch
    # Whatever the emulator's key store calls itself: the image decides that, and the PIN is what is shown here.
    await "ark-keystore device-check=ok protection=passcode" 180
    if ! read_log | grep -F 'ark-keystore device-check=ok protection=passcode' | grep -F -q 'restored=1 words=1'; then
      echo "the check passed without restoring a key or drawing its words: the build is not a development build" >&2
      exit 1
    fi
    if [ "$words_seen" -ne 1 ]; then
      echo "the check said the words were drawn, and they were not found on the screen" >&2
      exit 1
    fi
    ;;
  *)
    echo "unknown platform: $platform" >&2
    exit 2
    ;;
esac

echo "the keystore is in the build, its core answers rightly, and it makes a key, signs with it, and removes it"
