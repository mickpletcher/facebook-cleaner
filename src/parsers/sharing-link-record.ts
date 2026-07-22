import {
  normalizeTimelineRecord,
  TimelineRecordNormalizationError,
  type NormalizedTimelineRecord,
} from "./facebook-record.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSharingLinkRecord(
  value: unknown,
): NormalizedTimelineRecord {
  if (!isRecord(value)) {
    throw new TimelineRecordNormalizationError(
      "The content-sharing-link record must be a JSON object.",
    );
  }
  if (
    !Number.isSafeInteger(value.timestamp) ||
    Number(value.timestamp) < 0 ||
    typeof value.fbid !== "string" ||
    value.fbid.length === 0 ||
    !Array.isArray(value.label_values)
  ) {
    throw new TimelineRecordNormalizationError(
      "The content-sharing-link record must contain a timestamp, Facebook post ID, and labeled URL.",
    );
  }
  const url = value.label_values.find(
    (item) => isRecord(item) && item.label === "URL",
  );
  const href =
    isRecord(url) && typeof url.href === "string"
      ? url.href
      : isRecord(url) && typeof url.value === "string"
        ? url.value
        : null;
  if (href === null) {
    throw new TimelineRecordNormalizationError(
      "The content-sharing-link record must contain a labeled URL.",
    );
  }

  return normalizeTimelineRecord({
    timestamp: value.timestamp,
    fbid: value.fbid,
    attachments: [{ data: [{ external_context: { url: href } }] }],
  });
}
