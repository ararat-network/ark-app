# The keystore on a phone: what is checked by hand

The keystore's tests run its C core on the build machine and the whole of it on the iOS Simulator and an Android
emulator. Neither has the hardware the design rests on, so what only a phone can show is checked on one, by hand, as
the Ledger's own display is. This is the list. It is run on an iPhone and on an Android phone before a release that
changes `keystore/`, and each run is written at the end with its date, the phone, and what was seen.

## What the automatic checks already show

| | Where | What |
| --- | --- | --- |
| The core | The build machine | Seeds, keys, and signatures against the SDK, the signup vectors, and the transaction fixtures, byte for byte |
| The TypeScript | The build machine | The keystore over a native module in memory: every refusal, and every answer native code could give wrongly |
| iOS | The Simulator | A seed made, encrypted under the Simulator's Secure Enclave, opened, and signed with, twice; a second key refused; the key removed |
| Android | An emulator | With no screen lock, a key refused as `no_passcode`. With a PIN, a key that takes the PIN made, and a prompt answered for making it and for each of two signatures |

## What they cannot show

- **That the key is in hardware.** The Simulator's Secure Enclave and the emulator's Keystore are software.
- **Authentication on iOS at all.** The Simulator refuses every key with authentication on it, so its key has none.
- **A fingerprint or a face.** The emulator's key takes the PIN; nothing biometric is exercised.
- **Invalidation.** That enrolling a fingerprint or face, or removing the passcode, ends the key, and what the phone
  says when it has.
- **Android 9 and 10**, where a key takes biometrics alone and a phone without them is refused.

## How to run it

Install a build of the app on the phone: `pnpm ios --device` or `pnpm android --device` from `app/`, with the phone
connected. The app's first screen is the scaffold. It shows the key on the phone, how it opens and what holds it, and
has three buttons: **Make a key**, **Sign a test message**, and **Remove the key**. **Last result** says how the last
one ended.

Use a phone with no Ark key that matters on it: the list removes the key more than once.

## iPhone

1. **No passcode.** With the passcode turned off in Settings, **Make a key** ends in "This phone has no passcode, and
   a key needs one", and the screen still shows no key.
2. **Passcode, no Face ID or Touch ID enrolled.** **Make a key** makes one, with no prompt. The screen shows "Opens
   with the passcode" and "Held by the Secure Enclave".
3. **Sign a test message** asks for the passcode, and ends in "Signed, and the signature is the key's". Pressed
   again, it asks again: nothing is remembered between two signatures.
4. **Cancel the prompt.** **Sign a test message**, then cancel: "It was not confirmed". The key is still shown.
5. **Enrol Face ID or Touch ID with the passcode key held.** The key still signs, now with the face or finger or the
   passcode: this kind of key outlasts an enrolment.
6. **Remove the key**, then **Make a key** with Face ID or Touch ID enrolled. The screen shows "Opens with a
   fingerprint or face alone". The first signature asks leave to use Face ID, once.
7. **Sign a test message** asks for the face or finger and offers no passcode. A face or finger that does not match
   does not sign.
8. **Lock biometrics out** with five failed attempts: "Too many attempts. Try again later". After the passcode is
   entered on the lock screen, the key signs again.
9. **Enrol another finger, or reset Face ID and enrol again.** **Sign a test message** must not sign. Write down
   what the screen says, before and after the app is closed and opened again: the design expects "This phone can no
   longer open your key", and Apple documents the invalidation and not the error it is reported with.
10. **Turn the passcode off** with a key held. Opened again, the app shows "The phone no longer opens it".
11. **Delete the app and install it again** with a key held. Write down whether the key is still shown: Apple
    documents neither outcome, and the keystore relies on neither.

## Android phone

1. **No screen lock.** **Make a key** ends in "This phone has no passcode, and a key needs one".
2. **Screen lock, no fingerprint or face enrolled, Android 11 or later.** **Make a key** asks for the PIN, pattern, or
   password once and makes a key. The screen shows "Opens with the passcode" and either "Held by StrongBox" or "Held
   by the trusted environment". "Held by no hardware" on a phone is a failure of the build, which must refuse it.
3. **Sign a test message** asks for the screen lock, and asks again each time it is pressed.
4. **Cancel the prompt.** "It was not confirmed", and the key is still shown.
5. **Enrol a fingerprint with the passcode key held.** The key still signs, with the finger or the screen lock.
6. **Remove the key**, then **Make a key** with a fingerprint enrolled. The screen shows "Opens with a fingerprint or
   face alone", and the prompt offers a cancel button and no screen lock.
7. **A finger that is not enrolled** leaves the prompt up and does not sign. Five of them: "Too many attempts. Try
   again later".
8. **Enrol another fingerprint.** Opened again, the app shows "The phone no longer opens it", and **Sign a test
   message** ends in "This phone can no longer open your key" with no prompt shown.
9. **Remove the screen lock** with a key held. The same as 8.
10. **Delete the app and install it again.** No key is shown.
11. **On a phone with a weak face unlock and no fingerprint**, the key made is the passcode's, as in 2.
12. **Android 9 or 10, where one can be had.** With a fingerprint enrolled, 6 to 8 hold. With none, **Make a key**
    ends in "This phone needs a fingerprint or face enrolled to hold a key".

## Runs

None yet.
