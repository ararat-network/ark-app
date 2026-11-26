import ExpoModulesCore
import UIKit

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
// typed are offered, and a word is taken by choosing one, or by the return key
// or a space once the letters name a single word. When a word is taken the
// entry moves on to the next position here and at once: the letters a member
// types next are the next word's, however long the app takes to hear of it.
final class SeedPhraseEntry {
  static let shared = SeedPhraseEntry()

  /// How many of the list's words are offered at most.
  static let offered = 8

  /// Told as the word being typed changes, and when a word is taken: positions and counts, and never a letter.
  var onChange: (([String: Any]) -> Void)?
  var onWord: (([String: Any]) -> Void)?

  /// What is entered at each position: a word of the list, or nothing yet.
  private var entered = [String?](repeating: nil, count: Int(ARK_WORD_COUNT))
  private(set) var position = 0
  private var suggestions: [String] = []
  private let fields = NSHashTable<ArkKeystoreSeedPhraseFieldView>.weakObjects()
  private let suggestionPieces = NSHashTable<ArkKeystoreSeedPhraseSuggestionView>.weakObjects()

  private init() {}

  // MARK: - The pieces on the screen

  func attach(_ field: ArkKeystoreSeedPhraseFieldView) {
    fields.add(field)
    field.show(entered[position] ?? "")
  }

  /// The field has left the screen. With none left the entry is over, and what was entered is not kept.
  func detach(_ field: ArkKeystoreSeedPhraseFieldView) {
    fields.remove(field)
    DispatchQueue.main.async {
      if self.fields.allObjects.isEmpty { self.clear() }
    }
  }

  func attach(_ piece: ArkKeystoreSeedPhraseSuggestionView) {
    suggestionPieces.add(piece)
  }

  func detach(_ piece: ArkKeystoreSeedPhraseSuggestionView) {
    suggestionPieces.remove(piece)
  }

  /// The word offered at a place among those that begin with what is typed, or nil where there are fewer.
  func suggestion(at index: Int) -> String? {
    index >= 0 && index < suggestions.count ? suggestions[index] : nil
  }

  // MARK: - Typing

  /// The field's text changed to this.
  func typed(_ text: String) {
    // What is in the field is no longer the word that was taken here, so nothing is entered here until one is.
    if entered[position] != nil, entered[position] != text {
      entered[position] = nil
    }
    let found = beginning(text)
    offer(found.words)
    onChange?(["position": position, "typing": text.isEmpty ? "empty" : (found.count > 0 ? "typing" : "unknown"), "suggestions": found.words.count])
  }

  /// Takes what is typed as the word at this position, when its letters name one word of the list: the only word
  /// that begins with them, or a word in itself that also begins others, as `act` begins `action`.
  @discardableResult
  func take(_ text: String) -> Bool {
    let found = beginning(text)
    guard let first = found.words.first, found.count == 1 || first == text.lowercased() else { return false }
    accept(first)
    return true
  }

  /// Takes a word at this position and moves on to the next.
  func accept(_ word: String) {
    let taken = position
    entered[taken] = word
    position = min(taken + 1, entered.count - 1)
    offer([])
    showInFields(position == taken ? word : (entered[position] ?? ""))
    onWord?(["position": taken, "next": position, "entered": entered.filter { $0 != nil }.count])
  }

  /// Moves to a position: the field then holds the word entered there.
  func move(to asked: Int) {
    let next = min(max(asked, 0), entered.count - 1)
    guard next != position else { return }
    position = next
    offer([])
    showInFields(entered[position] ?? "")
  }

  /// Forgets everything entered, and goes back to the first position.
  func clear() {
    entered = [String?](repeating: nil, count: entered.count)
    position = 0
    offer([])
    showInFields("")
  }

  /// Enters a whole seed phrase at once: for a development build's checks, where nothing can type.
  func fill(_ seedPhrase: String) {
    clear()
    for (index, word) in seedPhrase.split(separator: " ").prefix(entered.count).enumerated() {
      entered[index] = String(word)
    }
    showInFields(entered[position] ?? "")
  }

  /// The words of the list that begin with the letters, as many as are offered, and how many there are in all.
  private func beginning(_ letters: String) -> (count: Int, words: [String]) {
    var first: Int32 = -1
    let count = Int(letters.withCString { ark_keystore_words_beginning($0, &first) })
    guard count > 0 else { return (0, []) }
    let words = (0..<min(count, Self.offered)).compactMap { offset in
      ark_keystore_word(first + Int32(offset)).map { String(cString: $0) }
    }
    return (count, words)
  }

  private func offer(_ words: [String]) {
    suggestions = words
    suggestionPieces.allObjects.forEach { $0.redraw() }
  }

  private func showInFields(_ text: String) {
    fields.allObjects.forEach { $0.show(text) }
  }

  // MARK: - What is entered, held against the key

  /// The whole of what is entered as one text, or nil while a position holds nothing.
  private func seedPhrase() -> String? {
    let words = entered.compactMap { $0 }
    return words.count == entered.count ? words.joined(separator: " ") : nil
  }

  /// Whether what is entered is the seed phrase of the key held: `match`, `no_match`, or `incomplete`.
  func check() throws -> String {
    guard let seedPhrase = seedPhrase() else { return "incomplete" }
    return try SeedStore.matches(seedPhrase: seedPhrase) ? "match" : "no_match"
  }

