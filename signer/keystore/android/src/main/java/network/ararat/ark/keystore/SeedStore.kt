package network.ararat.ark.keystore

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.io.File
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

// The seed at rest on Android, and the one place it is opened.
//
// The seed is encrypted with AES-GCM under a key the Android Keystore makes
// and never gives up, in StrongBox where the phone has it, in one layer. The
// ciphertext is a file in the app's no-backup directory, beside the public
// key and the protection the key was made with, which are no secret: the
// directory is in no backup and on no other phone, where the Keystore's key
// would not be. The Keystore's key asks the member to authenticate for every
// use, to encrypt as to decrypt.
//
// The seed is in this process for as long as one call takes: made in C and
// encrypted, or decrypted and signed with in C. Android's cipher takes and
// gives it as a byte array, which Kotlin zeroes when the call ends; what the
// cipher copies inside itself is the system's.

internal enum class Protection(val wire: String, val byte: Byte) {
  BIOMETRIC("biometric", 1),
  PASSCODE("passcode", 2)
}

internal enum class Hardware(val wire: String, val byte: Byte) {
  SOFTWARE("software", 0),
  STRONGBOX("strongbox", 2),
  TRUSTED_ENVIRONMENT("trusted_environment", 3)
}

internal class Held(val publicKey: ByteArray, val protection: Protection, val hardware: Hardware, val invalidated: Boolean)

internal class PromptText(val title: String, val reason: String, val cancel: String)

/** Why a keystore call did not do what it was asked, by the kind JavaScript reads from its code. */
internal class KeystoreFailure(val kind: String, message: String, cause: Throwable? = null) : Exception(message, cause)

internal class SeedStore(private val context: Context) {
  private val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
  private val file = AtomicFile(File(File(context.noBackupFilesDir, "ark-keystore"), "seed"))

  /** One call that makes or opens the key at a time: a second prompt is never shown over the first. */
  private val inFlight = AtomicBoolean(false)

  // What this phone can hold

  /** The protection a key made now would have, or why none can be made. */
  fun availability(): String = try {
    protectionNow().wire
  } catch (failure: KeystoreFailure) {
    failure.kind
  }

