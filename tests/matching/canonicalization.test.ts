import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  mediaReferenceMatchKey,
  normalizeMediaReference,
  normalizeText,
  normalizeUrl,
  sortedUnique,
} from "../../src/matching/canonicalization.js";

describe("canonicalization", () => {
  it("normalizes Unicode and line endings while preserving other whitespace", () => {
    expect(normalizeText("Cafe\u0301\r\nLine 2\rLine 3  ")).toBe(
      "Café\nLine 2\nLine 3  ",
    );
  });

  it("normalizes URL scheme, host, port, and fragment", () => {
    expect(
      normalizeUrl("HTTPS://Example.COM:443/a/%2F?b=2&a=1#private-fragment"),
    ).toBe("https://example.com/a/%2F?b=2&a=1");
  });

  it("preserves URL query values and parameter order", () => {
    expect(normalizeUrl("https://example.com/?a=1&b=2")).not.toBe(
      normalizeUrl("https://example.com/?b=2&a=1"),
    );
    expect(normalizeUrl("not an absolute URL")).toBeNull();
  });

  it("normalizes media separators and supplies a case-insensitive match key", () => {
    const normalized = normalizeMediaReference(
      ".\\Media\\Photos////Sample.JPG",
    );
    expect(normalized).toBe("Media/Photos/Sample.JPG");
    expect(mediaReferenceMatchKey(normalized ?? "")).toBe(
      "media/photos/sample.jpg",
    );
  });

  it("serializes object keys canonically", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: null } })).toBe(
      '{"a":{"b":null,"y":true},"z":1}',
    );
  });

  it("sorts and removes exact duplicates", () => {
    expect(sortedUnique(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});
