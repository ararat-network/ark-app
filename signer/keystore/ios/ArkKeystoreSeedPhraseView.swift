import ExpoModulesCore
import UIKit

// The view that draws the key's 24 words for the member to write down.
//
// The words are the seed in another form, so they are drawn here, by native
// code, and are never handed to JavaScript: the app places this view on its
// screen and asks it to show them, and what comes back is only that it did.
// They are in memory as the labels' text for as long as they are on screen,
// and are cleared when the app asks, when the app leaves the foreground, when
// the screen starts being recorded or mirrored, and when the view leaves its
// window. iOS gives an app no way to refuse a screenshot, so one taken while
// the words are shown holds them.
final class ArkKeystoreSeedPhraseView: ExpoView {
  /// Sent when the view clears the words itself, with why: `background` or `capture`.
  let onHide = EventDispatcher()

  private static let columns = 3
  private var words: [UILabel] = []
  private var numbers: [UILabel] = []
  private var cells: [UIView] = []
  private var shown = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    build()
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(leftForeground), name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(captureChanged), name: UIScreen.capturedDidChangeNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: - Showing and hiding

  /// Draws the words after the member authenticates. The seed is opened off the main thread, which the system's
  /// prompt needs free, and the words are drawn back on it.
  func show(reason: String, cancel: String, promise: Promise) {
    guard !isCaptured else {
      promise.reject(keystoreException(KeystoreFailure(.screenCaptured, "the screen is being recorded or mirrored")))
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let opened = Result { try SeedStore.seedPhrase(reason: reason, cancel: cancel) }
      DispatchQueue.main.async {
        switch opened {
        case .failure(let failure as KeystoreFailure):
          promise.reject(keystoreException(failure))
        case .failure(let other):
          promise.reject(keystoreException(KeystoreFailure(.failed, other.localizedDescription)))
        case .success(let opened):
          guard let self, self.window != nil else {
            promise.reject(keystoreException(KeystoreFailure(.failed, "the view that draws the words left the screen")))
            return
          }
          // A recording that began while the member was authenticating is as good a reason as one before it.
          guard !self.isCaptured else {
            promise.reject(keystoreException(KeystoreFailure(.screenCaptured, "the screen is being recorded or mirrored")))
            return
          }
          self.draw(opened)
          promise.resolve(nil)
        }
      }
    }
  }

  /// Clears the words. With a reason, the app is told the view did it itself.
  func hide(reason: String? = nil) {
    let wasShown = shown
    shown = false
    for (index, label) in words.enumerated() {
      label.text = ""
      cells[index].accessibilityLabel = "\(index + 1)"
    }
    if wasShown, let reason {
      onHide(["reason": reason])
    }
  }

  private func draw(_ opened: [String]) {
    for (index, label) in words.enumerated() {
      let word = index < opened.count ? opened[index] : ""
      label.text = word
      cells[index].accessibilityLabel = "\(index + 1), \(word)"
    }
    shown = true
  }

  private var isCaptured: Bool {
    (window?.windowScene?.screen ?? UIScreen.main).isCaptured
  }

  @objc private func leftForeground() {
    hide(reason: "background")
  }

  @objc private func captureChanged() {
    if isCaptured { hide(reason: "capture") }
  }

  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil { hide() }
  }

  // MARK: - What the app chooses of how they look

  func setWordColor(_ color: String?) {
    let chosen = Self.color(color) ?? .label
    words.forEach { $0.textColor = chosen }
  }

  func setNumberColor(_ color: String?) {
    let chosen = Self.color(color) ?? .secondaryLabel
    numbers.forEach { $0.textColor = chosen }
  }

  /// A colour as "#RRGGBB", or nil where the app names none or one that is no colour.
  private static func color(_ text: String?) -> UIColor? {
    guard let text, text.count == 7, text.hasPrefix("#"), let value = UInt32(text.dropFirst(), radix: 16) else { return nil }
    return UIColor(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
  }

  // MARK: - The grid

  /// 24 numbered cells in three columns, read down each column, as the sheets the words are written on are.
  private func build() {
    let count = Int(ARK_WORD_COUNT)
    let rows = count / Self.columns
    let grid = UIStackView()
    grid.axis = .horizontal
    grid.distribution = .fillEqually
    grid.spacing = 12
    grid.translatesAutoresizingMaskIntoConstraints = false
    addSubview(grid)
    NSLayoutConstraint.activate([
      grid.topAnchor.constraint(equalTo: topAnchor),
      grid.bottomAnchor.constraint(equalTo: bottomAnchor),
      grid.leadingAnchor.constraint(equalTo: leadingAnchor),
      grid.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    for column in 0..<Self.columns {
      let stack = UIStackView()
      stack.axis = .vertical
      stack.distribution = .fillEqually
      grid.addArrangedSubview(stack)
      for row in 0..<rows {
        let index = column * rows + row

        let number = UILabel()
        number.text = "\(index + 1)"
        number.textAlignment = .right
        number.textColor = .secondaryLabel
        number.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .monospacedDigitSystemFont(ofSize: 13, weight: .regular))
        number.adjustsFontForContentSizeCategory = true
        number.isAccessibilityElement = false
        number.setContentHuggingPriority(.required, for: .horizontal)
        number.widthAnchor.constraint(greaterThanOrEqualToConstant: 20).isActive = true

        let word = UILabel()
        word.textColor = .label
        word.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 16, weight: .medium))
        word.adjustsFontForContentSizeCategory = true
        // The longest word is eight letters, and none is ever cut short: it is drawn smaller before that.
        word.adjustsFontSizeToFitWidth = true
        word.minimumScaleFactor = 0.6
        word.isAccessibilityElement = false

        let cell = UIStackView(arrangedSubviews: [number, word])
        cell.axis = .horizontal
        cell.spacing = 6
        cell.alignment = .firstBaseline
        cell.isAccessibilityElement = true
        cell.accessibilityLabel = "\(index + 1)"
        stack.addArrangedSubview(cell)

        words.append(word)
        numbers.append(number)
        cells.append(cell)
      }
    }
  }
}
