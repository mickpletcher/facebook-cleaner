import {
  normalizeTimelineRecord,
  TimelineRecordNormalizationError,
  type NormalizedTimelineRecord,
} from "./facebook-record.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMediaMetadataRecord(
  value: unknown,
  sourceName: "video" | "photo",
): NormalizedTimelineRecord {
  if (!isRecord(value)) {
    throw new TimelineRecordNormalizationError(
      `The ${sourceName} metadata record must be a JSON object.`,
    );
  }
  if (
    typeof value.uri !== "string" ||
    !Number.isSafeInteger(value.creation_timestamp) ||
    Number(value.creation_timestamp) < 0
  ) {
    throw new TimelineRecordNormalizationError(
      `The ${sourceName} metadata record must contain a media URI and creation timestamp.`,
    );
  }

  return normalizeTimelineRecord({
    timestamp: value.creation_timestamp,
    ...(typeof value.description === "string"
      ? { data: [{ post: value.description }] }
      : {}),
    attachments: [{ data: [{ media: value }] }],
  });
}

export function normalizeVideoRecord(value: unknown): NormalizedTimelineRecord {
  return normalizeMediaMetadataRecord(value, "video");
}

export function normalizePhotoRecord(value: unknown): NormalizedTimelineRecord {
  return normalizeMediaMetadataRecord(value, "photo");
}
