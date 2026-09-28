import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Hex SHA-256 of the given parts, unambiguous about where one part ends and the next begins. */
export function hashOf(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(`${part.length}:`).update(part);
  return hash.digest("hex");
}

/**
 * A hash of the domain's source (its top-level files, which is all it has), so changing any Projection Model's code changes the cache key. Tests and fixtures are left
 * out: they cannot change a history.
 */
export function domainSourceHash(domainDir: string): string {
  const sources = readdirSync(domainDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();
  return hashOf(...sources.flatMap((name) => [name, readFileSync(join(domainDir, name), "utf8")]));
}

/**
 * The module code cached at `file` under `key`, or `compute()` when the cache is missing, stale or corrupt, in which case the
 * result is cached for next time. The cache is only an optimisation: an unreadable or unwritable one is never an error.
 */
export function cachedOrComputed(file: string, key: string, compute: () => string): string {
  try {
    const cached: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof cached === "object" && cached !== null && "key" in cached && "code" in cached) {
      if (cached.key === key && typeof cached.code === "string") return cached.code;
    }
  } catch {
    // Missing or corrupt: compute below.
  }
  const code = compute();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, code }));
  } catch {
    // Read-only checkout or a full disk: this build just goes uncached.
  }
  return code;
}
