import ExpoModulesCore
import Foundation

// The iOS side of the check: bytes from JavaScript go to the C in native/
// and come back, and each call is written to the system log, which is how a
// build is shown to have called native code with nobody watching the screen.
public class NativeCheckModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeCheck")

    Function("reverse") { (input: Data) -> Data in
      var output = Data(count: input.count)
      input.withUnsafeBytes { (source: UnsafeRawBufferPointer) in
        output.withUnsafeMutableBytes { (target: UnsafeMutableRawBufferPointer) in
          guard let from = source.bindMemory(to: UInt8.self).baseAddress,
                let to = target.bindMemory(to: UInt8.self).baseAddress else { return }
          ark_check_reverse(from, to, input.count)
        }
      }
      NSLog("ark-native-check reversed=%@", output.map { String(format: "%02x", $0) }.joined())
      return output
    }
  }
}
