// The steps inside the core, named so that a test can try each alone. Nothing
// outside this directory includes this file: the native modules reach the
// core through ark_keystore.h alone, which takes a seed and never a key.
#ifndef ARK_KEYSTORE_INTERNAL_H
#define ARK_KEYSTORE_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#define ARK_PRIVATE_KEY_LENGTH 32
// 24 words of at most 8 letters, 23 spaces, and the terminator.
#define ARK_MNEMONIC_SIZE (24 * 8 + 23 + 1)

// The 24 words of a seed, as one string with a space between each.
void ark_mnemonic_from_seed(const uint8_t seed[32], char mnemonic[ARK_MNEMONIC_SIZE]);

// The private key at m/44'/330'/0'/0/0 of a seed's words, with no passphrase.
int ark_private_key_from_seed(const uint8_t seed[32], uint8_t private_key[ARK_PRIVATE_KEY_LENGTH]);

int ark_public_key_of(const uint8_t private_key[ARK_PRIVATE_KEY_LENGTH], uint8_t public_key[33]);

int ark_sign_with_key(const uint8_t private_key[ARK_PRIVATE_KEY_LENGTH], const uint8_t *message, size_t length, uint8_t signature[64]);

#endif
