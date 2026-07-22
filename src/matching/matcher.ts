import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, mediaReferenceMatchKey, normalizeText } from "./canonicalization.js";
import { sha256 } from "./fingerprint.js";
import type { NormalizedTimelineRecord } from "../parsers/facebook-record.js";

interface CandidatePost {
  postId: number;
  semanticFingerprint: string;
  occurrenceSlot: number;
  postText: string | null;
  mediaMatchKeys: Set<string>;
  externalUrls: Set<string>;
}

export interface MatchResult {
  postId: number | null;
  matchRule: string;
  matchRank: number;
  shouldCreate: boolean;
  occurrenceSlot: number;
}

export interface MatcherCounts {
  timestampCounts: Map<number, number>;
  timestampTextCounts: Map<string, number>;
}

function hasOverlap(left: string[], right: Set<string>): boolean {
  return left.some((value) => right.has(value));
}

export function timestampTextKey(
  timestamp: number,
  normalizedText: string,
): string {
  return `${timestamp}:${sha256(canonicalJson(normalizedText))}`;
}

export class DeterministicMatcher {
  readonly #database: DatabaseSync;
  readonly #profileId: string;
  readonly #counts: MatcherCounts;
  readonly #matchedPostIds = new Set<number>();

  constructor(
    database: DatabaseSync,
    profileId: string,
    counts: MatcherCounts,
  ) {
    this.#database = database;
    this.#profileId = profileId;
    this.#counts = counts;
  }

  resetMatchScope(): void {
    this.#matchedPostIds.clear();
  }

  match(
    record: NormalizedTimelineRecord,
    fingerprintOccurrence: number,
    enrichmentOnly = false,
  ): MatchResult {
    if (record.facebookPostId !== null) {
      const candidate = this.#singlePostBy(
        "facebook_post_id = ?",
        record.facebookPostId,
      );
      if (candidate !== null) {
        return this.#existing(candidate.postId, "M01_FACEBOOK_ID", 1);
      }
    }

