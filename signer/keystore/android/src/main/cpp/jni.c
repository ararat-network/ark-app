// The JNI entries for ArkKeystoreModule. Each hands bytes to the C core and
// hands its answer back; nothing of a seed or a key is kept on this side.
#include <jni.h>

#include "ark_keystore.h"

JNIEXPORT jboolean JNICALL
Java_network_ararat_ark_keystore_ArkKeystoreModule_selfCheckNative(JNIEnv *env, jobject self) {
  (void)env;
  (void)self;
  return ark_keystore_self_check() == 1 ? JNI_TRUE : JNI_FALSE;
}
