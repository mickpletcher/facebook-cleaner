# Facebook Export Analysis

## Purpose

This document records the structure of the Facebook export received on July 21, 2026. It contains no post text, names, URLs, locations, messages, or personal media.

The analysis covers one primary export folder and one supplemental export folder downloaded on July 21, 2026. Their local names and paths are intentionally omitted.

The export folders are private input data. They must not be copied into or committed to this repository.

## Export Summary

### Primary export

- Total size: 2.36 GB.
- Total files: 17,447.
- JSON files: 1,060.
- Media files: approximately 16,000.
- Top-level categories: ads information, apps and websites, connections, logged information, personal information, preferences, security and login information, and Facebook activity.

### Supplemental export

- Total files: 775.
- JSON files: none.
- 774 PNG assets without file extensions.
- One JPEG image.
- The PNG assets represent 129 images exported at six sizes each: 24, 32, 48, 64, 72, and 96 pixels.
- Only one supplemental filename is referenced by the primary export's post JSON.

The supplemental export is not a post metadata source. It may be searched when resolving a media reference, but standalone files must not create post records.

## Primary Timeline Files

The authoritative starting point for the inventory is:

| File | Records |
| --- | ---: |
| `your_posts__check_ins__photos_and_videos_1.json` | 10,000 |
| `your_posts__check_ins__photos_and_videos_2.json` | 10,000 |
| `your_posts__check_ins__photos_and_videos_3.json` | 2,966 |
| **Total** | **22,966** |

The timeline records cover January 18, 2009 through July 20, 2026.

The main record structure can include:

- `timestamp`
- `title`
- `data`
- `attachments`
- `tags`

Observed nested fields include:

- Post text in `data.post`.
- Update timestamps in `data.update_timestamp`.
- Media in `attachments.data.media`.
- Shared links in `attachments.data.external_context`.
- Places in `attachments.data.place`.
- Media paths in `media.uri`.
- Media creation timestamps and descriptions.

The primary timeline records do not contain an `fbid`, `post_id`, `privacy`, or `audience` field.

## Content Coverage

Within the 22,966 main timeline records:

- 20,780 contain post text.
- 6,684 contain media attachments.
- 9,477 contain external-link attachments.
- 3,423 contain place attachments.

A record can appear in more than one category.

Facebook URLs occur in attachment data, but they cannot be assumed to be the direct URL of the containing timeline post. External URLs generally identify shared content rather than the user's Facebook post.

## Secondary Post Files

| File or group | Records | Intended use |
| --- | ---: | --- |
| `archive.json` | 16 | Identify archived records and extract available IDs and labeled values. |
| `trash.json` | 1 | Identify records currently represented as trash and extract available IDs and labeled values. |
| `your_reels.json` | 49 | Capture reels not safely identifiable from the main timeline alone. |
| `your_videos.json` | 518 | Supplement video metadata and media paths. |
| `your_uncategorized_photos.json` | 799 | Supplement photo metadata and media paths. |
| `album/*.json` | 255 albums and 11,241 photo entries | Supplement album and photo metadata. |
| `check-ins.json` | 356 | Supplement check-in data when it can be matched to a timeline record. |
| `content_sharing_links_you_have_created.json` | 73 | Supplement link-sharing data when it can be matched safely. |

Secondary files may overlap the main timeline and each other. They must enrich matched records rather than automatically create additional posts.

## Field Availability

| Approved inventory field | Export availability | Handling |
| --- | --- | --- |
| Internal record ID | Not provided | Generate locally after deterministic matching. |
| Facebook post ID | Generally missing from main timeline | Store as unavailable unless supplied by a matched secondary record. |
| Direct post URL | Not reliably provided | Store as unavailable unless a URL is verified as the post URL. |
| Creation date and time | Available | Convert Unix timestamps without losing the original value. |
| Post type | Derivable | Derive conservatively from attachment structure and source file. |
| Post text or caption | Usually available | Preserve exactly as exported. |
| Current audience setting | Not mapped to posts | Store as unavailable pending future read-only enrichment. |
| Original source name | Sometimes available | Extract from shared-link context when present. |
| Original source URL | Sometimes available | Extract from shared-link context when present. |
| Media URLs or references | Available for many records | Store normalized references without importing unreferenced media. |
| Facebook state | Partially available | Use archive and trash files when a record can be matched; otherwise use active or unknown conservatively. |
| Date first collected | Not provided | Record during import. |
| Date last verified | Not provided | Record during import or later verification. |
| Collection status | Not provided | Calculate from required-field coverage and parsing results. |

## Audience Data

`connections/friends/your_post_audiences.json` contains 26 audience-related entries. Its structure describes named audience settings, but it does not map those settings to the 22,966 timeline posts.

The initial importer must therefore record post audience as unavailable. It must not apply a general account setting to individual posts.

## Identity and Duplicate Risks

The primary timeline does not provide a stable post ID. Matching cannot depend on row position because Facebook splits records across numbered files and may change those boundaries in later exports.

Initial identity design must consider:

