// The C both platforms compile: Swift calls it directly and Kotlin through
// JNI. It stands where the keystore's C will, so the app's first build proves
// that one C source reaches both platforms and that bytes pass through whole.
#ifndef ARK_CHECK_H
#define ARK_CHECK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Writes the `length` bytes of `input` to `output` in reverse order. The two
// must not overlap, and `output` must hold `length` bytes.
void ark_check_reverse(const uint8_t *input, uint8_t *output, size_t length);

#ifdef __cplusplus
}
#endif

#endif
