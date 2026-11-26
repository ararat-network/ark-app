// The keystore's C core, built here with the host's C compiler and driven
// through a command line that exists for this file alone. Its hashes are held
// against Node's, its words and keys against the SDK's TypeScript, which
// shares no code with it, and its signatures against the signup vectors and
// every transaction fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fromBase64, isValidMnemonic, privateKeyFromMnemonic, publicKeyFromPrivate, signMessage, toHex, utf8Encode } from "@ararat-network/sdk";
import { fixtureKey, txFixtures } from "../src/testing/fixtures.ts";
import { signupVectors } from "../src/testing/vectors.ts";
import { DEVICE_CHECK_WORDS } from "./device-check.ts";

const native = fileURLToPath(new URL("native/", import.meta.url));
let cli = "";

before(() => {
  const out = mkdtempSync(join(tmpdir(), "ark-keystore-core-"));
  cli = join(out, "cli");
  const cc = process.env.CC ?? "cc";
  const flags = ["-std=c99", "-O2", "-D_DEFAULT_SOURCE"];
  const objects: string[] = [];
  const compile = (source: string, extra: string[]): void => {
    const object = join(out, `${source.replace(/[^a-z0-9_]/gi, "_")}.o`);
    execFileSync(cc, [...flags, ...extra, "-c", join(native, source), "-o", object], { stdio: "inherit" });
    objects.push(object);
  };
  // Ours with every warning an error; the library as its authors build it, with its own warnings its own.
  for (const source of ["ark_sha2.c", "ark_keystore.c", "ark_self_check.c", "test/cli.c"]) compile(source, ["-Wall", "-Wextra", "-Werror"]);
  for (const source of ["secp256k1/src/secp256k1.c", "secp256k1/src/precomputed_ecmult.c", "secp256k1/src/precomputed_ecmult_gen.c"]) {
    compile(source, ["-w", `-I${join(native, "secp256k1/include")}`, `-I${join(native, "secp256k1/src")}`]);
  }
  execFileSync(cc, [...objects, "-o", cli], { stdio: "inherit" });
});

const run = (...args: string[]): string => execFileSync(cli, args, { encoding: "utf8" }).trim();
const hex = (bytes: Uint8Array): string => toHex(bytes);