- Original Unix timestamp.
- Exact normalized post text.
- Referenced media paths.
- External shared URL.
- Place information.
- Source-file metadata.
- Available `fbid` values from safely matched secondary records.

The generated identity must distinguish legitimate posts that share the same timestamp or content. Matching rules must be documented and tested before import behavior is considered stable.

## Import Boundaries

The initial importer should:

1. Treat the three main timeline files as the authoritative starting set.
2. Parse archive and trash files using their separate schema.
3. Enrich timeline records from reels, videos, photos, albums, check-ins, and shared-link files only when a safe match exists.
4. Accept multiple folders that belong to one Facebook export session.
5. Resolve referenced media across all supplied export folders.
6. Ignore unreferenced media and unrelated Facebook activity categories.
7. Record unsupported records and parse errors without stopping the entire import.

The initial importer should not ingest comments, reactions, messages, tagged content created by other people, Page administration activity, group administration activity, advertising data, login information, or unrelated account activity.

## Verified Gaps

The export alone cannot reliably populate:

- Current audience for each post.
- Direct Facebook URL for each post.
- Facebook post ID for most timeline records.
- Current state when a record cannot be matched to archive or trash data.

These fields must remain unavailable or unknown until a separately approved read-only enrichment phase exists.

## Streaming Validation Result

The implemented read-only streaming validator processed both export roots on July 21, 2026.

- Three primary timeline files discovered.
- 22,966 records examined.
- 22,966 records structurally valid.
- 22,966 records normalized and assigned version 1 semantic fingerprints.
- Zero partial records.
- Zero unsupported records.
- Zero parsing errors.
- Earliest timestamp: January 18, 2009 at 04:32:52 UTC.
- Latest timestamp: July 20, 2026 at 22:05:17 UTC.

No database or validation report file was created during the private-export run.

## Primary Timeline Import Result

The primary timeline importer was run three times against both export roots on July 22, 2026.

First run:

- 22,966 source records examined.
- 22,966 canonical posts created.
- Zero ambiguous records.
- Zero skipped records.
- Zero errors.
- Database integrity check returned `ok`.

Second run:

- 22,966 source records examined.
- 22,966 existing posts matched by semantic fingerprint and occurrence slot.
- Zero canonical posts created.
- Zero canonical posts updated.
- Zero ambiguous records.
- Zero skipped records.
- Zero errors.
- Database integrity check returned `ok`.

Third run with expanded version 2 reporting:

- 22,966 source records examined and matched.
- Zero canonical posts created or updated.
- Zero ambiguous, skipped, or failed records.
- 30.71 second duration.
- 153.50 MB peak process memory.
- 96.51 MB database size.
- 7,346 media records and 7,703 post-media relationships.
- 5,594 link records.
- All 22,966 posts currently lack a Facebook post ID, direct post URL, and mapped audience setting because those fields are absent from the primary timeline export.
- Database integrity check returned `ok`.

Independent reconciliation confirmed 22,966 canonical posts, 68,898 source records, 68,898 post observations, three completed import runs, zero failed runs, zero unmatched parsed records, and zero orphaned observations. The generated report was also checked for absolute user paths and private export-folder names; neither was present.

## Archive Import Result

Archive support was run against the 16 records in `archive.json` on July 22, 2026.

- All 16 records parsed without errors.
- None matched a primary timeline post.
- 16 canonical archived posts were created.
- All 16 received their exported Facebook post ID, direct post URL, and confirmed `archived` state.
- A repeated combined import matched all 22,982 timeline and archive records.
- The repeated import created and updated zero posts.
- Archive records matched by Facebook post ID on the repeated run.
- Database integrity check returned `ok`.

Independent reconciliation after the repeated run confirmed 22,982 canonical posts, including 16 confirmed archived posts, 114,862 source records, 114,862 post observations, 32 archive state observations across two archive runs, and five completed import runs. The sanitized report contained no absolute user path or private export-folder name.

## Trash Import Result

Trash support was run against the single record in `trash.json` on July 22, 2026.

- The record parsed without errors.
- It did not match a timeline or archive post.
- One canonical trash post was created.
- It received its exported Facebook post ID, direct post URL, and confirmed `trash` state.
- A repeated combined import matched all 22,983 timeline, archive, and trash records.
- The repeated import created and updated zero posts.
- The trash record matched by Facebook post ID on the repeated run.
- Database integrity check returned `ok`.

Independent reconciliation after the repeated run confirmed 22,983 canonical posts, including 16 confirmed archived posts and one confirmed trash post, 160,828 source records, 160,828 post observations, 66 confirmed state observations, and seven completed import runs. The sanitized report contained no absolute user path or private export-folder name.

## Reels Import Result

Reels support was run against the 49 records in `your_reels.json` on July 22, 2026.

- All 49 records parsed without errors.
- Four matched existing timeline posts.
- Three matched by semantic fingerprint and occurrence slot.
- One matched by timestamp and media reference.
- 45 canonical reels were created because they were absent from the earlier sources.
- All 49 canonical records are classified as `reel`.
- Reel identity takes precedence when a less-specific timeline representation differs in caption but matches by timestamp and media.
- The final repeated combined import matched all 23,032 source records.
- The final repeated import created and updated zero posts.
- Database integrity check returned `ok`.

