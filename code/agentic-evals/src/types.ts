export type AdapterId = 'pi' | 'claude' | 'mock';

export type LauncherId = 'outfitter' | 'direct';

export type Assertion =
  | { readonly kind: 'exists' }
  | { readonly kind: 'contains'; readonly value: string }
  | { readonly kind: 'matches'; readonly pattern: string };

export interface OutputSpec {
  readonly path: string;
  readonly assertions: readonly Assertion[];
}

export interface FileCopySpec {
  /** Path relative to the eval directory. */
  readonly from: string;
  /** Path relative to the run workspace. */
  readonly to: string;
}

export interface CheckSpec {
  readonly name: string;
  /** Files copied from the eval directory into the workspace before the command runs (e.g. hidden tests). */
  readonly inject?: readonly FileCopySpec[];
  /** Shell command run in the workspace; exit 0 passes. */
  readonly command: string;
}

export interface QuestionSpec {
  readonly ask: string;
  /** Substring expected (case-insensitive) in the answers file. */
  readonly expect: string;
}

export interface QuestionsSpec {
  /** Workspace-relative file the workflow prompt instructs the agent to write answers into. */
  readonly answers_file: string;
  readonly items: readonly QuestionSpec[];
}

export interface MatrixVariant {
  readonly id: string;
  /** Declarative profile overrides merged into a generated profile extending the base profile. */
  readonly overrides?: Readonly<Record<string, unknown>>;
}

export interface MatrixSpec {
  readonly base_profile?: string;
  readonly repeat?: number;
  readonly variants: readonly MatrixVariant[];
}

export interface CoverageMetricSpec {
  /** Shell command run in the workspace after the agent finishes. */
  readonly command: string;
  /** Regex with one capture group extracting the coverage percentage from stdout+stderr. */
  readonly pattern?: string;
  /** Optional gate: coverage below this fails the run. */
  readonly minimum?: number;
}

export interface EvalDefinition {
  readonly id: string;
  readonly profile: string;
  readonly agent: AdapterId;
  readonly launcher: LauncherId;
  readonly mock?: { readonly command: string };
  readonly workflow: {
    readonly prompt: string;
    readonly timeout_seconds: number;
  };
  readonly inputs: readonly FileCopySpec[];
  readonly outputs: readonly OutputSpec[];
  readonly checks: readonly CheckSpec[];
  readonly questions?: QuestionsSpec;
  readonly matrix?: MatrixSpec;
  readonly metrics?: { readonly coverage?: CoverageMetricSpec };
  /** Absolute path of the directory containing eval.yml. */
  readonly directory: string;
}

export interface AssertionResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface RunMetrics {
  wall_time_seconds: number;
  tokens_in: number | null;
  tokens_out: number | null;
  tool_calls: number | null;
  turns: number | null;
  cost_usd: number | null;
  coverage_percent: number | null;
}

export interface RunResult {
  readonly eval: string;
  readonly variant: string;
  readonly run: number;
  readonly agent: AdapterId;
  readonly profile: string;
  readonly passed: boolean;
  readonly timed_out: boolean;
  readonly exit_code: number | null;
  readonly assertions: {
    readonly passed: number;
    readonly total: number;
    readonly results: readonly AssertionResult[];
  };
  readonly metrics: RunMetrics;
  readonly workspace?: string;
}

export interface VariantSummary {
  readonly variant: string;
  readonly runs: number;
  readonly passed: number;
  readonly pass_rate: number;
  readonly mean_wall_time_seconds: number;
}

export interface EvalSummary {
  readonly eval: string;
  readonly started_at: string;
  readonly agent: AdapterId;
  readonly variants: readonly VariantSummary[];
  readonly passed: boolean;
}
