package network.ararat.ark.nativecheck

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The Android side of the check: bytes from JavaScript go through JNI to the
// C in native/ and come back, and each call is written to the system log,
// which is how a build is shown to have called native code with nobody
// watching the screen.
class NativeCheckModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeCheck")

    Function("reverse") { input: ByteArray ->
      val output = reverseNative(input)
      Log.i("ArkNativeCheck", "ark-native-check reversed=" + output.joinToString("") { "%02x".format(it) })
      output
    }
  }

  private external fun reverseNative(input: ByteArray): ByteArray

  companion object {
    init {
      System.loadLibrary("arknativecheck")
    }
  }
}
