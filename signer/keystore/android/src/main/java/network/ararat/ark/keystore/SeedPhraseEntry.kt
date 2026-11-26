package network.ararat.ark.keystore

import android.app.Activity
import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.views.ExpoView

// A seed phrase being entered, a word at a time.
//
// It is how a member shows at signup that they wrote their seed phrase down,
// how they check the paper against the phone later, and how their key reaches
// a new phone. What they enter is the key, so it is kept here, in native code,
// and is never handed to JavaScript: the app places the field and the words
// offered on its screen, and is told that a word was taken, at which position,
// how many are, and whether the whole is right.
//
// The field takes one word. The words of the list that begin with what is
// typed are offered, and a word is taken by choosing one, or by the keyboard's
// action key or a space once the letters name a single word. When a word is
// taken the entry moves on to the next position here and at once: the letters
// a member types next are the next word's, however long the app takes to hear
// of it.
internal object SeedPhraseEntry {
  /** How many of the list's words are offered at most. */
  const val OFFERED = 8

  /** Told as the word being typed changes, and when a word is taken: positions and counts, and never a letter. */
  var onChange: ((Map<String, Any>) -> Unit)? = null
  var onWord: ((Map<String, Any>) -> Unit)? = null

  /** What is entered at each position: a word of the list, or nothing yet. */
  private val entered = arrayOfNulls<String>(Core.WORD_COUNT)
  var position = 0
    private set
  private var suggestions: List<String> = emptyList()
  private val fields = LinkedHashSet<ArkKeystoreSeedPhraseFieldView>()
  private val suggestionPieces = LinkedHashSet<ArkKeystoreSeedPhraseSuggestionView>()

  // The pieces on the screen

  fun attach(field: ArkKeystoreSeedPhraseFieldView) {
    fields.add(field)
    field.show(entered[position] ?: "")
  }

  /** The field has left the screen. With none left the entry is over, and what was entered is not kept. */
  fun detach(field: ArkKeystoreSeedPhraseFieldView) {
    fields.remove(field)
    field.post { if (fields.isEmpty()) clear() }
  }

  fun attach(piece: ArkKeystoreSeedPhraseSuggestionView) {
    suggestionPieces.add(piece)
  }

  fun detach(piece: ArkKeystoreSeedPhraseSuggestionView) {
    suggestionPieces.remove(piece)
  }

  /** The word offered at a place among those that begin with what is typed, or null where there are fewer. */
  fun suggestion(index: Int): String? = suggestions.getOrNull(index)

  // Typing

  /** The field's text changed to this. */
  fun typed(text: String) {
    // What is in the field is no longer the word that was taken here, so nothing is entered here until one is.
    if (entered[position] != null && entered[position] != text) entered[position] = null
    val (count, words) = beginning(text)
    offer(words)
    onChange?.invoke(mapOf("position" to position, "typing" to (if (text.isEmpty()) "empty" else if (count > 0) "typing" else "unknown"), "suggestions" to words.size))
  }

  /**
   * Takes what is typed as the word at this position, when its letters name one word of the list: the only word that
   * begins with them, or a word in itself that also begins others, as `act` begins `action`.
   */
  fun take(text: String): Boolean {
    val (count, words) = beginning(text)
    val first = words.firstOrNull() ?: return false
    if (count != 1 && first != text.lowercase()) return false
    accept(first)
    return true
  }

  /** Takes a word at this position and moves on to the next. */
  fun accept(word: String) {
    val taken = position
    entered[taken] = word
    position = minOf(taken + 1, entered.size - 1)
    offer(emptyList())
    showInFields(if (position == taken) word else entered[position] ?: "")
    onWord?.invoke(mapOf("position" to taken, "next" to position, "entered" to entered.count { it != null }))
  }

  /** Moves to a position: the field then holds the word entered there. */
  fun move(asked: Int) {
    val next = asked.coerceIn(0, entered.size - 1)
    if (next == position) return
    position = next
    offer(emptyList())
    showInFields(entered[position] ?: "")
  }

  /** Forgets everything entered, and goes back to the first position. */
  fun clear() {
    entered.fill(null)
    position = 0
    offer(emptyList())
    showInFields("")
  }

  /** Enters a whole seed phrase at once: for a development build's checks, where nothing types. */
  fun fill(seedPhrase: String) {
    clear()
    seedPhrase.split(' ').take(entered.size).forEachIndexed { index, word -> entered[index] = word }
    showInFields(entered[position] ?: "")
  }

  /** How many words of the list begin with the letters, and as many of them as are offered. */
  private fun beginning(letters: String): Pair<Int, List<String>> {
    val found = Core.wordsBeginningNative(letters.toByteArray(Charsets.UTF_8))
    val count = found.getOrElse(0) { 0 }
    val first = found.getOrElse(1) { -1 }
    if (count <= 0 || first < 0) return Pair(0, emptyList())
    return Pair(count, (0 until minOf(count, OFFERED)).mapNotNull { Core.wordNative(first + it) })
  }

  private fun offer(words: List<String>) {
    suggestions = words
    suggestionPieces.forEach { it.redraw() }
  }

  private fun showInFields(text: String) = fields.forEach { it.show(text) }

  // What is entered, held against the key