  /// The positions at which what is entered is not the held key's seed phrase, after the member authenticates.
  func mistakes(reason: String, cancel: String, promise: Promise) {
    let entered = self.entered
    DispatchQueue.global(qos: .userInitiated).async {
      let opened = Result { try SeedStore.seedPhrase(reason: reason, cancel: cancel) }
      DispatchQueue.main.async {
        switch opened {
        case .failure(let failure as KeystoreFailure):
          promise.reject(keystoreException(failure))
        case .failure(let other):
          promise.reject(keystoreException(KeystoreFailure(.failed, other.localizedDescription)))
        case .success(let words):
          promise.resolve(words.indices.filter { $0 >= entered.count || entered[$0] != words[$0] })
        }
      }
    }
  }

  /// Stores the key the entered seed phrase stands for, as a new key is stored.
  func restore() throws -> SeedStore.Held {
    guard let seedPhrase = seedPhrase() else {
      throw KeystoreFailure(.invalidSeedPhrase, "fewer than \(entered.count) words are entered")
    }
    return try SeedStore.restore(seedPhrase: seedPhrase)
  }
}

/// The field a word of a seed phrase is typed into. It is the system's own, with the keyboard's suggestions,
/// corrections, and learning off: a seed phrase is not something for a keyboard to remember. What is typed goes to
/// the entry, which keeps it, and never to JavaScript.
final class ArkKeystoreSeedPhraseFieldView: ExpoView, UITextFieldDelegate {
  private let field = UITextField()
  private var style = SeedPhraseTextStyle(fontSize: 24, fontWeight: .medium)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    field.delegate = self
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.spellCheckingType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.smartInsertDeleteType = .no
    field.keyboardType = .asciiCapable
    field.returnKeyType = .next
    field.textContentType = nil
    field.adjustsFontForContentSizeCategory = true
    field.addTarget(self, action: #selector(typed), for: .editingChanged)
    field.translatesAutoresizingMaskIntoConstraints = false
    addSubview(field)
    NSLayoutConstraint.activate([
      field.topAnchor.constraint(equalTo: topAnchor),
      field.bottomAnchor.constraint(equalTo: bottomAnchor),
      field.leadingAnchor.constraint(equalTo: leadingAnchor),
      field.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    applyProps()
  }

  func update(_ change: (inout SeedPhraseTextStyle) -> Void) {
    change(&style)
  }

  func applyProps() {
    field.textColor = style.color ?? .label
    field.font = style.font
    field.textAlignment = style.alignment
  }

  func focus() {
    field.becomeFirstResponder()
  }

  /// The entry's word at its position, set here and not typed.
  func show(_ text: String) {
    field.text = text
  }

  /// A space ends a word, as it does on paper, and is never typed into the field: it is taken here, before the
  /// field changes, as the return key is. Nothing with a space in it is taken, a pasted seed phrase among them.
  func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
    guard string.contains(where: { $0.isWhitespace }) else { return true }
    SeedPhraseEntry.shared.take((textField.text ?? "").trimmingCharacters(in: .whitespaces))
    return false
  }

  @objc private func typed() {
    SeedPhraseEntry.shared.typed(field.text ?? "")
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    SeedPhraseEntry.shared.take((textField.text ?? "").trimmingCharacters(in: .whitespaces))
    return false
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      SeedPhraseEntry.shared.attach(self)
    } else {
      SeedPhraseEntry.shared.detach(self)
    }
  }
}

/// The piece that draws one of the list's words that begin with what is typed: the one at its place among them, and
/// nothing where there are fewer. Touched, it is taken as the word. The app lays the pieces out; the word is drawn
/// here.
final class ArkKeystoreSeedPhraseSuggestionView: ExpoView {
  private let button = UIButton(type: .system)
  private var style = SeedPhraseTextStyle()
  var index = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.titleLabel?.adjustsFontSizeToFitWidth = true
    button.titleLabel?.minimumScaleFactor = 0.6
    button.addTarget(self, action: #selector(chosen), for: .touchUpInside)
    button.translatesAutoresizingMaskIntoConstraints = false
    addSubview(button)
    NSLayoutConstraint.activate([
      button.topAnchor.constraint(equalTo: topAnchor),
      button.bottomAnchor.constraint(equalTo: bottomAnchor),
      button.leadingAnchor.constraint(equalTo: leadingAnchor),
      button.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    applyProps()
  }

  func update(_ change: (inout SeedPhraseTextStyle) -> Void) {
    change(&style)
  }

  func applyProps() {
    button.setTitleColor(style.color ?? .label, for: .normal)
    button.titleLabel?.font = style.font
    switch style.alignment {
    case .left: button.contentHorizontalAlignment = .left
    case .right: button.contentHorizontalAlignment = .right
    default: button.contentHorizontalAlignment = .center
    }
    redraw()
  }

  func redraw() {
    let word = SeedPhraseEntry.shared.suggestion(at: index)
    button.setTitle(word ?? "", for: .normal)
    // With no word to offer the piece draws nothing and takes no touch, and keeps its place.
    button.isHidden = word == nil
  }

  @objc private func chosen() {
    if let word = SeedPhraseEntry.shared.suggestion(at: index) {
      SeedPhraseEntry.shared.accept(word)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      SeedPhraseEntry.shared.attach(self)
      redraw()
    } else {
      SeedPhraseEntry.shared.detach(self)
    }
  }
}
