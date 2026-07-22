// Harness-neutral projection types: a materialized runtime tree plus the launch plan for one run.
import type { Harness } from '../settings/Settings.js';

export interface AgentLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentProjectionPlan {
  /** Absolute path to the materialized runtime configuration root for this run. */
  readonly rootDirectory: string;
  readonly launch: AgentLaunchPlan;
  /** Harness-owned paths that may be written during a run without being treated as undeclared state. */
  readonly statePaths: readonly ProjectedStatePath[];
  /** Composition elements the selected harness cannot project. */
  readonly unsupported: readonly string[];
}

export interface ProjectedStatePath {
  /** POSIX-style path relative to the materialized runtime root. */
  readonly relativePath: string;
  readonly kind: 'file' | 'directory';
}

export interface ProjectionInput {
  readonly harness: Harness;
  readonly rootDirectory: string;
  readonly homeDirectory: string;
  readonly passThroughArgs?: readonly string[];
  /** Local pi extension install directories to load with `--extension` (pi only). */
  readonly extensionLoadDirs?: readonly string[];
}
