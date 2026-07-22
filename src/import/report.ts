import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CollectionValidationReport,
  TimelineImportReport,
} from "./types.js";

export function writeJsonReport(reportPath: string, report: unknown): string {
  const absoluteReportPath = resolve(reportPath);
  mkdirSync(dirname(absoluteReportPath), { recursive: true });
  const temporaryPath = `${absoluteReportPath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, absoluteReportPath);
  return absoluteReportPath;
}

export function writeValidationReport(
  reportPath: string,
  report: CollectionValidationReport,
): string {
  return writeJsonReport(reportPath, report);
}

export function formatTerminalSummary(
  report: CollectionValidationReport,
): string {
  const lines = [
    `Status: ${report.status}`,
    `Export roots: ${report.rootCount}`,
    `Timeline files: ${report.sourceFiles.length}`,
    `Records examined: ${report.summary.recordsExamined}`,
    `Parsed records: ${report.summary.parsedRecords}`,
    `Fingerprinted records: ${report.summary.fingerprintedRecords}`,
    `Partial records: ${report.summary.partialRecords}`,
    `Unsupported records: ${report.summary.unsupportedRecords}`,
    `Errors: ${report.summary.errorCount}`,
    `Earliest post UTC: ${report.summary.earliestPostUtc ?? "unavailable"}`,
    `Latest post UTC: ${report.summary.latestPostUtc ?? "unavailable"}`,
    `Collection fingerprint: ${report.collectionFingerprint ?? "unavailable"}`,
  ];

  for (const file of report.sourceFiles) {
    lines.push(
      `Root ${file.exportRootNumber}, timeline file ${file.sequence}: ${file.recordsExamined} records, ${file.status}`,
    );
  }

  return lines.join("\n");
}

export function formatImportTerminalSummary(report: TimelineImportReport): string {
  const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
  const lines = [
    `Status: ${report.status}`,
    `Duration: ${(report.durationMs / 1000).toFixed(2)} seconds`,
    `Timeline files: ${report.timelineFiles}`,
    `Archive files: ${report.archiveFiles}`,
    `Trash files: ${report.trashFiles}`,
    `Reels files: ${report.reelFiles}`,
    `Video metadata files: ${report.videoMetadataFiles}`,
    `Photo metadata files: ${report.photoMetadataFiles}`,
    `Records examined: ${report.recordsExamined}`,
    `Existing records matched: ${report.recordsMatched}`,
    `Posts added: ${report.postsAdded}`,
    `Posts updated: ${report.postsUpdated}`,
    `Ambiguous records: ${report.recordsAmbiguous}`,
    `Skipped records: ${report.recordsSkipped}`,
    `Errors: ${report.errorCount}`,
    `Canonical posts: ${report.canonicalPosts}`,
    `Post range UTC: ${report.earliestPostUtc ?? "unavailable"} to ${report.latestPostUtc ?? "unavailable"}`,
    `Missing Facebook post IDs: ${report.missingFacebookPostIds}`,
    `Missing direct post URLs: ${report.missingDirectPostUrls}`,
    `Missing audience settings: ${report.missingAudienceSettings}`,
    `Media records: ${report.mediaRecords}`,
    `Post-media relationships: ${report.postMediaRelationships}`,
    `Link records: ${report.linkRecords}`,
    `Database size: ${megabytes(report.databaseSizeBytes)} MB`,
    `Peak process memory: ${megabytes(report.peakRssBytes)} MB`,
    `Database integrity: ${report.databaseIntegrity}`,
  ];
  for (const [type, count] of Object.entries(report.postTypeCounts).sort()) {
    lines.push(`Post type ${type}: ${count}`);
  }
  for (const [rule, count] of Object.entries(report.matchRuleCounts).sort()) {
    lines.push(`${rule}: ${count}`);
  }
  for (const [code, count] of Object.entries(report.errorCodeCounts).sort()) {
    lines.push(`Error code ${code}: ${count}`);
  }
  for (const file of report.sourceFiles) {
    lines.push(
      `Root ${file.exportRootNumber}, ${file.relativePath}: ${file.recordCount ?? 0} records, ${file.parseStatus}, ${file.errorCount} errors`,
    );
  }
  return lines.join("\n");
}
