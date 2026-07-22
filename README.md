# facebook-cleaner

`facebook-cleaner` builds a private, local SQLite inventory of everything contained in a supplied Facebook information export. The approved roadmap also identifies content and interactions the user can review or remove across profiles, Pages, and groups.

It is currently an inventory tool only. It does not sign in to Facebook, call the Facebook API, operate a browser, change audience settings, archive posts, restore posts, or delete content.

## Current status

Implemented and verified:

- Primary timeline posts.
- Archived posts.
- Posts in trash.
- Reels.
- Video metadata enrichment.
- Uncategorized-photo metadata enrichment.
- Album-photo metadata enrichment.
- Check-in enrichment with deduplicated place relationships.
- Content-sharing-link enrichment.
- Deterministic duplicate matching.
- Repeatable, idempotent imports.
- Sanitized JSON reports.
- SQLite integrity checks and a single-writer lock.

Not implemented yet:

- Universal discovery and ingestion of every export category.
- Personal-information, connections, preferences, ads, apps, off-Facebook activity, login, security, search, device, and location inventories.
- Message and message-attachment inventory.
- Complete media-file cataloging and hashing.
- Optional encrypted-SQLite database mode.
- Comment inventory.
- Reaction inventory.
- Group activity inventory beyond post records already present in supported sources.
- Removal eligibility evaluation.
- A review interface.
- CSV export for manual review.
- Post deletion or modification.
- Comment deletion.
- Reaction removal.

The current executable remains read-only. Future removal features will require explicit selection, preview, confirmation, bounded execution, action logging, and verification.

The ownership boundary is the user's authorship or interaction. The tool may inventory posts, shares, comments, replies, media, reactions, Page-identity content with reliable ownership evidence, and other supported activity created by the user anywhere on Facebook. It does not claim ownership of content created by someone else. That content may be retained only as limited context needed to locate the user's activity.

The database scope is broader than the removal scope. Every record supplied in the export may be inventoried, including information Facebook recorded about the user that the user did not create. Removal workflows apply only when the user owns the content, made the interaction, controls the relevant identity, or Facebook provides a supported privacy or deletion action.

## Safety model

- All processing is local.
- The tool reads extracted Facebook JSON files. It does not modify the export.
- The SQLite database and reports are stored outside the Git repository.
- Media files are referenced by exported paths. They are not copied into the database or repository.
- Unmatched video and photo metadata cannot create posts.
- Import reports exclude post text, personal names, personal URLs, and absolute export paths.
- Database, report, export, image, video, and audio files are blocked by `.gitignore`.
- One importer process may write to a database at a time.

The database itself contains private Facebook information. Under the expanded scope it may eventually contain messages, contacts, locations, login records, IP addresses, device data, advertising data, and security history. Treat it as highly sensitive even though generated reports are sanitized.

Database encryption is an approved optional future feature. The current database mode is unencrypted SQLite. A future encrypted mode may use a supported encrypted-SQLite provider. Encryption at rest provided by Windows, BitLocker, EFS, or OneDrive is separate from database-file encryption.

Unencrypted mode must remain supported for users who deliberately select it. Encrypted mode must never silently fall back to an unencrypted database. Until encrypted mode is implemented, keep the database in private storage with restricted Windows and OneDrive access.

## Supported Facebook files

The supplied path must be the root of an extracted Facebook JSON export. The importer automatically discovers these paths when present:

