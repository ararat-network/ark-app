// A command line over the core's steps, for the tests in keystore/core.test.ts
// to drive from the vectors. It is built by those tests and by nothing else:
// no native module compiles it, since it takes private keys as arguments.
//
//   cli sha256|sha512 <hex>
//   cli hmac <key hex> <data hex>
//   cli pbkdf2 <password hex> <salt hex> <iterations>
//   cli mnemonic <seed hex>
//   cli key <seed hex>               the private key the seed derives
//   cli public <seed hex>
//   cli sign <seed hex> <message hex>
//   cli sign-with-key <key hex> <message hex>
//   cli self-check
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../ark_keystore.h"
#include "../ark_keystore_internal.h"
#include "../ark_sha2.h"

static size_t unhex(const char *hex, uint8_t **out) {
  size_t length = strlen(hex) / 2;
  *out = malloc(length + 1);
  for (size_t i = 0; i < length; i++) {
    unsigned byte;
    if (sscanf(hex + 2 * i, "%2x", &byte) != 1) {
      fprintf(stderr, "not hex: %s\n", hex);
      exit(2);
    }
    (*out)[i] = (uint8_t)byte;
  }
  return length;
}

static int print_hex(const uint8_t *bytes, size_t length) {
  for (size_t i = 0; i < length; i++) printf("%02x", bytes[i]);
  printf("\n");
  return 0;
}

static const uint8_t *exactly(const char *hex, size_t want) {
  uint8_t *bytes;
  if (unhex(hex, &bytes) != want) {
    fprintf(stderr, "expected %zu bytes\n", want);
    exit(2);
  }
  return bytes;
}

int main(int argc, char **argv) {
  uint8_t out[64];
  uint8_t *a, *b;
  if (argc < 2) return 2;
  const char *command = argv[1];
  if (strcmp(command, "self-check") == 0) {
    printf("%d\n", ark_keystore_self_check());
    return 0;
  }
  if (argc < 3) return 2;
  size_t a_length = unhex(argv[2], &a);
  if (strcmp(command, "sha256") == 0) {
    ark_sha256(a, a_length, out);
    return print_hex(out, 32);
  }
  if (strcmp(command, "sha512") == 0) {
    ark_sha512(a, a_length, out);
    return print_hex(out, 64);
  }
  if (strcmp(command, "mnemonic") == 0) {
    char mnemonic[ARK_MNEMONIC_SIZE];
    ark_mnemonic_from_seed(exactly(argv[2], 32), mnemonic);
    printf("%s\n", mnemonic);
    return 0;
  }
  if (strcmp(command, "key") == 0) {
    if (!ark_private_key_from_seed(exactly(argv[2], 32), out)) return 1;
    return print_hex(out, 32);
  }
  if (strcmp(command, "public") == 0) {
    if (!ark_keystore_public_key(exactly(argv[2], 32), out)) return 1;
    return print_hex(out, 33);
  }
  if (argc < 4) return 2;
  size_t b_length = unhex(argv[3], &b);
  if (strcmp(command, "hmac") == 0) {
    ark_hmac_sha512(a, a_length, b, b_length, out);
    return print_hex(out, 64);
  }
  if (strcmp(command, "sign") == 0) {
    if (!ark_keystore_sign(exactly(argv[2], 32), b, b_length, out)) return 1;
    return print_hex(out, 64);
  }
  if (strcmp(command, "sign-with-key") == 0) {
    if (!ark_sign_with_key(exactly(argv[2], 32), b, b_length, out)) return 1;
    return print_hex(out, 64);
  }
  if (strcmp(command, "pbkdf2") == 0 && argc == 5) {
    ark_pbkdf2_hmac_sha512(a, a_length, b, b_length, (uint32_t)strtoul(argv[4], NULL, 10), out);
    return print_hex(out, 64);
  }
  return 2;
}
