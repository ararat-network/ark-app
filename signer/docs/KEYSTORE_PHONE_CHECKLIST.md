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
| iOS | The Simulator | A seed made, encrypted under the Simulator's Secure Enclave, opened, and signed with, twice; a second key refused; the key removed. Then a key stored from published words, its signature the SDK's byte for byte, and its words drawn |
| Android | An emulator | With no screen lock, a key refused as `no_passcode`. With a PIN, a key that takes the PIN made, and a prompt answered for making it and for each of two signatures. Then the same key from published words, and its words read off the screen |

## What they cannot show

- **That the key is in hardware.** The Simulator's Secure Enclave and the emulator's Keystore are software.
- **Authentication on iOS at all.** The Simulator refuses every key with authentication on it, so its key has none.
- **A fingerprint or a face.** The emulator's key takes the PIN; nothing biometric is exercised.
- **Invalidation.** That enrolling a fingerprint or face, or removing the passcode, ends the key, and what the phone
  says when it has.
- **Android 9 and 10**, where a key takes biometrics alone and a phone without them is refused.
- **The seed phrase kept from a recording.** That an iPhone clears it when a recording or mirroring starts, and that
  an Android phone leaves it out of a screenshot and of the picture among recent apps.

## How to run it

Install a build of the app on the phone: `pnpm ios --device` or `pnpm android --device` from `app/`, with the phone
connected. The app's first screen is the scaffold. It shows the key on the phone, how it opens and what holds it, and
has a button for each thing the keystore does: **Make a key**, **Sign a test message**, **Remove the key**, **Show
the seed phrase**, and **Hide the seed phrase**. **Last result** says how the last one ended, and the seed phrase, the
key's 24 words, is drawn at the foot of the screen.

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
12. **Show the seed phrase** asks for the face, finger, or passcode as a signature does, and draws 24 numbered words.
    Entered into another wallet on coin type 330, they give the address the screen shows.
13. **Leave the app** with the words drawn, by the home gesture and by the app switcher. The switcher's picture of
    the app shows no words, and back in the app they are gone, with "The seed phrase was hidden when the app was
    left".
14. **Start a screen recording** with the words drawn: they are cleared, with "The seed phrase was hidden when the
    screen began to be recorded". With a recording running, **Show the seed phrase** ends in "The seed phrase is not
    shown while the screen is being recorded or shared". The same with the screen mirrored to another display.
15. **Take a screenshot** with the words drawn. It holds them: iOS gives an app no way to refuse one. Delete it.
16. **With VoiceOver on**, each word is read with its number.

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
13. **Show the seed phrase** asks for the finger or the screen lock as a signature does, and draws 24 numbered
    words.
    Entered into another wallet on coin type 330, they give the address the screen shows.
14. **Take a screenshot, and start a recording,** with the words drawn. The screenshot is refused or blank, and the
    recording shows a blank screen where the app is.
15. **Open recent apps** with the words drawn: the app's picture there is blank. Back in the app the words are gone,
    with "The seed phrase was hidden when the app was left".
16. **With TalkBack on**, each word is read with its number.

## Runs

None yet.
