import { describe, expect, it } from "vite-plus/test";
import { compactCurrency, currency, formatCell, number, percent } from "./format.ts";

describe("currency", () => {
  it("formats positive integers as USD with no decimals", () => {
    expect(currency(1234567)).toBe("$1,234,567");
  });

  it("formats zero", () => {
    expect(currency(0)).toBe("$0");
  });

  it("formats negative values", () => {
    expect(currency(-500)).toBe("-$500");
  });
});

describe("compactCurrency", () => {
  it("abbreviates millions", () => {
    expect(compactCurrency(1_200_000)).toBe("$1.2M");
  });

  it("abbreviates thousands", () => {
    expect(compactCurrency(340_000)).toBe("$340K");
  });
});

describe("number", () => {
  it("rounds to one decimal place", () => {
    expect(number(42.678)).toBe("42.7");
  });

  it("formats integers without decimals", () => {
    expect(number(100)).toBe("100");
  });

  it("formats zero", () => {
    expect(number(0)).toBe("0");
  });
});

describe("percent", () => {
  it("formats a ratio as a percentage", () => {
    expect(percent(0.1234)).toBe("12.3%");
  });

  it("returns n/a for null", () => {
    expect(percent(null)).toBe("n/a");
  });

  it("returns n/a for undefined", () => {
    expect(percent(undefined)).toBe("n/a");
  });

  it("formats 0%", () => {
    expect(percent(0)).toBe("0%");
  });

  it("formats 100%", () => {
    expect(percent(1)).toBe("100%");
  });
});

describe("formatCell", () => {
  it("uses number() for Headcount account", () => {
    expect(formatCell("Headcount", 42)).toBe("42");
  });

  it("uses currency() for Revenue account", () => {
    expect(formatCell("Revenue", 500000)).toBe("$500,000");
  });

  it("uses currency() for COGS account", () => {
    expect(formatCell("COGS", 100)).toBe("$100");
  });

  it("uses currency() for OpEx account", () => {
    expect(formatCell("OpEx", 250000)).toBe("$250,000");
  });
});