    if (record.normalizedDirectPostUrl !== null) {
      const candidate = this.#singlePostBy(
        "normalized_direct_post_url = ?",
        record.normalizedDirectPostUrl,
      );
      if (candidate !== null) {
        return this.#existing(candidate.postId, "M02_CONFIRMED_POST_URL", 2);
      }
    }

    const fingerprintCandidate = this.#singlePostBy(
      "semantic_fingerprint = ? AND occurrence_slot = ?",
      record.semanticFingerprint,
      fingerprintOccurrence,
    );
    if (
      fingerprintCandidate !== null &&
      !this.#matchedPostIds.has(fingerprintCandidate.postId)
    ) {
      return this.#existing(
        fingerprintCandidate.postId,
        "M03_SEMANTIC_FINGERPRINT_SLOT",
        3,
      );
    }

    const candidates = this.#timestampCandidates(record.createdTimestamp).filter(
      (candidate) => !this.#matchedPostIds.has(candidate.postId),
    );

    if (record.mediaMatchKeys.length > 0) {
      const mediaMatches = candidates.filter((candidate) =>
        hasOverlap(record.mediaMatchKeys, candidate.mediaMatchKeys),
      );
      if (mediaMatches.length === 1 && mediaMatches[0]) {
        return this.#existing(
          mediaMatches[0].postId,
          "M04_TIMESTAMP_AND_MEDIA",
          4,
        );
      }
    }

    if (record.normalizedExternalUrls.length > 0) {
      const urlMatches = candidates.filter((candidate) =>
        hasOverlap(record.normalizedExternalUrls, candidate.externalUrls),
      );
      if (urlMatches.length === 1 && urlMatches[0]) {
        return this.#existing(
          urlMatches[0].postId,
          "M05_TIMESTAMP_AND_EXTERNAL_URL",
          5,
        );
      }
    }

    if (
      record.normalizedPostText !== null &&
      record.normalizedPostText.length > 0 &&
      (enrichmentOnly ||
        this.#counts.timestampTextCounts.get(
          timestampTextKey(record.createdTimestamp, record.normalizedPostText),
        ) === 1)
    ) {
      const textMatches = candidates.filter(
        (candidate) =>
          candidate.postText !== null &&
          normalizeText(candidate.postText) === record.normalizedPostText,
      );
      if (textMatches.length === 1 && textMatches[0]) {
        return this.#existing(
          textMatches[0].postId,
          "M06_TIMESTAMP_AND_TEXT",
          6,
        );
      }
    }

    if (
      candidates.length === 1 &&
      candidates[0] &&
      (enrichmentOnly ||
        this.#counts.timestampCounts.get(record.createdTimestamp) === 1) &&
      !this.#hasContradictoryEvidence(record, candidates[0])
    ) {
      return this.#existing(
        candidates[0].postId,
        "M07_UNIQUE_TIMESTAMP",
        7,
      );
    }

    const occurrenceSlot = this.#nextAvailableOccurrenceSlot(
      record.semanticFingerprint,
      fingerprintOccurrence,
    );
    return {
      postId: null,
      matchRule: "M08_UNMATCHED_AUTHORITATIVE",
      matchRank: 8,
      shouldCreate: true,
      occurrenceSlot,
    };
  }

  markCreated(postId: number): void {
    this.#matchedPostIds.add(postId);
  }

  #existing(postId: number, matchRule: string, matchRank: number): MatchResult {
    this.#matchedPostIds.add(postId);
    return {
      postId,
      matchRule,
      matchRank,
      shouldCreate: false,
      occurrenceSlot: 0,
    };
  }

  #singlePostBy(whereClause: string, ...parameters: (string | number)[]): CandidatePost | null {
    const row = this.#database
      .prepare(`
        SELECT post_id, semantic_fingerprint, occurrence_slot, post_text
        FROM posts
        WHERE profile_id = ? AND ${whereClause}
      `)
      .get(this.#profileId, ...parameters);
    return row === undefined ? null : this.#candidateFromRow(row);
  }

  #timestampCandidates(timestamp: number): CandidatePost[] {
    return this.#database
      .prepare(`
        SELECT post_id, semantic_fingerprint, occurrence_slot, post_text
        FROM posts
        WHERE profile_id = ? AND created_timestamp = ?
        ORDER BY post_id
      `)
      .all(this.#profileId, timestamp)
      .map((row) => this.#candidateFromRow(row));
  }

  #candidateFromRow(row: Record<string, unknown>): CandidatePost {
    const postId = Number(row.post_id);
    const mediaMatchKeys = new Set(
      this.#database
        .prepare(`
          SELECT media.relative_uri
          FROM media
          JOIN post_media ON post_media.media_id = media.media_id
          WHERE post_media.post_id = ?
        `)
        .all(postId)
        .map((mediaRow) => mediaReferenceMatchKey(String(mediaRow.relative_uri))),
    );
    const externalUrls = new Set(
      this.#database
        .prepare(`
          SELECT normalized_url
          FROM post_links
          WHERE post_id = ? AND link_type IN ('external', 'source')
        `)
        .all(postId)
        .map((linkRow) => String(linkRow.normalized_url)),
    );

    return {
      postId,
      semanticFingerprint: String(row.semantic_fingerprint),
      occurrenceSlot: Number(row.occurrence_slot),
      postText: row.post_text === null ? null : String(row.post_text),
      mediaMatchKeys,
      externalUrls,
    };
  }

  #hasContradictoryEvidence(
    record: NormalizedTimelineRecord,
    candidate: CandidatePost,
  ): boolean {
    if (
      record.mediaMatchKeys.length > 0 &&
      candidate.mediaMatchKeys.size > 0 &&
      !hasOverlap(record.mediaMatchKeys, candidate.mediaMatchKeys)
    ) {
      return true;
    }
    return (
      record.normalizedExternalUrls.length > 0 &&
      candidate.externalUrls.size > 0 &&
      !hasOverlap(record.normalizedExternalUrls, candidate.externalUrls)
    );
  }

  #nextAvailableOccurrenceSlot(
    semanticFingerprint: string,
    preferredSlot: number,
  ): number {
    const rows = this.#database
      .prepare(`
        SELECT occurrence_slot
        FROM posts
        WHERE profile_id = ? AND semantic_fingerprint = ?
        ORDER BY occurrence_slot
      `)
      .all(this.#profileId, semanticFingerprint);
    const used = new Set(rows.map((row) => Number(row.occurrence_slot)));
    if (!used.has(preferredSlot)) {
      return preferredSlot;
    }
    let slot = 1;
    while (used.has(slot)) {
      slot += 1;
    }
    return slot;
  }
}
