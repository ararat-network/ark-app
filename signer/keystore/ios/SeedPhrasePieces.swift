import ExpoModulesCore
import UIKit

// What the seed phrase's native pieces share: how the app says their text is
// drawn. React Native styles no native text, so each piece takes a colour, a
// size, a weight, and an alignment, and draws its text with them.
struct SeedPhraseTextStyle {
  var color: UIColor?
  var fontSize: CGFloat = 17
  var fontWeight: UIFont.Weight = .regular
  var alignment: NSTextAlignment = .natural

  /// The font, scaled with the member's text size.
  var font: UIFont {
    UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: fontSize, weight: fontWeight))
  }

  mutating func setColor(_ text: String?) {
    color = hexColor(text)
  }

  mutating func setFontSize(_ size: Double?) {
    fontSize = size.map { CGFloat(min(max($0, 8), 72)) } ?? 17
  }

  mutating func setFontWeight(_ name: String?) {
    switch name {
    case "medium": fontWeight = .medium
    case "semibold": fontWeight = .semibold
    case "bold": fontWeight = .bold
    default: fontWeight = .regular
    }
  }

  mutating func setAlignment(_ name: String?) {
    switch name {
    case "left": alignment = .left
    case "center": alignment = .center
    case "right": alignment = .right
    default: alignment = .natural
    }
  }
}

/// A colour as "#RRGGBB", or nil where the app names none or one that is no colour.
func hexColor(_ text: String?) -> UIColor? {
  guard let text, text.count == 7, text.hasPrefix("#"), let value = UInt32(text.dropFirst(), radix: 16) else { return nil }
  return UIColor(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
}
