// The JNI entry for NativeCheckModule.reverse: copies the bytes in, calls the
// C both platforms share, and hands back a new array.
#include <jni.h>
#include <stdlib.h>

#include "ark_check.h"

JNIEXPORT jbyteArray JNICALL
Java_network_ararat_ark_nativecheck_NativeCheckModule_reverseNative(JNIEnv *env, jobject self, jbyteArray input) {
  (void)self;
  jsize length = (*env)->GetArrayLength(env, input);
  jbyteArray result = (*env)->NewByteArray(env, length);
  if (result == NULL || length == 0) {
    return result;
  }
  jbyte *source = (*env)->GetByteArrayElements(env, input, NULL);
  if (source == NULL) {
    return NULL;
  }
  uint8_t *reversed = malloc((size_t)length);
  if (reversed == NULL) {
    (*env)->ReleaseByteArrayElements(env, input, source, JNI_ABORT);
    return NULL;
  }
  ark_check_reverse((const uint8_t *)source, reversed, (size_t)length);
  (*env)->SetByteArrayRegion(env, result, 0, length, (const jbyte *)reversed);
  free(reversed);
  (*env)->ReleaseByteArrayElements(env, input, source, JNI_ABORT);
  return result;
}
