import { canonicalRawRecordHash } from "../matching/fingerprint.js";
import {
  normalizeTimelineRecord,
  TimelineRecordNormalizationError,
  type NormalizedTimelineRecord,
} from "./facebook-record.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findLabel(
  values: unknown,
  label: string,
): Record<string, unknown> | null {
  if (!Array.isArray(values)) return null;
  return (
    values.find((value) => isRecord(value) && value.label === label) ?? null
  ) as Record<string, unknown> | null;
}

function collectMedia(value: unknown, results: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMedia(item, results);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.uri === "string") results.push(value);
  for (const nested of Object.values(value)) collectMedia(nested, results);
}

export function normalizeStateRecord(
  value: unknown,
  sourceName: "archive" | "trash",
): NormalizedTimelineRecord {
  if (!isRecord(value)) {
    throw new TimelineRecordNormalizationError(
      `The ${sourceName} record must be a JSON object.`,
    );
  }
  if (!Number.isSafeInteger(value.timestamp) || Number(value.timestamp) < 0) {
    throw new TimelineRecordNormalizationError(
      `The ${sourceName} record must contain a valid Unix timestamp.`,
    );
  }
  if (typeof value.fbid !== "string" || value.fbid.length === 0) {
    throw new TimelineRecordNormalizationError(
      `The ${sourceName} record must contain a Facebook post ID.`,
    );
  }

  const message = findLabel(value.label_values, "Message");
  const url = findLabel(value.label_values, "URL");
  const directPostUrl =
    typeof url?.href === "string"
      ? url.href
      : typeof url?.value === "string"
        ? url.value
        : undefined;
  const media: Record<string, unknown>[] = [];
  collectMedia(value.label_values, media);

  const synthetic = {
    timestamp: value.timestamp,
    fbid: value.fbid,
    ...(directPostUrl === undefined ? {} : { post_url: directPostUrl }),
    ...(typeof message?.value === "string"
      ? { data: [{ post: message.value }] }
      : {}),
    ...(media.length === 0
      ? {}
      : { attachments: [{ data: media.map((item) => ({ media: item })) }] }),
  };
  return {
    ...normalizeTimelineRecord(synthetic),
    rawSha256: canonicalRawRecordHash(value),
  };
}

export function normalizeArchiveRecord(value: unknown): NormalizedTimelineRecord {
  return normalizeStateRecord(value, "archive");
}

export function normalizeTrashRecord(value: unknown): NormalizedTimelineRecord {
  return normalizeStateRecord(value, "trash");
}
