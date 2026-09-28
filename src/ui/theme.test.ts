import { describe, expect, it } from "vitest";
import { readTheme, storeTheme, THEME_KEY } from "./theme.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const failing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("readTheme", () => {
  it("reads a stored light or dark theme", () => {
    expect(readTheme(memoryStorage({ [THEME_KEY]: "light" }))).toBe("light");
    expect(readTheme(memoryStorage({ [THEME_KEY]: "dark" }))).toBe("dark");
  });

  it("follows the system when nothing, or something unknown, is stored", () => {
    expect(readTheme(memoryStorage())).toBe("system");
    expect(readTheme(memoryStorage({ [THEME_KEY]: "sepia" }))).toBe("system");
  });

  it("follows the system when storage is missing or blocked", () => {
    expect(readTheme(undefined)).toBe("system");
    expect(readTheme(failing)).toBe("system");
  });
});

describe("storeTheme", () => {
  it("round-trips through readTheme", () => {
    const storage = memoryStorage();
    storeTheme(storage, "dark");
    expect(readTheme(storage)).toBe("dark");
  });

  it("forgets the choice for system, so a later system change is followed", () => {
    const storage = memoryStorage({ [THEME_KEY]: "light" });
    storeTheme(storage, "system");
    expect(storage.items.has(THEME_KEY)).toBe(false);
  });

  it("swallows blocked storage", () => {
    expect(() => storeTheme(failing, "light")).not.toThrow();
  });
});
