package network.ararat.ark.keystore

// The C core, as Kotlin calls it. A seed is a byte array here, the only form
// Android's own cipher takes or gives, and whoever is handed one zeroes it.
internal object Core {
  const val SEED_LENGTH = 32
  const val PUBLIC_KEY_LENGTH = 33
  const val SIGNATURE_LENGTH = 64

  init {
    System.loadLibrary("arkkeystore")
  }

  external fun selfCheckNative(): Boolean

  /** A new seed into one array, and its public key into the other. */
  external fun generateNative(seed: ByteArray, publicKey: ByteArray): Boolean

  /** A signature by the seed's key over SHA-256 of the message, into the last array. */
  external fun signNative(seed: ByteArray, message: ByteArray, signature: ByteArray): Boolean
}
