// Applies the per-file write policy for pi/ overlay materialization: JSON object documents written
// by a lower tier of the same materialization call deep-merge, unparseable higher-precedence JSON
// warns and replaces, and everything else — including pre-existing root content such as generated
// files — copies over whole-file.
import { copyFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';

import { removeTargetTypeConflict } from '../fs/TypeConflict.js';
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';

export interface OverlayCopyOptions {
  /**
   * Diagnostics sink for overlay files that could not be merged. Its presence enables JSON
   * deep-merge for colliding overlay files; without a sink every file copies whole-file.
   */
  readonly warnings?: string[];
  /**
   * Root-relative POSIX paths already written by lower tiers of the same materialization call —
   * the only files a higher tier's JSON may merge with. Absent paths (pre-existing root content
   * such as generated defaults or retained-root files) always replace whole-file.
   */
  readonly mergeablePaths?: ReadonlySet<string>;
}

interface ParsedDocument {
  /** True when the content cannot be parsed as JSON at all. */
  readonly malformed: boolean;
  /** The parsed document, or undefined for malformed or non-object content. */
  readonly document?: Record<string, unknown>;
}

const isPlainJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a file and parses it as JSON, separating unparseable content from valid non-object documents. */
const readJsonDocument = (path: string): ParsedDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { malformed: true };
  }
  return isPlainJsonObject(parsed) ? { malformed: false, document: parsed } : { malformed: false };
};

/** Copies the source file over the target after removing any conflicting target type. */
const replaceFile = (sourcePath: string, targetPath: string): void => {
  removeTargetTypeConflict(targetPath, 'file');
  copyFileSync(sourcePath, targetPath);
};

/**
 * Merges one colliding `.json` pair: lower-precedence target document first, the higher layer's
 * values winning, written in canonical 2-space JSON. A higher-precedence file that cannot be read
 * and parsed as JSON warns (strict-fatal) and replaces whole-file, preserving the layer author's
 * content; a valid non-object document replaces silently because it is intentional content, and so
 * does an unmergeable lower-precedence counterpart — a valid higher document is strictly better
 * than JSON the harness would reject anyway.
 */
const mergeCollidingJsonPair = (sourcePath: string, targetPath: string, warnings: string[]): void => {
  const source = readJsonDocument(sourcePath);
  if (source.document === undefined) {
    if (source.malformed) {
      warnings.push(
        `overlay JSON file '${sourcePath}' is not valid JSON; it replaces the lower-precedence file instead of merging.`,
      );
    }
    replaceFile(sourcePath, targetPath);
    return;
  }

  const lower = readJsonDocument(targetPath);
  if (lower.document === undefined) {
    replaceFile(sourcePath, targetPath);
    return;
  }

  removeTargetTypeConflict(targetPath, 'file');
  writeFileSync(targetPath, `${JSON.stringify(mergeObjectsWithPolicy(lower.document, source.document), null, 2)}\n`);
};

/**
 * Writes one overlay file into the runtime root. Outside a colliding `.json` pair — no warnings
 * sink, non-JSON path, or a target no lower tier of this call wrote — the source replaces the
 * target whole-file, the copy semantics skill materialization, generated defaults, and
 * retained-root files rely on. Only a genuine lower-tier collision reaches the merge policy.
 */
export const copyOverlayFile = (
  sourcePath: string,
  targetPath: string,
  relativePath: string,
  options: OverlayCopyOptions = {},
): void => {
  if (options.warnings === undefined || !sourcePath.endsWith('.json')) {
    replaceFile(sourcePath, targetPath);
    return;
  }
  if (
    options.mergeablePaths?.has(relativePath) !== true ||
    lstatSync(targetPath, { throwIfNoEntry: false })?.isFile() !== true
  ) {
    replaceFile(sourcePath, targetPath);
    return;
  }
  mergeCollidingJsonPair(sourcePath, targetPath, options.warnings);
};
