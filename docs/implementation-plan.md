# Facebook Inventory Importer Implementation Plan

## Goal

Build a local, read-only TypeScript command-line tool that imports the supported Facebook JSON export files into SQLite, prevents duplicate posts, and produces a collection report.

The importer will not connect to Facebook, modify Facebook, classify posts, provide a review interface, or remove content.

## Progress

- Milestone 0, repository safety: completed July 21, 2026.
- Milestone 1, project foundation and SQLite schema: completed July 21, 2026.
- Milestone 2, source discovery and streaming parser: completed July 21, 2026.
- Milestone 3, normalization and fingerprints: completed July 22, 2026.
- Milestone 4, primary timeline import and matching: completed July 22, 2026.
- Milestone 5, expanded collection reporting: completed July 22, 2026.
- Milestone 6, full private export validation: completed July 22, 2026.
- Milestone 7.1, archive source support: completed July 22, 2026.
- Milestone 7.2, trash source support: completed July 22, 2026.
- Milestone 7.3, reels source support: completed July 22, 2026.
- Milestone 7.4, video metadata enrichment: completed July 22, 2026.
- Milestone 7.5, uncategorized-photo metadata enrichment: completed July 22, 2026.
- Milestone 7.6, album-photo metadata enrichment: completed July 22, 2026.

## Verified Local Toolchain

| Tool | Verified version | Use |
| --- | --- | --- |
| Node.js | 24.14.0 | Application runtime and built-in SQLite API. The installed version emits an experimental API warning. |
| npm | 11.11.0 | Dependency and script management. |
| PowerShell | 7.6.4 | Windows entry script and operator commands. |
| Git | 2.54.0 | Source control. |
| Standalone SQLite CLI | Not installed | Not required. |

Node 24's built-in `node:sqlite` module will be used. This avoids requiring a separately installed SQLite executable or a native third-party database package.

The installed Node 24.14.0 runtime was verified with SQLite 3.51.2. Its `node:sqlite` API still emits an experimental warning. Current Node 24 documentation classifies the module as a release candidate in newer Node 24 releases. The implementation will isolate all SQLite calls behind the database layer, pin the supported Node major version, and test the exact installed runtime. A runtime upgrade will require the full database test suite.

## Technology Decisions

- TypeScript with strict compiler settings.
- Node.js 24 or newer.
- ECMAScript modules.
- Node's built-in `node:sqlite` module.
- `stream-json` for streaming large root-level JSON arrays.
- Vitest for unit and integration tests.
- `tsx` for local TypeScript execution during development.
- Node's built-in argument parser for the command-line interface.
- SQL migration files stored in the repository.
- PowerShell wrapper for straightforward Windows use.

No web framework, React application, browser extension, ORM, AI provider, or Facebook API dependency is required.

## Proposed Repository Structure

```text
facebook-cleaner/
├── docs/
│   ├── facebook-export-analysis.md
│   ├── implementation-plan.md
│   └── sqlite-data-model.md
├── markdowns/
│   └── Facebook-Personal-Profile-Cleanup-Tool.md
├── migrations/
│   └── 001-initial-schema.sql
├── scripts/
│   └── Invoke-FacebookInventoryImport.ps1
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── database/
│   │   ├── connection.ts
│   │   ├── migrations.ts
│   │   └── repositories.ts
│   ├── import/
│   │   ├── collection-set.ts
│   │   ├── importer.ts
│   │   ├── report.ts
│   │   └── source-discovery.ts
│   ├── matching/
│   │   ├── canonicalization.ts
│   │   ├── fingerprint.ts
│   │   └── matcher.ts
│   ├── parsers/
│   │   ├── facebook-record.ts
│   │   └── timeline.ts
│   └── types.ts
├── tests/
│   ├── fixtures/
│   │   └── sanitized-facebook-export/
│   ├── integration/
│   └── unit/
├── .gitignore
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

Only files needed by the current milestone will be created. Empty future directories will not be scaffolded.

## Command-Line Contract

Initial command shape:

```powershell
.\scripts\Invoke-FacebookInventoryImport.ps1 `
    -ExportPath 'C:\Path\To\Extracted\FacebookExport' `
    -DatabasePath 'C:\Path\In\OneDrive\facebook-inventory.db'
```

Multiple export roots from the same collection will be supported:

```powershell
.\scripts\Invoke-FacebookInventoryImport.ps1 `
    -ExportPath 'C:\Path\To\PrimaryExport','C:\Path\To\SupplementalExport' `
    -DatabasePath 'C:\Path\In\OneDrive\facebook-inventory.db'
