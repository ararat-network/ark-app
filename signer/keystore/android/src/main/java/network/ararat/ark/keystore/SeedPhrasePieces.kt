package network.ararat.ark.keystore

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.widget.TextView

// What the seed phrase's native pieces share: how the app says their text is
// drawn. React Native styles no native text, so each piece takes a colour, a
// size, a weight, and an alignment, and draws its text with them.
internal class SeedPhraseTextStyle(private var fontSize: Float = 17f, private var weight: Int = 400) {
  private var color: Int? = null
  private var gravity: Int = Gravity.START

  fun setColor(text: String?) {
    color = text?.let { runCatching { Color.parseColor(it) }.getOrNull() }
  }

  fun setFontSize(size: Double?, otherwise: Float = 17f) {
    fontSize = size?.toFloat()?.coerceIn(8f, 72f) ?: otherwise
  }

  fun setFontWeight(name: String?, otherwise: Int = 400) {
    weight = when (name) {
      "regular" -> 400
      "medium" -> 500
      "semibold" -> 600
      "bold" -> 700
      else -> otherwise
    }
  }

  fun setAlignment(name: String?) {
    gravity = when (name) {
      "center" -> Gravity.CENTER_HORIZONTAL
      "right" -> Gravity.END
      else -> Gravity.START
    }
  }

  /** Draws a text view's text this way: in scaled points, so that it follows the member's text size. */
  fun apply(view: TextView, context: Context) {
    view.setTextColor(color ?: themed(context, android.R.attr.textColorPrimary))
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
    view.typeface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Typeface.create(Typeface.DEFAULT, weight, false)
    } else {
      Typeface.create(Typeface.DEFAULT, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
    }
    view.gravity = gravity or Gravity.CENTER_VERTICAL
  }

  private fun themed(context: Context, attribute: Int): Int {
    val value = TypedValue()
    if (!context.theme.resolveAttribute(attribute, value, true)) return Color.BLACK
    return if (value.resourceId != 0) context.getColor(value.resourceId) else value.data
  }
}
