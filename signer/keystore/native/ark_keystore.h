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
#define ARK_WORD_COUNT 24
// 24 words of at most 8 letters, 23 spaces, and the terminator. A plain number, so that Swift reads it.
#define ARK_SEED_PHRASE_SIZE 216

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

// The seed as the 24 words a member writes down: BIP-39's English words, in
// lower case, with one space between each. They are the seed in another form,
// and whoever is handed them wipes the buffer once they are drawn.
int ark_keystore_seed_phrase(const uint8_t seed[ARK_SEED_LENGTH], char phrase[ARK_SEED_PHRASE_SIZE]);

// What a text is, read as a seed's words.
#define ARK_SEED_PHRASE_OK 0         // 24 words of the list, and their checksum holds
#define ARK_SEED_PHRASE_INCOMPLETE 1 // fewer than 24 words, each of them of the list
#define ARK_SEED_PHRASE_UNKNOWN 2    // a word that is not of the list
#define ARK_SEED_PHRASE_TOO_MANY 3   // more than 24 words
#define ARK_SEED_PHRASE_CHECKSUM 4   // 24 words of the list whose checksum does not hold

// Reads a text as a seed's words and says which of the above it is. Letters
// are taken in either case, and any run of spaces, tabs, and line ends parts
// two words or surrounds them. The seed is written when the answer is
// ARK_SEED_PHRASE_OK and zeroed otherwise. `count` is how many words were read, and
// `unknown` the position, from 0, of the first that is not of the list, or -1.
// Either may be NULL.
int ark_keystore_seed_from_phrase(const char *text, uint8_t seed[ARK_SEED_LENGTH], int *count, int *unknown);

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
