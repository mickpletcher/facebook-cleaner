import type {
  CollectionValidationReport,
  SourceFileValidation,
  ValidationError,
  ValidationSummary,
  ValidationStatus,
} from "./types.js";
import {
  discoverTimelineSources,
  SourceDiscoveryError,
} from "./source-discovery.js";
import { validateTimelineFile } from "../parsers/timeline.js";

function unixSecondsToIso(timestamp: number | null): string | null {
  return timestamp === null
    ? null
    : new Date(timestamp * 1000).toISOString();
}

function summarize(sourceFiles: SourceFileValidation[]): ValidationSummary {
  const earliestTimestamps = sourceFiles
    .map((file) => file.earliestTimestamp)
    .filter((value): value is number => value !== null);
  const latestTimestamps = sourceFiles
    .map((file) => file.latestTimestamp)
    .filter((value): value is number => value !== null);
  const earliestTimestamp =
    earliestTimestamps.length === 0 ? null : Math.min(...earliestTimestamps);
  const latestTimestamp =
    latestTimestamps.length === 0 ? null : Math.max(...latestTimestamps);

  return {
    recordsExamined: sourceFiles.reduce(
      (total, file) => total + file.recordsExamined,
      0,
    ),
    parsedRecords: sourceFiles.reduce(
      (total, file) => total + file.parsedRecords,
      0,
    ),
    fingerprintedRecords: sourceFiles.reduce(
      (total, file) => total + file.fingerprintedRecords,
      0,
    ),
    partialRecords: sourceFiles.reduce(
      (total, file) => total + file.partialRecords,
      0,
    ),
    unsupportedRecords: sourceFiles.reduce(
      (total, file) => total + file.unsupportedRecords,
      0,
    ),
    errorCount: sourceFiles.reduce(
      (total, file) => total + file.errorCount,
      0,
    ),
    earliestTimestamp,
    latestTimestamp,
    earliestPostUtc: unixSecondsToIso(earliestTimestamp),
    latestPostUtc: unixSecondsToIso(latestTimestamp),
  };
}

function overallStatus(sourceFiles: SourceFileValidation[]): ValidationStatus {
  if (sourceFiles.some((file) => file.status === "failed")) {
    return "failed";
  }
  if (sourceFiles.some((file) => file.status === "completed_with_errors")) {
    return "completed_with_errors";
  }
  return "completed";
}

function failedReport(
  startedAtUtc: string,
  rootCount: number,
  error: ValidationError,
): CollectionValidationReport {
  return {
    reportSchemaVersion: 1,
    mode: "validate_only",
    status: "failed",
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    rootCount,
    collectionFingerprint: null,
    sourceFiles: [],
    summary: {
      recordsExamined: 0,
      parsedRecords: 0,
      fingerprintedRecords: 0,
      partialRecords: 0,
      unsupportedRecords: 0,
      errorCount: 1,
      earliestTimestamp: null,
      latestTimestamp: null,
      earliestPostUtc: null,
      latestPostUtc: null,
    },
    errors: [error],
  };
}

export async function validateCollection(
  exportPaths: string[],
): Promise<CollectionValidationReport> {
  const startedAtUtc = new Date().toISOString();
  let collection;
  try {
    collection = await discoverTimelineSources(exportPaths);
  } catch (error) {
    if (error instanceof SourceDiscoveryError) {
      return failedReport(startedAtUtc, exportPaths.length, {
        code: error.code,
        message: error.message,
        ...(error.exportRootNumber === undefined
          ? {}
          : { exportRootNumber: error.exportRootNumber }),
      });
    }
    return failedReport(startedAtUtc, exportPaths.length, {
      code: "SOURCE_FILE_READ_FAILED",
      message: "Source discovery failed for an unexpected reason.",
    });
  }

  const sourceFiles: SourceFileValidation[] = [];
  for (const source of collection.sourceFiles) {
    sourceFiles.push(await validateTimelineFile(source));
  }
  const summary = summarize(sourceFiles);

  return {
    reportSchemaVersion: 1,
    mode: "validate_only",
    status: overallStatus(sourceFiles),
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    rootCount: collection.rootCount,
    collectionFingerprint: collection.collectionFingerprint,
    sourceFiles,
    summary,
    errors: sourceFiles.flatMap((file) => file.errors),
  };
}
