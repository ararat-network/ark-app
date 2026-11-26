#include "ark_keystore.h"

#include <stdlib.h>
#include <string.h>

// The operating system's random source. Apple's is its own call, the one it documents for keys; elsewhere it is
// getentropy, the kernel asked directly, which bionic has from Android 9 and glibc has.
#if defined(__APPLE__)
#include <CommonCrypto/CommonRandom.h>
static int system_random(uint8_t *bytes, size_t length) { return CCRandomGenerateBytes(bytes, length) == kCCSuccess; }
#else
#include <sys/types.h>
#include <sys/random.h>
static int system_random(uint8_t *bytes, size_t length) { return getentropy(bytes, length) == 0; }
#endif

#include "ark_bip39_english.h"
#include "ark_keystore_internal.h"
#include "ark_sha2.h"
#include "secp256k1/include/secp256k1.h"

// BIP-39: the seed, then the first byte of its SHA-256 as a checksum, read as
// 24 groups of 11 bits, each the index of a word.
int ark_keystore_seed_phrase(const uint8_t seed[ARK_SEED_LENGTH], char mnemonic[ARK_SEED_PHRASE_SIZE]) {
  uint8_t bits[33];
  uint8_t digest[ARK_SHA256_LENGTH];
  size_t at = 0;
  memcpy(bits, seed, 32);
  ark_sha256(seed, 32, digest);
  bits[32] = digest[0];
  for (int word = 0; word < 24; word++) {
    unsigned index = 0;
    for (int bit = 0; bit < 11; bit++) {
      int position = word * 11 + bit;
      index = (index << 1) | ((bits[position / 8] >> (7 - position % 8)) & 1u);
    }
    const char *text = ARK_BIP39_ENGLISH[index];
    size_t length = strlen(text);
    if (word > 0) mnemonic[at++] = ' ';
    memcpy(mnemonic + at, text, length);
    at += length;
  }
  mnemonic[at] = '\0';
  ark_zeroise(bits, sizeof bits);
  ark_zeroise(digest, sizeof digest);
  return 1;
}

// The size the header gives for a seed phrase is the one its longest form takes.
typedef char ark_seed_phrase_size_is_right[ARK_SEED_PHRASE_SIZE == ARK_WORD_COUNT * ARK_BIP39_WORD_MAX_LENGTH + (ARK_WORD_COUNT - 1) + 1 ? 1 : -1];

