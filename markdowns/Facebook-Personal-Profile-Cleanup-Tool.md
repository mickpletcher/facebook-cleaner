# Facebook Personal Profile Inventory Tool

## Project Status

This document defines the approved project scope. The post inventory is implemented and populated. Full-export inventory, activity control, review, and removal workflows are approved future phases.

## Project Goal

Build a local tool that inventories everything Facebook includes in the user's supplied information export and gives the user the fullest practical control over removable content, interactions, settings, and data.

The tool cannot claim to contain everything Facebook holds internally. Its completeness boundary is the files Facebook supplies in the selected export plus any separately approved and verified enrichment source.

The inventory will be stored in a local SQLite database located in a user-selected OneDrive folder. Collection will gather available activity information without changing any Facebook content or settings.

Collection remains read-only. Removal features must be implemented as a separate, explicitly confirmed phase after the relevant activity can be located reliably.

## Complete Export Scope

Every file and structured record in the supplied Facebook export is in scope for discovery, provenance tracking, and inventory. This includes:

- User-created posts, comments, replies, reactions, shares, stories, and media.
- Content and interactions on the user's profile, other profiles, Pages, groups, events, and listings.
- Messages and message attachments.
- Friends, followers, following, blocked accounts, contacts, and other connections.
- Personal and profile information.
- Preferences and account settings.
- Search, browsing, location, and activity history included in the export.
- Advertising interests and advertising activity.
- Apps, websites, and off-Facebook activity.
- Login, logout, IP address, device, browser, session, and security history.
- Page and group administration information.
- Files, media, and metadata included in any export folder.

Structured JSON should be stored with full source provenance. Binary media should normally remain outside SQLite and be represented by path-independent fingerprints, type, size, hash, availability, and source provenance. This avoids turning the SQLite file into an impractical binary archive while still inventorying every exported file.

## Control and Removal Scope

Scope follows ownership and authorship, not location. User-created content and user-made interactions are in scope whether they appear on:

- The user's profile or timeline.
- Another person's profile or post.
- A Facebook Page.
- A public, private, or hidden group available in the export.
- A photo, video, reel, story, event, listing, or other supported Facebook content surface.

The inventory should include every supported activity category attributable to the user, including:

- Posts created by the user.
- Posts shared by the user.
- Comments and replies written by the user.
- Photos, videos, reels, stories, and other media posted by the user.
- Reactions and likes made by the user.
- Group posts, comments, replies, media, and reactions created by the user.
- Posts, comments, replies, media, and reactions created by the user on Pages or other profiles.
- Content published through a Page identity controlled by the user when the export provides reliable ownership evidence.
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
- The target post, comment, Page, profile, or group associated with each comment or reaction when available.
- Direct target URLs and Facebook identifiers when available.
- Whether each activity record has enough evidence to support a future removal action.

All exported data may be inventoried, but inventory does not imply ownership. Content created by another person must be marked as external or contextual. Tagged content is not user-owned unless the user authored it. Removal eligibility must distinguish user-owned content, user-made interactions, controlled identities, supported privacy actions, contextual records, and records Facebook does not allow the user to remove.

Full control means the tool should inventory, locate, review, classify, export, and request removal of supported user-owned activity. It does not mean Facebook will expose a removable identifier for every historical record. Records blocked by missing identifiers, removed groups, inaccessible posts, permissions, or Facebook interface limitations must remain visible with an accurate eligibility reason.

## Activity Record Requirements

Comments and reactions will be separate entities from posts. Each activity record should contain:

- Internal immutable record ID.
- Activity type.
- Activity surface: own profile, other profile, Page, group, or other.
- Facebook activity ID when available.
- Creation date and time when available.
- Comment text for comments.
- Reaction type for reactions.
- Direct activity URL when available.
- Target type and target identifier when available.
- Target URL, group, Page, or profile reference when available.
- Source-file and source-record provenance.
- Date first collected and date last verified.
- Collection status.
- Removal eligibility: eligible, insufficient evidence, unsupported, or unknown.
- Removal limitation reason when ineligible.
- Future removal status: not requested, queued, removed, failed, or manually resolved.

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
- The database must be treated as a highly sensitive personal archive.
- Database encryption must be optional. Supported modes will include explicit unencrypted SQLite and a future encrypted-SQLite mode.
- The selected encryption mode must be recorded as nonsensitive database metadata and displayed before import.
- Encrypted mode must fail closed when its provider or key is unavailable. It must not create or open an unencrypted replacement silently.
- Encryption keys and passphrases must not appear in command-line arguments, configuration committed to Git, reports, logs, lock files, or database metadata.
- Interactive secret entry or Windows Credential Manager should be preferred for future encrypted mode.
- Switching between encrypted and unencrypted modes requires an explicit verified database migration or export-and-rebuild operation. Renaming a file is not conversion.
- Messages, contacts, locations, IP addresses, device details, login records, and security information must never appear in sanitized reports or repository fixtures.
- Binary files must be cataloged without storing their contents as SQLite blobs unless a later design explicitly approves that change.
- Highly sensitive categories must not be imported until the selected database mode, Windows access, optional encryption or compensating protection, OneDrive permissions, backup exposure, reports, key recovery, and temporary-file handling are explicitly reviewed.

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

## Next Scope Step

Inventory and classify the remaining JSON files under `your_facebook_activity` and relevant group-activity directories. Identify the files containing comments, reactions, and user-created group activity. Record aggregate structures and counts only. Do not copy private exports into the repository. Use those findings to design deterministic identities and future SQLite migrations before implementing additional importers.

## Approved Future Phases

After each inventory is complete and reliable, future phases may add:

1. Review and classification for posts, comments, and reactions.
2. Explicit selection of activity to remove.
3. Post archive, trash, or deletion workflows.
4. Comment deletion workflows.
5. Reaction removal workflows, including reactions on group content and other people's posts.
6. Verification that each requested action succeeded.
7. An immutable action log containing the target, request time, result, and sanitized error status.

Removal must never run automatically from import results. It requires an explicit user-selected queue, a preview, confirmation, bounded execution, and post-action verification. Records lacking a reliable target ID or URL remain ineligible for automated removal.
