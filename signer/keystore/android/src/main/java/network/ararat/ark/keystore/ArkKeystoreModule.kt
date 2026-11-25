package network.ararat.ark.keystore

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The keystore's Android side. Today it holds one call, the core's
// self-check: the key's storage, and signing behind the member's
// authentication, join it as they are built. No call here takes or returns a
// seed or a key.
class ArkKeystoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArkKeystore")

    // Whether the C core, as built into this app, derives the key and makes the signature a fixed seed must give.
    // The answer is written to the system log too, which is how a build is checked with nobody watching the screen.
    Function("selfCheck") {
      val passed = selfCheckNative()
      Log.i("ArkKeystore", "ark-keystore self-check=" + (if (passed) 1 else 0))
      passed
    }
  }

  private external fun selfCheckNative(): Boolean

  companion object {
    init {
      System.loadLibrary("arkkeystore")
    }
  }
}
