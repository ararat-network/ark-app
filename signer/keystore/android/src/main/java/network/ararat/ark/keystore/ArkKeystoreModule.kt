package network.ararat.ark.keystore

import android.util.Log
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The keystore's Android side, as JavaScript calls it. The seed's storage and
// its uses are in SeedStore.kt, the seed phrase while it is shown in
// SeedPhraseShown.kt, and one being entered in SeedPhraseEntry.kt; this file
// turns their answers into what crosses to JavaScript. No call here returns a
// seed, a key, or a word of the seed phrase, and in a build for a phone none
// takes one.
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

    // What the module tells the app with nobody asking. None carries a word or a letter of one.
    Events("onSeedPhraseClosed", "onEntryChange", "onEntryWord")

    OnCreate {
      SeedPhraseShown.onClosed = { reason -> sendEvent("onSeedPhraseClosed", mapOf("reason" to reason)) }
      SeedPhraseEntry.onChange = { change -> sendEvent("onEntryChange", change) }
      SeedPhraseEntry.onWord = { word -> sendEvent("onEntryWord", word) }
    }

    // The app is left: the seed phrase is not kept on a screen nobody is looking at.
    OnActivityEntersBackground {
      SeedPhraseShown.close("background")
    }

    // Opens the held key's seed phrase, after the member authenticates, for the word pieces on the screen to draw.
    // It returns no word.
    AsyncFunction("openSeedPhrase") { prompt: KeystorePrompt, promise: Promise ->
      SeedPhraseShown.open(activity(), context(), prompt.text(), promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("closeSeedPhrase") {
      SeedPhraseShown.close()
    }.runOnQueue(Queues.MAIN)

    // The entry of a seed phrase: where it is, and what is entered, held against the key. What is entered is
    // returned by no call.
    AsyncFunction("moveEntry") { position: Int ->
      SeedPhraseEntry.move(position)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("checkEntry") {
      answering { SeedPhraseEntry.check(context()) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("entryMistakes") { prompt: KeystorePrompt, promise: Promise ->
      SeedPhraseEntry.mistakes(activity(), context(), prompt.text(), promise)
    }.runOnQueue(Queues.MAIN)

    // Stores the key what is entered stands for. The Keystore's key asks for authentication to encrypt, so the
    // member authenticates once here, as to make a key.
    AsyncFunction("restoreFromEntry") { prompt: KeystorePrompt, promise: Promise ->
      SeedPhraseEntry.restore(activity(), context(), prompt.text()) { made -> made.fold({ promise.resolve(describe(it)) }, { promise.reject(coded(it)) }) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearEntry") {
      SeedPhraseEntry.clear()
    }.runOnQueue(Queues.MAIN)

    // The two calls that take a seed phrase from JavaScript: one stores a key from it, and one enters it whole.
    // Only a development build has them, where a test loads a key it knows and nothing types into the field. No
    // build for a phone takes a seed phrase from JavaScript.
    if (BuildConfig.DEVELOPMENT_KEYS) {
      AsyncFunction("restoreSeedPhrase") { seedPhrase: String, prompt: KeystorePrompt, promise: Promise ->
        store.restore(activity(), seedPhrase, prompt.text()) { made -> made.fold({ promise.resolve(describe(it)) }, { promise.reject(coded(it)) }) }
      }

      AsyncFunction("fillEntry") { seedPhrase: String ->
        SeedPhraseEntry.fill(seedPhrase)
      }.runOnQueue(Queues.MAIN)
    }

    // The piece that draws one word of the seed phrase, while it is open.
    View(ArkKeystoreSeedPhraseWordView::class) {
      Prop("position") { view: ArkKeystoreSeedPhraseWordView, position: Int? -> view.position = position ?: 0 }

      Prop("color") { view: ArkKeystoreSeedPhraseWordView, color: String? -> view.style.setColor(color) }

      Prop("fontSize") { view: ArkKeystoreSeedPhraseWordView, size: Double? -> view.style.setFontSize(size) }

      Prop("fontWeight") { view: ArkKeystoreSeedPhraseWordView, weight: String? -> view.style.setFontWeight(weight) }

      Prop("textAlign") { view: ArkKeystoreSeedPhraseWordView, alignment: String? -> view.style.setAlignment(alignment) }

      OnViewDidUpdateProps { view: ArkKeystoreSeedPhraseWordView -> view.applyProps() }
    }

    // The field a word of a seed phrase is typed into.
    View(ArkKeystoreSeedPhraseFieldView::class) {
      Prop("color") { view: ArkKeystoreSeedPhraseFieldView, color: String? -> view.style.setColor(color) }

      Prop("fontSize") { view: ArkKeystoreSeedPhraseFieldView, size: Double? -> view.style.setFontSize(size, 24f) }

      Prop("fontWeight") { view: ArkKeystoreSeedPhraseFieldView, weight: String? -> view.style.setFontWeight(weight, 500) }

      Prop("textAlign") { view: ArkKeystoreSeedPhraseFieldView, alignment: String? -> view.style.setAlignment(alignment) }

      OnViewDidUpdateProps { view: ArkKeystoreSeedPhraseFieldView -> view.applyProps() }

      AsyncFunction("focus") { view: ArkKeystoreSeedPhraseFieldView ->
        view.post { view.focus() }
      }
    }

    // The piece that draws one of the list's words that begin with what is typed, and takes it when touched.
    View(ArkKeystoreSeedPhraseSuggestionView::class) {
      Prop("index") { view: ArkKeystoreSeedPhraseSuggestionView, index: Int? -> view.index = index ?: 0 }

      Prop("color") { view: ArkKeystoreSeedPhraseSuggestionView, color: String? -> view.style.setColor(color) }

      Prop("fontSize") { view: ArkKeystoreSeedPhraseSuggestionView, size: Double? -> view.style.setFontSize(size) }

      Prop("fontWeight") { view: ArkKeystoreSeedPhraseSuggestionView, weight: String? -> view.style.setFontWeight(weight) }

      Prop("textAlign") { view: ArkKeystoreSeedPhraseSuggestionView, alignment: String? -> view.style.setAlignment(alignment ?: "center") }

      OnViewDidUpdateProps { view: ArkKeystoreSeedPhraseSuggestionView -> view.applyProps() }
    }
  }

  private fun context() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

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
