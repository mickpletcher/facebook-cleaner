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
    values.find((item) => isRecord(item) && item.label === label) ?? null
  ) as Record<string, unknown> | null;
}

export function normalizeCheckinRecord(value: unknown): NormalizedTimelineRecord {
  if (!isRecord(value)) {
    throw new TimelineRecordNormalizationError(
      "The check-in record must be a JSON object.",
    );
  }
  if (
    !Number.isSafeInteger(value.timestamp) ||
    Number(value.timestamp) < 0 ||
    typeof value.fbid !== "string" ||
    value.fbid.length === 0
  ) {
    throw new TimelineRecordNormalizationError(
      "The check-in record must contain a timestamp and Facebook post ID.",
    );
  }

  const message = findLabel(value.label_values, "Message");
  const location = findLabel(value.label_values, "Location");
  const placeTags = findLabel(value.label_values, "Place tags");
  const url = findLabel(value.label_values, "URL");
  const photos = findLabel(value.label_values, "Photos");
  const directPostUrl =
    typeof url?.href === "string"
      ? url.href
      : typeof url?.value === "string"
        ? url.value
        : undefined;
  const media = Array.isArray(photos?.media)
    ? photos.media.filter(isRecord)
    : [];
  const place = {
    name: typeof location?.value === "string" ? location.value : null,
    location: typeof location?.value === "string" ? location.value : null,
    place_tags: Array.isArray(placeTags?.dict) ? placeTags.dict : [],
  };

  return normalizeTimelineRecord({
    timestamp: value.timestamp,
    fbid: value.fbid,
    ...(directPostUrl === undefined ? {} : { post_url: directPostUrl }),
    ...(typeof message?.value === "string"
      ? { data: [{ post: message.value }] }
      : {}),
    attachments: [
      {
        data: [
          { place },
          ...media.map((item) => ({ media: item })),
        ],
      },
    ],
  });
}
