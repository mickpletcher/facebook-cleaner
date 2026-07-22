import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalization.js";

export const identityVersion = 1;

export interface SemanticFingerprintInput {
  createdTimestamp: number;
  normalizedPostText: string | null;
  normalizedMediaReferences: string[];
  normalizedExternalUrls: string[];
  normalizedPlaceReference: string | null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalRawRecordHash(record: unknown): string {
  return sha256(canonicalJson(record));
}

export function semanticFingerprint(
  input: SemanticFingerprintInput,
): string {
  return sha256(
    canonicalJson({
      identity_version: identityVersion,
      created_timestamp: input.createdTimestamp,
      normalized_post_text: input.normalizedPostText,
      sorted_normalized_media_references: input.normalizedMediaReferences,
      sorted_normalized_external_urls: input.normalizedExternalUrls,
      normalized_place_reference_when_available:
        input.normalizedPlaceReference,
    }),
  );
}
