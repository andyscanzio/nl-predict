import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedOrComputed, domainSourceHash } from "./historyCache.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "history-cache-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("cachedOrComputed", () => {
  it("computes on a cold cache and reads the cache on the next call with the same key", () => {
    const file = join(dir, "nested", "history.json");
    const compute = vi.fn(() => "module code");
    expect(cachedOrComputed(file, "key-1", compute)).toBe("module code");
    expect(cachedOrComputed(file, "key-1", compute)).toBe("module code");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the key changes", () => {
    const file = join(dir, "history.json");
    const compute = vi.fn(() => "module code");
    cachedOrComputed(file, "key-1", compute);
    cachedOrComputed(file, "key-2", compute);
    expect(compute).toHaveBeenCalledTimes(2);
    cachedOrComputed(file, "key-2", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["not JSON", "{oops"],
    ["JSON of the wrong shape", JSON.stringify(["key-1"])],
    ["a matching key without code", JSON.stringify({ key: "key-1" })],
  ])("falls back to computing when the cache is %s", (_name, content) => {
    const file = join(dir, "history.json");
    writeFileSync(file, content);
    expect(cachedOrComputed(file, "key-1", () => "fresh")).toBe("fresh");
    expect(cachedOrComputed(file, "key-1", () => "recomputed")).toBe("fresh");
  });

  it("still returns the computed result when the cache cannot be written", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file where the cache directory should go");
    expect(cachedOrComputed(join(blocker, "history.json"), "key-1", () => "fresh")).toBe("fresh");
  });

  it("propagates an error from computing", () => {
    expect(() =>
      cachedOrComputed(join(dir, "history.json"), "key-1", () => {
        throw new Error("bad snapshot");
      }),
    ).toThrow("bad snapshot");
  });
});

describe("domainSourceHash", () => {
  function domain(files: Record<string, string>): string {
    const root = join(dir, "domain");
    mkdirSync(join(root, "__fixtures__"), { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
    return root;
  }

  it("changes when a domain source file changes", () => {
    const root = domain({ "model.ts": "export const rate = 1;" });
    const before = domainSourceHash(root);
    writeFileSync(join(root, "model.ts"), "export const rate = 2;");
    expect(domainSourceHash(root)).not.toBe(before);
  });

  it("changes when a domain source file is added", () => {
    const root = domain({ "model.ts": "export const rate = 1;" });
    const before = domainSourceHash(root);
    writeFileSync(join(root, "other.ts"), "export {};");
    expect(domainSourceHash(root)).not.toBe(before);
  });

  it("ignores tests and fixtures, which cannot change a history", () => {
    const root = domain({ "model.ts": "export const rate = 1;", "model.test.ts": "// a" });
    writeFileSync(join(root, "__fixtures__", "snapshot.json"), "{}");
    const before = domainSourceHash(root);
    writeFileSync(join(root, "model.test.ts"), "// b");
    writeFileSync(join(root, "__fixtures__", "snapshot.json"), '{"changed":true}');
    expect(domainSourceHash(root)).toBe(before);
  });

  it("is stable across calls", () => {
    const root = domain({ "a.ts": "1", "b.ts": "2" });
    expect(domainSourceHash(root)).toBe(domainSourceHash(root));
  });

  it("hashes the real domain code", () => {
    expect(domainSourceHash(new URL("../src/domain", import.meta.url).pathname)).toMatch(/^[0-9a-f]{64}$/);
  });
});

it("keeps the cache directory out of git", () => {
  expect(readFileSync(new URL("../.gitignore", import.meta.url).pathname, "utf8").split("\n")).toContain(".cache");
});