  private fun protectionNow(): Protection {
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!keyguard.isDeviceSecure) throw KeystoreFailure("no_passcode", "the phone has no screen lock")
    if (hardwareOf(PROBE, plainSpec(PROBE)) == Hardware.SOFTWARE && !BuildConfig.ALLOW_SOFTWARE_KEYSTORE) {
      throw KeystoreFailure("no_hardware", "the phone's key store is not backed by hardware")
    }
    if (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS) return Protection.BIOMETRIC
    // A key used once per authentication takes the screen lock from Android 11 alone.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Protection.PASSCODE
    throw KeystoreFailure("no_biometrics", "no fingerprint or face of the strong class is enrolled, and this Android has no key that takes the screen lock")
  }

  // The key held

  /** The key the phone holds, or null. It asks the member for nothing. */
  fun held(): Held? {
    val record = read() ?: return null
    val cipher = openingCipher(record)
    // The operation was begun only to learn whether the key still stands. It is ended here, by asking it to finish
    // with no authentication, which it refuses: left open, each one would hold a slot in the Keystore until collected.
    cipher?.let { runCatching { it.doFinal() } }
    return Held(record.publicKey, record.protection, record.hardware, invalidated = cipher == null)
  }

  // Making the key

  fun create(activity: FragmentActivity, prompt: PromptText, done: (Result<Held>) -> Unit) = exclusively(done) { finish ->
    // A record whose Keystore key is gone or invalidated opens nothing and is replaced; any other is the member's.
    held()?.let { if (!it.invalidated) throw KeystoreFailure("exists", "a key is already held, and a key is never overwritten") }
    val protection = protectionNow()
    removeAll()

    val (key, hardware) = makeKey(protection)
    val cipher = try {
      Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }
    } catch (thrown: Throwable) {
      removeAll()
      throw thrown
    }
    authenticate(activity, prompt, protection, cipher) { authenticated ->
      finish(
        authenticated.mapCatching { unlocked ->
          val seed = ByteArray(Core.SEED_LENGTH)
          try {
            val publicKey = ByteArray(Core.PUBLIC_KEY_LENGTH)
            if (!Core.generateNative(seed, publicKey)) throw KeystoreFailure("failed", "the system's random source gave no seed")
            write(Record(publicKey, protection, hardware, unlocked.iv, unlocked.doFinal(seed)))
            Held(publicKey, protection, hardware, invalidated = false)
          } finally {
            seed.fill(0)
          }
        }.onFailure {
          // No Keystore key is left behind with no seed under it.
          runCatching { removeAll() }
        }
      )
    }
  }

  // Signing

  /** A signature by the held key over SHA-256 of the message, after the member authenticates. */
  fun sign(activity: FragmentActivity, message: ByteArray, prompt: PromptText, done: (Result<ByteArray>) -> Unit) = exclusively(done) { finish ->
    val record = read() ?: throw KeystoreFailure("no_key", "no key is held")
    val cipher = openingCipher(record) ?: throw KeystoreFailure("key_invalidated", "the Keystore no longer opens the seed: a fingerprint or face was enrolled, or the screen lock removed")
    authenticate(activity, prompt, record.protection, cipher) { authenticated ->
      finish(
        authenticated.mapCatching { unlocked ->
          val seed = unlocked.doFinal(record.wrapped)
          try {
            if (seed.size != Core.SEED_LENGTH) throw KeystoreFailure("failed", "the seed opened to ${seed.size} bytes")
            val signature = ByteArray(Core.SIGNATURE_LENGTH)
            if (!Core.signNative(seed, message, signature)) throw KeystoreFailure("failed", "the core made no signature")
            signature
          } finally {
            seed.fill(0)
          }
        }
      )
    }
  }

  // Removing

  fun remove() {
    if (!inFlight.compareAndSet(false, true)) throw KeystoreFailure("failed", "another keystore call is in flight")
    try {
      removeAll()
    } finally {
      inFlight.set(false)
    }
  }

  private fun removeAll() {
    file.delete()
    if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
  }

  /** Runs a call that ends in a callback with no other such call in flight, and ends it with a failure if it throws. */
  private fun <T> exclusively(done: (Result<T>) -> Unit, call: (finish: (Result<T>) -> Unit) -> Unit) {
    if (!inFlight.compareAndSet(false, true)) return done(Result.failure(KeystoreFailure("failed", "another keystore call is in flight")))
    val finish = { result: Result<T> ->
      inFlight.set(false)
      done(result)
    }
    try {
      call(finish)
    } catch (thrown: Throwable) {
      finish(Result.failure(thrown))
    }
  }

  // The Keystore's key

  private fun makeKey(protection: Protection): Pair<SecretKey, Hardware> {
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
    when (protection) {
      // A fingerprint or a face alone, for every use: one enrolled later invalidates the key.
      Protection.BIOMETRIC -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        // Before Android 11 a key with no validity period is this already.
        spec.setInvalidatedByBiometricEnrollment(true)
      }
      // The screen lock, or a fingerprint or face in its place, for every use: naming the screen lock is what
      // exempts the key from invalidation, so it outlasts an enrolment.
      Protection.PASSCODE -> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw KeystoreFailure("no_biometrics", "this Android has no key that takes the screen lock")
        spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
      }
    }
    val hardware = hardwareOf(ALIAS, spec)
    if (hardware == Hardware.SOFTWARE && !BuildConfig.ALLOW_SOFTWARE_KEYSTORE) {
      keyStore.deleteEntry(ALIAS)
      throw KeystoreFailure("no_hardware", "the phone's key store is not backed by hardware")
    }
    return Pair(keyStore.getKey(ALIAS, null) as SecretKey, hardware)
  }

  /** A key with nothing asked of the member, made to learn where this phone keeps keys and deleted again. */
  private fun plainSpec(alias: String) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
    .setKeySize(256)

  /**
   * Makes the key the spec describes, in StrongBox where the phone has it, and says where it is held. The probe's
   * key is deleted again; the seed's is left for its caller.
   */
  private fun hardwareOf(alias: String, spec: KeyGenParameterSpec.Builder): Hardware {
    val generate = { strongBox: Boolean ->
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).run {
        init(spec.setIsStrongBoxBacked(strongBox).build())
        generateKey()
      }
    }
    val key = if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
      try {
        generate(true)
      } catch (_: StrongBoxUnavailableException) {
        // StrongBox refuses what it cannot make, and the request is made again without it.
        generate(false)
      }
    } else {
      generate(false)
    }
    try {
      val info = SecretKeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java) as KeyInfo
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        when (info.securityLevel) {
          KeyProperties.SECURITY_LEVEL_STRONGBOX -> Hardware.STRONGBOX
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Hardware.TRUSTED_ENVIRONMENT
          else -> Hardware.SOFTWARE
        }
      } else {
        // Before Android 12 the platform says only whether the key is in hardware, and StrongBox is known by having been asked for.
        @Suppress("DEPRECATION")
        val inside = info.isInsideSecureHardware
        when {
          !inside -> Hardware.SOFTWARE
          context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE) -> Hardware.STRONGBOX
          else -> Hardware.TRUSTED_ENVIRONMENT
        }
      }
    } finally {
      if (alias == PROBE) keyStore.deleteEntry(alias)
    }
  }

  /** A cipher set to open the record's seed, waiting on the member, or null when the Keystore's key is gone or invalidated. */
  private fun openingCipher(record: Record): Cipher? {
    val key = keyStore.getKey(ALIAS, null) as? SecretKey ?: return null
    return try {
      Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, record.iv)) }
    } catch (_: KeyPermanentlyInvalidatedException) {
      null
    }
  }

  // The system's prompt

  private fun authenticate(activity: FragmentActivity, prompt: PromptText, protection: Protection, cipher: Cipher, done: (Result<Cipher>) -> Unit) {
    val info = BiometricPrompt.PromptInfo.Builder().setTitle(prompt.title).setSubtitle(prompt.reason)
    when (protection) {
      Protection.BIOMETRIC -> info.setAllowedAuthenticators(BIOMETRIC_STRONG).setNegativeButtonText(prompt.cancel)
      // With the screen lock allowed the system draws its own way out, and takes no cancel button of the app's.
      Protection.PASSCODE -> info.setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
    }
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        val unlocked = result.cryptoObject?.cipher
        done(if (unlocked != null) Result.success(unlocked) else Result.failure(KeystoreFailure("failed", "the prompt returned no cipher")))
      }

      override fun onAuthenticationError(code: Int, message: CharSequence) {
        val kind = when (code) {
          BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "locked_out"
          BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_TIMEOUT -> "authentication_failed"
          else -> "failed"
        }
        done(Result.failure(KeystoreFailure(kind, "the prompt ended with $code: $message")))
      }
      // A finger or face that did not match leaves the prompt up, and is no ending.
    }
    activity.runOnUiThread {
      try {
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(info.build(), BiometricPrompt.CryptoObject(cipher))
      } catch (thrown: Throwable) {
        done(Result.failure(thrown))
      }
    }
  }

  // The record in the no-backup directory: a version, the protection, the hardware, the public key, the nonce, and
  // the seed as the Keystore's key encrypted it.

  private class Record(val publicKey: ByteArray, val protection: Protection, val hardware: Hardware, val iv: ByteArray, val wrapped: ByteArray)

  private fun read(): Record? {
    val bytes = try {
      file.readFully()
    } catch (_: java.io.FileNotFoundException) {
      return null
    }
    val header = 3 + Core.PUBLIC_KEY_LENGTH + IV_LENGTH
    val protection = Protection.entries.firstOrNull { bytes.size > header && it.byte == bytes[1] }
    val hardware = Hardware.entries.firstOrNull { bytes.size > header && it.byte == bytes[2] }
    if (bytes.size <= header || bytes[0] != VERSION || protection == null || hardware == null) {
      throw KeystoreFailure("failed", "the stored key is in no layout this build reads")
    }
    val publicKey = bytes.copyOfRange(3, 3 + Core.PUBLIC_KEY_LENGTH)
    return Record(publicKey, protection, hardware, bytes.copyOfRange(3 + Core.PUBLIC_KEY_LENGTH, header), bytes.copyOfRange(header, bytes.size))
  }

  private fun write(record: Record) {
    file.baseFile.parentFile?.mkdirs()
    val stream = file.startWrite()
    try {
      stream.write(byteArrayOf(VERSION, record.protection.byte, record.hardware.byte))
      stream.write(record.publicKey)
      stream.write(record.iv)
      stream.write(record.wrapped)
      file.finishWrite(stream)
    } catch (thrown: Throwable) {
      file.failWrite(stream)
      throw thrown
    }
  }

  private companion object {
    const val PROVIDER = "AndroidKeyStore"
    const val ALIAS = "network.ararat.ark.keystore.seed"
    const val PROBE = "network.ararat.ark.keystore.probe"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val TAG_BITS = 128
    const val IV_LENGTH = 12

    /** The record's first byte, so that a later layout is told from this one. */
    const val VERSION: Byte = 1
  }
}
