// SHA-256, SHA-512, HMAC-SHA-512, and PBKDF2 over it: what deriving a key
// from a seed and signing with it need beside the curve. They are here, in C,
// because the seed and every value derived from it are handled in C alone,
// where memory can be zeroised, and a hash that took them through Swift or
// Kotlin would leave copies behind. Each is written from its standard and
// tested against that standard's own vectors.
#ifndef ARK_SHA2_H
#define ARK_SHA2_H

#include <stddef.h>
#include <stdint.h>

#define ARK_SHA256_LENGTH 32
#define ARK_SHA512_LENGTH 64

// Overwrites memory in a way a compiler may not remove.
void ark_zeroise(void *memory, size_t length);

void ark_sha256(const uint8_t *data, size_t length, uint8_t digest[ARK_SHA256_LENGTH]);
void ark_sha512(const uint8_t *data, size_t length, uint8_t digest[ARK_SHA512_LENGTH]);

void ark_hmac_sha512(const uint8_t *key, size_t key_length, const uint8_t *data, size_t length, uint8_t mac[ARK_SHA512_LENGTH]);

// PBKDF2 with HMAC-SHA-512, for one block of output: 64 bytes.
void ark_pbkdf2_hmac_sha512(const uint8_t *password, size_t password_length, const uint8_t *salt, size_t salt_length, uint32_t iterations,
                            uint8_t output[ARK_SHA512_LENGTH]);

#endif
