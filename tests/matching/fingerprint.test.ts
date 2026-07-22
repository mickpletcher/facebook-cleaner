import { describe, expect, it } from "vitest";
import {
  canonicalRawRecordHash,
  semanticFingerprint,
} from "../../src/matching/fingerprint.js";

describe("fingerprints", () => {
  it("generates a stable version 1 semantic fingerprint", () => {
    expect(
      semanticFingerprint({
        createdTimestamp: 1_704_067_200,
        normalizedPostText: "Stable fixture",
        normalizedMediaReferences: ["media/photo.jpg"],
        normalizedExternalUrls: ["https://example.com/sample"],
        normalizedPlaceReference: null,
      }),
    ).toBe("bfa46a3b0802cb0ca1943bbe7e457d4175715c0a5fd03ed1491f08e5d3197630");
  });

  it("keeps null and empty text distinct", () => {
    const common = {
      createdTimestamp: 1,
      normalizedMediaReferences: [] as string[],
      normalizedExternalUrls: [] as string[],
      normalizedPlaceReference: null,
    };
    expect(
      semanticFingerprint({ ...common, normalizedPostText: null }),
    ).not.toBe(semanticFingerprint({ ...common, normalizedPostText: "" }));
  });

  it("canonicalizes raw object property order", () => {
    expect(canonicalRawRecordHash({ timestamp: 1, data: [] })).toBe(
      canonicalRawRecordHash({ data: [], timestamp: 1 }),
    );
  });
});
