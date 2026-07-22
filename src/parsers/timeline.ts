import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import chain from "stream-chain";
import { parser } from "stream-json";
import {
  streamArray,
  type StreamArrayItem,
} from "stream-json/streamers/stream-array.js";
import type {
  DiscoveredSourceFile,
  SourceFileValidation,
  ValidationError,
} from "../import/types.js";
import { normalizeTimelineRecord } from "./facebook-record.js";

const maximumRetainedErrorsPerFile = 100;

export interface StreamedTimelineRecord {
  recordIndex: number;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function firstNonWhitespaceCharacter(path: string): Promise<string | null> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    let position = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        return null;
      }
      position += bytesRead;
      const text = buffer.toString("utf8", 0, bytesRead);
      for (const character of text) {
        if (!/\s/u.test(character)) {
          return character;
        }
      }
    }
  } finally {
    await file.close();
  }
}

function createBaseResult(source: DiscoveredSourceFile): SourceFileValidation {
  return {
    exportRootNumber: source.exportRootNumber,
    relativePath: source.relativePath,
    sequence: source.sequence,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    status: "completed",
    recordsExamined: 0,
    parsedRecords: 0,
    fingerprintedRecords: 0,
    partialRecords: 0,
    unsupportedRecords: 0,
    earliestTimestamp: null,
    latestTimestamp: null,
    errorCount: 0,
    errorsTruncated: false,
    errors: [],
  };
}

function addError(
  result: SourceFileValidation,
  error: ValidationError,
): void {
  result.errorCount += 1;
  if (result.errors.length < maximumRetainedErrorsPerFile) {
    result.errors.push(error);
  } else {
    result.errorsTruncated = true;
  }
  result.status = "completed_with_errors";
}

function updateTimestampRange(
  result: SourceFileValidation,
  timestamp: number,
): void {
  result.earliestTimestamp =
    result.earliestTimestamp === null
      ? timestamp
      : Math.min(result.earliestTimestamp, timestamp);
  result.latestTimestamp =
    result.latestTimestamp === null
      ? timestamp
      : Math.max(result.latestTimestamp, timestamp);
}

export async function validateTimelineFile(
  source: DiscoveredSourceFile,
): Promise<SourceFileValidation> {
  const result = createBaseResult(source);
  let firstCharacter: string | null;
  try {
    firstCharacter = await firstNonWhitespaceCharacter(source.absolutePath);
  } catch {
    addError(result, {
      code: "SOURCE_FILE_READ_FAILED",
      message: "The source file could not be read.",
      exportRootNumber: source.exportRootNumber,
      relativePath: source.relativePath,
    });
    result.status = "failed";
    return result;
  }

  if (firstCharacter !== "[") {
    addError(result, {
      code: "RECORD_UNSUPPORTED",
      message: "The source file must contain a root-level JSON array.",
      exportRootNumber: source.exportRootNumber,
      relativePath: source.relativePath,
    });
    result.status = "failed";
    return result;
  }

  try {
    for await (const item of streamTimelineRecords(source)) {
      const recordIndex = item.recordIndex;
      result.recordsExamined += 1;

      if (!isRecord(item.value)) {
        result.unsupportedRecords += 1;
        addError(result, {
          code: "RECORD_UNSUPPORTED",
          message: "The timeline entry is not a JSON object.",
          exportRootNumber: source.exportRootNumber,
          relativePath: source.relativePath,
          recordIndex,
        });
        continue;
      }

      const timestamp = item.value.timestamp;
      if (!Number.isSafeInteger(timestamp) || Number(timestamp) < 0) {
        result.partialRecords += 1;
        addError(result, {
          code: "RECORD_PARTIAL",
          message: "The timeline entry has no valid Unix creation timestamp.",
          exportRootNumber: source.exportRootNumber,
          relativePath: source.relativePath,
          recordIndex,
        });
        continue;
      }

      try {
        normalizeTimelineRecord(item.value);
        result.parsedRecords += 1;
        result.fingerprintedRecords += 1;
        updateTimestampRange(result, Number(timestamp));
      } catch {
        result.partialRecords += 1;
        addError(result, {
          code: "RECORD_PARTIAL",
          message: "The timeline entry could not be normalized and fingerprinted.",
          exportRootNumber: source.exportRootNumber,
          relativePath: source.relativePath,
          recordIndex,
        });
      }
    }
  } catch {
    addError(result, {
      code: "JSON_INVALID",
      message: "The source file contains invalid or incomplete JSON.",
      exportRootNumber: source.exportRootNumber,
      relativePath: source.relativePath,
    });
    result.status = "failed";
  }

  return result;
}

