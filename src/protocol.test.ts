import { describe, expect, it } from "vitest";
import { gen, nextAction, outcomeTone, parseSafeGEN, validAddress, validTarget } from "./protocol";

describe("protocol helpers", () => {
  it("validates StudioNet addresses", () => {
    expect(validAddress("0x" + "a".repeat(40))).toBe(true);
    expect(validAddress("0x" + "0".repeat(40))).toBe(false);
    expect(validAddress("nope")).toBe(false);
  });

  it("validates https target origins without a path", () => {
    expect(validTarget("https://api.acme.io")).toBe(true);
    expect(validTarget("https://api.acme.io/health")).toBe(false);
    expect(validTarget("http://api.acme.io")).toBe(false);
  });

  it("parses GEN into integer wei safely", () => {
    expect(parseSafeGEN("0.001")).toBe(1_000_000_000_000_000);
    expect(() => parseSafeGEN("-1")).toThrow();
    expect(() => parseSafeGEN("abc")).toThrow();
  });

  it("formats wei as GEN", () => {
    expect(gen(1_000_000_000_000_000)).toBe("0.0010 GEN");
  });

  it("maps outcomes to tones and next actions", () => {
    expect(outcomeTone("ACCEPTED")).toBe("good");
    expect(outcomeTone("PARTIAL")).toBe("warn");
    expect(outcomeTone("REJECTED")).toBe("bad");
    expect(nextAction("SUBMITTED", "0xabc")).toBe("SYNC");
    expect(
      nextAction("SUBMITTED", "0xabc", { client: "0xc", terms: { vendor: "0xv" } } as never),
    ).toBe("RUN LIVE REVIEW");
  });
});