Independent reconciliation after final validation confirmed 23,028 canonical posts, including 49 reels, 16 confirmed archived posts, and one confirmed trash post, 229,924 source records, 229,924 post observations, 117 confirmed state observations, and ten completed import runs.

## Video Metadata Import Result

Video metadata enrichment was run against the 518 records in `your_videos.json` on July 22, 2026.

- All 518 records parsed without errors.
- 191 matched canonical posts safely.
- 93 matched by semantic fingerprint and occurrence slot.
- 98 matched by timestamp and media reference.
- Matched records populated media type, creation timestamp, and stored metadata.
- 327 unmatched metadata records were skipped.
- Video metadata created zero canonical posts.
- The corrected repeated import updated zero canonical posts.
- Canonical type counts remained stable at 49 reels and 449 videos.
- Database integrity check returned `ok`.

Independent reconciliation after the final report run confirmed 23,028 canonical posts, 191 enriched media records, 300,574 source records, 981 skipped source observations across three video metadata runs, 299,593 matched post observations, and thirteen completed import runs. The final report includes `M09_UNMATCHED_ENRICHMENT: 327` and contains no absolute user path or private export-folder name.

## Uncategorized-Photo Metadata Import Result

Photo metadata enrichment was run against the 799 records in `your_uncategorized_photos.json` on July 22, 2026.

- All 799 records parsed without errors.
- Eight matched canonical posts by timestamp and media reference.
- Matched records populated media type, creation timestamp, and stored metadata.
- 791 unmatched photo metadata records were skipped.
- Photo metadata created zero canonical posts.
- The repeated import updated zero canonical posts.
- Canonical type counts remained unchanged.
- Database integrity check returned `ok`.

Independent reconciliation confirmed 23,028 canonical posts, 199 enriched media records, 349,272 source records, 3,217 skipped source observations across all enrichment runs, 346,055 matched post observations, and fifteen completed import runs. The final run reported `M09_UNMATCHED_ENRICHMENT: 1118`, including 327 video and 791 photo metadata records.

## Album-Photo Metadata Import Result

Album enrichment was run against 255 files containing 11,241 photo records on July 22, 2026.

- All 255 album files parsed without errors.
- 137 album photos matched canonical posts safely.
- 83 matched by semantic fingerprint and occurrence slot.
- 54 matched by timestamp and media reference.
- Matched media received album name, description, last-modified timestamp, cover status, source file, ordinal, and photo metadata.
- 11,104 unmatched album-photo records were skipped.
- Album metadata created zero canonical posts.
- The repeated import updated zero canonical posts.
- Canonical post type and Facebook state counts remained unchanged.
- Database integrity check returned `ok`.

Independent reconciliation confirmed 23,028 canonical posts, 336 enriched media records, 420,452 source records, 27,661 skipped source observations across all enrichment runs, 392,791 matched post observations, and seventeen completed import runs. The final database size was 432.66 MB.

## Check-In Enrichment Result

Check-in enrichment was run against all 356 records in `check-ins.json` on July 22, 2026.

- The check-in file parsed without errors.
- All 356 check-ins matched existing canonical posts safely.
- Four initially matched by timestamp and normalized text.
- 352 initially matched by unique timestamp.
- Matched records added confirmed Facebook post IDs and direct post URLs when previously unavailable.
- The importer created 133 deduplicated place records and 356 post-place relationships.
- Check-in metadata created zero canonical posts.
- The repeated import updated zero canonical posts and created no duplicate places or relationships.
- The repeat run matched all 356 check-ins by Facebook post ID.
- Database integrity check returned `ok`.

Independent reconciliation confirmed 23,028 canonical posts, 133 places, 356 post-place relationships, 492,344 source records, 52,087 skipped source observations across all enrichment runs, 440,257 matched post observations, and nineteen completed import runs. The final database size was 502.21 MB.

## Content-Sharing-Link Enrichment Result

Content-sharing-link enrichment was run against all 73 records in `content_sharing_links_you_have_created.json` on July 22, 2026.

- The file parsed without errors.
- Every record contained a timestamp, Facebook ID, and labeled shared URL.
- Zero Facebook IDs matched canonical post IDs.
- Zero records had an exact canonical-post timestamp candidate.
- The exported `href` and display `value` normalized to the same URL for all 73 records.
- All 73 records were retained as skipped enrichment provenance.
- The importer created zero canonical posts and no unverified link relationships.
- The repeated import updated zero canonical posts and created no duplicate links.
- Database integrity check returned `ok`.

Independent reconciliation confirmed 23,028 canonical posts, 564,382 source records, 76,659 skipped source observations across all enrichment runs, 487,723 matched post observations, and twenty-one completed import runs. The final database size was 571.17 MB.

## Data Model

The proposed SQLite tables and deterministic matching rules are documented in `docs/sqlite-data-model.md`.
