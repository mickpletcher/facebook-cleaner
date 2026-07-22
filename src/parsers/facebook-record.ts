import {
  canonicalJson,
  mediaReferenceMatchKey,
  normalizeMediaReference,
  normalizeText,
  normalizeUrl,
  sortedUnique,
} from "../matching/canonicalization.js";
import {
  canonicalRawRecordHash,
  identityVersion,
  semanticFingerprint,
} from "../matching/fingerprint.js";

export type PostType =
  | "text"
  | "photo"
  | "video"
  | "reel"
  | "link"
  | "check_in"
  | "mixed"
  | "unknown";

export interface NormalizedExternalLink {
  originalUrl: string;
  normalizedUrl: string;
  sourceName: string | null;
}

export interface NormalizedTimelineRecord {
  identityVersion: number;
  facebookPostId: string | null;
  directPostUrl: string | null;
  normalizedDirectPostUrl: string | null;
  createdTimestamp: number;
  createdAtUtc: string;
  postType: PostType;
  postText: string | null;
  normalizedPostText: string | null;
  originalMediaReferences: string[];
  normalizedMediaReferences: string[];
  mediaDetails: Array<{
    normalizedReference: string;
    mediaType: "photo" | "video" | "unknown";
    creationTimestamp: number | null;
    metadataJson: string;
  }>;
  mediaMatchKeys: string[];
  externalLinks: NormalizedExternalLink[];
  normalizedExternalUrls: string[];
  normalizedPlaceReference: string | null;
  originalSourceName: string | null;
  originalSourceUrl: string | null;
  rawSha256: string;
  semanticFingerprint: string;
}

export class TimelineRecordNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineRecordNormalizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsIn(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function attachmentItems(record: Record<string, unknown>): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const visitAttachments = (attachments: unknown): void => {
    for (const attachment of recordsIn(attachments)) {
      for (const item of recordsIn(attachment.data)) {
        items.push(item);
        visitAttachments(item.attachments);
      }
    }
  };
  visitAttachments(record.attachments);
  return items;
}

function extractPostText(record: Record<string, unknown>): string | null {
  for (const dataItem of recordsIn(record.data)) {
    if (typeof dataItem.post === "string") {
      return dataItem.post;
    }
  }
  return null;
}

function mediaKind(media: Record<string, unknown>): "photo" | "video" | "unknown" {
  if (isRecord(media.media_metadata)) {
    if (isRecord(media.media_metadata.video_metadata)) {
      return "video";
    }
    if (isRecord(media.media_metadata.photo_metadata)) {
      return "photo";
    }
  }

  if (typeof media.uri === "string") {
    const withoutQuery = media.uri.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
    if (/\.(mp4|mov|m4v|avi|webm)$/u.test(withoutQuery)) {
      return "video";
    }
    if (/\.(jpe?g|png|gif|webp|heic|heif)$/u.test(withoutQuery)) {
      return "photo";
    }
  }
  return "unknown";
}

function derivePostType(
  sourceKind: "timeline" | "reel",
  mediaKinds: Set<"photo" | "video" | "unknown">,
  hasExternalLink: boolean,
  hasPlace: boolean,
  hasText: boolean,
): PostType {
  if (sourceKind === "reel") {
    return "reel";
  }

  if (mediaKinds.size > 0) {
    if (hasExternalLink || mediaKinds.size > 1 || mediaKinds.has("unknown")) {
      return "mixed";
    }
    return mediaKinds.has("video") ? "video" : "photo";
  }
  if (hasExternalLink) {
    return "link";
  }
  if (hasPlace) {
    return "check_in";
  }
  if (hasText) {
    return "text";
  }
  return "unknown";
}