| Source | Relative export path | Behavior |
| --- | --- | --- |
| Primary timeline | `your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_*.json` | Authoritative. Creates or matches canonical posts. |
| Archive | `your_facebook_activity/posts/archive.json` | Authoritative. Confirms archived state and may create an unmatched post. |
| Trash | `your_facebook_activity/posts/trash.json` | Authoritative. Confirms trash state and may create an unmatched post. Trash has the highest state precedence. |
| Reels | `your_facebook_activity/reels/your_reels.json` | Authoritative. Matches existing posts or creates unmatched reels. |
| Videos | `your_facebook_activity/posts/your_videos.json` | Enrichment only. Updates safely matched media metadata and skips unmatched records. |
| Uncategorized photos | `your_facebook_activity/posts/your_uncategorized_photos.json` | Enrichment only. Updates safely matched media metadata and skips unmatched records. |
| Album photos | `your_facebook_activity/posts/album/*.json` | Enrichment only. Adds album context to safely matched media and skips unmatched records. |
| Check-ins | `your_facebook_activity/posts/check-ins.json` | Enrichment only. Adds confirmed post IDs, direct post URLs, media, and deduplicated place relationships to safe matches. Skips unmatched records. |
| Content-sharing links | `your_facebook_activity/posts/content_sharing_links_you_have_created.json` | Enrichment only. Adds confirmed post IDs and shared-content links to safe matches. Skips unmatched records. Shared URLs are not treated as direct Facebook post URLs. |

Other Facebook files are currently ignored. Unreferenced media files do not create posts.

## Requirements

- Windows 11.
- PowerShell 7.
- Node.js 24.x. Node 25 and later are not currently supported by `package.json`.
- npm, included with Node.js.
- Enough free OneDrive space for the SQLite database and its temporary lock file.

The verified development runtime is Node.js 24.14.0. Node may print an experimental warning for its built-in SQLite module. That warning is expected with the verified runtime.

## Initial setup

Open PowerShell 7 in the repository directory.

Confirm the required tools:

```powershell
node --version
npm --version
$PSVersionTable.PSVersion
```

The Node version must start with `v24`.

Install the exact dependencies recorded in `package-lock.json`:

```powershell
npm ci
```

Run the complete development validation:

```powershell
npm run check
```

This runs strict TypeScript checking and the full automated test suite.

## Prepare the Facebook export

1. Request a Facebook information download in JSON format, not HTML.
2. Download every part belonging to the same export session.
3. Extract each downloaded archive into its own folder.
4. Keep all extracted folders outside this Git repository.
5. Do not rename or reorganize the directories inside an extracted export.

Some Facebook downloads split metadata and media across multiple folders. Pass every extracted root from the same export session through `ExportPath`.

Example placeholders used below:

```powershell
$ExportPaths = @(
    'C:\Private\FacebookExport-Part1'
    'C:\Private\FacebookExport-Part2'
)

$DatabasePath = 'C:\Private\OneDrive\Facebook Cleaner\facebook-inventory.db'
$ReportPath = 'C:\Private\OneDrive\Facebook Cleaner\last-import-report.json'
```

Replace these placeholders with your real paths. Do not place the export, database, or report under the repository.

## Step 1: Validate the primary timeline

Validation checks the numbered primary timeline files without creating or modifying a database:

```powershell
.\scripts\Invoke-FacebookInventoryImport.ps1 `
    -ExportPath $ExportPaths `
    -ValidateOnly
```

To save the sanitized validation report:

```powershell
.\scripts\Invoke-FacebookInventoryImport.ps1 `
    -ExportPath $ExportPaths `
    -ValidateOnly `
    -ReportPath 'C:\Private\OneDrive\Facebook Cleaner\validation-report.json'
```

Validation currently covers the primary timeline files. Secondary sources are parsed and reconciled during a full import.

A successful validation reports:

- Timeline files discovered.
- Records examined and parsed.
- Fingerprinted, partial, unsupported, and failed record counts.
- Earliest and latest post timestamps.
- A collection fingerprint.

Validation without `ReportPath` prints the summary and writes no report file.

## Step 2: Import or update the inventory

Run the full importer:

```powershell
.\scripts\Invoke-FacebookInventoryImport.ps1 `
    -ExportPath $ExportPaths `
    -DatabasePath $DatabasePath `
    -ReportPath $ReportPath
```

`ReportPath` is optional. If omitted, the importer writes `last-import-report.json` beside the database.

On the first run, the importer:

1. Creates the destination directory when needed.
2. Creates the SQLite database and applies ordered migrations.
3. Acquires an adjacent `<database>.lock` file.
4. Discovers all currently supported source files.
5. Streams the large primary timeline arrays instead of loading them completely into memory.
6. Normalizes records and generates stable fingerprints.
7. Applies deterministic matching rules in order.
8. Writes source provenance, canonical posts, media, links, state evidence, observations, and sanitized errors in bounded transactions.
9. Runs `PRAGMA integrity_check`.
10. Writes the sanitized JSON report atomically.
11. Closes the database and removes its lock.

