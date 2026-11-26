package network.ararat.ark.keystore

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// The view that draws the key's 24 words for the member to write down.
//
// The words are the seed in another form, so they are drawn here, by native
// code, and are never handed to JavaScript: the app places this view on its
// screen and asks it to show them, and what comes back is only that it did.
// They are in memory as the text views' text for as long as they are on
// screen, and are cleared when the app asks, when the app's window stops
// being shown, and when the view leaves its window. While they are drawn the
// window is marked secure, so that the system leaves them out of screenshots,
// recordings, and the picture of the app among recent apps.
class ArkKeystoreWordsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Sent when the view clears the words itself, with why: `background`. */
  val onHide by EventDispatcher()

  private val words = ArrayList<TextView>(Core.WORD_COUNT)
  private val numbers = ArrayList<TextView>(Core.WORD_COUNT)
  private val cells = ArrayList<View>(Core.WORD_COUNT)
  private var shown = false

  /** Whether this view marked the window secure, so that it clears only a mark of its own. */
  private var securedWindow = false

  init {
    build()
  }

  // Showing and hiding

  /** Draws the words after the member authenticates. */
  internal fun show(prompt: PromptText, promise: Promise) {
    val activity = appContext.currentActivity as? FragmentActivity
      ?: return promise.reject(coded(KeystoreFailure("failed", "the app has no screen to show the prompt over")))
    SeedStore.of(context).words(activity, prompt) { opened ->
      post {
        opened.fold(
          { list ->
            if (!isAttachedToWindow) {
              promise.reject(coded(KeystoreFailure("failed", "the view that draws the words left the screen")))
            } else {
              draw(list)
              promise.resolve(null)
            }
          },
          { promise.reject(coded(it)) }
        )
      }
    }
  }

  /** Clears the words. With a reason, the app is told the view did it itself. */
  fun hide(reason: String? = null) {
    val wasShown = shown
    shown = false
    words.forEachIndexed { index, view ->
      view.text = ""
      cells[index].contentDescription = "${index + 1}"
    }
    secure(false)
    if (wasShown && reason != null) onHide(mapOf("reason" to reason))
  }

  private fun draw(list: List<String>) {
    secure(true)
    words.forEachIndexed { index, view ->
      val word = list.getOrElse(index) { "" }
      view.text = word
      cells[index].contentDescription = "${index + 1}, $word"
    }
    shown = true
  }

  private fun secure(on: Boolean) {
    val window = (appContext.currentActivity as? Activity)?.window ?: return
    if (on) {
      if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE == 0) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        securedWindow = true
      }
    } else if (securedWindow) {
      window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      securedWindow = false
    }
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != View.VISIBLE) hide("background")
  }

  override fun onDetachedFromWindow() {
    hide()
    super.onDetachedFromWindow()
  }

  // What the app chooses of how they look

  fun setWordColor(color: String?) = paint(words, color, android.R.attr.textColorPrimary)

  fun setNumberColor(color: String?) = paint(numbers, color, android.R.attr.textColorSecondary)

  /** A colour as "#RRGGBB", or the theme's own where the app names none or one that is no colour. */
  private fun paint(views: List<TextView>, color: String?, fallback: Int) {
    val parsed = color?.let { runCatching { Color.parseColor(it) }.getOrNull() } ?: themed(fallback)
    views.forEach { it.setTextColor(parsed) }
  }

  private fun themed(attribute: Int): Int {
    val value = TypedValue()
    if (!context.theme.resolveAttribute(attribute, value, true)) return Color.BLACK
    return if (value.resourceId != 0) context.getColor(value.resourceId) else value.data
  }

  // The grid

  /** 24 numbered cells in three columns, read down each column, as the sheets the words are written on are. */
  private fun build() {
    orientation = HORIZONTAL
    val rows = Core.WORD_COUNT / COLUMNS
    val gap = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 6f, resources.displayMetrics).toInt()
    for (column in 0 until COLUMNS) {
      val stack = LinearLayout(context).apply { orientation = VERTICAL }
      addView(stack, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
      for (row in 0 until rows) {
        val index = column * rows + row
        val number = TextView(context).apply {
          text = "${index + 1}"
          gravity = Gravity.END
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
          minWidth = gap * 4
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val word = TextView(context).apply {
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          maxLines = 1
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val cell = LinearLayout(context).apply {
          orientation = HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          contentDescription = "${index + 1}"
          isFocusable = true
          addView(number, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
          addView(word, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = gap })
        }
        stack.addView(cell, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        numbers.add(number)
        words.add(word)
        cells.add(cell)
      }
    }
    setWordColor(null)
    setNumberColor(null)
  }

  private companion object {
    const val COLUMNS = 3
  }
}
