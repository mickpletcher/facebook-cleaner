# Changelog

Every functional, database, matching, reporting, privacy, test, and documentation change to this project must be recorded in this file.

## [Unreleased]

### Added

- Added a local, read-only TypeScript command-line importer for personal Facebook JSON exports.
- Added a PowerShell entry script for Windows operation.
- Added strict TypeScript, Vitest, and ECMAScript module configuration.
- Added Node.js 24 built-in SQLite support.
- Added ordered SQL migrations and schema-version tracking.
- Added OneDrive-safe SQLite settings using full synchronization and rollback journaling.
- Added adjacent single-writer lock handling.
- Added tables for profiles, collection sets, import runs, source files, source records, canonical posts, observations, media, links, post state evidence, and import errors.
- Added deterministic matching rules M01 through M09.
- Added stable semantic fingerprints and occurrence slots for legitimate identical posts.
- Added streaming parsing for the primary timeline files.
- Added support for multiple Facebook export roots from the same export session.
- Added collection fingerprints based on recognized source files.
- Added primary timeline import for text, photo, video, link, check-in, mixed, and unknown post types.
- Added archive import with confirmed archived-state evidence.
- Added trash import with confirmed trash-state evidence.
- Added trash state precedence over archive, active, and unknown state.
- Added reels import and canonical reel classification.
- Added reel identity precedence over less-specific timeline representations.
- Added video metadata enrichment from `your_videos.json`.
- Added uncategorized-photo metadata enrichment from `your_uncategorized_photos.json`.
- Added album-photo metadata enrichment from 255 numbered `album/*.json` files.
- Added album name, description, last-modified timestamp, cover status, source-file provenance, and ordinal metadata to safely matched album media.
- Added enrichment-only import for `check-ins.json` that safely matches existing posts and skips unmatched check-ins.
- Added confirmed Facebook post ID, direct post URL, media, and place enrichment from matched check-ins.
- Added migration 002 with deduplicated `places` and `post_places` relationship tables.
- Added check-in file, place, and post-place relationship totals to sanitized reports.
- Added enrichment-only import for `content_sharing_links_you_have_created.json`.
- Added confirmed Facebook post IDs and shared-content links to safely matched posts while preserving the distinction between shared URLs and direct Facebook post URLs.
- Added content-sharing-link file totals to sanitized reports.
- Added enrichment-only handling that skips unmatched media metadata without creating posts.
- Added media type, creation timestamp, and metadata storage for safely matched media.
- Added sanitized JSON collection reports and concise terminal summaries.
- Added report schema version 2 with timing, peak memory, database size, integrity, canonical totals, missing-field totals, date range, type counts, media and link totals, match-rule counts, error-code counts, source-file results, and bounded issue locations.
- Added controlled failed-run reports after database transaction failures.
- Added explicit M09 unmatched-enrichment counts to reports.
- Added sanitized fixtures containing no personal Facebook information.
- Added unit and integration coverage for database constraints, locking, discovery, parsing, normalization, fingerprints, deterministic matching, batch rollback, idempotence, state precedence, reels, media enrichment, reporting, and PowerShell execution.
- Added repository documentation for the concept, implementation plan, SQLite model, deterministic matching rules, export analysis, and private validation results.
- Added this changelog and linked it from the README.

### Changed

- Replaced the short README with a complete Windows operator guide covering safety, supported sources, setup, export preparation, validation, import, parameters, exit codes, database contents, deterministic matching, reports, OneDrive backup, troubleshooting, privacy checks, development commands, and project documentation.
- Made README maintenance mandatory whenever behavior, supported sources, commands, requirements, outputs, privacy controls, or operator workflows change.
- Updated `AGENTS.md` so user-facing work is incomplete until both the README and changelog match the implementation.
- Made changelog maintenance mandatory for every project file addition, modification, rename, or removal.
- Added a root `AGENTS.md` rule stating that work is incomplete until the corresponding changelog entry is present.
- Changed primary storage from the proposed CSV format to SQLite for more than 100,000 expected posts.
- Limited the current project scope to populating and maintaining the local inventory. Facebook deletion remains a future upgrade.
- Changed the supported import set incrementally from primary timeline only to timeline, archive, trash, reels, video metadata, and uncategorized-photo metadata.
- Changed archive, trash, and reels to authoritative sources that may create unmatched canonical posts.
- Changed video and uncategorized-photo sources to enrichment-only sources.
- Changed the importer to process source kinds in precedence order: timeline, archive, trash, reels, video metadata, photo metadata, album metadata, check-in metadata, then content-sharing-link metadata.
- Allowed enrichment-only records to use unique canonical timestamp-and-text or timestamp evidence without being blocked by overlapping source-record counts.
- Changed repeated imports to preserve reel canonical identity when timeline captions or fingerprints differ.
- Expanded import reporting with database reconciliation and per-source totals.
- Expanded terminal output with source-kind file counts and M09 skipped-enrichment totals.
- Collapsed hundreds of album-file terminal lines into one album aggregate while retaining every per-file result in the JSON report.
- Updated the README and project documents after each completed source milestone.