// The index of a word in the list, which is in alphabetical order, or -1.
static int word_index(const char *word) {
  int low = 0;
  int high = ARK_BIP39_WORD_COUNT - 1;
  while (low <= high) {
    int middle = (low + high) / 2;
    int order = strcmp(word, ARK_BIP39_ENGLISH[middle]);
    if (order == 0) return middle;
    if (order < 0) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return -1;
}

typedef char ark_word_list_size_is_right[ARK_WORD_LIST_SIZE == ARK_BIP39_WORD_COUNT ? 1 : -1];

const char *ark_keystore_word(int index) {
  if (index < 0 || index >= ARK_BIP39_WORD_COUNT) return NULL;
  return ARK_BIP39_ENGLISH[index];
}

int ark_keystore_words_beginning(const char *letters, int *first) {
  char prefix[ARK_BIP39_WORD_MAX_LENGTH + 1];
  size_t length = 0;
  if (first != NULL) *first = -1;
  for (; letters[length] != '\0'; length++) {
    char c = letters[length];
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if (length >= ARK_BIP39_WORD_MAX_LENGTH || c < 'a' || c > 'z') {
      ark_zeroise(prefix, sizeof prefix);
      return 0;
    }
    prefix[length] = c;
  }
  if (length == 0) return 0;
  // The first word that is not before the letters, by the list's order, and then every word that begins with them.
  int low = 0;
  int high = ARK_BIP39_WORD_COUNT;
  while (low < high) {
    int middle = (low + high) / 2;
    if (strncmp(ARK_BIP39_ENGLISH[middle], prefix, length) < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  int count = 0;
  while (low + count < ARK_BIP39_WORD_COUNT && strncmp(ARK_BIP39_ENGLISH[low + count], prefix, length) == 0) count++;
  if (count > 0 && first != NULL) *first = low;
  ark_zeroise(prefix, sizeof prefix);
  return count;
}

static int parts_words(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

int ark_keystore_seed_from_phrase(const char *text, uint8_t seed[ARK_SEED_LENGTH], int *count, int *unknown) {
  // BIP-39 in reverse: each word is 11 bits, its index; 24 of them are the 256 bits of the seed and 8 of checksum.
  uint8_t bits[33];
  uint8_t digest[ARK_SHA256_LENGTH];
  char word[ARK_BIP39_WORD_MAX_LENGTH + 1];
  int words = 0;
  int first_unknown = -1;
  int status;
  memset(bits, 0, sizeof bits);

  const char *at = text;
  while (*at != '\0') {
    while (parts_words(*at)) at++;
    if (*at == '\0') break;
    size_t length = 0;
    int fits = 1;
    while (*at != '\0' && !parts_words(*at)) {
      char c = *at++;
      if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
      if (length < ARK_BIP39_WORD_MAX_LENGTH) {
        word[length++] = c;
      } else {
        fits = 0;
      }
    }
    word[length] = '\0';
    int index = fits ? word_index(word) : -1;
    if (index < 0) {
      if (first_unknown < 0) first_unknown = words;
    } else if (words < ARK_WORD_COUNT && first_unknown < 0) {
      for (int bit = 0; bit < 11; bit++) {
        int position = words * 11 + bit;
        if ((index >> (10 - bit)) & 1) bits[position / 8] |= (uint8_t)(1u << (7 - position % 8));
      }
    }
    words++;
  }

  if (first_unknown >= 0) {
    status = ARK_SEED_PHRASE_UNKNOWN;
  } else if (words < ARK_WORD_COUNT) {
    status = ARK_SEED_PHRASE_INCOMPLETE;
  } else if (words > ARK_WORD_COUNT) {
    status = ARK_SEED_PHRASE_TOO_MANY;
  } else {
    ark_sha256(bits, ARK_SEED_LENGTH, digest);
    status = digest[0] == bits[ARK_SEED_LENGTH] ? ARK_SEED_PHRASE_OK : ARK_SEED_PHRASE_CHECKSUM;
  }
  if (status == ARK_SEED_PHRASE_OK) {
    memcpy(seed, bits, ARK_SEED_LENGTH);
  } else {
    memset(seed, 0, ARK_SEED_LENGTH);
  }
  if (count != NULL) *count = words;
  if (unknown != NULL) *unknown = first_unknown;
  ark_zeroise(bits, sizeof bits);
  ark_zeroise(digest, sizeof digest);
  ark_zeroise(word, sizeof word);
  return status;
}

// A context to sign with, blinded with fresh randomness against side channels.
static secp256k1_context *signing_context(void) {
  uint8_t randomness[32];
  secp256k1_context *ctx = secp256k1_context_create(SECP256K1_CONTEXT_NONE);
  if (ctx == NULL) return NULL;
  arc4random_buf(randomness, sizeof randomness);
  int blinded = secp256k1_context_randomize(ctx, randomness);
  ark_zeroise(randomness, sizeof randomness);
  if (!blinded) {
    secp256k1_context_destroy(ctx);
    return NULL;
  }
  return ctx;
}

#define HARDENED 0x80000000u

// BIP-32's child of a private key: the parent's key and chain code are
// replaced by the child's.
static int derive_child(const secp256k1_context *ctx, uint8_t key[32], uint8_t chain[32], uint32_t index) {
  uint8_t data[37];
  uint8_t mac[ARK_SHA512_LENGTH];
  int ok = 1;
  if (index & HARDENED) {
    data[0] = 0;
    memcpy(data + 1, key, 32);
  } else {
    secp256k1_pubkey point;
    size_t length = 33;
    ok = secp256k1_ec_pubkey_create(ctx, &point, key) && secp256k1_ec_pubkey_serialize(ctx, data, &length, &point, SECP256K1_EC_COMPRESSED);
  }
  data[33] = (uint8_t)(index >> 24);
  data[34] = (uint8_t)(index >> 16);
  data[35] = (uint8_t)(index >> 8);
  data[36] = (uint8_t)index;
  if (ok) {
    ark_hmac_sha512(chain, 32, data, sizeof data, mac);
    // Fails for a tweak outside the curve order or a child key of zero. The standard then takes the next index; with
    // one path there is no next, and a seed this happens to, one in 2^127, has no key here.
    ok = secp256k1_ec_seckey_tweak_add(ctx, key, mac);
    memcpy(chain, mac + 32, 32);
  }
  ark_zeroise(data, sizeof data);
  ark_zeroise(mac, sizeof mac);
  return ok;
}

int ark_private_key_from_seed(const uint8_t seed[32], uint8_t private_key[ARK_PRIVATE_KEY_LENGTH]) {
  static const uint8_t salt[] = {'m', 'n', 'e', 'm', 'o', 'n', 'i', 'c'};
  static const uint8_t master[] = {'B', 'i', 't', 'c', 'o', 'i', 'n', ' ', 's', 'e', 'e', 'd'};
  static const uint32_t path[5] = {44 | HARDENED, 330 | HARDENED, 0 | HARDENED, 0, 0};
  char mnemonic[ARK_SEED_PHRASE_SIZE];
  uint8_t stretched[ARK_SHA512_LENGTH];
  uint8_t mac[ARK_SHA512_LENGTH];
  uint8_t key[32];
  uint8_t chain[32];
  int ok;

  secp256k1_context *ctx = signing_context();
  if (ctx == NULL) {
    memset(private_key, 0, ARK_PRIVATE_KEY_LENGTH);
    return 0;
  }
  ark_keystore_seed_phrase(seed, mnemonic);
  ark_pbkdf2_hmac_sha512((const uint8_t *)mnemonic, strlen(mnemonic), salt, sizeof salt, 2048, stretched);
  ark_hmac_sha512(master, sizeof master, stretched, sizeof stretched, mac);
  memcpy(key, mac, 32);
  memcpy(chain, mac + 32, 32);
  ok = secp256k1_ec_seckey_verify(ctx, key);
  for (size_t i = 0; ok && i < sizeof path / sizeof path[0]; i++) {
    ok = derive_child(ctx, key, chain, path[i]);
  }
  if (ok) {
    memcpy(private_key, key, 32);
  } else {
    memset(private_key, 0, ARK_PRIVATE_KEY_LENGTH);
  }
  secp256k1_context_destroy(ctx);
  ark_zeroise(mnemonic, sizeof mnemonic);
  ark_zeroise(stretched, sizeof stretched);
  ark_zeroise(mac, sizeof mac);
  ark_zeroise(key, sizeof key);
  ark_zeroise(chain, sizeof chain);
  return ok;
}

int ark_public_key_of(const uint8_t private_key[ARK_PRIVATE_KEY_LENGTH], uint8_t public_key[33]) {
  secp256k1_pubkey point;
  size_t length = 33;
  secp256k1_context *ctx = signing_context();
  int ok = ctx != NULL && secp256k1_ec_pubkey_create(ctx, &point, private_key) &&
           secp256k1_ec_pubkey_serialize(ctx, public_key, &length, &point, SECP256K1_EC_COMPRESSED);
  if (ctx != NULL) secp256k1_context_destroy(ctx);
  if (!ok) memset(public_key, 0, 33);
  return ok;
}

int ark_sign_with_key(const uint8_t private_key[ARK_PRIVATE_KEY_LENGTH], const uint8_t *message, size_t length, uint8_t signature[64]) {
  uint8_t digest[ARK_SHA256_LENGTH];
  secp256k1_ecdsa_signature made;
  secp256k1_context *ctx = signing_context();
  ark_sha256(message, length, digest);
  // The library's own nonce is RFC 6979's, and what it makes already has s in the lower half of the order.
  int ok = ctx != NULL && secp256k1_ecdsa_sign(ctx, &made, digest, private_key, NULL, NULL) &&
           secp256k1_ecdsa_signature_serialize_compact(ctx, signature, &made);
  if (ctx != NULL) secp256k1_context_destroy(ctx);
  ark_zeroise(&made, sizeof made);
  if (!ok) memset(signature, 0, 64);
  return ok;
}

int ark_keystore_generate(uint8_t seed[ARK_SEED_LENGTH], uint8_t public_key[ARK_PUBLIC_KEY_LENGTH]) {
  // A seed whose key BIP-32 calls invalid is as likely as guessing a key, and is refused all the same.
  int ok = system_random(seed, ARK_SEED_LENGTH) && ark_keystore_public_key(seed, public_key);
  if (!ok) {
    ark_zeroise(seed, ARK_SEED_LENGTH);
    memset(public_key, 0, ARK_PUBLIC_KEY_LENGTH);
  }
  return ok;
}

void ark_keystore_wipe(void *bytes, size_t length) { ark_zeroise(bytes, length); }

int ark_keystore_public_key(const uint8_t seed[ARK_SEED_LENGTH], uint8_t public_key[ARK_PUBLIC_KEY_LENGTH]) {
  uint8_t key[ARK_PRIVATE_KEY_LENGTH];
  int ok = ark_private_key_from_seed(seed, key) && ark_public_key_of(key, public_key);
  ark_zeroise(key, sizeof key);
  if (!ok) memset(public_key, 0, ARK_PUBLIC_KEY_LENGTH);
  return ok;
}

int ark_keystore_sign(const uint8_t seed[ARK_SEED_LENGTH], const uint8_t *message, size_t length, uint8_t signature[ARK_SIGNATURE_LENGTH]) {
  uint8_t key[ARK_PRIVATE_KEY_LENGTH];
  int ok = ark_private_key_from_seed(seed, key) && ark_sign_with_key(key, message, length, signature);
  ark_zeroise(key, sizeof key);
  if (!ok) memset(signature, 0, ARK_SIGNATURE_LENGTH);
  return ok;
}
