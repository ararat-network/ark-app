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
void ark_mnemonic_from_seed(const uint8_t seed[32], char mnemonic[ARK_MNEMONIC_SIZE]) {
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
  char mnemonic[ARK_MNEMONIC_SIZE];
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
  ark_mnemonic_from_seed(seed, mnemonic);
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
