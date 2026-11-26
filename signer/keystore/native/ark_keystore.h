// The keystore's core: from the 256-bit seed to the member's key, and from
// the key to a signature. Everything that touches the seed or the key is in
// this C, where what held them is zeroised before a call returns, and Swift
// and Kotlin pass bytes through.
//
// The seed is 256 bits of entropy as BIP-39 has it, so it is also 24 words a
// member can write down. The key is the one those words give at
// m/44'/330'/0'/0/0, the path the Ledger and arkd use, so a member's key can
// move between them.
#ifndef ARK_KEYSTORE_H
#define ARK_KEYSTORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ARK_SEED_LENGTH 32
#define ARK_PUBLIC_KEY_LENGTH 33
#define ARK_SIGNATURE_LENGTH 64

// Each returns 1 when it has done what it says and 0 when it has not, in
// which case what it was to write is zeroed.

// A new seed, 256 bits from the operating system's random source, and the
// compressed public key of its key. The caller owns the seed from here: it
// encrypts it and wipes it.
int ark_keystore_generate(uint8_t seed[ARK_SEED_LENGTH], uint8_t public_key[ARK_PUBLIC_KEY_LENGTH]);

// The compressed public key of the seed's key.
int ark_keystore_public_key(const uint8_t seed[ARK_SEED_LENGTH], uint8_t public_key[ARK_PUBLIC_KEY_LENGTH]);

// A signature by the seed's key over SHA-256 of the message: r then s, with s
// in the lower half of the curve order, and deterministic (RFC 6979).
int ark_keystore_sign(const uint8_t seed[ARK_SEED_LENGTH], const uint8_t *message, size_t length, uint8_t signature[ARK_SIGNATURE_LENGTH]);

// Zeroes what held a seed, in a way a compiler does not remove. Swift and
// Kotlin call it on the one buffer each of them hands a seed through.
void ark_keystore_wipe(void *bytes, size_t length);

// Derives a key from a seed fixed here and signs with it, and compares both
// with the answers fixed here: 1 when this build of the core, on this device,
// gives them.
int ark_keystore_self_check(void);

#ifdef __cplusplus
}
#endif

#endif
