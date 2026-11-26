package network.ararat.ark.keystore

import android.util.Log
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The keystore's Android side, as JavaScript calls it. The seed's storage and
// its uses are in SeedStore.kt, and the view that draws its 24 words in
// ArkKeystoreWordsView.kt; this file turns their answers into what crosses to
// JavaScript. No call here returns a seed, a key, or the words, and in a
// build for a phone none takes them.
class ArkKeystoreModule : Module() {
  private val store by lazy { SeedStore.of(appContext.reactContext ?: throw Exceptions.ReactContextLost()) }

  override fun definition() = ModuleDefinition {
    Name("ArkKeystore")

    // Whether the C core, as built into this app, derives the key and makes the signature a fixed seed must give.
    // The answer is written to the system log too, which is how a build is checked with nobody watching the screen.
    Function("selfCheck") {
      val passed = Core.selfCheckNative()
      Log.i("ArkKeystore", "ark-keystore self-check=" + (if (passed) 1 else 0))
      passed
    }

    // The protection a key made now would have, or why none can be made.
    AsyncFunction("availability") {
      answering { store.availability() }
    }

    // The key the phone holds, or null.
    AsyncFunction("key") {
      answering { store.held()?.let(::describe) }
    }

    // Makes the member's key. The Keystore's key asks for authentication to encrypt as it does to decrypt, so the
    // member authenticates once here.
    AsyncFunction("create") { prompt: KeystorePrompt, promise: Promise ->
      store.create(activity(), prompt.text()) { made -> made.fold({ promise.resolve(describe(it)) }, { promise.reject(coded(it)) }) }
    }

    // A signature by the held key over SHA-256 of the message, after the member authenticates.
    AsyncFunction("sign") { message: ByteArray, prompt: KeystorePrompt, promise: Promise ->
      store.sign(activity(), message, prompt.text()) { signed -> signed.fold({ promise.resolve(it) }, { promise.reject(coded(it)) }) }
    }

    // Destroys the Keystore's key and the encrypted seed.
    AsyncFunction("remove") {
      answering { store.remove() }
    }

    // Stores the key a seed's 24 words stand for. Only a development build has this call, which is how a test
    // loads a key it knows: no build for a phone takes words from JavaScript.
    if (BuildConfig.DEVELOPMENT_KEYS) {
      AsyncFunction("restoreWords") { words: String, prompt: KeystorePrompt, promise: Promise ->
        store.restore(activity(), words, prompt.text()) { made -> made.fold({ promise.resolve(describe(it)) }, { promise.reject(coded(it)) }) }
      }
    }

    // The view that draws the key's 24 words. They are drawn by it and returned by no call.
    View(ArkKeystoreWordsView::class) {
      Events("onHide")

      Prop("wordColor") { view: ArkKeystoreWordsView, color: String? -> view.setWordColor(color) }

      Prop("numberColor") { view: ArkKeystoreWordsView, color: String? -> view.setNumberColor(color) }

      AsyncFunction("show") { view: ArkKeystoreWordsView, prompt: KeystorePrompt, promise: Promise ->
        view.post { view.show(prompt.text(), promise) }
      }

      AsyncFunction("hide") { view: ArkKeystoreWordsView ->
        view.post { view.hide() }
      }
    }
  }

  // The system's prompt is shown over the app's own screen, so there has to be one.
  private fun activity(): FragmentActivity =
    appContext.currentActivity as? FragmentActivity ?: throw coded(KeystoreFailure("failed", "the app has no screen to show the prompt over"))
}

/** The text of the system's prompt, from JavaScript's string resources. */
class KeystorePrompt : Record {
  @Field val title: String = ""

  @Field val reason: String = ""

  @Field val cancel: String = ""

  internal fun text() = PromptText(title, reason, cancel)
}

private fun describe(held: Held): Map<String, Any> = mapOf(
  "publicKey" to held.publicKey,
  "protection" to held.protection.wire,
  "hardware" to held.hardware.wire,
  "invalidated" to held.invalidated
)

/** A failure as the error JavaScript reads the kind of from its code. */
internal fun coded(thrown: Throwable): CodedException {
  val failure = thrown as? KeystoreFailure ?: KeystoreFailure("failed", thrown.javaClass.simpleName + ": " + thrown.message, thrown)
  return CodedException("ERR_ARK_KEYSTORE_" + failure.kind.uppercase(), failure.message, failure.cause)
}

private inline fun <T> answering(call: () -> T): T = try {
  call()
} catch (thrown: Throwable) {
  throw coded(thrown)
}