export function normalizeTimelineRecord(
  value: unknown,
  sourceKind: "timeline" | "reel" = "timeline",
): NormalizedTimelineRecord {
  if (!isRecord(value)) {
    throw new TimelineRecordNormalizationError(
      "The timeline record must be a JSON object.",
    );
  }
  if (!Number.isSafeInteger(value.timestamp) || Number(value.timestamp) < 0) {
    throw new TimelineRecordNormalizationError(
      "The timeline record must contain a valid Unix timestamp.",
    );
  }

  const createdTimestamp = Number(value.timestamp);
  const facebookPostId =
    typeof value.fbid === "string" && value.fbid.length > 0 ? value.fbid : null;
  const directPostUrlValue =
    typeof value.post_url === "string"
      ? value.post_url
      : typeof value.url === "string"
        ? value.url
        : null;
  const normalizedDirectPostUrl =
    directPostUrlValue === null ? null : normalizeUrl(directPostUrlValue);
  const postText = extractPostText(value);
  const normalizedPostText = postText === null ? null : normalizeText(postText);
  const items = attachmentItems(value);
  const originalMediaReferences: string[] = [];
  const normalizedMediaReferences: string[] = [];
  const mediaKinds = new Set<"photo" | "video" | "unknown">();
  const mediaDetails: NormalizedTimelineRecord["mediaDetails"] = [];
  const externalLinks: NormalizedExternalLink[] = [];
  const placeReferences: string[] = [];

  for (const item of items) {
    if (isRecord(item.media)) {
      mediaKinds.add(mediaKind(item.media));
      if (typeof item.media.uri === "string") {
        const normalized = normalizeMediaReference(item.media.uri);
        if (normalized !== null) {
          const kind = mediaKind(item.media);
          originalMediaReferences.push(item.media.uri);
          normalizedMediaReferences.push(normalized);
          mediaDetails.push({
            normalizedReference: normalized,
            mediaType: kind,
            creationTimestamp: Number.isSafeInteger(item.media.creation_timestamp)
              ? Number(item.media.creation_timestamp)
              : null,
            metadataJson: canonicalJson(item.media),
          });
        }
      }
    }

    if (isRecord(item.external_context) && typeof item.external_context.url === "string") {
      const normalizedUrl = normalizeUrl(item.external_context.url);
      if (normalizedUrl !== null) {
        const sourceName =
          typeof item.external_context.source === "string"
            ? item.external_context.source
            : typeof item.external_context.name === "string"
              ? item.external_context.name
              : null;
        externalLinks.push({
          originalUrl: item.external_context.url,
          normalizedUrl,
          sourceName,
        });
      }
    }

    if (isRecord(item.place)) {
      placeReferences.push(canonicalJson(item.place));
    }
  }

  const storedMediaReferences = sortedUnique(normalizedMediaReferences);
  const mediaMatchKeys = sortedUnique(
    storedMediaReferences.map(mediaReferenceMatchKey),
  );
  const normalizedExternalUrls = sortedUnique(
    externalLinks.map((link) => link.normalizedUrl),
  );
  const uniquePlaceReferences = sortedUnique(placeReferences);
  const normalizedPlaceReference =
    uniquePlaceReferences.length === 0
      ? null
      : uniquePlaceReferences.length === 1
        ? uniquePlaceReferences[0] ?? null
        : canonicalJson(uniquePlaceReferences);
  const postType = derivePostType(
    sourceKind,
    mediaKinds,
    externalLinks.length > 0,
    placeReferences.length > 0,
    postText !== null,
  );

  return {
    identityVersion,
    facebookPostId,
    directPostUrl:
      normalizedDirectPostUrl === null ? null : directPostUrlValue,
    normalizedDirectPostUrl,
    createdTimestamp,
    createdAtUtc: new Date(createdTimestamp * 1000).toISOString(),
    postType,
    postText,
    normalizedPostText,
    originalMediaReferences,
    normalizedMediaReferences: storedMediaReferences,
    mediaDetails,
    mediaMatchKeys,
    externalLinks,
    normalizedExternalUrls,
    normalizedPlaceReference,
    originalSourceName:
      externalLinks.find((link) => link.sourceName !== null)?.sourceName ?? null,
    originalSourceUrl: externalLinks[0]?.originalUrl ?? null,
    rawSha256: canonicalRawRecordHash(value),
    semanticFingerprint: semanticFingerprint({
      createdTimestamp,
      normalizedPostText,
      normalizedMediaReferences: mediaMatchKeys,
      normalizedExternalUrls,
      normalizedPlaceReference,
    }),
  };
}
