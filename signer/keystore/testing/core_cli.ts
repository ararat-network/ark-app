// The keystore's C core, built here with the host's C compiler into the
// command line in native/test/cli.c, for tests to drive. It is the same C the
// phone compiles, with libsecp256k1 from the source kept beside it. Test-only:
// the command line takes seeds and keys as arguments, and no native module
// builds it.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const native = fileURLToPath(new URL("../native/", import.meta.url));
let built: string | undefined;

/** The path of the command line, built the first time it is asked for. */
export function coreCli(): string {
  if (built) return built;
  const out = mkdtempSync(join(tmpdir(), "ark-keystore-core-"));
  const cli = join(out, "cli");
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
  built = cli;
  return cli;
}

/** Runs the command line and gives what it printed. */
export function runCore(...args: string[]): string {
  return execFileSync(coreCli(), args, { encoding: "utf8" }).trim();
}

/** The directory the core's C is in. */
export const coreSource = native;
