import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importTimelineCollection } from "../../src/import/importer.js";
import { InventoryDatabase } from "../../src/database/connection.js";
import { formatImportTerminalSummary } from "../../src/import/report.js";

const migrationsDirectory = resolve("migrations");
const sanitizedFixture = resolve("tests/fixtures/sanitized-facebook-export");
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "facebook-cleaner-import-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createExportRoot(files: Record<string, unknown>): string {
  const root = createTemporaryDirectory();
  const postsDirectory = join(root, "your_facebook_activity", "posts");
  mkdirSync(postsDirectory, { recursive: true });
  for (const [name, records] of Object.entries(files)) {
    const directory =
      name === "your_reels.json"
        ? join(root, "your_facebook_activity", "reels")
        : postsDirectory;
    const filePath = join(directory, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(records), "utf8");
  }
  return root;
}

function queryValue(databasePath: string, sql: string): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare(sql).get();
    return Number(row?.value);
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("primary timeline importer", () => {
  it("imports the sanitized fixture and re-imports it without duplicates", async () => {
    const databasePath = join(createTemporaryDirectory(), "inventory.db");
    const options = {
      exportPaths: [sanitizedFixture],
      databasePath,
      migrationsDirectory,
    };

    const first = await importTimelineCollection(options);
    expect(first).toMatchObject({
      reportSchemaVersion: 2,
      status: "completed",
      recordsExamined: 3,
      recordsMatched: 0,
      postsAdded: 3,
      postsUpdated: 0,
      recordsAmbiguous: 0,
      recordsSkipped: 0,
      errorCount: 0,
      databaseIntegrity: "ok",
      canonicalPosts: 3,
      errorCodeCounts: {},
      issues: [],
      issuesTruncated: false,
    });
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
    expect(first.peakRssBytes).toBeGreaterThan(0);
    expect(first.databaseSizeBytes).toBeGreaterThan(0);
    expect(first.earliestPostUtc).not.toBeNull();
    expect(first.latestPostUtc).not.toBeNull();
    expect(first.sourceFiles).toHaveLength(1);
    expect(first.sourceFiles[0]).toMatchObject({
      exportRootNumber: 1,
      recordCount: 3,
      parseStatus: "completed",
      errorCount: 0,
    });
    expect(first.matchRuleCounts).toEqual({ M08_UNMATCHED_AUTHORITATIVE: 3 });

    const second = await importTimelineCollection(options);
    expect(second).toMatchObject({
      status: "completed",
      recordsExamined: 3,
      recordsMatched: 3,
      postsAdded: 0,
      postsUpdated: 0,
      errorCount: 0,
    });
    expect(second.matchRuleCounts).toEqual({
      M03_SEMANTIC_FINGERPRINT_SLOT: 3,
    });
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(3);
    expect(
      queryValue(databasePath, "SELECT COUNT(*) AS value FROM source_records"),
    ).toBe(6);
    expect(
      queryValue(databasePath, "SELECT COUNT(*) AS value FROM post_observations"),
    ).toBe(6);
  });

  it("preserves legitimate identical posts with separate occurrence slots", async () => {
    const identical = { timestamp: 10, data: [{ post: "Identical" }] };
    const exportRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [identical, identical],
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [exportRoot],
      databasePath,
      migrationsDirectory,
    });
    expect(first.postsAdded).toBe(2);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(
        database
          .prepare("SELECT occurrence_slot FROM posts ORDER BY occurrence_slot")
          .all()
          .map((row) => Number(row.occurrence_slot)),
      ).toEqual([1, 2]);
    } finally {
      database.close();
    }

    const second = await importTimelineCollection({
      exportPaths: [exportRoot],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(2);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(2);
  });

  it("keeps identities when records move between numbered files", async () => {
    const records = [
      { timestamp: 1, data: [{ post: "One" }] },
      { timestamp: 2, data: [{ post: "Two" }] },
      { timestamp: 3, data: [{ post: "Three" }] },
    ];
    const firstRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": records,
    });
    const secondRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": records.slice(0, 1),
      "your_posts__check_ins__photos_and_videos_2.json": records.slice(1),
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    await importTimelineCollection({
      exportPaths: [firstRoot],
      databasePath,
      migrationsDirectory,
    });
    const before = new DatabaseSync(databasePath, { readOnly: true });
    const recordIds = before
      .prepare("SELECT record_id FROM posts ORDER BY created_timestamp")
      .all()
      .map((row) => String(row.record_id));
    before.close();

    const second = await importTimelineCollection({
      exportPaths: [secondRoot],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    const after = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(
        after
          .prepare("SELECT record_id FROM posts ORDER BY created_timestamp")
          .all()
          .map((row) => String(row.record_id)),
      ).toEqual(recordIds);
    } finally {
      after.close();
    }
  });

  it("applies matching rules M01 through M07 in order", async () => {
    const media = (uri: string) => [{ data: [{ media: { uri } }] }];
    const link = (url: string) => [
      { data: [{ external_context: { url } }] },
    ];
    const initial = [
      { timestamp: 101, data: [{ post: "Media original" }], attachments: media("a.jpg") },
      { timestamp: 102, data: [{ post: "Link original" }], attachments: link("https://example.com/a") },
      { timestamp: 103, data: [{ post: "Same text" }] },
      { timestamp: 104 },
      { timestamp: 105, fbid: "fb-105", data: [{ post: "ID original" }] },
      {
        timestamp: 106,
        post_url: "https://www.facebook.com/posts/106",
        data: [{ post: "URL original" }],
      },
    ];
    const changed = [
      { timestamp: 101, data: [{ post: "Media changed" }], attachments: media("A.JPG") },
      { timestamp: 102, data: [{ post: "Link changed" }], attachments: link("https://example.com/a#fragment") },
      {
        timestamp: 103,
        data: [{ post: "Same text" }],
        attachments: [{ data: [{ place: { id: "place-103" } }] }],
      },
      { timestamp: 104, data: [{ post: "Added text" }] },
      { timestamp: 105, fbid: "fb-105", data: [{ post: "ID changed" }] },
      {
        timestamp: 106,
        post_url: "https://www.facebook.com/posts/106#details",
        data: [{ post: "URL changed" }],
      },
    ];
    const initialRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": initial,
    });
    const changedRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": changed,
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    await importTimelineCollection({
      exportPaths: [initialRoot],
      databasePath,
      migrationsDirectory,
    });
    const result = await importTimelineCollection({
      exportPaths: [changedRoot],
      databasePath,
      migrationsDirectory,
    });

    expect(result.postsAdded).toBe(0);
    expect(result.recordsMatched).toBe(6);
    expect(result.postsUpdated).toBe(6);
    expect(result.matchRuleCounts).toEqual({
      M01_FACEBOOK_ID: 1,
      M02_CONFIRMED_POST_URL: 1,
      M04_TIMESTAMP_AND_MEDIA: 1,
      M05_TIMESTAMP_AND_EXTERNAL_URL: 1,
      M06_TIMESTAMP_AND_TEXT: 1,
      M07_UNIQUE_TIMESTAMP: 1,
    });
  });

  it("retains posts absent from a later export", async () => {
    const firstRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        { timestamp: 1, data: [{ post: "One" }] },
        { timestamp: 2, data: [{ post: "Two" }] },
      ],
    });
    const laterRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        { timestamp: 2, data: [{ post: "Two" }] },
      ],
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    await importTimelineCollection({
      exportPaths: [firstRoot],
      databasePath,
      migrationsDirectory,
    });
    await importTimelineCollection({
      exportPaths: [laterRoot],
      databasePath,
      migrationsDirectory,
    });

    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(2);
  });

  it("imports archive records as confirmed state evidence", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        { timestamp: 200, data: [{ post: "Archived fixture post" }] },
      ],
      "archive.json": [
        {
          timestamp: 200,
          fbid: "fixture-archive-200",
          media: [],
          label_values: [
            { label: "Message", value: "Archived fixture post" },
            {
              label: "URL",
              value: "https://www.facebook.com/posts/fixture-archive-200",
              href: "https://www.facebook.com/posts/fixture-archive-200",
            },
          ],
        },
      ],
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      recordsExamined: 2,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      errorCount: 0,
    });
    expect(first.matchRuleCounts).toEqual({
      M03_SEMANTIC_FINGERPRINT_SLOT: 1,
      M08_UNMATCHED_AUTHORITATIVE: 1,
    });

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(database.prepare(`
        SELECT facebook_post_id, direct_post_url, facebook_state, state_status
        FROM posts
      `).get()).toMatchObject({
        facebook_post_id: "fixture-archive-200",
        direct_post_url: "https://www.facebook.com/posts/fixture-archive-200",
        facebook_state: "archived",
        state_status: "confirmed",
      });
      expect(
        Number(
          database
            .prepare("SELECT COUNT(*) AS value FROM post_state_observations")
            .get()?.value,
        ),
      ).toBe(1);
    } finally {
      database.close();
    }

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(2);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);
  });

  it("imports trash records with precedence over archive state", async () => {
    const archivedRecord = {
      timestamp: 300,
      fbid: "fixture-trash-300",
      media: [],
      label_values: [
        { label: "Message", value: "Trash fixture post" },
        {
          label: "URL",
          value: "https://www.facebook.com/posts/fixture-trash-300",
          href: "https://www.facebook.com/posts/fixture-trash-300",
        },
      ],
    };
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        { timestamp: 300, data: [{ post: "Trash fixture post" }] },
      ],
      "archive.json": [archivedRecord],
      "trash.json": archivedRecord,
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      archiveFiles: 1,
      trashFiles: 1,
      recordsExamined: 3,
      recordsMatched: 2,
      postsAdded: 1,
      postsUpdated: 1,
      errorCount: 0,
    });

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(database.prepare(`
        SELECT facebook_post_id, facebook_state, state_status FROM posts
      `).get()).toMatchObject({
        facebook_post_id: "fixture-trash-300",
        facebook_state: "trash",
        state_status: "confirmed",
      });
      expect(
        Number(
          database
            .prepare("SELECT COUNT(*) AS value FROM post_state_observations")
            .get()?.value,
        ),
      ).toBe(2);
    } finally {
      database.close();
    }

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(3);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);
  });

  it("matches and creates reels without changing confirmed state", async () => {
    const reel = (timestamp: number, text: string, uri: string) => ({
      timestamp,
      data: [{ post: text }],
      attachments: [{ data: [{ media: { uri } }] }],
      title: "Sanitized reel",
    });
    const matching = reel(400, "Matching reel", "media/matching.mp4");
    const timelineVersion = reel(
      400,
      "Earlier timeline caption",
      "media/matching.mp4",
    );
    const unmatched = reel(401, "Unmatched reel", "media/unmatched.mp4");
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [timelineVersion],
      "your_reels.json": { lasso_videos_v2: [matching, unmatched] },
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      archiveFiles: 0,
      trashFiles: 0,
      reelFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 2,
      postsUpdated: 1,
      errorCount: 0,
    });
    expect(first.postTypeCounts.reel).toBe(2);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(3);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(2);
  });

  it("enriches matched video media and skips unmatched metadata", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        {
          timestamp: 500,
          data: [{ post: "Timeline video caption" }],
          attachments: [
            { data: [{ media: { uri: "media/matched-video.mp4" } }] },
          ],
        },
      ],
      "your_videos.json": {
        videos_v2: [
          {
            uri: "media/matched-video.mp4",
            creation_timestamp: 500,
            description: "Video metadata caption",
            media_metadata: { video_metadata: { exif_data: [] } },
          },
          {
            uri: "media/unmatched-video.mp4",
            creation_timestamp: 501,
            description: "Unmatched metadata",
            media_metadata: { video_metadata: { exif_data: [] } },
          },
        ],
      },
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      videoMetadataFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      recordsSkipped: 1,
      errorCount: 0,
    });
    expect(first.postTypeCounts.video).toBe(1);
    expect(first.postTypeCounts.reel).toBeUndefined();
    expect(first.matchRuleCounts.M09_UNMATCHED_ENRICHMENT).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM media WHERE metadata_json IS NOT NULL",
      ),
    ).toBe(1);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(2);
    expect(second.recordsSkipped).toBe(1);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);
  });

  it("enriches matched photo media and skips unmatched metadata", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        {
          timestamp: 600,
          data: [{ post: "Timeline photo caption" }],
          attachments: [
            { data: [{ media: { uri: "media/matched-photo.jpg" } }] },
          ],
        },
      ],
      "your_uncategorized_photos.json": {
        other_photos_v2: [
          {
            uri: "media/matched-photo.jpg",
            creation_timestamp: 600,
            description: "Photo metadata caption",
            media_metadata: { photo_metadata: { exif_data: [] } },
          },
          {
            uri: "media/unmatched-photo.jpg",
            creation_timestamp: 601,
            media_metadata: { photo_metadata: { exif_data: [] } },
          },
        ],
      },
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      photoMetadataFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      recordsSkipped: 1,
      errorCount: 0,
    });
    expect(first.postTypeCounts.photo).toBe(1);
    expect(first.matchRuleCounts.M09_UNMATCHED_ENRICHMENT).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM media WHERE metadata_json IS NOT NULL",
      ),
    ).toBe(1);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(2);
    expect(second.recordsSkipped).toBe(1);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);
  });

  it("enriches matched album photos and skips unmatched entries", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        {
          timestamp: 700,
          data: [{ post: "Timeline album photo" }],
          attachments: [
            { data: [{ media: { uri: "media/matched-album-photo.jpg" } }] },
          ],
        },
      ],
      "album/0.json": {
        name: "Sanitized album",
        description: "Sanitized album description",
        last_modified_timestamp: 702,
        cover_photo: {
          uri: "media/matched-album-photo.jpg",
          creation_timestamp: 700,
        },
        photos: [
          {
            uri: "media/matched-album-photo.jpg",
            creation_timestamp: 700,
            media_metadata: { photo_metadata: { exif_data: [] } },
          },
          {
            uri: "media/unmatched-album-photo.jpg",
            creation_timestamp: 701,
            media_metadata: { photo_metadata: { exif_data: [] } },
          },
        ],
      },
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      albumMetadataFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      recordsSkipped: 1,
      errorCount: 0,
    });
    expect(first.matchRuleCounts.M09_UNMATCHED_ENRICHMENT).toBe(1);
    const terminalSummary = formatImportTerminalSummary(first);
    expect(terminalSummary).toContain(
      "Album metadata records: 2 across 1 files, 0 errors",
    );
    expect(terminalSummary).not.toContain("album/0.json");
    expect(
      queryValue(
        databasePath,
        `SELECT COUNT(*) AS value FROM media
         WHERE json_extract(metadata_json, '$.facebook_cleaner_album.name') = 'Sanitized album'
           AND json_extract(metadata_json, '$.facebook_cleaner_album.is_cover') = 1`,
      ),
    ).toBe(1);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second.postsAdded).toBe(0);
    expect(second.recordsMatched).toBe(2);
    expect(second.recordsSkipped).toBe(1);
    expect(second.postsUpdated).toBe(0);
    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(1);
  });

  it("enriches matched check-ins and skips unmatched entries", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        {
          timestamp: 800,
          data: [{ post: "Sanitized check-in message" }],
          attachments: [{ data: [{ place: { name: "Sanitized place" } }] }],
        },
      ],
      "check-ins.json": [
        {
          timestamp: 800,
          fbid: "800800",
          label_values: [
            { label: "Message", value: "Sanitized check-in message" },
            { label: "Location", value: "Sanitized place" },
            { label: "Place tags", dict: [{ name: "Sanitized place" }] },
            { label: "URL", href: "https://www.facebook.com/800800" },
          ],
        },
        {
          timestamp: 801,
          fbid: "801801",
          label_values: [
            { label: "Message", value: "Unmatched sanitized check-in" },
            { label: "Location", value: "Different sanitized place" },
            { label: "URL", href: "https://www.facebook.com/801801" },
          ],
        },
      ],
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      checkinMetadataFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      recordsSkipped: 1,
      errorCount: 0,
      canonicalPosts: 1,
      placeRecords: 1,
      postPlaceRelationships: 1,
    });
    expect(first.matchRuleCounts.M09_UNMATCHED_ENRICHMENT).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM posts WHERE facebook_post_id = '800800' AND direct_post_url = 'https://www.facebook.com/800800'",
      ),
    ).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM places WHERE place_name = 'Sanitized place'",
      ),
    ).toBe(1);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second).toMatchObject({
      postsAdded: 0,
      postsUpdated: 0,
      recordsMatched: 2,
      recordsSkipped: 1,
      placeRecords: 1,
      postPlaceRelationships: 1,
    });
  });

  it("enriches matched content-sharing links and skips unmatched entries", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": [
        {
          timestamp: 900,
          attachments: [
            {
              data: [
                {
                  external_context: {
                    url: "https://example.test/sanitized-shared-content",
                  },
                },
              ],
            },
          ],
        },
      ],
      "content_sharing_links_you_have_created.json": [
        {
          timestamp: 900,
          fbid: "900900",
          media: [],
          label_values: [
            {
              label: "URL",
              href: "https://example.test/sanitized-shared-content",
              value: "https://example.test/sanitized-shared-content",
            },
          ],
        },
        {
          timestamp: 901,
          fbid: "901901",
          media: [],
          label_values: [
            {
              label: "URL",
              href: "https://example.test/unmatched-shared-content",
              value: "https://example.test/unmatched-shared-content",
            },
          ],
        },
      ],
    });
    const databasePath = join(createTemporaryDirectory(), "inventory.db");

    const first = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(first).toMatchObject({
      timelineFiles: 1,
      sharingLinkMetadataFiles: 1,
      recordsExamined: 3,
      recordsMatched: 1,
      postsAdded: 1,
      postsUpdated: 1,
      recordsSkipped: 1,
      errorCount: 0,
      canonicalPosts: 1,
      linkRecords: 1,
    });
    expect(first.matchRuleCounts.M09_UNMATCHED_ENRICHMENT).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM posts WHERE facebook_post_id = '900900' AND direct_post_url IS NULL",
      ),
    ).toBe(1);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM post_links WHERE normalized_url = 'https://example.test/sanitized-shared-content'",
      ),
    ).toBe(1);

    const second = await importTimelineCollection({
      exportPaths: [root],
      databasePath,
      migrationsDirectory,
    });
    expect(second).toMatchObject({
      postsAdded: 0,
      postsUpdated: 0,
      recordsMatched: 2,
      recordsSkipped: 1,
      linkRecords: 1,
    });
  });

  it("rolls back an entire canonical batch after a database failure", async () => {
    const databasePath = join(createTemporaryDirectory(), "inventory.db");
    const inventory = InventoryDatabase.open({ databasePath, migrationsDirectory });
    inventory.database.exec(`
      CREATE TRIGGER reject_third_fixture_post
      BEFORE INSERT ON posts
      WHEN NEW.created_timestamp = 1704240000
      BEGIN
        SELECT RAISE(ABORT, 'controlled test failure');
      END;
    `);
    inventory.close();

    const report = await importTimelineCollection({
      exportPaths: [sanitizedFixture],
      databasePath,
      migrationsDirectory,
    });

    expect(report).toMatchObject({
      reportSchemaVersion: 2,
      status: "failed",
      postsAdded: 0,
      recordsMatched: 0,
      errorCount: 1,
      errorCodeCounts: { DATABASE_WRITE_FAILED: 1 },
      issues: [
        {
          errorCode: "DATABASE_WRITE_FAILED",
          exportRootNumber: null,
          relativePath: null,
          recordIndex: null,
        },
      ],
      issuesTruncated: false,
    });

    expect(queryValue(databasePath, "SELECT COUNT(*) AS value FROM posts")).toBe(0);
    expect(
      queryValue(databasePath, "SELECT COUNT(*) AS value FROM post_observations"),
    ).toBe(0);
    expect(
      queryValue(
        databasePath,
        "SELECT COUNT(*) AS value FROM import_runs WHERE status = 'failed'",
      ),
    ).toBe(1);
  });

  it("imports through PowerShell and writes a sanitized report", () => {
    const outputDirectory = createTemporaryDirectory();
    const databasePath = join(outputDirectory, "inventory.db");
    const reportPath = join(outputDirectory, "import-report.json");
    const scriptPath = resolve("scripts/Invoke-FacebookInventoryImport.ps1");

    const output = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        scriptPath,
        "-ExportPath",
        sanitizedFixture,
        "-DatabasePath",
        databasePath,
        "-ReportPath",
        reportPath,
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );

    expect(output).toContain("Posts added: 3");
    expect(output).not.toContain("Sanitized text post");
    expect(existsSync(databasePath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);
    const reportText = readFileSync(reportPath, "utf8");
    expect(JSON.parse(reportText)).toMatchObject({
      reportSchemaVersion: 2,
      status: "completed",
      canonicalPosts: 3,
    });
    expect(reportText).not.toContain(sanitizedFixture);
    expect(reportText).not.toContain("Sanitized text post");
  });
});