```

Initial options:

| Option | Required | Purpose |
| --- | --- | --- |
| `ExportPath` | Yes | One or more extracted Facebook export roots. |
| `DatabasePath` | Yes | SQLite database destination. |
| `ReportPath` | No | JSON report destination. Defaults beside the database. |
| `ValidateOnly` | No | Parse and report without changing the database. |

The command must display resolved paths and request no Facebook credentials.

## Milestone 0: Repository Safety

### Work

- Expand `.gitignore` before reading private fixtures through the application.
- Ignore SQLite databases and sidecar files.
- Ignore Facebook export folders, media, local reports, logs, and unsanitized fixtures.
- Document that real exports must remain outside the repository.
- Add a small, hand-written sanitized fixture containing no personal information.

### Required ignore patterns

```text
*.db
*.db-journal
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
data/
exports/
reports/
tests/fixtures/private/
facebook-*/
```

### Verification

- Place uniquely named dummy private files under ignored test paths.
- Confirm `git status --short --ignored` marks them ignored.
- Confirm no export folder or personal media is present under the repository.

## Milestone 1: Project Foundation and SQLite Schema

### Work

- Create the minimal TypeScript project.
- Add strict TypeScript and Vitest configuration.
- Implement database connection settings.
- Implement ordered SQL migrations.
- Create the tables, constraints, and indexes defined in `docs/sqlite-data-model.md`.
- Add adjacent instance-lock behavior.
- Add clean shutdown handling.

### Database requirements

```text
foreign_keys = ON
journal_mode = DELETE
synchronous = FULL
busy_timeout = 5000
```

### Verification

- Create a temporary database.
- Apply migrations twice without error.
- Verify the schema version.
- Verify foreign-key enforcement.
- Verify unique and check constraints.
- Verify a second writer is rejected by the instance lock.
- Verify a stale local lock can be identified without removing it automatically.

### Completion gate

No Facebook export parsing begins until schema and locking tests pass.

## Milestone 2: Source Discovery and Streaming Parser

### Initial supported files

```text
your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_*.json
```

### Work

- Accept one or more export roots.
- Resolve and validate each root.
- Discover numbered timeline files by pattern.
- Sort numbered files numerically.
- Hash recognized metadata files.
- Build the logical collection-set fingerprint.
- Stream each root-level JSON array.
- Preserve source file and record-index provenance.
- Reject paths that escape an export root.
- Report malformed and unsupported records without exposing post text in logs.

### Verification

- Parse empty, one-record, and multi-record fixtures.
- Parse multiline text and non-ASCII text.
- Parse missing optional fields.
- Report malformed JSON with file and record context.
- Prove records are processed incrementally instead of loading the complete array into memory.
- Verify numbered file sorting such as `_2` before `_10`.

### Completion gate

`ValidateOnly` must report fixture counts without creating or changing a database.

## Milestone 3: Normalization and Fingerprints

### Work

- Normalize text, URLs, and media references exactly as defined in the data model.
- Extract timestamp, post text, attachments, external links, place information, and derived post type.
- Generate canonical raw-record hashes.
- Generate version 1 semantic fingerprints.
- Keep original values separate from normalized matching values.

### Verification

- Equivalent line endings produce the same fingerprint.
- Case changes in post text produce different fingerprints.
- URL fragments do not affect matching.
- URL query strings remain significant.
- Attachment ordering does not affect the fingerprint.
- Null and empty post text remain distinct.
- Source filename and record index do not affect the fingerprint.

### Completion gate

Fingerprint fixtures must remain stable across repeated test runs.

## Milestone 4: Primary Timeline Import and Matching

### Work

- Register collection sets, import runs, source files, and source records.
- Implement matching rules M01 through M09 in their documented order.
- Assign immutable record UUIDs.
- Preserve legitimate identical records using occurrence slots.
- Write posts, observations, media, links, and errors in bounded transactions.
- Make import idempotent.
- Resume safely by re-running an interrupted collection.

### Batch behavior

- Parse outside long-running database write transactions.
- Write bounded batches of 500 records by default.
- Commit the source record, canonical match, media, links, and error state together.
- Roll back an entire batch on database failure.

The default batch size may be adjusted after full-export measurement. It must not change identity results.

### Verification

- Run all twelve identity acceptance tests from the data-model document.
- Import the sanitized fixture twice and add zero posts on the second run.
- Change fixture file boundaries and retain the same post identities.
- Preserve multiple identical legitimate records.
- Report ambiguous records instead of merging them.

### Completion gate

The primary importer must pass all tests before it is used against the private full export.

## Milestone 5: Collection Report

### Output

Write a machine-readable JSON report and a concise terminal summary containing:

- Import-run ID.
- Collection-set ID.
- Start and completion times.
- Total records examined.
- Date range covered.
- Earliest and latest post.
- Posts added and updated.
- Records matched, ambiguous, skipped, and failed.
- Missing post IDs.
- Missing direct post URLs.
- Missing audience settings.
- Post-type counts.
- Source-file results.
- Stable error-code counts.
- Final run status.

Reports must not include full post text, personal URLs, names, or absolute export paths.

The implemented version 2 report also records duration, peak process memory, database size and integrity, canonical post count, media and link totals, matching-rule counts, and up to 100 bounded sanitized issue locations.

### Verification

- Reconcile report totals against database queries.
- Verify terminal and JSON totals agree.
- Verify failure and partial-run reports remain valid JSON.
- Scan reports for fixture sentinel values that must not be logged.

## Milestone 6: Full Private Export Validation

This milestone runs locally against the private export after sanitized tests pass.

### Procedure

1. Run `ValidateOnly` against both export roots.
2. Confirm discovery of the three primary timeline files.
3. Confirm the expected 22,966 primary records.
4. Import into a new SQLite database in the selected OneDrive folder.
5. Reconcile database and report counts.
6. Re-run the same import.
7. Confirm the second run adds zero canonical posts.
8. Record peak memory, duration, database size, ambiguous count, and error count.
9. Inspect sanitized error summaries only.

### Privacy rules

- Do not copy exports into the repository.
- Do not commit the database or report.
- Do not print post text or personal URLs.
- Do not upload fixtures, errors, or database contents.
- Use only aggregate counts in repository documentation.

### Completion gate

The primary timeline milestone is complete when:

- All 22,966 records reach a terminal import status.
- Re-import adds zero posts.
- Counts reconcile.
- The database passes an integrity check.
- No private data appears in Git status or tracked files.

## Milestone 7: Secondary Sources

Add one source type at a time after the primary importer is stable:

1. Archive.
2. Trash.
3. Reels.
4. Video metadata.
5. Uncategorized-photo metadata.
6. Albums and album photos.
7. Check-ins.
8. Content-sharing links.
9. Referenced supplemental media.

Archive, trash, and reels may create canonical posts when unmatched. The remaining sources may only enrich safely matched posts.

Each source requires:

- A documented parser contract.
- Sanitized fixtures.
- Match and ambiguity tests.
- Record-count reconciliation.
- Confirmation that repeated import adds no duplicates.

Archive, trash, reels, video metadata, uncategorized-photo metadata, album-photo metadata, check-in enrichment, and content-sharing-link enrichment are complete. Archive, trash, and reels are authoritative sources whose unmatched entries may create canonical posts. The remaining implemented secondary sources are enrichment only. Matched check-ins can add confirmed IDs, direct post URLs, media, and deduplicated place relationships. Matched content-sharing-link records can add confirmed IDs and shared-content URLs without misclassifying those URLs as direct Facebook post URLs. Unmatched enrichment records are skipped. Confirmed trash evidence takes precedence over archived, active, or unknown state. Reel classification and reel canonical identity take precedence over less-specific sources. The next source is referenced supplemental media.

## Error Codes

Initial stable error-code families:

| Code | Meaning |
| --- | --- |
| `EXPORT_ROOT_NOT_FOUND` | Supplied export root does not exist. |
| `SOURCE_FILE_MISSING` | Required primary source file was not found. |
| `SOURCE_FILE_READ_FAILED` | File could not be read. |
| `JSON_INVALID` | JSON syntax is invalid. |
| `RECORD_UNSUPPORTED` | Record structure is not supported. |
| `RECORD_PARTIAL` | Record was imported with missing required inventory information. |
| `MATCH_AMBIGUOUS` | More than one safe canonical match exists. |
| `IDENTITY_CONFLICT` | Strong identifiers contradict an existing post. |
| `DATABASE_LOCKED` | Another process owns the application instance lock. |
| `DATABASE_WRITE_FAILED` | A transaction failed. |
| `REPORT_WRITE_FAILED` | Collection report could not be written. |

Error messages must describe structure and location without embedding private content.

## Test Strategy

### Unit tests

- Canonicalization.
- Fingerprints.
- Post-type derivation.
- Source discovery.
- File sorting.
- Matching rules.
- Occurrence-slot assignment.
- Report aggregation.

### Integration tests

- Migrations and constraints.
- Full fixture import.
- Re-import idempotence.
- Interrupted batch recovery.
- Multiple export roots.
- Instance locking.
- Report reconciliation.

### Private validation

The real export is never a checked-in test fixture. It is used only for local aggregate validation after all sanitized tests pass.

## Implementation Order

Work must proceed in this order:

1. Repository privacy protections.
2. Minimal TypeScript project.
3. SQLite migrations and connection safety.
4. Sanitized fixtures.
5. Timeline source discovery and streaming parser.
6. Normalization and fingerprints.
7. Deterministic matching.
8. Primary import transactions.
9. Collection report.
10. Full private-export validation.
11. Secondary source support.

Do not begin a later step while the current completion gate is failing.

## First Implementation Assignment

The first coding assignment should cover Milestones 0 and 1 only:

> Add repository privacy protections, create the minimal TypeScript and Vitest project, implement the approved SQLite schema and migration runner using Node 24's built-in SQLite support, add OneDrive-safe connection settings and single-writer locking, and verify the schema through automated tests. Do not parse Facebook exports yet.
