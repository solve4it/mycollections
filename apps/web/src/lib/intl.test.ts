import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatNumber } from "./intl.js";

describe("formatDate", () => {
  it("formats a date in the given locale", () => {
    const date = new Date("2024-01-15T00:00:00Z");
    const result = formatDate(date, "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    expect(result).toBe("January 15, 2024");
  });

  it("accepts a timestamp number", () => {
    const ts = new Date("2024-06-01T00:00:00Z").getTime();
    const result = formatDate(ts, "en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
    expect(result).toBe("6/1/2024");
  });

  it("accepts an ISO string", () => {
    const result = formatDate("2024-12-25T00:00:00Z", "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(result).toBe("December 25, 2024");
  });
});

describe("formatNumber", () => {
  it("formats an integer in US English locale", () => {
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
  });

  it("formats a decimal in US English locale", () => {
    expect(formatNumber(1234567.89, "en-US")).toBe("1,234,567.89");
  });
});

describe("formatCurrency", () => {
  it("formats USD in US English locale", () => {
    expect(formatCurrency(42.5, "en-US", "USD")).toBe("$42.50");
  });

  it("formats whole-dollar amount", () => {
    expect(formatCurrency(100, "en-US", "USD")).toBe("$100.00");
  });
});