  /** The whole of what is entered as one text, or null while a position holds nothing. */
  private fun seedPhrase(): String? = if (entered.all { it != null }) entered.joinToString(" ") else null

  /** Whether what is entered is the seed phrase of the key held: `match`, `no_match`, or `incomplete`. */
  fun check(context: Context): String {
    val seedPhrase = seedPhrase() ?: return "incomplete"
    return if (SeedStore.of(context).matches(seedPhrase)) "match" else "no_match"
  }

  /** The positions at which what is entered is not the held key's seed phrase, after the member authenticates. */
  fun mistakes(activity: FragmentActivity, context: Context, prompt: PromptText, promise: Promise) {
    val typed = entered.copyOf()
    SeedStore.of(context).seedPhrase(activity, prompt) { opened ->
      opened.fold(
        { words -> promise.resolve(words.indices.filter { typed.getOrNull(it) != words[it] }) },
        { promise.reject(coded(it)) }
      )
    }
  }

  /** Stores the key the entered seed phrase stands for, as a new key is stored. */
  fun restore(activity: FragmentActivity, context: Context, prompt: PromptText, done: (Result<Held>) -> Unit) {
    val seedPhrase = seedPhrase()
      ?: return done(Result.failure(KeystoreFailure("invalid_seed_phrase", "fewer than ${entered.size} words are entered")))
    SeedStore.of(context).restore(activity, seedPhrase, prompt, done)
  }
}

/**
 * The field a word of a seed phrase is typed into. It is the system's own, and the keyboard is asked for no
 * suggestions and no learning: a seed phrase is not something for a keyboard to remember. What is typed goes to the
 * entry, which keeps it, and never to JavaScript. While the field is on the screen the window is marked secure, so
 * that the word in it is in no screenshot or recording.
 */
class ArkKeystoreSeedPhraseFieldView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** The field is laid out by Android: React Native lays out only what it placed itself. */
  override val shouldUseAndroidLayout = true

  internal val style = SeedPhraseTextStyle(fontSize = 24f, weight = 500)
  private val field = EditText(context)

  /** Whether the field's text is being set here, and not typed: the entry is not told of it. */
  private var setting = false

  /** What the field holds, with no space in it: what it goes back to when something with a space is put in. */
  private var shown = ""
  private var securedWindow = false

  init {
    field.apply {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      imeOptions = EditorInfo.IME_ACTION_NEXT or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING or EditorInfo.IME_FLAG_NO_EXTRACT_UI
      isSingleLine = true
      importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      background = null
      setPadding(0, 0, 0, 0)
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit

        override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit

        override fun afterTextChanged(text: Editable?) {
          if (!setting) typed()
        }
      })
      setOnEditorActionListener { _, _, _ ->
        SeedPhraseEntry.take(text.toString().trim())
        true
      }
    }
    addView(field, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    applyProps()
  }

  fun applyProps() = style.apply(field, context)

  fun focus() {
    field.requestFocus()
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
  }

  /** The entry's word at its position, set here and not typed. */
  fun show(text: String) {
    setting = true
    shown = text
    field.setText(text)
    field.setSelection(field.text.length)
    setting = false
  }

  private fun typed() {
    val text = field.text.toString()
    if (text.any { it.isWhitespace() }) {
      val before = text.dropLast(1)
      if (before.none { it.isWhitespace() } && before == shown) {
        // A space typed after the letters ends the word, as it does on paper, and is never left in the field.
        show(before)
        SeedPhraseEntry.take(before)
      } else {
        // Anything else with a space in it is not taken, a pasted seed phrase among them: the field is as it was.
        show(shown)
      }
      return
    }
    shown = text
    SeedPhraseEntry.typed(text)
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

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    secure(true)
    SeedPhraseEntry.attach(this)
  }

  override fun onDetachedFromWindow() {
    SeedPhraseEntry.detach(this)
    secure(false)
    super.onDetachedFromWindow()
  }
}

/**
 * The piece that draws one of the list's words that begin with what is typed: the one at its place among them, and
 * nothing where there are fewer. Touched, it is taken as the word. The app lays the pieces out; the word is drawn
 * here.
 */
class ArkKeystoreSeedPhraseSuggestionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** The word is laid out by Android when it changes: React Native lays out only what it placed itself. */
  override val shouldUseAndroidLayout = true

  internal val style = SeedPhraseTextStyle().apply { setAlignment("center") }
  var index = 0
  private val label = TextView(context).apply {
    maxLines = 1
    isClickable = true
    isFocusable = true
    setOnClickListener { SeedPhraseEntry.suggestion(index)?.let(SeedPhraseEntry::accept) }
  }

  init {
    addView(label, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    applyProps()
  }

  fun applyProps() {
    style.apply(label, context)
    redraw()
  }

  fun redraw() {
    val word = SeedPhraseEntry.suggestion(index)
    label.text = word ?: ""
    // With no word to offer the piece draws nothing and takes no touch, and keeps its place.
    label.visibility = if (word == null) View.INVISIBLE else View.VISIBLE
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    SeedPhraseEntry.attach(this)
    redraw()
  }

  override fun onDetachedFromWindow() {
    SeedPhraseEntry.detach(this)
    super.onDetachedFromWindow()
  }
}