Running the same command again is supported and expected. A stable repeat run should add zero duplicate posts. It creates new source observations so the database retains a history of every collection run.

## PowerShell parameters

| Parameter | Required | Description |
| --- | --- | --- |
| `ExportPath` | Yes | One or more extracted Facebook export roots. Use a PowerShell string array for multiple roots. |
| `DatabasePath` | Import only | Destination SQLite file. The directory is created automatically. |
| `ReportPath` | No | Sanitized JSON report destination. Import defaults beside the database. Validation writes a report only when this parameter is supplied. |
| `ValidateOnly` | No | Validates the primary timeline without opening or changing a database. |

The PowerShell wrapper passes these values to the TypeScript CLI without printing resolved private paths.

## Exit codes

| Exit code | Meaning |
| ---: | --- |
| `0` | Completed without errors. |
| `1` | Failed, invalid arguments, missing required input, database or lock failure, or report-write failure. |
| `2` | Completed with one or more record-level errors. Review the sanitized report. |

After running the PowerShell wrapper, inspect the exit code with:

```powershell
$LASTEXITCODE
```

## Database contents

The SQLite database stores:

- An internal immutable record UUID.
- Facebook post ID when supplied by a supported source.
- Confirmed direct post URL when supplied by a supported source.
- Creation timestamp and UTC time.
- Post type.
- Post text or caption.
- Audience status when available. Current exports do not map an audience to each post, so this usually remains unavailable.
- Original source name and URL for shared content when available.
- Media references and safely matched metadata.
- Deduplicated places and post-to-place relationships from safely matched check-ins.
- Facebook state: active, archived, trash, or unknown.
- First-collected, last-collected, and verification timestamps.
- Source file and record-index provenance.
- Every import run and matching observation.
- Sanitized structural errors.

The database uses foreign-key enforcement, `journal_mode=DELETE`, `synchronous=FULL`, and a five-second busy timeout. These settings favor data safety and OneDrive compatibility over maximum write speed.

## Deterministic matching

The importer evaluates matching evidence in this order:

1. Facebook post ID.
2. Confirmed direct post URL.
3. Semantic fingerprint and occurrence slot.
4. Timestamp and media reference.
5. Timestamp and external URL.
6. Timestamp and normalized text.
7. Unique timestamp.
8. Create an unmatched record only when its source is authoritative.
9. Skip unmatched enrichment-only metadata.

The importer does not merge an ambiguous record. It records the ambiguity for review.

Source processing precedence is primary timeline, archive, trash, reels, video metadata, uncategorized-photo metadata, album metadata, check-in metadata, then content-sharing-link metadata. Confirmed trash state cannot be downgraded by another supported source. Reel classification and canonical reel identity cannot be downgraded by less-specific metadata.

See [docs/sqlite-data-model.md](docs/sqlite-data-model.md) for the complete identity contract and acceptance tests.

## Import report

The current import report uses schema version 2. It contains:

- Run and collection identifiers.
- Start time, completion time, and duration.
- Peak process memory and database size.
- Database integrity result.
- Per-source file counts and parse status.
- Records examined, matched, created, updated, ambiguous, skipped, and failed.
- Canonical post count and date range.
- Missing Facebook ID, direct URL, and audience totals.
- Post-type, media, link, place, and relationship totals.
- Deterministic matching-rule counts.
- Stable error-code counts.
- Up to 100 sanitized issue locations using export-root number, relative path, and record index.

The terminal summary collapses album-file details into one aggregate line. The JSON report retains the result for every album file.

The report intentionally excludes full post text, personal names, personal URLs, and absolute export paths. It is still best to keep reports private because aggregate activity information may be sensitive.

## OneDrive backup guidance

- Put the database in a private OneDrive folder, not in the repository.
- Allow an import to finish and the `.lock` file to disappear before shutting down or moving the database.
- Wait for OneDrive synchronization to complete after a large import.
- Do not run the importer against the same synced database from two computers at once.
- For an additional point-in-time backup, copy the closed `.db` file after synchronization completes.

