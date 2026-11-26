// The JNI entries for the keystore's Kotlin (Core.kt). Each hands bytes to
// the C core and hands its answer back. A seed crosses as a Java array, the
// only form Android's own cipher takes or gives; here it is copied to the
// stack, used, and wiped, and Kotlin zeroes the array.
#include <jni.h>
#include <stdlib.h>

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

// The seed's 24 words into the array, as ASCII with a terminator.
JNIEXPORT jboolean JNICALL
Java_network_ararat_ark_keystore_Core_seedPhraseNative(JNIEnv *env, jobject self, jbyteArray seed, jbyteArray words) {
  (void)self;
  uint8_t held[ARK_SEED_LENGTH];
  char made[ARK_SEED_PHRASE_SIZE];
  if (!has_length(env, seed, ARK_SEED_LENGTH) || !has_length(env, words, ARK_SEED_PHRASE_SIZE)) return JNI_FALSE;
  (*env)->GetByteArrayRegion(env, seed, 0, ARK_SEED_LENGTH, (jbyte *)held);
  int ok = ark_keystore_seed_phrase(held, made);
  ark_keystore_wipe(held, sizeof held);
  if (ok) (*env)->SetByteArrayRegion(env, words, 0, ARK_SEED_PHRASE_SIZE, (const jbyte *)made);
  ark_keystore_wipe(made, sizeof made);
  return ok ? JNI_TRUE : JNI_FALSE;
}

// Reads a text as a seed's words: the core's answer, with the seed and its public key written when it is
// ARK_SEED_PHRASE_OK. A text longer than any 24 words could be is not read.
JNIEXPORT jint JNICALL
Java_network_ararat_ark_keystore_Core_seedFromPhraseNative(JNIEnv *env, jobject self, jbyteArray text, jbyteArray seed, jbyteArray public_key) {
  (void)self;
  uint8_t made[ARK_SEED_LENGTH];
  uint8_t made_public[ARK_PUBLIC_KEY_LENGTH];
  if (text == NULL || !has_length(env, seed, ARK_SEED_LENGTH) || !has_length(env, public_key, ARK_PUBLIC_KEY_LENGTH)) return ARK_SEED_PHRASE_UNKNOWN;
  jsize length = (*env)->GetArrayLength(env, text);
  if (length > 4096) return ARK_SEED_PHRASE_TOO_MANY;
  char *copy = malloc((size_t)length + 1);
  if (copy == NULL) return ARK_SEED_PHRASE_UNKNOWN;
  (*env)->GetByteArrayRegion(env, text, 0, length, (jbyte *)copy);
  copy[length] = '\0';
  int status = ark_keystore_seed_from_phrase(copy, made, NULL, NULL);
  ark_keystore_wipe(copy, (size_t)length + 1);
  free(copy);
  if (status == ARK_SEED_PHRASE_OK && !ark_keystore_public_key(made, made_public)) status = ARK_SEED_PHRASE_UNKNOWN;
  if (status == ARK_SEED_PHRASE_OK) {
    (*env)->SetByteArrayRegion(env, seed, 0, ARK_SEED_LENGTH, (const jbyte *)made);
    (*env)->SetByteArrayRegion(env, public_key, 0, ARK_PUBLIC_KEY_LENGTH, (const jbyte *)made_public);
  }
  ark_keystore_wipe(made, sizeof made);
  return status;
}

// How many words of the list begin with the letters, and where the first of them is in the list.
JNIEXPORT jintArray JNICALL
Java_network_ararat_ark_keystore_Core_wordsBeginningNative(JNIEnv *env, jobject self, jbyteArray letters) {
  (void)self;
  char copy[16];
  jint answer[2] = {0, -1};
  jsize length = letters == NULL ? 0 : (*env)->GetArrayLength(env, letters);
  // Longer than any word of the list begins nothing, and is not read.
  if (length > 0 && (size_t)length < sizeof copy) {
    int first = -1;
    (*env)->GetByteArrayRegion(env, letters, 0, length, (jbyte *)copy);
    copy[length] = '\0';
    answer[0] = ark_keystore_words_beginning(copy, &first);
    answer[1] = first;
    ark_keystore_wipe(copy, sizeof copy);
  }
  jintArray found = (*env)->NewIntArray(env, 2);
  if (found != NULL) (*env)->SetIntArrayRegion(env, found, 0, 2, answer);
  return found;
}

// The word at a place in the list, or null where the list has none. The list is published, and no secret.
JNIEXPORT jstring JNICALL
Java_network_ararat_ark_keystore_Core_wordNative(JNIEnv *env, jobject self, jint index) {
  (void)self;
  const char *word = ark_keystore_word(index);
  return word == NULL ? NULL : (*env)->NewStringUTF(env, word);
}
