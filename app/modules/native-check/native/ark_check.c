#include "ark_check.h"

void ark_check_reverse(const uint8_t *input, uint8_t *output, size_t length) {
  for (size_t i = 0; i < length; i++) {
    output[i] = input[length - 1 - i];
  }
}
