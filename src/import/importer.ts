import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { InventoryDatabase } from "../database/connection.js";
import { canonicalJson, mediaReferenceMatchKey } from "../matching/canonicalization.js";
import { canonicalRawRecordHash, sha256 } from "../matching/fingerprint.js";
import {
  DeterministicMatcher,
  timestampTextKey,
  type MatcherCounts,
} from "../matching/matcher.js";
import {
  normalizeTimelineRecord,
  type NormalizedTimelineRecord,
} from "../parsers/facebook-record.js";
import {
  normalizeArchiveRecord,
  normalizeTrashRecord,
} from "../parsers/archive-record.js";
import {
  normalizePhotoRecord,
  normalizeVideoRecord,
} from "../parsers/video-record.js";
import { normalizeCheckinRecord } from "../parsers/checkin-record.js";
import { normalizeSharingLinkRecord } from "../parsers/sharing-link-record.js";
import { streamTimelineRecords } from "../parsers/timeline.js";
import { discoverTimelineSources } from "./source-discovery.js";
import type {
  TimelineImportOptions,
  TimelineImportReport,
} from "./types.js";

interface ImportCounters {
  recordsExamined: number;
  recordsMatched: number;
  postsAdded: number;
  updatedPostIds: Set<number>;
  recordsAmbiguous: number;
  recordsSkipped: number;
  errorCount: number;
  matchRuleCounts: Map<string, number>;
}

interface CanonicalUpdateResult {
  changed: boolean;
  identityConflict: boolean;
}

interface ReconciledRunMetrics {
  recordsExamined: number;
  recordsMatched: number;
  postsAdded: number;
  postsUpdated: number;
  recordsAmbiguous: number;
  recordsSkipped: number;
  errorCount: number;
  matchRuleCounts: Record<string, number>;
}

class PeakMemoryTracker {
  peakRssBytes = 0;

  sample(): void {
    this.peakRssBytes = Math.max(this.peakRssBytes, process.memoryUsage().rss);
  }
}

const defaultBatchSize = 500;
type SourceKind =
  | "timeline"
  | "archive"
  | "trash"
  | "reel"
  | "video_metadata"
  | "photo_metadata"
  | "album_metadata"
  | "checkin_metadata"
  | "sharing_link_metadata";

function isMediaMetadataSource(sourceKind: SourceKind): boolean {
  return (
    sourceKind === "video_metadata" ||
    sourceKind === "photo_metadata" ||
    sourceKind === "album_metadata"
  );
}

function isEnrichmentSource(sourceKind: SourceKind): boolean {
  return (
    isMediaMetadataSource(sourceKind) ||
    sourceKind === "checkin_metadata" ||
    sourceKind === "sharing_link_metadata"
  );
}

function normalizeSourceRecord(
  value: unknown,
  sourceKind: SourceKind,
): NormalizedTimelineRecord {
  if (sourceKind === "archive") return normalizeArchiveRecord(value);
  if (sourceKind === "trash") return normalizeTrashRecord(value);
  if (sourceKind === "reel") return normalizeTimelineRecord(value, "reel");
  if (sourceKind === "video_metadata") return normalizeVideoRecord(value);
  if (sourceKind === "photo_metadata") return normalizePhotoRecord(value);
  if (sourceKind === "album_metadata") return normalizePhotoRecord(value);
  if (sourceKind === "checkin_metadata") return normalizeCheckinRecord(value);
  if (sourceKind === "sharing_link_metadata") {
    return normalizeSharingLinkRecord(value);
  }
  return normalizeTimelineRecord(value);
}

