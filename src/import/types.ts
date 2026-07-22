export type ValidationStatus = "completed" | "completed_with_errors" | "failed";

export type ValidationErrorCode =
  | "EXPORT_ROOT_NOT_FOUND"
  | "SOURCE_FILE_MISSING"
  | "SOURCE_FILE_READ_FAILED"
  | "JSON_INVALID"
  | "RECORD_UNSUPPORTED"
  | "RECORD_PARTIAL"
  | "REPORT_WRITE_FAILED";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  exportRootNumber?: number;
  relativePath?: string;
  recordIndex?: number;
}

export interface DiscoveredSourceFile {
  absolutePath: string;
  exportRootNumber: number;
  relativePath: string;
  sequence: number;
  sizeBytes: number;
  sha256: string;
  sourceKind:
    | "timeline"
    | "archive"
    | "trash"
    | "reel"
    | "video_metadata"
    | "photo_metadata";
}

export interface DiscoveredCollection {
  rootCount: number;
  collectionFingerprint: string;
  sourceFiles: DiscoveredSourceFile[];
}

export interface SourceFileValidation {
  exportRootNumber: number;
  relativePath: string;
  sequence: number;
  sizeBytes: number;
  sha256: string;
  status: ValidationStatus;
  recordsExamined: number;
  parsedRecords: number;
  fingerprintedRecords: number;
  partialRecords: number;
  unsupportedRecords: number;
  earliestTimestamp: number | null;
  latestTimestamp: number | null;
  errorCount: number;
  errorsTruncated: boolean;
  errors: ValidationError[];
}

export interface ValidationSummary {
  recordsExamined: number;
  parsedRecords: number;
  fingerprintedRecords: number;
  partialRecords: number;
  unsupportedRecords: number;
  errorCount: number;
  earliestTimestamp: number | null;
  latestTimestamp: number | null;
  earliestPostUtc: string | null;
  latestPostUtc: string | null;
}

export interface CollectionValidationReport {
  reportSchemaVersion: 1;
  mode: "validate_only";
  status: ValidationStatus;
  startedAtUtc: string;
  completedAtUtc: string;
  rootCount: number;
  collectionFingerprint: string | null;
  sourceFiles: SourceFileValidation[];
  summary: ValidationSummary;
  errors: ValidationError[];
}

export interface TimelineImportOptions {
  exportPaths: string[];
  databasePath: string;
  migrationsDirectory: string;
  profileLabel?: string;
  batchSize?: number;
}

export interface TimelineImportReport {
  reportSchemaVersion: 2;
  mode: "import";
  status: "completed" | "completed_with_errors" | "failed";
  importRunId: string;
  collectionSetId: string;
  startedAtUtc: string;
  completedAtUtc: string;
  durationMs: number;
  peakRssBytes: number;
  databaseSizeBytes: number;
  rootCount: number;
  collectionFingerprint: string;
  timelineFiles: number;
  archiveFiles: number;
  trashFiles: number;
  reelFiles: number;
  videoMetadataFiles: number;
  photoMetadataFiles: number;
  recordsExamined: number;
  recordsMatched: number;
  postsAdded: number;
  postsUpdated: number;
  recordsAmbiguous: number;
  recordsSkipped: number;
  errorCount: number;
  databaseIntegrity: string;
  canonicalPosts: number;
  earliestPostUtc: string | null;
  latestPostUtc: string | null;
  missingFacebookPostIds: number;
  missingDirectPostUrls: number;
  missingAudienceSettings: number;
  mediaRecords: number;
  postMediaRelationships: number;
  linkRecords: number;
  postTypeCounts: Record<string, number>;
  matchRuleCounts: Record<string, number>;
  errorCodeCounts: Record<string, number>;
  sourceFiles: SourceFileImportReport[];
  issues: ImportIssue[];
  issuesTruncated: boolean;
}

export interface SourceFileImportReport {
  exportRootNumber: number;
  relativePath: string;
  sourceKind: string;
  sizeBytes: number;
  sha256: string;
  recordCount: number | null;
  parseStatus: string;
  errorCount: number;
}

export interface ImportIssue {
  errorCode: string;
  exportRootNumber: number | null;
  relativePath: string | null;
  recordIndex: number | null;
}
