// The JNI entries for the keystore's Kotlin (Core.kt). Each hands bytes to
// the C core and hands its answer back. A seed crosses as a Java array, the
// only form Android's own cipher takes or gives; here it is copied to the
// stack, used, and wiped, and Kotlin zeroes the array.
#include <jni.h>

#include "ark_keystore.h"

static int has_length(JNIEnv *env, jbyteArray array, jsize length) {
  return array != NULL && (*env)->GetArrayLength(env, array) == length;
}

JNIEXPORT jboolean JNICALL
Java_network_ararat_ark_keystore_Core_selfCheckNative(JNIEnv *env, jobject self) {
  (void)env;
  (void)self;
  return ark_keystore_self_check() == 1 ? JNI_TRUE : JNI_FALSE;
}

// A new seed into one array, and its public key into the other.
JNIEXPORT jboolean JNICALL
Java_network_ararat_ark_keystore_Core_generateNative(JNIEnv *env, jobject self, jbyteArray seed, jbyteArray public_key) {
  (void)self;
  uint8_t made[ARK_SEED_LENGTH];
  uint8_t made_public[ARK_PUBLIC_KEY_LENGTH];
  if (!has_length(env, seed, ARK_SEED_LENGTH) || !has_length(env, public_key, ARK_PUBLIC_KEY_LENGTH)) return JNI_FALSE;
  if (!ark_keystore_generate(made, made_public)) return JNI_FALSE;
  (*env)->SetByteArrayRegion(env, seed, 0, ARK_SEED_LENGTH, (const jbyte *)made);
  (*env)->SetByteArrayRegion(env, public_key, 0, ARK_PUBLIC_KEY_LENGTH, (const jbyte *)made_public);
  ark_keystore_wipe(made, sizeof made);
  return JNI_TRUE;
}

// A signature by the seed's key over SHA-256 of the message, into the last array.
JNIEXPORT jboolean JNICALL
Java_network_ararat_ark_keystore_Core_signNative(JNIEnv *env, jobject self, jbyteArray seed, jbyteArray message, jbyteArray signature) {
  (void)self;
  uint8_t held[ARK_SEED_LENGTH];
  uint8_t made[ARK_SIGNATURE_LENGTH];
  if (!has_length(env, seed, ARK_SEED_LENGTH) || message == NULL || !has_length(env, signature, ARK_SIGNATURE_LENGTH)) return JNI_FALSE;
  jsize length = (*env)->GetArrayLength(env, message);
  jbyte *bytes = (*env)->GetByteArrayElements(env, message, NULL);
  if (bytes == NULL) return JNI_FALSE;
  (*env)->GetByteArrayRegion(env, seed, 0, ARK_SEED_LENGTH, (jbyte *)held);
  int signed_it = ark_keystore_sign(held, (const uint8_t *)bytes, (size_t)length, made);
  ark_keystore_wipe(held, sizeof held);
  // The message is read and never written: nothing is copied back.
  (*env)->ReleaseByteArrayElements(env, message, bytes, JNI_ABORT);
  if (!signed_it) return JNI_FALSE;
  (*env)->SetByteArrayRegion(env, signature, 0, ARK_SIGNATURE_LENGTH, (const jbyte *)made);
  return JNI_TRUE;
}
