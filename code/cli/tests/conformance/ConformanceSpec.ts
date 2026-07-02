// Defines the cross-adapter conformance vocabulary: row/expectation types, shared
// assertion helpers, and the mapping from conformance rows onto the published
// support-matrix tables so the docs cannot drift from adapter behavior.
import type {
  AgentAdapter,
  AgentCompositeProfilePlan,
  AgentLaunchPlan,
  AgentLaunchProfileLayer,
} from '../../src/agents/AgentAdapter.js';
import type { Profile, ProfileControls } from '../../src/profiles/Profile.js';

/** Temporary directories a fixture may populate before the adapter runs. */
export interface ConformanceFixturePaths {
  /** Root of the per-expectation temporary directory tree. */
  readonly rootDirectory: string;
  /** Stand-in home directory passed to the adapter. */
  readonly homeDirectory: string;
  /** Stand-in project directory passed to the adapter. */
  readonly projectDirectory: string;
  /** A profile folder registered in `profileFolders` for the adapter run. */
  readonly profileFolder: string;
  /** Composite profile root directory passed to `createCompositeProfile`. */
  readonly compositeRootDirectory: string;
}

/** Everything a supported-row assertion may inspect. */
export interface ConformanceSupportedOutcome {
  readonly adapter: AgentAdapter;
  readonly profile: Profile;
  readonly plan: AgentCompositeProfilePlan;
  readonly launchPlan: AgentLaunchPlan;
  readonly paths: ConformanceFixturePaths;
}

/** The adapter translates the control: the composite output/launch flags are asserted. */
export interface SupportedExpectation {
  readonly status: 'supported';
  readonly controls?: (paths: ConformanceFixturePaths) => ProfileControls;
  readonly setup?: (paths: ConformanceFixturePaths) => void;
  readonly passThroughArgs?: readonly string[];
  readonly profileLayers?: (paths: ConformanceFixturePaths, profile: Profile) => readonly AgentLaunchProfileLayer[];
  readonly assert: (outcome: ConformanceSupportedOutcome) => void;
}

/**
 * The adapter cannot translate the control yet: requesting it must produce the
 * exact untranslatable-control warning, and `--strict` must escalate to failure.
 * `controls` must be JSON-serializable (it is embedded into a profile.yml) and
 * use the snake_case spelling users write in profiles.
 */
export interface RoadmapExpectation {
  readonly status: 'roadmap';
  readonly controls: ProfileControls;
  /** The control name the warning must reference. */
  readonly warnsAbout: string;
}

/** The concept has no meaningful translation for this adapter; a justification is required. */
export interface NotApplicableExpectation {
  readonly status: 'not-applicable';
  readonly justification: string;
}

export type ConformanceExpectation = SupportedExpectation | RoadmapExpectation | NotApplicableExpectation;

export interface ConformanceRow {
  readonly id: string;
  readonly description: string;
  /** Keyed by adapter id; every registered adapter must declare every row. */
  readonly expectations: Readonly<Record<string, ConformanceExpectation>>;
}

export const untranslatableControlWarning = (adapterId: string, controlName: string): string =>
  `${adapterId} adapter cannot translate requested control '${controlName}'.`;

/** Returns the values following each occurrence of a repeatable `--flag value` pair. */
export const flagValuesOf = (args: readonly string[], flag: string): readonly string[] =>
  args.flatMap((arg, index) => {
    const value = args[index + 1];
    return arg === flag && value !== undefined ? [value] : [];
  });

// --- Documentation matrix mapping -------------------------------------------

export type DocSupportStatus = 'Supported' | 'Partial' | 'Roadmap';

export interface DocMatrixFileSpec {
  readonly key: string;
  readonly repoRelativePath: string;
  /** Table column header used for each adapter id; a new adapter must add its column. */
  readonly adapterColumns: Readonly<Record<string, string>>;
  /**
   * `fine` renders Partial as-is; `coarse` renders Partial as Supported. The
   * architecture matrix is restricted to Supported/Roadmap/Unsupported by
   * OFTR-007.2 and defines Supported as "at least one native mechanism", so a
   * partially-translated concept reads as Supported there.
   */
  readonly statusVocabulary: 'fine' | 'coarse';
}

export const docMatrixFiles: readonly DocMatrixFileSpec[] = [
  {
    key: 'support-matrix',
    repoRelativePath: 'docs/documentation/support-matrix.md',
    adapterColumns: { pi: 'Pi', claude: 'Claude Code' },
    statusVocabulary: 'fine',
  },
  {
    key: 'controllable-elements',
    repoRelativePath: 'docs/architecture/controllable-elements.md',
    adapterColumns: { pi: 'Pi', claude: 'Claude' },
    statusVocabulary: 'coarse',
  },
];

export interface DocMatrixRow {
  /** Conformance row ids aggregated into this documentation table row. */
  readonly rowIds: readonly string[];
  /** Exact table-cell label per doc file key; omit when the file's table has no such row. */
  readonly labels: Readonly<Record<string, string | undefined>>;
}

