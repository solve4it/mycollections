import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch } from "./search-params.js";

describe("search params (#41)", () => {
  it("keeps every value a string, exactly as written", () => {
    // The router's default JSON-parses values: ?q=1984 became the number 1984,
    // ?q=01984 lost its zero, and ?q=true became a boolean.
    expect(parseSearch("?q=1984&sort=-name")).toEqual({ q: "1984", sort: "-name" });
    expect(parseSearch("?q=01984")).toEqual({ q: "01984" });
    expect(parseSearch("?q=true")).toEqual({ q: "true" });
    expect(parseSearch("")).toEqual({});
  });

  it("writes strings plainly, without JSON quotes, and leaves out empty values", () => {
    expect(stringifySearch({ q: "1984", sort: "-field:a b" })).toBe("?q=1984&sort=-field%3Aa+b");
    expect(stringifySearch({ q: "", sort: undefined })).toBe("");
  });

  it("round-trips text that looks like JSON or holds URL syntax", () => {
    for (const q of ['"quoted"', "[1,2]", "a&b=c", "café ☕", "null"]) {
      expect(parseSearch(stringifySearch({ q }))).toEqual({ q });
    }
  });

  it("does not depend on URLSearchParams.size, which Safari 16 and Chrome 111 lack", () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    Object.defineProperty(URLSearchParams.prototype, "size", { get: () => undefined, configurable: true });
    try {
      expect(stringifySearch({ q: "dune" })).toBe("?q=dune");
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, "size", descriptor);
    }
  });
});