### Fixed

- Fixed strict TypeScript narrowing for parsed album objects before reading album metadata fields.
- Fixed report-construction argument ordering during expanded reporting implementation.
- Fixed failed database batches so they return a sanitized failed-run report while preserving transaction rollback.
- Fixed command exit codes so failed imports return 1 and completed imports with errors return 2.
- Fixed matching scope boundaries so secondary records can match a post already observed by an earlier source kind in the same run.
- Fixed source ordering so trash evidence is applied after archive evidence.
- Fixed reel re-import churn when timeline and reel captions produce different semantic fingerprints but match by timestamp and media.
- Fixed video metadata enrichment from incorrectly replacing canonical post text, identity, fingerprint, or post type.
- Restored 142 private inventory records temporarily misclassified as reels during validation of the video metadata precedence fix.
- Added regression coverage confirming video metadata cannot convert videos into reels.
- Fixed report source counts so timeline, archive, trash, reels, video metadata, and photo metadata files are reported separately.
- Added idempotence coverage proving repeated check-in imports do not duplicate posts, places, or relationships.
- Added discovery, matching, URL classification, unmatched-record, and idempotence coverage for content-sharing-link enrichment.

### Security

- Added explicit ignore rules and tests for root-level import and validation report filenames discovered during the README audit.
- Added ignore rules for Facebook export directories, local data directories, reports, and private fixtures.
- Added ignore rules for SQLite databases, journal files, WAL files, shared-memory files, locks, and temporary files.
- Added broad ignore rules for exported image, video, and audio formats.
- Added privacy tests that verify sensitive paths and media extensions remain ignored.
- Kept real Facebook exports, SQLite databases, generated reports, and personal media outside the repository.
- Added sanitized error and issue reporting that excludes post text, names, personal URLs, and absolute export paths.
- Audited the working tree and Git history for private export names, local user paths, email addresses, long Facebook-style identifiers, databases, reports, and media files.
- Verified that the repository contains no private Facebook export data.

### Verified private inventory

- Imported 22,966 primary timeline posts.
- Added 16 archived posts absent from the primary timeline.
- Added one trash post absent from the earlier sources.
- Imported 49 reels, including four matches and 45 newly discovered posts.
- Enriched 191 media records from 518 video metadata records and skipped 327 unmatched records.
- Enriched eight additional media records from 799 uncategorized-photo records and skipped 791 unmatched records.
- Enriched 137 additional media records from 11,241 album-photo records across 255 files and skipped 11,104 unmatched records.
- Safely matched all 356 check-in records without creating canonical posts.
- Added 133 deduplicated places and 356 post-place relationships from matched check-ins.
- Parsed all 73 content-sharing-link records and safely skipped all 73 because the export supplied no deterministic canonical-post match.
- Confirmed content-sharing-link enrichment added zero posts, changed zero posts, and added no unverified link relationships.
- Confirmed 23,028 canonical posts after the current source set.
- Confirmed 336 media records contain secondary enrichment metadata.
- Confirmed 49 reels, 449 videos, 16 archived posts, and one trash post.
- Confirmed repeated imports add no duplicates.
- Confirmed database integrity returns `ok`.
- Confirmed the generated report contains no absolute user path or private export-folder name.

## [0.1.0] - 2026-07-21

### Added

- Added the initial project concept and scope document.
- Defined the read-only Facebook inventory goal.
- Selected SQLite as the primary store and OneDrive as the backup location.
- Defined the approved inventory fields and initial Facebook export coverage.
