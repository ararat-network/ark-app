#include "ark_sha2.h"

#include <string.h>

void ark_zeroise(void *memory, size_t length) {
  volatile uint8_t *bytes = (volatile uint8_t *)memory;
  while (length--) {
    *bytes++ = 0;
  }
}

// SHA-256, FIPS 180-4 §6.2.

static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

typedef struct {
  uint32_t state[8];
  uint64_t length;
  uint8_t block[64];
  size_t held;
} sha256_ctx;

static uint32_t rotr32(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }

static void sha256_block(uint32_t state[8], const uint8_t block[64]) {
  uint32_t w[64];
  uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[4 * i] << 24) | ((uint32_t)block[4 * i + 1] << 16) | ((uint32_t)block[4 * i + 2] << 8) | (uint32_t)block[4 * i + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  for (int i = 0; i < 64; i++) {
    uint32_t t1 = h + (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i];
    uint32_t t2 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
  ark_zeroise(w, sizeof w);
}

static void sha256_init(sha256_ctx *ctx) {
  static const uint32_t initial[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(ctx->state, initial, sizeof initial);
  ctx->length = 0;
  ctx->held = 0;
}

static void sha256_update(sha256_ctx *ctx, const uint8_t *data, size_t length) {
  ctx->length += length;
  while (length > 0) {
    size_t take = 64 - ctx->held;
    if (take > length) take = length;
    memcpy(ctx->block + ctx->held, data, take);
    ctx->held += take;
    data += take;
    length -= take;
    if (ctx->held == 64) {
      sha256_block(ctx->state, ctx->block);
      ctx->held = 0;
    }
  }
}

static void sha256_final(sha256_ctx *ctx, uint8_t digest[ARK_SHA256_LENGTH]) {
  uint64_t bits = ctx->length * 8;
  uint8_t pad[72] = {0x80};
  size_t pad_length = (ctx->held < 56 ? 56 : 120) - ctx->held;
  for (int i = 0; i < 8; i++) {
    pad[pad_length + i] = (uint8_t)(bits >> (56 - 8 * i));
  }
  sha256_update(ctx, pad, pad_length + 8);
  for (int i = 0; i < 8; i++) {
    digest[4 * i] = (uint8_t)(ctx->state[i] >> 24);
    digest[4 * i + 1] = (uint8_t)(ctx->state[i] >> 16);
    digest[4 * i + 2] = (uint8_t)(ctx->state[i] >> 8);
    digest[4 * i + 3] = (uint8_t)ctx->state[i];
  }
  ark_zeroise(ctx, sizeof *ctx);
}

void ark_sha256(const uint8_t *data, size_t length, uint8_t digest[ARK_SHA256_LENGTH]) {
  sha256_ctx ctx;
  sha256_init(&ctx);
  sha256_update(&ctx, data, length);
  sha256_final(&ctx, digest);
}

// SHA-512, FIPS 180-4 §6.4.

static const uint64_t K512[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL, 0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL,
    0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL, 0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL, 0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL,
    0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL, 0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL, 0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL,
    0x06ca6351e003826fULL, 0x142929670a0e6e70ULL, 0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL, 0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL,
    0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL, 0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL, 0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL,
    0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL, 0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL, 0xca273eceea26619cULL, 0xd186b8c721c0c207ULL,
    0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL, 0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL, 0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL,
    0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL};

typedef struct {
  uint64_t state[8];
  uint64_t length;
  uint8_t block[128];
  size_t held;
} sha512_ctx;

static uint64_t rotr64(uint64_t x, unsigned n) { return (x >> n) | (x << (64 - n)); }

static void sha512_block(uint64_t state[8], const uint8_t block[128]) {
  uint64_t w[80];
  uint64_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (int i = 0; i < 16; i++) {
    uint64_t word = 0;
    for (int j = 0; j < 8; j++) {
      word = (word << 8) | block[8 * i + j];
    }
    w[i] = word;
  }
  for (int i = 16; i < 80; i++) {
    uint64_t s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7);
    uint64_t s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  for (int i = 0; i < 80; i++) {
    uint64_t t1 = h + (rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41)) + ((e & f) ^ (~e & g)) + K512[i] + w[i];
    uint64_t t2 = (rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
  ark_zeroise(w, sizeof w);
}

static void sha512_init(sha512_ctx *ctx) {
  static const uint64_t initial[8] = {0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
                                      0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL, 0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL};
  memcpy(ctx->state, initial, sizeof initial);
  ctx->length = 0;
  ctx->held = 0;
}

static void sha512_update(sha512_ctx *ctx, const uint8_t *data, size_t length) {
  ctx->length += length;
  while (length > 0) {
    size_t take = 128 - ctx->held;
    if (take > length) take = length;
    memcpy(ctx->block + ctx->held, data, take);
    ctx->held += take;
    data += take;
    length -= take;
    if (ctx->held == 128) {
      sha512_block(ctx->state, ctx->block);
      ctx->held = 0;
    }
  }
}

static void sha512_final(sha512_ctx *ctx, uint8_t digest[ARK_SHA512_LENGTH]) {
  // The length is written as 128 bits; no message here comes near 2^61 bytes, so the upper 64 are zero.
  uint64_t bits = ctx->length * 8;
  uint8_t pad[144] = {0x80};
  size_t pad_length = (ctx->held < 112 ? 112 : 240) - ctx->held;
  for (int i = 0; i < 8; i++) {
    pad[pad_length + 8 + i] = (uint8_t)(bits >> (56 - 8 * i));
  }
  sha512_update(ctx, pad, pad_length + 16);
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      digest[8 * i + j] = (uint8_t)(ctx->state[i] >> (56 - 8 * j));
    }
  }
  ark_zeroise(ctx, sizeof *ctx);
}

void ark_sha512(const uint8_t *data, size_t length, uint8_t digest[ARK_SHA512_LENGTH]) {
  sha512_ctx ctx;
  sha512_init(&ctx);
  sha512_update(&ctx, data, length);
  sha512_final(&ctx, digest);
}

// HMAC, RFC 2104, over SHA-512.

typedef struct {
  sha512_ctx inner;
  uint8_t outer_pad[128];
} hmac_ctx;

static void hmac_init(hmac_ctx *ctx, const uint8_t *key, size_t key_length) {
  uint8_t block[128] = {0};
  uint8_t inner_pad[128];
  if (key_length > 128) {
    ark_sha512(key, key_length, block);
  } else {
    memcpy(block, key, key_length);
  }
  for (int i = 0; i < 128; i++) {
    inner_pad[i] = block[i] ^ 0x36;
    ctx->outer_pad[i] = block[i] ^ 0x5c;
  }
  sha512_init(&ctx->inner);
  sha512_update(&ctx->inner, inner_pad, 128);
  ark_zeroise(block, sizeof block);
  ark_zeroise(inner_pad, sizeof inner_pad);
}

static void hmac_final(hmac_ctx *ctx, uint8_t mac[ARK_SHA512_LENGTH]) {
  uint8_t inner[ARK_SHA512_LENGTH];
  sha512_ctx outer;
  sha512_final(&ctx->inner, inner);
  sha512_init(&outer);
  sha512_update(&outer, ctx->outer_pad, 128);
  sha512_update(&outer, inner, sizeof inner);
  sha512_final(&outer, mac);
  ark_zeroise(inner, sizeof inner);
  ark_zeroise(ctx, sizeof *ctx);
}

void ark_hmac_sha512(const uint8_t *key, size_t key_length, const uint8_t *data, size_t length, uint8_t mac[ARK_SHA512_LENGTH]) {
  hmac_ctx ctx;
  hmac_init(&ctx, key, key_length);
  sha512_update(&ctx.inner, data, length);
  hmac_final(&ctx, mac);
}

// PBKDF2, RFC 8018 §5.2, for its first block.

void ark_pbkdf2_hmac_sha512(const uint8_t *password, size_t password_length, const uint8_t *salt, size_t salt_length, uint32_t iterations,
                            uint8_t output[ARK_SHA512_LENGTH]) {
  static const uint8_t block_one[4] = {0, 0, 0, 1};
  uint8_t u[ARK_SHA512_LENGTH];
  hmac_ctx ctx;
  hmac_init(&ctx, password, password_length);
  sha512_update(&ctx.inner, salt, salt_length);
  sha512_update(&ctx.inner, block_one, sizeof block_one);
  hmac_final(&ctx, u);
  memcpy(output, u, sizeof u);
  for (uint32_t i = 1; i < iterations; i++) {
    ark_hmac_sha512(password, password_length, u, sizeof u, u);
    for (size_t j = 0; j < sizeof u; j++) {
      output[j] ^= u[j];
    }
  }
  ark_zeroise(u, sizeof u);
}
