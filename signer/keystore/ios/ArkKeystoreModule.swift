import ExpoModulesCore
import Foundation

// The keystore's iOS side, as JavaScript calls it. The seed's storage and
// its uses are in SeedStore.swift, the seed phrase while it is shown in
// SeedPhraseShown.swift, and one being entered in SeedPhraseEntry.swift; this
// file turns their answers into what crosses to JavaScript. No call here
// returns a seed, a key, or a word of the seed phrase, and in a build for a
// phone none takes one.
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

    // What the module tells the app with nobody asking. None carries a word or a letter of one.
    Events("onSeedPhraseClosed", "onEntryChange", "onEntryWord")

    OnCreate {
      SeedPhraseShown.shared.onClosed = { [weak self] reason in
        self?.sendEvent("onSeedPhraseClosed", ["reason": reason])
      }
      SeedPhraseEntry.shared.onChange = { [weak self] change in
        self?.sendEvent("onEntryChange", change)
      }
      SeedPhraseEntry.shared.onWord = { [weak self] word in
        self?.sendEvent("onEntryWord", word)
      }
    }

    // Opens the held key's seed phrase, after the member authenticates, for the word pieces on the screen to draw.
    // It returns no word.
    AsyncFunction("openSeedPhrase") { (prompt: KeystorePrompt, promise: Promise) in
      SeedPhraseShown.shared.open(reason: prompt.reason, cancel: prompt.cancel, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("closeSeedPhrase") { () in
      SeedPhraseShown.shared.close()
    }.runOnQueue(.main)

    // The entry of a seed phrase: where it is, and what is entered, held against the key. What is entered is
    // returned by no call.
    AsyncFunction("moveEntry") { (position: Int) in
      SeedPhraseEntry.shared.move(to: position)
    }.runOnQueue(.main)

    AsyncFunction("checkEntry") { () -> String in
      try answering { try SeedPhraseEntry.shared.check() }
    }.runOnQueue(.main)

    AsyncFunction("entryMistakes") { (prompt: KeystorePrompt, promise: Promise) in
      SeedPhraseEntry.shared.mistakes(reason: prompt.reason, cancel: prompt.cancel, promise: promise)
    }.runOnQueue(.main)

    // Stores the key what is entered stands for. iOS asks for no authentication here, as it asks for none to make
    // a key.
    AsyncFunction("restoreFromEntry") { (_: KeystorePrompt) -> [String: Any] in
      try answering { describe(try SeedPhraseEntry.shared.restore()) }
    }.runOnQueue(.main)

    AsyncFunction("clearEntry") { () in
      SeedPhraseEntry.shared.clear()
    }.runOnQueue(.main)

    #if targetEnvironment(simulator)
      // The two calls that take a seed phrase from JavaScript: one stores a key from it, and one enters it whole.
      // Only a build for the Simulator has them, where a test loads a key it knows and nothing can type into the
      // field. No build for a phone takes a seed phrase from JavaScript.
      AsyncFunction("restoreSeedPhrase") { (seedPhrase: String, _: KeystorePrompt) -> [String: Any] in
        try answering { describe(try SeedStore.restore(seedPhrase: seedPhrase)) }
      }

      AsyncFunction("fillEntry") { (seedPhrase: String) in
        SeedPhraseEntry.shared.fill(seedPhrase)
      }.runOnQueue(.main)
    #endif

    // The piece that draws one word of the seed phrase, while it is open.
    View(ArkKeystoreSeedPhraseWordView.self) {
      Prop("position") { (view: ArkKeystoreSeedPhraseWordView, position: Int?) in
        view.position = position ?? 0
      }

      Prop("color") { (view: ArkKeystoreSeedPhraseWordView, color: String?) in
        view.update { $0.setColor(color) }
      }

      Prop("fontSize") { (view: ArkKeystoreSeedPhraseWordView, size: Double?) in
        view.update { $0.setFontSize(size) }
      }

      Prop("fontWeight") { (view: ArkKeystoreSeedPhraseWordView, weight: String?) in
        view.update { $0.setFontWeight(weight) }
      }

      Prop("textAlign") { (view: ArkKeystoreSeedPhraseWordView, alignment: String?) in
        view.update { $0.setAlignment(alignment) }
      }

      OnViewDidUpdateProps { (view: ArkKeystoreSeedPhraseWordView) in
        view.applyProps()
      }
    }

    // The field a word of a seed phrase is typed into.
    View(ArkKeystoreSeedPhraseFieldView.self) {
      Prop("color") { (view: ArkKeystoreSeedPhraseFieldView, color: String?) in
        view.update { $0.setColor(color) }
      }

      Prop("fontSize") { (view: ArkKeystoreSeedPhraseFieldView, size: Double?) in
        view.update { $0.setFontSize(size ?? 24) }
      }

      Prop("fontWeight") { (view: ArkKeystoreSeedPhraseFieldView, weight: String?) in
        view.update { $0.setFontWeight(weight ?? "medium") }
      }

      Prop("textAlign") { (view: ArkKeystoreSeedPhraseFieldView, alignment: String?) in
        view.update { $0.setAlignment(alignment) }
      }

      OnViewDidUpdateProps { (view: ArkKeystoreSeedPhraseFieldView) in
        view.applyProps()
      }

      AsyncFunction("focus") { (view: ArkKeystoreSeedPhraseFieldView) in
        view.focus()
      }
    }

    // The piece that draws one of the list's words that begin with what is typed, and takes it when touched.
    View(ArkKeystoreSeedPhraseSuggestionView.self) {
      Prop("index") { (view: ArkKeystoreSeedPhraseSuggestionView, index: Int?) in
        view.index = index ?? 0
      }

      Prop("color") { (view: ArkKeystoreSeedPhraseSuggestionView, color: String?) in
        view.update { $0.setColor(color) }
      }

      Prop("fontSize") { (view: ArkKeystoreSeedPhraseSuggestionView, size: Double?) in
        view.update { $0.setFontSize(size) }
      }

      Prop("fontWeight") { (view: ArkKeystoreSeedPhraseSuggestionView, weight: String?) in
        view.update { $0.setFontWeight(weight) }
      }

      Prop("textAlign") { (view: ArkKeystoreSeedPhraseSuggestionView, alignment: String?) in
        view.update { $0.setAlignment(alignment) }
      }

      OnViewDidUpdateProps { (view: ArkKeystoreSeedPhraseSuggestionView) in
        view.applyProps()
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