function getOrCreateDefaultProfile(
  database: DatabaseSync,
  profileLabel: string,
  now: string,
): string {
  const metadata = database
    .prepare("SELECT value FROM schema_metadata WHERE key = 'default_profile_id'")
    .get();
  if (metadata !== undefined) {
    return String(metadata.value);
  }

  const profileId = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(`
        INSERT INTO profiles(profile_id, profile_label, created_at_utc)
        VALUES (?, ?, ?)
      `)
      .run(profileId, profileLabel, now);
    database
      .prepare(`
        INSERT INTO schema_metadata(key, value)
        VALUES ('default_profile_id', ?)
      `)
      .run(profileId);
    database.exec("COMMIT");
    return profileId;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function getOrCreateCollectionSet(
  database: DatabaseSync,
  profileId: string,
  sourceFingerprint: string,
  rootCount: number,
  now: string,
): string {
  const existing = database
    .prepare(`
      SELECT collection_set_id
      FROM collection_sets
      WHERE profile_id = ? AND source_fingerprint = ?
    `)
    .get(profileId, sourceFingerprint);
  if (existing !== undefined) {
    return String(existing.collection_set_id);
  }

  const collectionSetId = randomUUID();
  database
    .prepare(`
      INSERT INTO collection_sets(
        collection_set_id,
        profile_id,
        source_fingerprint,
        root_count,
        registered_at_utc
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(collectionSetId, profileId, sourceFingerprint, rootCount, now);
  return collectionSetId;
}

function addImportError(
  database: DatabaseSync,
  importRunId: string,
  sourceFileId: number | null,
  recordIndex: number | null,
  errorCode: string,
  message: string,
): void {
  database
    .prepare(`
      INSERT INTO import_errors(
        import_run_id,
        source_file_id,
        record_index,
        error_code,
        message,
        created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      importRunId,
      sourceFileId,
      recordIndex,
      errorCode,
      message,
      new Date().toISOString(),
    );
}

async function ingestSourceRecords(
  database: DatabaseSync,
  importRunId: string,
  sources: Awaited<ReturnType<typeof discoverTimelineSources>>["sourceFiles"],
  batchSize: number,
  counters: ImportCounters,
  memory: PeakMemoryTracker,
): Promise<void> {
  const insertSourceFile = database.prepare(`
    INSERT INTO source_files(
      import_run_id,
      export_root_number,
      relative_path,
      source_kind,
      size_bytes,
      sha256,
      parse_status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  const insertSourceRecord = database.prepare(`
    INSERT INTO source_records(
      source_file_id,
      record_index,
      source_kind,
      raw_json,
      raw_sha256,
      semantic_fingerprint,
      facebook_post_id,
      created_timestamp,
      parse_status,
      match_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const source of sources) {
    const sourceFileResult = insertSourceFile.run(
      importRunId,
      source.exportRootNumber,
      source.relativePath,
      source.sourceKind,
      source.sizeBytes,
      source.sha256,
    );
    const sourceFileId = Number(sourceFileResult.lastInsertRowid);
    let fileRecordCount = 0;
    let fileErrorCount = 0;
    let transactionOpen = false;

    try {
      for await (const streamed of streamTimelineRecords(source)) {
        if (!transactionOpen) {
          database.exec("BEGIN IMMEDIATE");
          transactionOpen = true;
        }

        const rawJson = canonicalJson(streamed.value);
        try {
          const normalized = normalizeSourceRecord(streamed.value, source.sourceKind);
          insertSourceRecord.run(
            sourceFileId,
            streamed.recordIndex,
            source.sourceKind,
            rawJson,
            normalized.rawSha256,
            normalized.semanticFingerprint,
            normalized.facebookPostId,
            normalized.createdTimestamp,
            "parsed",
            "pending",
          );
        } catch {
          const parseStatus =
            typeof streamed.value === "object" && streamed.value !== null
              ? "partial"
              : "unsupported";
          insertSourceRecord.run(
            sourceFileId,
            streamed.recordIndex,
            source.sourceKind,
            rawJson,
            canonicalRawRecordHash(streamed.value),
            null,
            null,
            null,
            parseStatus,
            "skipped",
          );
          addImportError(
            database,
            importRunId,
            sourceFileId,
            streamed.recordIndex,
            parseStatus === "partial" ? "RECORD_PARTIAL" : "RECORD_UNSUPPORTED",
            "The timeline entry could not be normalized.",
          );
          counters.recordsSkipped += 1;
          counters.errorCount += 1;
          fileErrorCount += 1;
        }

        counters.recordsExamined += 1;
        fileRecordCount += 1;
        if (fileRecordCount % batchSize === 0) {
          database.exec("COMMIT");
          transactionOpen = false;
          memory.sample();
        }
      }
      if (transactionOpen) {
        database.exec("COMMIT");
        transactionOpen = false;
      }
      database
        .prepare(`
          UPDATE source_files
          SET record_count = ?, parse_status = ?
          WHERE source_file_id = ?
        `)
        .run(
          fileRecordCount,
          fileErrorCount === 0 ? "completed" : "partial",
          sourceFileId,
        );
      memory.sample();
    } catch (error) {
      if (transactionOpen) {
        database.exec("ROLLBACK");
      }
      database
        .prepare(`
          UPDATE source_files
          SET record_count = ?, parse_status = 'failed'
          WHERE source_file_id = ?
        `)
        .run(fileRecordCount, sourceFileId);
      addImportError(
        database,
        importRunId,
        sourceFileId,
        null,
        "JSON_INVALID",
        "The source file contains invalid or incomplete JSON.",
      );
      counters.errorCount += 1;
      throw error;
    }
  }
}

function buildMatcherCounts(
  database: DatabaseSync,
  importRunId: string,
): MatcherCounts {
  const timestampCounts = new Map<number, number>();
  const timestampTextCounts = new Map<string, number>();
  const rows = database
    .prepare(`
      SELECT source_records.raw_json, source_records.source_kind
      FROM source_records
      JOIN source_files USING(source_file_id)
      WHERE source_files.import_run_id = ?
        AND source_records.parse_status = 'parsed'
    `)
    .iterate(importRunId);

  for (const row of rows) {
    const normalized = normalizeSourceRecord(
      JSON.parse(String(row.raw_json)),
      String(row.source_kind) as SourceKind,
    );
    timestampCounts.set(
      normalized.createdTimestamp,
      (timestampCounts.get(normalized.createdTimestamp) ?? 0) + 1,
    );
    if (
      normalized.normalizedPostText !== null &&
      normalized.normalizedPostText.length > 0
    ) {
      const key = timestampTextKey(
        normalized.createdTimestamp,
        normalized.normalizedPostText,
      );
      timestampTextCounts.set(key, (timestampTextCounts.get(key) ?? 0) + 1);
    }
  }
  return { timestampCounts, timestampTextCounts };
}

function insertMediaAndLinks(
  database: DatabaseSync,
  postId: number,
  record: NormalizedTimelineRecord,
  sourceKind: SourceKind,
): boolean {
  let changed = false;
  const insertMedia = database.prepare(`
    INSERT OR IGNORE INTO media(
      reference_fingerprint,
      relative_uri,
      media_type,
      availability
    ) VALUES (?, ?, ?, 'unresolved')
  `);
  const findMedia = database.prepare(
    "SELECT media_id FROM media WHERE reference_fingerprint = ?",
  );
  const enrichMedia = database.prepare(`
    UPDATE media
    SET media_type = ?, creation_timestamp = ?, metadata_json = ?
    WHERE reference_fingerprint = ?
      AND (media_type <> ?
           OR creation_timestamp IS NOT ?
           OR metadata_json IS NOT ?)
  `);
  const insertPostMedia = database.prepare(`
    INSERT OR IGNORE INTO post_media(post_id, media_id, ordinal, role)
    VALUES (?, ?, ?, 'attachment')
  `);

  for (const [ordinal, reference] of record.normalizedMediaReferences.entries()) {
    const referenceFingerprint = sha256(mediaReferenceMatchKey(reference));
    const mediaType =
      record.postType === "photo" || record.postType === "video"
        ? record.postType
        : "unknown";
    if (insertMedia.run(referenceFingerprint, reference, mediaType).changes > 0) {
      changed = true;
    }
    if (isMediaMetadataSource(sourceKind)) {
      const detail = record.mediaDetails.find(
        (item) => item.normalizedReference === reference,
      );
      if (
        detail !== undefined &&
        enrichMedia.run(
          detail.mediaType,
          detail.creationTimestamp,
          detail.metadataJson,
          referenceFingerprint,
          detail.mediaType,
          detail.creationTimestamp,
          detail.metadataJson,
        ).changes > 0
      ) {
        changed = true;
      }
    }
    const mediaRow = findMedia.get(referenceFingerprint);
    if (
      mediaRow !== undefined &&
      insertPostMedia.run(postId, Number(mediaRow.media_id), ordinal).changes > 0
    ) {
      changed = true;
    }
  }

  const insertLink = database.prepare(`
    INSERT OR IGNORE INTO post_links(
      post_id,
      url,
      normalized_url,
      link_type,
      source_name,
      ordinal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [ordinal, link] of record.externalLinks.entries()) {
    if (
      insertLink.run(
        postId,
        link.originalUrl,
        link.normalizedUrl,
        link.sourceName === null ? "external" : "source",
        link.sourceName,
        ordinal,
      ).changes > 0
    ) {
      changed = true;
    }
  }
  return changed;
}

function insertPlace(
  database: DatabaseSync,
  postId: number,
  record: NormalizedTimelineRecord,
  now: string,
): boolean {
  if (
    record.normalizedPlaceReference === null ||
    record.placeMetadataJson === null
  ) {
    return false;
  }
  const placeFingerprint = sha256(record.normalizedPlaceReference);
  const insertedPlace = database
    .prepare(`
      INSERT OR IGNORE INTO places(place_fingerprint, place_name, metadata_json)
      VALUES (?, ?, ?)
    `)
    .run(placeFingerprint, record.placeName, record.placeMetadataJson).changes;
  const place = database
    .prepare("SELECT place_id FROM places WHERE place_fingerprint = ?")
    .get(placeFingerprint);
  if (place === undefined) throw new Error("Matched place does not exist.");
  const insertedRelationship = database
    .prepare(`
      INSERT OR IGNORE INTO post_places(
        post_id, place_id, first_collected_at_utc, last_collected_at_utc
      ) VALUES (?, ?, ?, ?)
    `)
    .run(postId, Number(place.place_id), now, now).changes;
  database
    .prepare(`
      UPDATE post_places SET last_collected_at_utc = ?
      WHERE post_id = ? AND place_id = ?
    `)
    .run(now, postId, Number(place.place_id));
  return insertedPlace > 0 || insertedRelationship > 0;
}

function createPost(
  database: DatabaseSync,
  profileId: string,
  record: NormalizedTimelineRecord,
  occurrenceSlot: number,
  now: string,
  sourceKind: SourceKind,
): number {
  const result = database
    .prepare(`
      INSERT INTO posts(
        record_id,
        profile_id,
        facebook_post_id,
        direct_post_url,
        normalized_direct_post_url,
        created_timestamp,
        created_at_utc,
        post_type,
        post_text,
        audience,
        audience_status,
        original_source_name,
        original_source_url,
        facebook_state,
        state_status,
        semantic_fingerprint,
        occurrence_slot,
        identity_version,
        collection_status,
        first_collected_at_utc,
        last_collected_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'unavailable', ?, ?,
                ?, ?, ?, ?, ?, 'partial', ?, ?)
    `)
    .run(
      randomUUID(),
      profileId,
      record.facebookPostId,
      record.directPostUrl,
      record.normalizedDirectPostUrl,
      record.createdTimestamp,
      record.createdAtUtc,
      record.postType,
      record.postText,
      record.originalSourceName,
      record.originalSourceUrl,
      sourceKind === "trash"
        ? "trash"
        : sourceKind === "archive"
          ? "archived"
          : "active",
      sourceKind === "archive" || sourceKind === "trash" ? "confirmed" : "derived",
      record.semanticFingerprint,
      occurrenceSlot,
      record.identityVersion,
      now,
      now,
    );
  const postId = Number(result.lastInsertRowid);
  insertMediaAndLinks(database, postId, record, sourceKind);
  return postId;
}

function updatePost(
  database: DatabaseSync,
  postId: number,
  record: NormalizedTimelineRecord,
  now: string,
  sourceKind: SourceKind,
): CanonicalUpdateResult {
  const current = database.prepare("SELECT * FROM posts WHERE post_id = ?").get(postId);
  if (current === undefined) {
    throw new Error("Matched canonical post does not exist.");
  }

  const preserveReelCanonical =
    current.post_type === "reel" && sourceKind !== "reel";
  const preserveCanonicalIdentity =
    preserveReelCanonical || isEnrichmentSource(sourceKind);
  const nextPostText = preserveCanonicalIdentity
    ? current.post_text === null
      ? null
      : String(current.post_text)
    : record.postText;
  const nextSemanticFingerprint = preserveCanonicalIdentity
    ? String(current.semantic_fingerprint)
    : record.semanticFingerprint;
  const nextIdentityVersion = preserveCanonicalIdentity
    ? Number(current.identity_version)
    : record.identityVersion;
  const occurrenceSlot = Number(current.occurrence_slot);
  if (String(current.semantic_fingerprint) !== nextSemanticFingerprint) {
    const conflict = database
      .prepare(`
        SELECT post_id
        FROM posts
        WHERE profile_id = ?
          AND semantic_fingerprint = ?
          AND occurrence_slot = ?
          AND post_id <> ?
      `)
      .get(
        String(current.profile_id),
        nextSemanticFingerprint,
        occurrenceSlot,
        postId,
      );
    if (conflict !== undefined) {
      return { changed: false, identityConflict: true };
    }
  }

  const nextFacebookPostId =
    current.facebook_post_id === null
      ? record.facebookPostId
      : String(current.facebook_post_id);
  const nextDirectPostUrl =
    current.direct_post_url === null
      ? record.directPostUrl
      : String(current.direct_post_url);
  const nextNormalizedDirectPostUrl =
    current.normalized_direct_post_url === null
      ? record.normalizedDirectPostUrl
      : String(current.normalized_direct_post_url);
  const nextPostType =
    preserveReelCanonical
      ? "reel"
      : isEnrichmentSource(sourceKind)
        ? String(current.post_type)
      : record.postType === "unknown"
        ? String(current.post_type)
        : record.postType;
  const nextSourceName =
    record.originalSourceName ??
    (current.original_source_name === null
      ? null
      : String(current.original_source_name));
  const nextSourceUrl =
    record.originalSourceUrl ??
    (current.original_source_url === null
      ? null
      : String(current.original_source_url));
  const nextFacebookState =
    sourceKind === "trash"
      ? "trash"
      : sourceKind === "archive" && current.facebook_state !== "trash"
        ? "archived"
        : String(current.facebook_state);
  const nextStateStatus =
    sourceKind === "archive" || sourceKind === "trash"
      ? "confirmed"
      : String(current.state_status);

  let changed =
    current.facebook_post_id !== nextFacebookPostId ||
    current.direct_post_url !== nextDirectPostUrl ||
    current.normalized_direct_post_url !== nextNormalizedDirectPostUrl ||
    current.post_type !== nextPostType ||
    current.post_text !== nextPostText ||
    current.original_source_name !== nextSourceName ||
    current.original_source_url !== nextSourceUrl ||
    current.facebook_state !== nextFacebookState ||
    current.state_status !== nextStateStatus ||
    current.semantic_fingerprint !== nextSemanticFingerprint ||
    Number(current.identity_version) !== nextIdentityVersion;

  database
    .prepare(`
      UPDATE posts
      SET facebook_post_id = ?,
          direct_post_url = ?,
          normalized_direct_post_url = ?,
          post_type = ?,
          post_text = ?,
          original_source_name = ?,
          original_source_url = ?,
          facebook_state = ?,
          state_status = ?,
          semantic_fingerprint = ?,
          identity_version = ?,
          last_collected_at_utc = ?
      WHERE post_id = ?
    `)
    .run(
      nextFacebookPostId,
      nextDirectPostUrl,
      nextNormalizedDirectPostUrl,
      nextPostType,
      nextPostText,
      nextSourceName,
      nextSourceUrl,
      nextFacebookState,
      nextStateStatus,
      nextSemanticFingerprint,
      nextIdentityVersion,
      now,
      postId,
    );
  changed = insertMediaAndLinks(database, postId, record, sourceKind) || changed;
  return { changed, identityConflict: false };
}

function incrementRule(counters: ImportCounters, rule: string): void {
  counters.matchRuleCounts.set(
    rule,
    (counters.matchRuleCounts.get(rule) ?? 0) + 1,
  );
}

function matchSourceRecords(
  database: DatabaseSync,
  importRunId: string,
  profileId: string,
  batchSize: number,
  counters: ImportCounters,
  memory: PeakMemoryTracker,
): void {
  const counts = buildMatcherCounts(database, importRunId);
  const matcher = new DeterministicMatcher(database, profileId, counts);
  const orderedIds = database
    .prepare(`
      SELECT source_records.source_record_id
      FROM source_records
      JOIN source_files USING(source_file_id)
      WHERE source_files.import_run_id = ?
        AND source_records.parse_status = 'parsed'
      ORDER BY CASE source_records.source_kind
                 WHEN 'timeline' THEN 0
                 WHEN 'archive' THEN 1
                 WHEN 'trash' THEN 2
                 WHEN 'reel' THEN 3
                 WHEN 'video_metadata' THEN 4
                 WHEN 'photo_metadata' THEN 5
                 WHEN 'album_metadata' THEN 6
                 WHEN 'checkin_metadata' THEN 7
                 ELSE 8
               END,
               source_records.semantic_fingerprint,
               source_records.raw_sha256,
               source_files.relative_path,
               source_records.record_index
    `)
    .all(importRunId)
    .map((row) => Number(row.source_record_id));
  const getSourceRecord = database.prepare(`
    SELECT source_record_id, raw_json, semantic_fingerprint, source_kind
    FROM source_records
    WHERE source_record_id = ?
  `);
  const updateMatchStatus = database.prepare(`
    UPDATE source_records SET match_status = ? WHERE source_record_id = ?
  `);
  const insertObservation = database.prepare(`
    INSERT INTO post_observations(
      post_id,
      source_record_id,
      match_rule,
      match_rank,
      matched_at_utc,
      changed_canonical_post
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  let currentFingerprint: string | null = null;
  let fingerprintOccurrence = 0;
  let transactionOpen = false;
  let recordsInTransaction = 0;
  let currentSourceKind: SourceKind | null = null;

  try {
    for (const sourceRecordId of orderedIds) {
      if (!transactionOpen) {
        database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
      }
      const source = getSourceRecord.get(sourceRecordId);
      if (source === undefined) {
        throw new Error("Source record disappeared during matching.");
      }
      const sourceKind = String(source.source_kind) as SourceKind;
      if (sourceKind !== currentSourceKind) {
        matcher.resetMatchScope();
        currentSourceKind = sourceKind;
        currentFingerprint = null;
        fingerprintOccurrence = 0;
      }
      const fingerprint = String(source.semantic_fingerprint);
      if (fingerprint === currentFingerprint) {
        fingerprintOccurrence += 1;
      } else {
        currentFingerprint = fingerprint;
        fingerprintOccurrence = 1;
      }
      const normalized = normalizeSourceRecord(
        JSON.parse(String(source.raw_json)),
        sourceKind,
      );
      const match = matcher.match(
        normalized,
        fingerprintOccurrence,
        isEnrichmentSource(sourceKind),
      );
      const now = new Date().toISOString();
      let postId: number;
      let changed: boolean;

      if (match.shouldCreate) {
        if (isEnrichmentSource(sourceKind)) {
          updateMatchStatus.run("skipped", sourceRecordId);
          counters.recordsSkipped += 1;
          recordsInTransaction += 1;
          if (recordsInTransaction >= batchSize) {
            database.exec("COMMIT");
            transactionOpen = false;
            recordsInTransaction = 0;
            memory.sample();
          }
          continue;
        }
        postId = createPost(
          database,
          profileId,
          normalized,
          match.occurrenceSlot,
          now,
          sourceKind,
        );
        matcher.markCreated(postId);
        counters.postsAdded += 1;
        changed = true;
        updateMatchStatus.run("created", sourceRecordId);
      } else {
        if (match.postId === null) {
          throw new Error("Existing match did not provide a post ID.");
        }
        postId = match.postId;
        const update = updatePost(database, postId, normalized, now, sourceKind);
        if (update.identityConflict) {
          updateMatchStatus.run("ambiguous", sourceRecordId);
          addImportError(
            database,
            importRunId,
            null,
            null,
            "IDENTITY_CONFLICT",
            "A matched post conflicts with an existing semantic identity slot.",
          );
          counters.recordsAmbiguous += 1;
          counters.errorCount += 1;
          recordsInTransaction += 1;
          continue;
        }
        changed = update.changed;
        if (changed) {
          counters.updatedPostIds.add(postId);
        }
        counters.recordsMatched += 1;
        updateMatchStatus.run("matched", sourceRecordId);
      }

      if (
        sourceKind === "checkin_metadata" &&
        insertPlace(database, postId, normalized, now)
      ) {
        changed = true;
        counters.updatedPostIds.add(postId);
      }

      insertObservation.run(
        postId,
        sourceRecordId,
        match.matchRule,
        match.matchRank,
        now,
        changed ? 1 : 0,
      );
      if (sourceKind === "archive" || sourceKind === "trash") {
        const facebookState = sourceKind === "trash" ? "trash" : "archived";
        database.prepare(`
          INSERT OR IGNORE INTO post_state_observations(
            post_id, source_record_id, facebook_state, observed_at_utc, is_confirmed
          ) VALUES (?, ?, ?, ?, 1)
        `).run(postId, sourceRecordId, facebookState, now);
      }
      incrementRule(counters, match.matchRule);
      recordsInTransaction += 1;

      if (recordsInTransaction >= batchSize) {
        database.exec("COMMIT");
        transactionOpen = false;
        recordsInTransaction = 0;
        memory.sample();
      }
    }
    if (transactionOpen) {
      database.exec("COMMIT");
    }
    memory.sample();
  } catch (error) {
    if (transactionOpen) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

function numberValue(
  database: DatabaseSync,
  sql: string,
  ...parameters: (string | number)[]
): number {
  const row = database.prepare(sql).get(...parameters);
  return Number(row?.value ?? 0);
}

function reconcileRunMetrics(
  database: DatabaseSync,
  importRunId: string,
): ReconciledRunMetrics {
  const matchRuleCounts = Object.fromEntries(
    database
      .prepare(`
        SELECT post_observations.match_rule, COUNT(*) AS count
        FROM post_observations
        JOIN source_records USING(source_record_id)
        JOIN source_files USING(source_file_id)
        WHERE source_files.import_run_id = ?
        GROUP BY post_observations.match_rule
        ORDER BY post_observations.match_rule
      `)
      .all(importRunId)
      .map((row) => [String(row.match_rule), Number(row.count)]),
  );
  const unmatchedEnrichment = numberValue(
    database,
    `SELECT COUNT(*) AS value
     FROM source_records JOIN source_files USING(source_file_id)
     WHERE source_files.import_run_id = ?
       AND source_records.source_kind IN (
         'video_metadata', 'photo_metadata', 'album_metadata', 'checkin_metadata',
         'sharing_link_metadata'
       )
       AND source_records.match_status = 'skipped'`,
    importRunId,
  );
  if (unmatchedEnrichment > 0) {
    matchRuleCounts.M09_UNMATCHED_ENRICHMENT = unmatchedEnrichment;
  }

  return {
    recordsExamined: numberValue(
      database,
      `SELECT COUNT(*) AS value
       FROM source_records JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ?`,
      importRunId,
    ),
    recordsMatched: numberValue(
      database,
      `SELECT COUNT(*) AS value
       FROM source_records JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ? AND source_records.match_status = 'matched'`,
      importRunId,
    ),
    postsAdded: numberValue(
      database,
      `SELECT COUNT(*) AS value
       FROM source_records JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ? AND source_records.match_status = 'created'`,
      importRunId,
    ),
    postsUpdated: numberValue(
      database,
      `SELECT COUNT(DISTINCT post_observations.post_id) AS value
       FROM post_observations
       JOIN source_records USING(source_record_id)
       JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ?
         AND source_records.match_status = 'matched'
         AND post_observations.changed_canonical_post = 1`,
      importRunId,
    ),
    recordsAmbiguous: numberValue(
      database,
      `SELECT COUNT(*) AS value
       FROM source_records JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ? AND source_records.match_status = 'ambiguous'`,
      importRunId,
    ),
    recordsSkipped: numberValue(
      database,
      `SELECT COUNT(*) AS value
       FROM source_records JOIN source_files USING(source_file_id)
       WHERE source_files.import_run_id = ? AND source_records.match_status = 'skipped'`,
      importRunId,
    ),
    errorCount: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM import_errors WHERE import_run_id = ?",
      importRunId,
    ),
    matchRuleCounts,
  };
}

function buildImportReport(
  database: DatabaseSync,
  databasePath: string,
  profileId: string,
  importRunId: string,
  collectionSetId: string,
  rootCount: number,
  collectionFingerprint: string,
  startedAtUtc: string,
  completedAtUtc: string,
  status: TimelineImportReport["status"],
  peakRssBytes: number,
  metrics: ReconciledRunMetrics,
): TimelineImportReport {
  const timestampRange = database
    .prepare(`
      SELECT MIN(created_timestamp) AS earliest, MAX(created_timestamp) AS latest
      FROM posts
      WHERE profile_id = ?
    `)
    .get(profileId);
  const earliestTimestamp =
    timestampRange?.earliest === null || timestampRange?.earliest === undefined
      ? null
      : Number(timestampRange.earliest);
  const latestTimestamp =
    timestampRange?.latest === null || timestampRange?.latest === undefined
      ? null
      : Number(timestampRange.latest);
  const sourceFiles = database
    .prepare(`
      SELECT source_files.export_root_number,
             source_files.relative_path,
             source_files.source_kind,
             source_files.size_bytes,
             source_files.sha256,
             source_files.record_count,
             source_files.parse_status,
             COUNT(import_errors.import_error_id) AS error_count
      FROM source_files
      LEFT JOIN import_errors USING(source_file_id)
      WHERE source_files.import_run_id = ?
      GROUP BY source_files.source_file_id
      ORDER BY source_files.export_root_number, source_files.relative_path
    `)
    .all(importRunId)
    .map((row) => ({
      exportRootNumber: Number(row.export_root_number),
      relativePath: String(row.relative_path),
      sourceKind: String(row.source_kind),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      recordCount:
        row.record_count === null ? null : Number(row.record_count),
      parseStatus: String(row.parse_status),
      errorCount: Number(row.error_count),
    }));
  const postTypeCounts = Object.fromEntries(
    database
      .prepare(`
        SELECT post_type, COUNT(*) AS count
        FROM posts
        WHERE profile_id = ?
        GROUP BY post_type
        ORDER BY post_type
      `)
      .all(profileId)
      .map((row) => [String(row.post_type), Number(row.count)]),
  );
  const errorCodeCounts = Object.fromEntries(
    database
      .prepare(`
        SELECT error_code, COUNT(*) AS count
        FROM import_errors
        WHERE import_run_id = ?
        GROUP BY error_code
        ORDER BY error_code
      `)
      .all(importRunId)
      .map((row) => [String(row.error_code), Number(row.count)]),
  );
  const issueLimit = 100;
  const issues = database
    .prepare(`
      SELECT import_errors.error_code,
             source_files.export_root_number,
             source_files.relative_path,
             import_errors.record_index
      FROM import_errors
      LEFT JOIN source_files USING(source_file_id)
      WHERE import_errors.import_run_id = ?
      ORDER BY import_errors.import_error_id
      LIMIT ?
    `)
    .all(importRunId, issueLimit)
    .map((row) => ({
      errorCode: String(row.error_code),
      exportRootNumber:
        row.export_root_number === null
          ? null
          : Number(row.export_root_number),
      relativePath:
        row.relative_path === null ? null : String(row.relative_path),
      recordIndex: row.record_index === null ? null : Number(row.record_index),
    }));
  const integrity = database.prepare("PRAGMA integrity_check").get();

  return {
    reportSchemaVersion: 2,
    mode: "import",
    status,
    importRunId,
    collectionSetId,
    startedAtUtc,
    completedAtUtc,
    durationMs: Date.parse(completedAtUtc) - Date.parse(startedAtUtc),
    peakRssBytes,
    databaseSizeBytes: statSync(databasePath).size,
    rootCount,
    collectionFingerprint,
    timelineFiles: sourceFiles.filter((file) => file.sourceKind === "timeline").length,
    archiveFiles: sourceFiles.filter((file) => file.sourceKind === "archive").length,
    trashFiles: sourceFiles.filter((file) => file.sourceKind === "trash").length,
    reelFiles: sourceFiles.filter((file) => file.sourceKind === "reel").length,
    videoMetadataFiles: sourceFiles.filter(
      (file) => file.sourceKind === "video_metadata",
    ).length,
    photoMetadataFiles: sourceFiles.filter(
      (file) => file.sourceKind === "photo_metadata",
    ).length,
    albumMetadataFiles: sourceFiles.filter(
      (file) => file.sourceKind === "album_metadata",
    ).length,
    checkinMetadataFiles: sourceFiles.filter(
      (file) => file.sourceKind === "checkin_metadata",
    ).length,
    sharingLinkMetadataFiles: sourceFiles.filter(
      (file) => file.sourceKind === "sharing_link_metadata",
    ).length,
    recordsExamined: metrics.recordsExamined,
    recordsMatched: metrics.recordsMatched,
    postsAdded: metrics.postsAdded,
    postsUpdated: metrics.postsUpdated,
    recordsAmbiguous: metrics.recordsAmbiguous,
    recordsSkipped: metrics.recordsSkipped,
    errorCount: metrics.errorCount,
    databaseIntegrity: String(integrity?.integrity_check ?? "unknown"),
    canonicalPosts: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM posts WHERE profile_id = ?",
      profileId,
    ),
    earliestPostUtc:
      earliestTimestamp === null
        ? null
        : new Date(earliestTimestamp * 1000).toISOString(),
    latestPostUtc:
      latestTimestamp === null
        ? null
        : new Date(latestTimestamp * 1000).toISOString(),
    missingFacebookPostIds: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM posts WHERE profile_id = ? AND facebook_post_id IS NULL",
      profileId,
    ),
    missingDirectPostUrls: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM posts WHERE profile_id = ? AND direct_post_url IS NULL",
      profileId,
    ),
    missingAudienceSettings: numberValue(
      database,
      `SELECT COUNT(*) AS value FROM posts
       WHERE profile_id = ? AND (audience = 'unknown' OR audience_status = 'unavailable')`,
      profileId,
    ),
    mediaRecords: numberValue(database, "SELECT COUNT(*) AS value FROM media"),
    postMediaRelationships: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM post_media",
    ),
    linkRecords: numberValue(database, "SELECT COUNT(*) AS value FROM post_links"),
    placeRecords: numberValue(database, "SELECT COUNT(*) AS value FROM places"),
    postPlaceRelationships: numberValue(
      database,
      "SELECT COUNT(*) AS value FROM post_places",
    ),
    postTypeCounts,
    matchRuleCounts: metrics.matchRuleCounts,
    errorCodeCounts,
    sourceFiles,
    issues,
    issuesTruncated: metrics.errorCount > issues.length,
  };
}

export async function importTimelineCollection(
  options: TimelineImportOptions,
): Promise<TimelineImportReport> {
  const startedAtUtc = new Date().toISOString();
  const memory = new PeakMemoryTracker();
  memory.sample();
  const batchSize = options.batchSize ?? defaultBatchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Batch size must be a positive integer.");
  }

  const collection = await discoverTimelineSources(options.exportPaths, true);
  const inventory = InventoryDatabase.open({
    databasePath: options.databasePath,
    migrationsDirectory: options.migrationsDirectory,
  });
  const counters: ImportCounters = {
    recordsExamined: 0,
    recordsMatched: 0,
    postsAdded: 0,
    updatedPostIds: new Set<number>(),
    recordsAmbiguous: 0,
    recordsSkipped: 0,
    errorCount: 0,
    matchRuleCounts: new Map<string, number>(),
  };

  let importRunId = "";
  let collectionSetId = "";
  try {
    const database = inventory.database;
    const profileId = getOrCreateDefaultProfile(
      database,
      options.profileLabel ?? "Personal Facebook Profile",
      startedAtUtc,
    );
    collectionSetId = getOrCreateCollectionSet(
      database,
      profileId,
      collection.collectionFingerprint,
      collection.rootCount,
      startedAtUtc,
    );
    importRunId = randomUUID();
    database
      .prepare(`
        INSERT INTO import_runs(
          import_run_id,
          collection_set_id,
          started_at_utc,
          status
        ) VALUES (?, ?, ?, 'running')
      `)
      .run(importRunId, collectionSetId, startedAtUtc);

    let fatalFailure = false;
    try {
      await ingestSourceRecords(
        database,
        importRunId,
        collection.sourceFiles,
        batchSize,
        counters,
        memory,
      );
      matchSourceRecords(
        database,
        importRunId,
        profileId,
        batchSize,
        counters,
        memory,
      );
    } catch {
      fatalFailure = true;
      addImportError(
        database,
        importRunId,
        null,
        null,
        "DATABASE_WRITE_FAILED",
        "Import processing stopped after a database transaction failed.",
      );
    }

    memory.sample();
    const metrics = reconcileRunMetrics(database, importRunId);
    const completedAtUtc = new Date().toISOString();
    const status: TimelineImportReport["status"] = fatalFailure
      ? "failed"
      : metrics.errorCount === 0
        ? "completed"
        : "completed_with_errors";
    database
      .prepare(`
        UPDATE import_runs
        SET completed_at_utc = ?, status = ?,
            records_examined = ?, records_matched = ?, posts_added = ?,
            posts_updated = ?, records_ambiguous = ?, records_skipped = ?,
            error_count = ?
        WHERE import_run_id = ?
      `)
      .run(
        completedAtUtc,
        status,
        metrics.recordsExamined,
        metrics.recordsMatched,
        metrics.postsAdded,
        metrics.postsUpdated,
        metrics.recordsAmbiguous,
        metrics.recordsSkipped,
        metrics.errorCount,
        importRunId,
      );

    return buildImportReport(
      database,
      inventory.path,
      profileId,
      importRunId,
      collectionSetId,
      collection.rootCount,
      collection.collectionFingerprint,
      startedAtUtc,
      completedAtUtc,
      status,
      memory.peakRssBytes,
      metrics,
    );
  } finally {
    inventory.close();
  }
}
