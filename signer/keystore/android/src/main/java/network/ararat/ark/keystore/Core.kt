package network.ararat.ark.keystore

// The C core, as Kotlin calls it. A seed is a byte array here, the only form
// Android's own cipher takes or gives, and whoever is handed one zeroes it.
internal object Core {
  const val SEED_LENGTH = 32
  const val PUBLIC_KEY_LENGTH = 33
  const val SIGNATURE_LENGTH = 64
  const val WORD_COUNT = 24

  /** The room 24 words take as ASCII with a terminator, as the core's header gives it. */
  const val SEED_PHRASE_SIZE = 216

  /** The core's answer for a text that is a seed's 24 words. */
  const val SEED_PHRASE_OK = 0

  init {
    System.loadLibrary("arkkeystore")
  }

  external fun selfCheckNative(): Boolean

  /** A new seed into one array, and its public key into the other. */
  external fun generateNative(seed: ByteArray, publicKey: ByteArray): Boolean

  /** A signature by the seed's key over SHA-256 of the message, into the last array. */
  external fun signNative(seed: ByteArray, message: ByteArray, signature: ByteArray): Boolean

  /** The seed's 24 words into the array, as ASCII with a terminator. */
  external fun seedPhraseNative(seed: ByteArray, words: ByteArray): Boolean

  /** Reads UTF-8 text as a seed's words: the core's answer, with the seed and its public key written when it is SEED_PHRASE_OK. */
  external fun seedFromPhraseNative(text: ByteArray, seed: ByteArray, publicKey: ByteArray): Int

  /** How many words of the list begin with the letters, and where the first of them is in the list: two numbers. */
  external fun wordsBeginningNative(letters: ByteArray): IntArray

  /** The word at a place in the list, or null where the list has none. */
  external fun wordNative(index: Int): String?
}
