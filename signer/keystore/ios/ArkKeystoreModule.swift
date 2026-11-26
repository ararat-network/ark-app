import ExpoModulesCore
import Foundation

// The keystore's iOS side, as JavaScript calls it. The seed's storage and
// its uses are in SeedStore.swift, and the view that draws its 24 words in
// ArkKeystoreWordsView.swift; this file turns their answers into what crosses
// to JavaScript. No call here returns a seed, a key, or the words, and in a
// build for a phone none takes them.
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

    // The protection a key made now would have, or why none can be made.
    AsyncFunction("availability") { () -> String in
      SeedStore.availability().name
    }

    // The key the phone holds, or null.
    AsyncFunction("key") { () -> [String: Any]? in
      try answering { try SeedStore.held().map(describe) }
    }

    // Makes the member's key. iOS asks for no authentication here: encrypting to the Secure Enclave's key needs
    // none, and the prompt's text is used when the key signs.
    AsyncFunction("create") { (_: KeystorePrompt) -> [String: Any] in
      try answering { describe(try SeedStore.create()) }
    }

    // A signature by the held key over SHA-256 of the message, after the member authenticates.
    AsyncFunction("sign") { (message: Data, prompt: KeystorePrompt) -> Data in
      try answering { try SeedStore.sign(message, reason: prompt.reason, cancel: prompt.cancel) }
    }

    // Destroys the Secure Enclave's key and the encrypted seed.
    AsyncFunction("remove") { () in
      try answering { try SeedStore.remove() }
    }

    #if targetEnvironment(simulator)
      // Stores the key a seed's 24 words stand for. Only a build for the Simulator has this call, which is how a
      // test loads a key it knows: no build for a phone takes words from JavaScript.
      AsyncFunction("restoreWords") { (words: String, _: KeystorePrompt) -> [String: Any] in
        try answering { describe(try SeedStore.restore(words: words)) }
      }
    #endif

    // The view that draws the key's 24 words. They are drawn by it and returned by no call.
    View(ArkKeystoreWordsView.self) {
      Events("onHide")

      Prop("wordColor") { (view: ArkKeystoreWordsView, color: String?) in
        view.setWordColor(color)
      }

      Prop("numberColor") { (view: ArkKeystoreWordsView, color: String?) in
        view.setNumberColor(color)
      }

      AsyncFunction("show") { (view: ArkKeystoreWordsView, prompt: KeystorePrompt, promise: Promise) in
        view.show(reason: prompt.reason, cancel: prompt.cancel, promise: promise)
      }

      AsyncFunction("hide") { (view: ArkKeystoreWordsView) in
        view.hide()
      }
    }
  }
}

/// The text of the system's prompt, from JavaScript's string resources.
struct KeystorePrompt: Record {
  @Field var title: String = ""
  @Field var reason: String = ""
  @Field var cancel: String = ""
}

private func describe(_ held: SeedStore.Held) -> [String: Any] {
  [
    "publicKey": held.publicKey,
    "protection": held.protection.name,
    "hardware": held.hardware.name,
    "invalidated": held.invalidated,
  ]
}

/// A failure as the error JavaScript reads the kind of from its code.
func keystoreException(_ failure: KeystoreFailure) -> Exception {
  Exception(name: "ArkKeystoreException", description: failure.reason, code: "ERR_ARK_KEYSTORE_" + failure.kind.rawValue.uppercased())
}

/// Runs a call, and turns its failure into that error.
private func answering<T>(_ call: () throws -> T) throws -> T {
  do {
    return try call()
  } catch let failure as KeystoreFailure {
    throw keystoreException(failure)
  }
}
