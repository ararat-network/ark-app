import ExpoModulesCore
import UIKit

// The seed phrase, while it is shown.
//
// The seed phrase is the seed in another form, so it is opened here, in
// native code, and is never handed to JavaScript. The app asks for it to be
// opened, the member authenticates, and each word piece on the screen draws
// the word at its position. What comes back to the app is that it was opened.
//
// The words are kept here, all 24 of them whichever are drawn, until the seed
// phrase is closed: when the app asks, when the app leaves the foreground,
// when the screen starts being recorded or mirrored, and when no word piece
// is left on the screen. iOS gives an app no way to refuse a screenshot, so
// one taken while words are drawn holds those that are drawn then.
final class SeedPhraseShown {
  static let shared = SeedPhraseShown()

  /// Told when the seed phrase closes with nobody asking, and why: `background` or `capture`.
  var onClosed: ((String) -> Void)?

  private var words: [String]?
  private let pieces = NSHashTable<ArkKeystoreSeedPhraseWordView>.weakObjects()

  private init() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(leftForeground), name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(captureChanged), name: UIScreen.capturedDidChangeNotification, object: nil)
  }

  /// The word at a position, or nothing while the seed phrase is closed.
  func word(at position: Int) -> String {
    guard let words, position >= 0, position < words.count else { return "" }
    return words[position]
  }

  /// Opens the seed phrase after the member authenticates. The seed is opened off the main thread, which the
  /// system's prompt needs free, and the words are kept and drawn back on it.
  func open(reason: String, cancel: String, promise: Promise) {
    guard !isCaptured else {
      promise.reject(keystoreException(KeystoreFailure(.screenCaptured, "the screen is being recorded or mirrored")))
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      let opened = Result { try SeedStore.seedPhrase(reason: reason, cancel: cancel) }
      DispatchQueue.main.async {
        switch opened {
        case .failure(let failure as KeystoreFailure):
          promise.reject(keystoreException(failure))
        case .failure(let other):
          promise.reject(keystoreException(KeystoreFailure(.failed, other.localizedDescription)))
        case .success(let words):
          // A recording that began while the member was authenticating is as good a reason as one before it.
          guard !self.isCaptured else {
            promise.reject(keystoreException(KeystoreFailure(.screenCaptured, "the screen is being recorded or mirrored")))
            return
          }
          self.words = words
          self.redraw()
          promise.resolve(nil)
        }
      }
    }
  }

  /// Closes it. With a reason, the app is told it closed by itself.
  func close(reason: String? = nil) {
    let wasOpen = words != nil
    words = nil
    redraw()
    if wasOpen, let reason {
      onClosed?(reason)
    }
  }

  func attach(_ piece: ArkKeystoreSeedPhraseWordView) {
    pieces.add(piece)
  }

  /// A piece has left the screen. With none left there is nothing to draw the words for, and they are not kept.
  /// It is looked at a turn later, since an app that moves through the positions may take its pieces off the screen
  /// and put others on in one go.
  func detach(_ piece: ArkKeystoreSeedPhraseWordView) {
    pieces.remove(piece)
    DispatchQueue.main.async {
      if self.pieces.allObjects.isEmpty { self.close() }
    }
  }

  private func redraw() {
    pieces.allObjects.forEach { $0.redraw() }
  }

  private var isCaptured: Bool {
    (pieces.allObjects.first?.window?.windowScene?.screen ?? UIScreen.main).isCaptured
  }

  @objc private func leftForeground() {
    close(reason: "background")
  }

  @objc private func captureChanged() {
    if isCaptured { close(reason: "capture") }
  }
}

/// The piece that draws one word of the seed phrase: the word at its position, while the seed phrase is open, and
/// nothing otherwise. The app lays the pieces out and draws what is around them; the letters are drawn here.
final class ArkKeystoreSeedPhraseWordView: ExpoView {
  private let label = UILabel()
  private var style = SeedPhraseTextStyle()
  var position = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    label.translatesAutoresizingMaskIntoConstraints = false
    label.adjustsFontForContentSizeCategory = true
    // The longest word is eight letters, and none is ever cut short: it is drawn smaller before that.
    label.adjustsFontSizeToFitWidth = true
    label.minimumScaleFactor = 0.6
    addSubview(label)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: topAnchor),
      label.bottomAnchor.constraint(equalTo: bottomAnchor),
      label.leadingAnchor.constraint(equalTo: leadingAnchor),
      label.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    applyStyle()
  }

  func update(_ change: (inout SeedPhraseTextStyle) -> Void) {
    change(&style)
  }

  /// Draws with the style and at the position the app has set.
  func applyProps() {
    applyStyle()
    redraw()
  }

  func redraw() {
    let word = SeedPhraseShown.shared.word(at: position)
    label.text = word
    // A screen reader reads the word; the number beside it is the app's to say.
    label.isAccessibilityElement = !word.isEmpty
  }

  private func applyStyle() {
    label.textColor = style.color ?? .label
    label.font = style.font
    label.textAlignment = style.alignment
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      SeedPhraseShown.shared.attach(self)
      redraw()
    } else {
      SeedPhraseShown.shared.detach(self)
    }
  }
}