test("SHA-256 and SHA-512 are Node's, at every length around a block's edge", () => {
  // The lengths where padding changes shape: one block's last bytes, and the two blocks after.
  const lengths = [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 110, 111, 112, 113, 119, 120, 127, 128, 129, 239, 240, 241, 1000];
  for (const length of lengths) {
    const data = Buffer.alloc(length, 0).map((_, i) => (i * 131 + 7) & 0xff);
    assert.equal(run("sha256", hex(data)), createHash("sha256").update(data).digest("hex"), `sha256 of ${length} bytes`);
    assert.equal(run("sha512", hex(data)), createHash("sha512").update(data).digest("hex"), `sha512 of ${length} bytes`);
  }
  assert.equal(run("sha256", "616263"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("HMAC-SHA-512 is Node's, with a key shorter than a block, a block long, and longer", () => {
  for (const keyLength of [1, 20, 127, 128, 129, 200]) {
    for (const length of [0, 37, 128, 300]) {
      const key = Buffer.alloc(keyLength, 0).map((_, i) => (i * 17 + 3) & 0xff);
      const data = Buffer.alloc(length, 0).map((_, i) => (i * 29 + 11) & 0xff);
      assert.equal(run("hmac", hex(key), hex(data)), createHmac("sha512", key).update(data).digest("hex"), `key ${keyLength}, data ${length}`);
    }
  }
});

test("PBKDF2 over HMAC-SHA-512 is Node's, at BIP-39's count and at one", () => {
  for (const [password, salt, iterations] of [
    ["password", "salt", 1],
    ["password", "salt", 2],
    ["legal winner thank year", "mnemonic", 2048],
    ["p".repeat(200), "s".repeat(90), 3],
  ] as [string, string, number][]) {
    const expected = pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
    assert.equal(run("pbkdf2", hex(utf8Encode(password)), hex(utf8Encode(salt)), String(iterations)), expected, `${iterations} iterations`);
  }
});

test("the word list is BIP-39's English list, word for word", () => {
  const header = readFileSync(join(native, "ark_bip39_english.h"), "utf8");
  const words = [...header.slice(header.indexOf("ARK_BIP39_ENGLISH[")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(words.length, 2048);
  // The SHA-256 of the list as the standard publishes it, one word to a line.
  assert.equal(
    createHash("sha256")
      .update(`${words.join("\n")}\n`)
      .digest("hex"),
    "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda",
  );
});

test("a seed's words are the ones BIP-39's own vectors give", () => {
  const vectors: [string, string][] = [
    ["00", `${"abandon ".repeat(23)}art`],
    ["7f", `${"legal winner thank year wave sausage worth useful ".repeat(2)}legal winner thank year wave sausage worth title`],
    ["80", `${"letter advice cage absurd amount doctor acoustic avoid ".repeat(2)}letter advice cage absurd amount doctor acoustic bless`],
    ["ff", `${"zoo ".repeat(23)}vote`],
  ];
  for (const [byte, words] of vectors) assert.equal(run("mnemonic", byte.repeat(32)), words, byte);
});

test("a seed's key is the one the SDK derives from the same words, at the path the Ledger and arkd use", () => {
  const seeds = ["00".repeat(32), "7f".repeat(32), "ff".repeat(32), ...Array.from({ length: 24 }, () => randomBytes(32).toString("hex"))];
  for (const seed of seeds) {
    const mnemonic = run("mnemonic", seed);
    assert.ok(isValidMnemonic(mnemonic), `the words of ${seed} carry their checksum`);
    assert.equal(mnemonic.split(" ").length, 24);
    const key = privateKeyFromMnemonic(mnemonic);
    assert.equal(run("key", seed), hex(key), `the key of ${seed}`);
    assert.equal(run("public", seed), hex(publicKeyFromPrivate(key)), `the public key of ${seed}`);
    const message = randomBytes(1 + (Number.parseInt(seed.slice(0, 2), 16) % 200));
    assert.equal(run("sign", seed, hex(message)), hex(signMessage(message, key)), `a signature of ${seed}`);
  }
});

test("every signature a signup vector's key validly made is made again, byte for byte", () => {
  const { keys, vectors } = signupVectors();
  let made = 0;
  for (const vector of vectors) {
    const key = keys.find((k) => k.public_key === vector.public_key);
    if (!key || !vector.signature_valid) continue;
    const signBytes = utf8Encode(vector.sign_bytes);
    // A vector may carry a valid signature that is not its key's deterministic one; those the SDK does not reproduce either.
    const expected = hex(signMessage(signBytes, Buffer.from(key.private_key_hex, "hex")));
    assert.equal(run("sign-with-key", key.private_key_hex, hex(signBytes)), expected, vector.name);
    if (expected === hex(fromBase64(vector.signature))) made++;
  }
  assert.ok(made >= 8, `only ${made} vectors were reproduced`);
});

test("every transaction fixture's signature is made again from its direct sign bytes, byte for byte", () => {
  const fixtures = txFixtures();
  assert.equal(fixtures.length, 85);
  for (const f of fixtures) {
    const key = fixtureKey(f.signer.key).private_key_hex;
    const signature = run("sign-with-key", key, hex(fromBase64(f.sign_mode_direct.sign_doc)));
    assert.equal(signature, hex(fromBase64(f.signature)), f.name);
  }
});

test("the self-check the device runs passes here, and its answers are the SDK's", () => {
  assert.equal(run("self-check"), "1");
  const seed = "7f".repeat(32);
  const key = privateKeyFromMnemonic(run("mnemonic", seed));
  const source = readFileSync(join(native, "ark_self_check.c"), "utf8");
  const bytesOf = (name: string): string => {
    const body = source.slice(source.indexOf(`${name}[`));
    return [...body.slice(0, body.indexOf("};")).matchAll(/0x([0-9a-f]{2})/g)].map((m) => m[1]).join("");
  };
  assert.equal(bytesOf("PUBLIC_KEY"), hex(publicKeyFromPrivate(key)));
  assert.equal(bytesOf("SIGNATURE"), hex(signMessage(utf8Encode("ark-keystore self-check"), key)));
});

test("a new seed is 32 bytes no other call gave, with the public key the SDK derives from its words", () => {
  const made = Array.from({ length: 8 }, () => run("generate").split(" "));
  for (const [seed, publicKey] of made) {
    assert.match(seed ?? "", /^[0-9a-f]{64}$/);
    assert.equal(publicKey, hex(publicKeyFromPrivate(privateKeyFromMnemonic(run("mnemonic", seed ?? "")))), `the public key of ${seed}`);
  }
  assert.equal(new Set(made.map(([seed]) => seed)).size, made.length, "no seed is given twice");
  assert.ok(!made.some(([seed]) => seed === "00".repeat(32)), "the source's bytes are in the seed");
});

// What the core says of a text read as words: its status, how many words it read, the first unknown, and the seed.
const read = (text: string): { status: number; count: number; unknown: number; seed: string } => {
  const [status, count, unknown, seed] = run("words", text).split(" ");
  return { status: Number(status), count: Number(count), unknown: Number(unknown), seed: seed ?? "" };
};
const [OK, INCOMPLETE, UNKNOWN, TOO_MANY, CHECKSUM] = [0, 1, 2, 3, 4];
const NO_SEED = "00".repeat(32);

test("the words the device check restores from are those of the seed the self-check signs with", () => {
  assert.equal(run("mnemonic", "7f".repeat(32)), DEVICE_CHECK_WORDS);
  assert.deepEqual(read(DEVICE_CHECK_WORDS), { status: OK, count: 24, unknown: -1, seed: "7f".repeat(32) });
});

test("the word list is in the order a search of it relies on", () => {
  const header = readFileSync(join(native, "ark_bip39_english.h"), "utf8");
  const words = [...header.slice(header.indexOf("ARK_BIP39_ENGLISH[")).matchAll(/"([a-z]+)"/g)].map((m) => m[1] ?? "");
  for (let i = 1; i < words.length; i++)
    assert.ok(Buffer.compare(Buffer.from(words[i - 1] ?? ""), Buffer.from(words[i] ?? "")) < 0, `${words[i - 1]} before ${words[i]}`);
});

test("a seed's words read back as that seed, and every word of the list is read", () => {
  const seeds = ["00".repeat(32), "7f".repeat(32), "80".repeat(32), "ff".repeat(32), ...Array.from({ length: 40 }, () => randomBytes(32).toString("hex"))];
  for (const seed of seeds) assert.deepEqual(read(run("mnemonic", seed)), { status: OK, count: 24, unknown: -1, seed }, seed);

  // Every one of the 2048 words, each in a text of 24 that reads as incomplete or whole and never as unknown.
  const header = readFileSync(join(native, "ark_bip39_english.h"), "utf8");
  const words = [...header.slice(header.indexOf("ARK_BIP39_ENGLISH[")).matchAll(/"([a-z]+)"/g)].map((m) => m[1] ?? "");
  for (let i = 0; i < words.length; i += 23) {
    const some = words.slice(i, i + 23);
    assert.deepEqual(read(some.join(" ")), { status: INCOMPLETE, count: some.length, unknown: -1, seed: NO_SEED }, `words from ${i}`);
  }
});

test("words are read in either case and with any spacing, as the member typed them", () => {
  const seed = randomBytes(32).toString("hex");
  const words = run("mnemonic", seed).split(" ");
  const typed = [
    words.join("  "),
    `  ${words.join(" ")}  `,
    words.join("\n"),
    words.join(" \t\r\n "),
    words.join(" ").toUpperCase(),
    words.map((word, i) => (i % 2 ? word : `${word[0]?.toUpperCase()}${word.slice(1)}`)).join(" "),
  ];
  for (const text of typed) assert.deepEqual(read(text), { status: OK, count: 24, unknown: -1, seed }, JSON.stringify(text));
});

test("a text that is not a seed's words is told from one that is, and gives no seed", () => {
  const words = run("mnemonic", randomBytes(32).toString("hex")).split(" ");
  const withWord = (at: number, word: string): string => words.map((w, i) => (i === at ? word : w)).join(" ");

  assert.deepEqual(read(""), { status: INCOMPLETE, count: 0, unknown: -1, seed: NO_SEED });
  assert.deepEqual(read("   \n "), { status: INCOMPLETE, count: 0, unknown: -1, seed: NO_SEED });
  assert.deepEqual(read(words.slice(0, 23).join(" ")), { status: INCOMPLETE, count: 23, unknown: -1, seed: NO_SEED });
  assert.deepEqual(read([...words, "abandon"].join(" ")), { status: TOO_MANY, count: 25, unknown: -1, seed: NO_SEED });

  // A word of the list in place of another breaks the checksum, but for the one in 256 that keeps it.
  const other = words[23] === "zoo" ? "zone" : "zoo";
  const swapped = read(withWord(23, other));
  assert.ok(swapped.status === CHECKSUM || swapped.status === OK);
  assert.equal(swapped.status === OK, isValidMnemonic(withWord(23, other)));

  for (const [at, word] of [
    [0, "abandonn"],
    [7, "zzz"],
    [23, "abandonment"],
    [3, "ab"],
    [11, "act1"],
    [12, "act,"],
    [5, "caf\u00e9"],
    [9, "\u5bc6\u7801"],
  ] as const) {
    assert.deepEqual(read(withWord(at, word)), { status: UNKNOWN, count: 24, unknown: at, seed: NO_SEED }, word);
  }
  // The first unknown word is the one named, however many follow.
  assert.equal(read(`${words.slice(0, 4).join(" ")} nope ${words.slice(5).join(" ")} nor this`).unknown, 4);
  // A word still being typed is not of the list yet.
  assert.deepEqual(read(`${words.slice(0, 6).join(" ")} aban`), { status: UNKNOWN, count: 7, unknown: 6, seed: NO_SEED });
});

test("24 words of the list are a seed's exactly when the SDK says their checksum holds", () => {
  const header = readFileSync(join(native, "ark_bip39_english.h"), "utf8");
  const list = [...header.slice(header.indexOf("ARK_BIP39_ENGLISH[")).matchAll(/"([a-z]+)"/g)].map((m) => m[1] ?? "");
  for (let i = 0; i < 600; i++) {
    // Each word drawn evenly from the list: a remainder of random bytes would favour some words on a list of any other length.
    const text = Array.from({ length: 24 }, () => list[randomInt(list.length)]).join(" ");
    const answer = read(text);
    assert.equal(answer.status === OK, isValidMnemonic(text), text);
    assert.ok(answer.status === OK || answer.status === CHECKSUM);
    if (answer.status === OK) {
      assert.equal(run("mnemonic", answer.seed), text, "the seed read is the one those words stand for");
    } else {
      assert.equal(answer.seed, NO_SEED);
    }
  }
});

test("a seed that is not 32 bytes is not taken", () => {
  assert.throws(() => execFileSync(cli, ["key", "00".repeat(31)], { stdio: "pipe" }));
  assert.throws(() => execFileSync(cli, ["public", "00".repeat(33)], { stdio: "pipe" }));
});
