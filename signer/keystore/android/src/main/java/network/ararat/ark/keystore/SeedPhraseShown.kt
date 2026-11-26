package network.ararat.ark.keystore

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference

// The seed phrase, while it is shown.
//
// The seed phrase is the seed in another form, so it is opened here, in
// native code, and is never handed to JavaScript. The app asks for it to be
// opened, the member authenticates, and each word piece on the screen draws
// the word at its position. What comes back to the app is that it was opened.
//
// The words are kept here, all 24 of them whichever are drawn, until the seed
// phrase is closed: when the app asks, when the app is left, and when no word
// piece is left on the screen. While it is open the
// window is marked secure, so that the system leaves the words out of
// screenshots, recordings, and the picture of the app among recent apps.
internal object SeedPhraseShown {
  /** Told when the seed phrase closes with nobody asking, and why: `background`. */
  var onClosed: ((String) -> Unit)? = null

  private var words: List<String>? = null
  private val pieces = LinkedHashSet<ArkKeystoreSeedPhraseWordView>()

  /** The window this marked secure, so that it clears only a mark of its own. */
  private var secured: WeakReference<Activity>? = null

  /** The word at a position, or nothing while the seed phrase is closed. */
  fun word(position: Int): String = words?.getOrNull(position) ?: ""

  /** Opens the seed phrase after the member authenticates. */
  fun open(activity: FragmentActivity, context: Context, prompt: PromptText, promise: Promise) {
    SeedStore.of(context).seedPhrase(activity, prompt) { answer ->
      activity.runOnUiThread {
        answer.fold(
          { opened ->
            words = opened
            secure(activity)
            redraw()
            promise.resolve(null)
          },
          { promise.reject(coded(it)) }
        )
      }
    }
  }

  /** Closes it. With a reason, the app is told it closed by itself. */
  fun close(reason: String? = null) {
    val wasOpen = words != null
    words = null
    redraw()
    unsecure()
    if (wasOpen && reason != null) onClosed?.invoke(reason)
  }

  fun attach(piece: ArkKeystoreSeedPhraseWordView) {
    pieces.add(piece)
  }

  /**
   * A piece has left the screen. With none left there is nothing to draw the words for, and they are not kept. It is
   * looked at a turn later, since an app that moves through the positions may take its pieces off the screen and put
   * others on in one go.
   */
  fun detach(piece: ArkKeystoreSeedPhraseWordView) {
    pieces.remove(piece)
    piece.post { if (pieces.isEmpty()) close() }
  }

  private fun redraw() = pieces.forEach { it.redraw() }

  private fun secure(activity: Activity) {
    val window = activity.window ?: return
    if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE == 0) {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      secured = WeakReference(activity)
    }
  }

  private fun unsecure() {
    secured?.get()?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    secured = null
  }
}

/**
 * The piece that draws one word of the seed phrase: the word at its position, while the seed phrase is open, and
 * nothing otherwise. The app lays the pieces out and draws what is around them; the letters are drawn here.
 */
class ArkKeystoreSeedPhraseWordView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** The text is laid out by Android when it changes: React Native lays out only what it placed itself. */
  override val shouldUseAndroidLayout = true

  internal val style = SeedPhraseTextStyle()
  var position = 0
  private val label = TextView(context).apply { maxLines = 1 }

  init {
    addView(label, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    applyProps()
  }

  /** Draws with the style and at the position the app has set. */
  fun applyProps() {
    style.apply(label, context)
    redraw()
  }

  fun redraw() {
    val word = SeedPhraseShown.word(position)
    label.text = word
    // A screen reader reads the word; the number beside it is the app's to say.
    label.importantForAccessibility = if (word.isEmpty()) View.IMPORTANT_FOR_ACCESSIBILITY_NO else View.IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    SeedPhraseShown.attach(this)
    redraw()
  }

  override fun onDetachedFromWindow() {
    SeedPhraseShown.detach(this)
    super.onDetachedFromWindow()
  }
}