The adjacent lock file contains the database path, computer name, process ID, and application start time. It is temporary and removed after a clean shutdown.

## Troubleshooting

### Dependencies are missing

Error:

```text
Project dependencies are missing. Run npm install first.
```

Run:

```powershell
npm ci
```

### No primary timeline files were found

Confirm that `ExportPath` points to the extracted export root, not directly to `your_facebook_activity` or a JSON file. The root must contain:

```text
your_facebook_activity\posts\your_posts__check_ins__photos_and_videos_*.json
```

### The database is locked

Only one writer is allowed. Confirm no importer is running on this or another computer. If a previous process crashed, inspect the adjacent `.lock` file before removing it. Never remove an active or remote lock merely to force an import.

### The command exits with code 2

The overall import completed, but at least one record had a structural, matching, or processing issue. Review `errorCodeCounts`, `sourceFiles`, and `issues` in the sanitized report.

### Node prints an SQLite experimental warning

This is expected on the verified Node.js 24 runtime. The project isolates SQLite access and tests the supported runtime directly.

### The database keeps growing after repeat imports

This is expected. Canonical post totals should remain stable, but every run adds source records and post observations for auditability.

### OneDrive shows a sync conflict

Stop all import processes. Preserve both copies until you determine which database completed successfully. Do not merge SQLite files manually. Use the copy whose latest run completed and whose integrity check returns `ok`.

## Verified private-export result

Only aggregate results are documented. No private content is stored in this repository.

- 23,028 canonical posts.
- 49 reels.
- 449 videos.
- 16 confirmed archived posts.
- One confirmed trash post.
- 336 media records enriched from secondary metadata.
- 137 matched media records include album name, description, last-modified timestamp, cover status, source file, and album ordinal.
- 356 check-ins safely matched existing posts.
- 133 deduplicated places and 356 post-to-place relationships.
- 73 content-sharing-link records parsed and retained as skipped provenance because none had a deterministic canonical-post match.
- Zero duplicate posts added on the latest repeat import.
- Database integrity: `ok`.

The exact database size, run duration, and cumulative observation totals change after every import and are recorded in the latest private report and [docs/facebook-export-analysis.md](docs/facebook-export-analysis.md).

## Verify repository privacy before pushing

Review pending files:

```powershell
git status --short
git status --short --ignored
```

Confirm common private targets are ignored:

```powershell
git check-ignore -v --no-index `
    facebook-inventory.db `
    last-import-report.json `
    private-photo.jpg `
    private-video.mp4
```

Before committing, verify that staged files contain only source code, sanitized fixtures, and documentation:

```powershell
git diff --cached --name-only
git diff --cached
```

Do not use `git add -f` for an export, database, report, or media file.

## Development commands

```powershell
npm run typecheck
npm test
npm run check
```

Direct CLI scripts also exist for development:

```powershell
npm run validate -- --export-path 'C:\Private\FacebookExport'
npm run import -- --export-path 'C:\Private\FacebookExport' --database-path 'C:\Private\facebook-inventory.db'
```

The PowerShell wrapper is the recommended Windows interface.

## Project documentation

- [CHANGELOG.md](CHANGELOG.md): every project change.
- [docs/implementation-plan.md](docs/implementation-plan.md): implementation sequence and completed milestones.
- [docs/sqlite-data-model.md](docs/sqlite-data-model.md): schema, identity rules, and matching acceptance tests.
- [docs/facebook-export-analysis.md](docs/facebook-export-analysis.md): sanitized source analysis and aggregate private validation results.
- [markdowns/Facebook-Personal-Profile-Cleanup-Tool.md](markdowns/Facebook-Personal-Profile-Cleanup-Tool.md): original concept and approved scope.

## Mandatory documentation maintenance

Every change must update [CHANGELOG.md](CHANGELOG.md). Every change affecting behavior, supported sources, commands, requirements, outputs, privacy controls, or operator workflow must also update this README in the same change set.

The repository-level requirements are recorded in [AGENTS.md](AGENTS.md).
