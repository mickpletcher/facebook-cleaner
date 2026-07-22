import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  DiscoveredCollection,
  DiscoveredSourceFile,
  ValidationErrorCode,
} from "./types.js";

const timelineFilenamePattern =
  /^your_posts__check_ins__photos_and_videos_(\d+)\.json$/;
const timelineRelativeDirectory = "your_facebook_activity/posts";
const archiveFilename = "archive.json";
const trashFilename = "trash.json";
const videosFilename = "your_videos.json";
const photosFilename = "your_uncategorized_photos.json";
const reelsRelativePath = "your_facebook_activity/reels/your_reels.json";

export class SourceDiscoveryError extends Error {
  readonly code: ValidationErrorCode;
  readonly exportRootNumber: number | undefined;

  constructor(
    code: ValidationErrorCode,
    message: string,
    exportRootNumber?: number,
  ) {
    super(message);
    this.name = "SourceDiscoveryError";
    this.code = code;
    this.exportRootNumber = exportRootNumber;
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function buildCollectionFingerprint(
  rootCount: number,
  sourceFiles: DiscoveredSourceFile[],
): string {
  const roots = Array.from({ length: rootCount }, (_, index) => {
    const files = sourceFiles
      .filter((file) => file.exportRootNumber === index + 1)
      .map((file) => ({
        relativePath: file.relativePath,
        sourceKind: file.sourceKind,
        sequence: file.sequence,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return {
      rootFingerprint: createHash("sha256")
        .update(JSON.stringify(files), "utf8")
        .digest("hex"),
      files,
    };
  }).sort((left, right) =>
    left.rootFingerprint.localeCompare(right.rootFingerprint),
  );

  return createHash("sha256")
    .update(
      JSON.stringify({ fingerprintVersion: 1, rootCount, roots }),
      "utf8",
    )
    .digest("hex");
}

export async function discoverTimelineSources(
  exportPaths: string[],
  includeStateSources = false,
): Promise<DiscoveredCollection> {
  if (exportPaths.length === 0) {
    throw new SourceDiscoveryError(
      "EXPORT_ROOT_NOT_FOUND",
      "At least one export root is required.",
    );
  }

  const sourceFiles: DiscoveredSourceFile[] = [];
  for (const [rootIndex, suppliedPath] of exportPaths.entries()) {
    const exportRootNumber = rootIndex + 1;
    let root: string;
    try {
      root = await realpath(resolve(suppliedPath));
      if (!(await stat(root)).isDirectory()) {
        throw new Error("not a directory");
      }
    } catch {
      throw new SourceDiscoveryError(
        "EXPORT_ROOT_NOT_FOUND",
        `Export root ${exportRootNumber} does not exist or is not a directory.`,
        exportRootNumber,
      );
    }

    const timelineDirectory = join(
      root,
      "your_facebook_activity",
      "posts",
    );
    let entries;
    try {
      entries = await readdir(timelineDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw new SourceDiscoveryError(
        "SOURCE_FILE_READ_FAILED",
        `Timeline directory in export root ${exportRootNumber} could not be read.`,
        exportRootNumber,
      );
    }

    for (const entry of entries) {
      const match = timelineFilenamePattern.exec(entry.name);
      const isArchive = includeStateSources && entry.name === archiveFilename;
      const isTrash = includeStateSources && entry.name === trashFilename;
      const isVideoMetadata =
        includeStateSources && entry.name === videosFilename;
      const isPhotoMetadata =
        includeStateSources && entry.name === photosFilename;
      if (
        !entry.isFile() ||
        (!match?.[1] &&
          !isArchive &&
          !isTrash &&
          !isVideoMetadata &&
          !isPhotoMetadata)
      ) {
        continue;
      }

      const candidate = await realpath(join(timelineDirectory, entry.name));
      if (!isInsideRoot(root, candidate)) {
        throw new SourceDiscoveryError(
          "SOURCE_FILE_READ_FAILED",
          `A timeline file in export root ${exportRootNumber} resolves outside the export root.`,
          exportRootNumber,
        );
      }

      const fileStats = await stat(candidate);
      sourceFiles.push({
        absolutePath: candidate,
        exportRootNumber,
        relativePath: `${timelineRelativeDirectory}/${basename(candidate)}`,
        sequence:
          isArchive || isTrash || isVideoMetadata || isPhotoMetadata
            ? Number.MAX_SAFE_INTEGER
            : Number.parseInt(match?.[1] ?? "0", 10),
        sizeBytes: fileStats.size,
        sha256: await hashFile(candidate),
        sourceKind: isPhotoMetadata
          ? "photo_metadata"
          : isVideoMetadata
            ? "video_metadata"
          : isTrash
            ? "trash"
            : isArchive
              ? "archive"
              : "timeline",
      });
    }

    if (includeStateSources) {
      try {
        const candidate = await realpath(join(root, ...reelsRelativePath.split("/")));
        if (!isInsideRoot(root, candidate)) {
          throw new SourceDiscoveryError(
            "SOURCE_FILE_READ_FAILED",
            `A reels file in export root ${exportRootNumber} resolves outside the export root.`,
            exportRootNumber,
          );
        }
        const fileStats = await stat(candidate);
        if (fileStats.isFile()) {
          sourceFiles.push({
            absolutePath: candidate,
            exportRootNumber,
            relativePath: reelsRelativePath,
            sequence: Number.MAX_SAFE_INTEGER,
            sizeBytes: fileStats.size,
            sha256: await hashFile(candidate),
            sourceKind: "reel",
          });
        }
      } catch (error) {
        if (error instanceof SourceDiscoveryError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new SourceDiscoveryError(
            "SOURCE_FILE_READ_FAILED",
            `The reels file in export root ${exportRootNumber} could not be read.`,
            exportRootNumber,
          );
        }
      }
    }
  }

  sourceFiles.sort(
    (left, right) =>
      ({
        timeline: 0,
        archive: 1,
        trash: 2,
        reel: 3,
        video_metadata: 4,
        photo_metadata: 5,
      }[left.sourceKind] -
        {
          timeline: 0,
          archive: 1,
          trash: 2,
          reel: 3,
          video_metadata: 4,
          photo_metadata: 5,
        }[right.sourceKind]) ||
      left.sequence - right.sequence ||
      left.exportRootNumber - right.exportRootNumber ||
      left.relativePath.localeCompare(right.relativePath),
  );

  if (sourceFiles.length === 0) {
    throw new SourceDiscoveryError(
      "SOURCE_FILE_MISSING",
      "No supported primary timeline files were found in the supplied export roots.",
    );
  }

  return {
    rootCount: exportPaths.length,
    collectionFingerprint: buildCollectionFingerprint(
      exportPaths.length,
      sourceFiles,
    ),
    sourceFiles,
  };
}
