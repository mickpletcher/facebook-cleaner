# Facebook Personal Profile Inventory Tool

## Project Status

This document defines the approved scope for the initial project phase. The primary timeline importer is implemented and has populated the local SQLite inventory. Secondary export sources and read-only Facebook enrichment remain future work.

## Project Goal

Build a local, read-only tool that creates and maintains a complete inventory of posts from the user's personal Facebook profile.

The inventory will be stored in a local SQLite database located in a user-selected OneDrive folder. The tool will collect available post information without changing any Facebook content or settings.

The initial phase is limited to populating and maintaining the database. Reviewing, classifying, archiving, trashing, or deleting posts is not part of this phase.

## Initial Content Scope

The inventory will include:

- Posts created by the user.
- Posts shared by the user.
- Text posts.
- Photos.
- Videos.
- Reels.
- Link posts.
- Archived posts when available.
- Posts currently in trash when available.
- The current audience setting when available.
- The direct Facebook post URL when available.
- The original source name and URL for shared content when available.

The initial phase does not include:

- Comments made by the user.
- Reactions or likes made by the user.
- Messenger content.
- Posts created by other people that only tag the user.
- Posts placed on the user's profile by other people.
- Facebook Page or group administration activity.

## Required Post Information

Each post record will contain:

- Internal record ID.
- Facebook post ID, when available.
- Direct post URL, when available.
- Creation date and time.
- Post type.
- Post text or caption.
- Current audience setting.
- Original source name for shared posts.
- Original source URL.
- Media URLs or references.
- Current Facebook state: active, archived, trash, or unknown.
- Date first collected.
- Date last verified.
- Collection status: complete, partial, or unavailable.

Information Facebook does not expose reliably must be stored as unknown or unavailable. The tool must not infer or invent post IDs, URLs, audience settings, sources, dates, or Facebook states.

## Storage

SQLite will be the authoritative inventory.

The database must:

- Support more than 100,000 posts.
- Prevent duplicate post records.
- Preserve existing records across repeated collection runs.
- Update records when newer or more complete information becomes available.
- Support efficient searches and filtering in future phases.
- Use safe transactions so an interrupted import does not corrupt the inventory.

CSV is not the primary storage format. Exporting selected database records to CSV may be considered later.

## OneDrive Backup

The SQLite database will be stored in a user-selected OneDrive folder. OneDrive will provide synchronization, backup, recovery, and version history.

The tool must:

- Display the database location.
- Prevent more than one running instance from writing to the database.
- Close database connections cleanly.
- Warn against using the same database from multiple computers at the same time.
- Detect OneDrive conflict copies when practical.

## Collection Strategy

The tool will use a hybrid collection approach.

### Primary Collection

The user's Facebook information export in JSON format will be the primary source for building the SQLite inventory. This is the preferred method for processing the user's full history of more than 100,000 posts.

### Read-Only Enrichment

The user's authenticated Facebook interface may later be used in read-only mode to verify records and fill information missing from the export, including:

- Direct post URLs.
- Current audience settings.
- Archive status.
- Trash status.

Read-only enrichment must not change Facebook content or settings.

### Repeated Collection

Later collection runs must update and enrich existing records rather than create duplicates or rebuild the database unnecessarily.

## Collection Reporting

Each collection run must report:

- Collection start and completion times.
- Total records imported or examined.
- Date range covered.
- Earliest and latest post found.
- New records added.
- Existing records updated.
- Duplicate records detected.
- Records missing direct post URLs.
- Records missing audience settings.
- Records requiring Facebook verification.
- Whether collection completed successfully or stopped early.
- Errors encountered during collection.

The report must make incomplete or interrupted collection runs clearly visible.

## Safety and Privacy Requirements

- Collection is read-only.
- The tool must not modify Facebook content or settings.
- The tool must not request or store the user's Facebook password.
- All collected data remains local unless the user explicitly decides otherwise in a future phase.
- Personal Facebook exports and SQLite databases must not be committed to the repository.
- The importer must tolerate missing, malformed, and unexpected records without corrupting the database.
- The tool must report skipped or unsupported records.

## Initial Completion Criteria

The initial phase is complete when:

1. The tool can read the supported JSON files from an extracted Facebook information export.
2. It can populate a local SQLite database with the approved post records.
3. It can process more than 100,000 posts without loading the entire inventory into memory at once.
4. Re-importing the same export does not create duplicate records.
5. A later export can add new posts and update existing records.
6. Missing fields are recorded as unknown or unavailable.
7. Interrupted imports do not corrupt the database.
8. Every collection run produces a coverage and error report.
9. No Facebook content or settings are changed.
10. No Facebook credentials are requested or stored.

## Verified Export Findings

The Facebook export was inspected locally on July 21, 2026. It contains 22,966 primary timeline records covering January 18, 2009 through July 20, 2026.

The export confirms that:

- Creation timestamps, post text, attachment types, media references, shared links, and some source information are available.
- Facebook post IDs are generally absent from primary timeline records.
- Direct Facebook post URLs are not reliably identified.
- Audience settings are not mapped to individual posts.
- Archive and trash files use a different record structure from the primary timeline.
- Reels, videos, photos, albums, check-ins, and shared-link files may overlap primary timeline records.
- Multiple download folders may belong to one export and include supplemental media without post metadata.

Missing post IDs, direct URLs, audiences, and uncertain states must remain unavailable or unknown until they can be verified through a separately approved read-only enrichment process.

The private export must not be copied into or committed to the repository.

## Next Step Before Implementation

Review the SQLite data model in `docs/sqlite-data-model.md` and the phased implementation plan in `docs/implementation-plan.md`. The first coding assignment covers repository privacy protections and the SQLite foundation only.

## Future Upgrade

After the inventory is complete and reliable, a future project phase may add tools to review and remove selected Facebook posts. Any review, classification, archive, trash, deletion, reaction removal, Page unlike, or source unfollow capability must be designed and approved separately.
