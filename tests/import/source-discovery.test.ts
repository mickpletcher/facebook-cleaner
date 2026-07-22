import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverTimelineSources,
  SourceDiscoveryError,
} from "../../src/import/source-discovery.js";

const temporaryDirectories: string[] = [];
const sanitizedFixture = resolve("tests/fixtures/sanitized-facebook-export");

function createExportRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "facebook-cleaner-discovery-test-"));
  temporaryDirectories.push(root);
  const postsDirectory = join(root, "your_facebook_activity", "posts");
  mkdirSync(postsDirectory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(postsDirectory, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("discoverTimelineSources", () => {
  it("discovers and hashes a supported timeline file", async () => {
    const collection = await discoverTimelineSources([sanitizedFixture]);

    expect(collection.rootCount).toBe(1);
    expect(collection.collectionFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(collection.sourceFiles).toHaveLength(1);
    expect(collection.sourceFiles[0]).toMatchObject({
      exportRootNumber: 1,
      relativePath:
        "your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json",
      sequence: 1,
    });
    expect(collection.sourceFiles[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("sorts numbered files numerically", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_10.json": "[]",
      "your_posts__check_ins__photos_and_videos_2.json": "[]",
      "your_posts__check_ins__photos_and_videos_1.json": "[]",
    });

    const collection = await discoverTimelineSources([root]);
    expect(collection.sourceFiles.map((file) => file.sequence)).toEqual([1, 2, 10]);
  });

  it("discovers and sorts numbered album metadata files", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": "[]",
      "album/10.json": JSON.stringify({ photos: [] }),
      "album/2.json": JSON.stringify({ photos: [] }),
    });

    const collection = await discoverTimelineSources([root], true);
    expect(
      collection.sourceFiles
        .filter((file) => file.sourceKind === "album_metadata")
        .map((file) => file.sequence),
    ).toEqual([2, 10]);
  });

  it("discovers content-sharing-link metadata", async () => {
    const root = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": "[]",
      "content_sharing_links_you_have_created.json": "[]",
    });

    const collection = await discoverTimelineSources([root], true);
    expect(collection.sourceFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath:
            "your_facebook_activity/posts/content_sharing_links_you_have_created.json",
          sourceKind: "sharing_link_metadata",
        }),
      ]),
    );
  });

  it("produces the same fingerprint when export-root order changes", async () => {
    const firstRoot = createExportRoot({
      "your_posts__check_ins__photos_and_videos_1.json": "[]",
    });
    const secondRoot = createExportRoot({});

    const firstOrder = await discoverTimelineSources([firstRoot, secondRoot]);
    const secondOrder = await discoverTimelineSources([secondRoot, firstRoot]);

    expect(firstOrder.collectionFingerprint).toBe(
      secondOrder.collectionFingerprint,
    );
  });

  it("rejects a missing export root without including its path", async () => {
    const missingPath = join(tmpdir(), "private-missing-export-name");

    await expect(discoverTimelineSources([missingPath])).rejects.toMatchObject({
      code: "EXPORT_ROOT_NOT_FOUND",
      exportRootNumber: 1,
    });
    await expect(discoverTimelineSources([missingPath])).rejects.not.toThrow(
      missingPath,
    );
  });

  it("reports when no primary timeline files exist", async () => {
    const root = createExportRoot({ "archive.json": "[]" });

    await expect(discoverTimelineSources([root])).rejects.toBeInstanceOf(
      SourceDiscoveryError,
    );
    await expect(discoverTimelineSources([root])).rejects.toMatchObject({
      code: "SOURCE_FILE_MISSING",
    });
  });
});
