import { describe, expect, it } from "vitest";
import { postSeasonFlag } from "./postSeasonFlag.ts";

describe("postSeasonFlag", () => {
  it("is off when VITE_PLAYOFFS is unset or empty", () => {
    expect(postSeasonFlag(undefined)).toBe(false);
    expect(postSeasonFlag("")).toBe(false);
  });

  it("is off when VITE_PLAYOFFS says so", () => {
    expect(postSeasonFlag("false")).toBe(false);
    expect(postSeasonFlag("0")).toBe(false);
  });

  it("is on when VITE_PLAYOFFS is set to anything else", () => {
    expect(postSeasonFlag("true")).toBe(true);
    expect(postSeasonFlag("1")).toBe(true);
  });
});
