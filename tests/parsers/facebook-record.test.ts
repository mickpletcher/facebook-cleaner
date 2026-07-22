import { describe, expect, it } from "vitest";
import {
  normalizeTimelineRecord,
  TimelineRecordNormalizationError,
} from "../../src/parsers/facebook-record.js";

function textRecord(text: string | null): Record<string, unknown> {
  return {
    timestamp: 1_704_067_200,
    data: text === null ? [] : [{ post: text }],
    title: "Mutable title",
  };
}

describe("normalizeTimelineRecord", () => {
  it("extracts and preserves a text post", () => {
    const result = normalizeTimelineRecord(textRecord("Line 1\r\nLine 2"));

    expect(result).toMatchObject({
      identityVersion: 1,
      createdTimestamp: 1_704_067_200,
      createdAtUtc: "2024-01-01T00:00:00.000Z",
      postType: "text",
      postText: "Line 1\r\nLine 2",
      normalizedPostText: "Line 1\nLine 2",
    });
    expect(result.rawSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.semanticFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("extracts media, shared links, source details, and place data", () => {
    const result = normalizeTimelineRecord({
      timestamp: 1_704_067_200,
      data: [{ post: "Caption" }],
      attachments: [
        {
          data: [
            {
              media: {
                uri: ".\\Media\\Sample.JPG",
                media_metadata: { photo_metadata: { exif_data: [] } },
              },
            },
            {
              external_context: {
                url: "HTTPS://Example.COM:443/story#section",
                source: "Example source",
              },
            },
            { place: { name: "Sanitized place", id: "place-1" } },
          ],
        },
      ],
    });

    expect(result.postType).toBe("mixed");
    expect(result.originalMediaReferences).toEqual([".\\Media\\Sample.JPG"]);
    expect(result.normalizedMediaReferences).toEqual(["Media/Sample.JPG"]);
    expect(result.mediaMatchKeys).toEqual(["media/sample.jpg"]);
    expect(result.normalizedExternalUrls).toEqual([
      "https://example.com/story",
    ]);
    expect(result.originalSourceName).toBe("Example source");
    expect(result.originalSourceUrl).toBe(
      "HTTPS://Example.COM:443/story#section",
    );
    expect(result.normalizedPlaceReference).toBe(
      '{"id":"place-1","name":"Sanitized place"}',
    );
  });

  it("derives photo, video, link, check-in, reel, and unknown types", () => {
    const attachment = (data: Record<string, unknown>) => [{ data: [data] }];

    expect(
      normalizeTimelineRecord({
        timestamp: 1,
        attachments: attachment({ media: { uri: "photo.jpg" } }),
      }).postType,
    ).toBe("photo");
    expect(
      normalizeTimelineRecord({
        timestamp: 1,
        attachments: attachment({ media: { uri: "video.mp4" } }),
      }).postType,
    ).toBe("video");
    expect(
      normalizeTimelineRecord({
        timestamp: 1,
        attachments: attachment({
          external_context: { url: "https://example.com" },
        }),
      }).postType,
    ).toBe("link");
    expect(
      normalizeTimelineRecord({
        timestamp: 1,
        attachments: attachment({ place: { id: "place-1" } }),
      }).postType,
    ).toBe("check_in");
    expect(normalizeTimelineRecord({ timestamp: 1 }, "reel").postType).toBe(
      "reel",
    );
    expect(normalizeTimelineRecord({ timestamp: 1 }).postType).toBe("unknown");
  });

  it("makes equivalent line endings and attachment order fingerprint equally", () => {
    const first = {
      timestamp: 1,
      data: [{ post: "Line 1\r\nLine 2" }],
      attachments: [
        {
          data: [
            { media: { uri: "media/B.jpg" } },
            { media: { uri: "media/a.jpg" } },
          ],
        },
      ],
      title: "First title",
    };
    const second = {
      title: "Different title",
      attachments: [
        {
          data: [
            { media: { uri: "MEDIA/A.JPG" } },
            { media: { uri: "MEDIA/b.JPG" } },
          ],
        },
      ],
      data: [{ post: "Line 1\nLine 2" }],
      timestamp: 1,
    };

    expect(normalizeTimelineRecord(first).semanticFingerprint).toBe(
      normalizeTimelineRecord(second).semanticFingerprint,
    );
  });

  it("treats post-text case and URL queries as significant", () => {
    expect(normalizeTimelineRecord(textRecord("Text")).semanticFingerprint).not.toBe(
      normalizeTimelineRecord(textRecord("text")).semanticFingerprint,
    );

    const linkedRecord = (url: string) => ({
      timestamp: 1,
      attachments: [{ data: [{ external_context: { url } }] }],
    });
    expect(
      normalizeTimelineRecord(linkedRecord("https://example.com/?a=1"))
        .semanticFingerprint,
    ).not.toBe(
      normalizeTimelineRecord(linkedRecord("https://example.com/?a=2"))
        .semanticFingerprint,
    );
  });

  it("keeps null and empty post text distinct", () => {
    expect(normalizeTimelineRecord(textRecord(null)).semanticFingerprint).not.toBe(
      normalizeTimelineRecord(textRecord("")).semanticFingerprint,
    );
  });

  it("rejects records without a valid timestamp", () => {
    expect(() => normalizeTimelineRecord({ data: [] })).toThrowError(
      TimelineRecordNormalizationError,
    );
  });
});