export const docMatrixRows: readonly DocMatrixRow[] = [
  {
    rowIds: ['agent_config_directory'],
    labels: { 'support-matrix': 'Agent config directory', 'controllable-elements': 'Agent Config Directory' },
  },
  {
    rowIds: ['session_directory'],
    labels: {
      'support-matrix': 'Session directory (`session_directory`)',
      'controllable-elements': 'Session Directory',
    },
  },
  {
    rowIds: ['extensions'],
    labels: { 'support-matrix': 'Extensions / plugins (`extensions`)', 'controllable-elements': 'Extensions' },
  },
  {
    rowIds: ['skills'],
    labels: { 'support-matrix': 'Skills (`skills`)', 'controllable-elements': 'Skills' },
  },
  {
    rowIds: ['prompt_template', 'native_commands'],
    labels: {
      'support-matrix': 'Prompt templates / commands (`prompt_template`)',
      'controllable-elements': 'Prompt Templates',
    },
  },
  {
    rowIds: ['system_prompt'],
    labels: { 'support-matrix': 'System prompt (`system_prompt`)', 'controllable-elements': 'System Prompt' },
  },
  {
    rowIds: ['append_system_prompt'],
    labels: {
      'support-matrix': 'Appended system prompt (`append_system_prompt`)',
      'controllable-elements': 'Appended System Prompt',
    },
  },
  {
    rowIds: ['model', 'provider', 'thinking'],
    labels: {
      'support-matrix': 'Model selection (`model`, `provider`, `thinking`)',
      'controllable-elements': 'Model Selection',
    },
  },
  {
    rowIds: ['environment'],
    labels: {
      'support-matrix': 'Credentials and environment (`environment`)',
      'controllable-elements': 'Credentials and Environment',
    },
  },
  {
    rowIds: ['mcp'],
    labels: { 'support-matrix': 'MCP servers (`cli_specific/<agent>/.mcp.json`)' },
  },
  {
    rowIds: ['deepwork'],
    labels: { 'support-matrix': 'DeepWork job selection (`deepwork`)' },
  },
  {
    rowIds: ['tool_availability'],
    labels: { 'support-matrix': 'Tool availability', 'controllable-elements': 'Tool Availability' },
  },
  {
    rowIds: ['context_files'],
    labels: { 'support-matrix': 'Context files', 'controllable-elements': 'Context Files' },
  },
  {
    rowIds: ['theme'],
    labels: { 'support-matrix': 'Theme / UI presentation', 'controllable-elements': 'Theme / UI Presentation' },
  },
  {
    rowIds: ['project_override_policy'],
    labels: { 'support-matrix': 'Project override policy', 'controllable-elements': 'Project Override Policy' },
  },
  {
    rowIds: ['working_directory'],
    labels: { 'support-matrix': 'Working directory', 'controllable-elements': 'Working Directory' },
  },
  {
    rowIds: ['pass_through_args', 'args'],
    labels: { 'support-matrix': 'Pass-through arguments', 'controllable-elements': 'Pass-through Arguments' },
  },
  {
    rowIds: ['bootstrap_hook'],
    labels: { 'support-matrix': 'Bootstrap hook', 'controllable-elements': 'Bootstrap Hook' },
  },
];

/** Conformance rows intentionally absent from the documentation tables. */
export const undocumentedRowIds: readonly { readonly id: string; readonly reason: string }[] = [
  {
    id: 'state_paths',
    reason:
      'State persistence is an adapter-internal mechanism documented in docs/documentation/state.md; the matrix covers it through the config/session directory rows.',
  },
];

/**
 * Computes the documentation status for a table row from the declared per-control
 * statuses: everything supported → Supported, everything roadmap → Roadmap, a mix
 * → Partial. Not-applicable declarations are excluded from the aggregate.
 */
export const expectedDocStatus = (
  docRow: DocMatrixRow,
  conformanceRows: readonly ConformanceRow[],
  adapterId: string,
  statusVocabulary: DocMatrixFileSpec['statusVocabulary'],
): DocSupportStatus => {
  const statuses = docRow.rowIds
    .map((rowId) => statusOfRow(rowId, conformanceRows, adapterId))
    .filter((status) => status !== 'not-applicable');

  if (statuses.length === 0) {
    throw new Error(`doc matrix row [${docRow.rowIds.join(', ')}] has no applicable status for '${adapterId}'`);
  }

  if (statuses.every((status) => status === 'supported')) {
    return 'Supported';
  }

  if (statuses.every((status) => status === 'roadmap')) {
    return 'Roadmap';
  }

  return statusVocabulary === 'coarse' ? 'Supported' : 'Partial';
};

const statusOfRow = (
  rowId: string,
  conformanceRows: readonly ConformanceRow[],
  adapterId: string,
): ConformanceExpectation['status'] => {
  const row = conformanceRows.find((candidate) => candidate.id === rowId);

  if (row === undefined) {
    throw new Error(`doc matrix references unknown conformance row '${rowId}'`);
  }

  const expectation = row.expectations[adapterId];

  if (expectation === undefined) {
    throw new Error(`conformance row '${rowId}' declares no expectation for adapter '${adapterId}'`);
  }

  return expectation.status;
};
