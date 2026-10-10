import { describe, expect, it } from "vitest";
import { playoffsFlag } from "./playoffsFlag.ts";

describe("playoffsFlag", () => {
  it("is off when VITE_PLAYOFFS is unset or empty", () => {
    expect(playoffsFlag(undefined)).toBe(false);
    expect(playoffsFlag("")).toBe(false);
  });

  it("is off when VITE_PLAYOFFS says so", () => {
    expect(playoffsFlag("false")).toBe(false);
    expect(playoffsFlag("0")).toBe(false);
  });

  it("is on when VITE_PLAYOFFS is set to anything else", () => {
    expect(playoffsFlag("true")).toBe(true);
    expect(playoffsFlag("1")).toBe(true);
  });
});