export async function* streamTimelineRecords(
  source: DiscoveredSourceFile,
): AsyncGenerator<StreamedTimelineRecord> {
  const firstCharacter = await firstNonWhitespaceCharacter(source.absolutePath);
  if (source.sourceKind === "reel" && firstCharacter === "{") {
    const value = JSON.parse(await readFile(source.absolutePath, "utf8")) as unknown;
    const records =
      isRecord(value) && Array.isArray(value.lasso_videos_v2)
        ? value.lasso_videos_v2
        : null;
    if (records === null) {
      throw new Error("The reels file must contain a lasso_videos_v2 array.");
    }
    for (const [recordIndex, record] of records.entries()) {
      yield { recordIndex, value: record };
    }
    return;
  }
  if (source.sourceKind === "video_metadata" && firstCharacter === "{") {
    const value = JSON.parse(await readFile(source.absolutePath, "utf8")) as unknown;
    const records =
      isRecord(value) && Array.isArray(value.videos_v2)
        ? value.videos_v2
        : null;
    if (records === null) {
      throw new Error("The video metadata file must contain a videos_v2 array.");
    }
    for (const [recordIndex, record] of records.entries()) {
      yield { recordIndex, value: record };
    }
    return;
  }
  if (source.sourceKind === "photo_metadata" && firstCharacter === "{") {
    const value = JSON.parse(await readFile(source.absolutePath, "utf8")) as unknown;
    const records =
      isRecord(value) && Array.isArray(value.other_photos_v2)
        ? value.other_photos_v2
        : null;
    if (records === null) {
      throw new Error(
        "The uncategorized-photo file must contain an other_photos_v2 array.",
      );
    }
    for (const [recordIndex, record] of records.entries()) {
      yield { recordIndex, value: record };
    }
    return;
  }
  if (source.sourceKind === "album_metadata" && firstCharacter === "{") {
    const value = JSON.parse(await readFile(source.absolutePath, "utf8")) as unknown;
    if (!isRecord(value) || !Array.isArray(value.photos)) {
      throw new Error("The album file must contain a photos array.");
    }
    const album = value;
    const records = album.photos as unknown[];
    const coverUri =
      isRecord(album.cover_photo) && typeof album.cover_photo.uri === "string"
        ? album.cover_photo.uri
        : null;
    for (const [recordIndex, record] of records.entries()) {
      if (!isRecord(record)) {
        yield { recordIndex, value: record };
        continue;
      }
      yield {
        recordIndex,
        value: {
          ...record,
          facebook_cleaner_album: {
            source_relative_path: source.relativePath,
            ordinal: recordIndex,
            name: typeof album.name === "string" ? album.name : null,
            description:
              typeof album.description === "string" ? album.description : null,
            last_modified_timestamp: Number.isSafeInteger(
              album.last_modified_timestamp,
            )
              ? Number(album.last_modified_timestamp)
              : null,
            is_cover: coverUri !== null && record.uri === coverUri,
          },
        },
      };
    }
    return;
  }
  if (source.sourceKind === "trash" && firstCharacter === "{") {
    yield {
      recordIndex: 0,
      value: JSON.parse(await readFile(source.absolutePath, "utf8")),
    };
    return;
  }
  if (firstCharacter !== "[") {
    throw new Error("The source file must contain a root-level JSON array.");
  }

  const pipeline = chain([
    createReadStream(source.absolutePath),
    parser(),
    streamArray(),
  ]);
  for await (const item of pipeline as AsyncIterable<StreamArrayItem>) {
    yield { recordIndex: Number(item.key), value: item.value };
  }
}
