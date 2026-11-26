import ExpoModulesCore
import Foundation

// The keystore's iOS side. Today it holds one call, the core's self-check:
// the key's storage, and signing behind the member's authentication, join it
// as they are built. No call here takes or returns a seed or a key.
public class ArkKeystoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArkKeystore")

    // Whether the C core, as built into this app, derives the key and makes the signature a fixed seed must give.
    // The answer is written to the system log too, which is how a build is checked with nobody watching the screen.
    Function("selfCheck") { () -> Bool in
      let passed = ark_keystore_self_check() == 1
      NSLog("ark-keystore self-check=%d", passed ? 1 : 0)
      return passed
    }
  }
}
