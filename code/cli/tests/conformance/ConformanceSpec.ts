// Defines the CompositionPlan projection conformance vocabulary and documentation-table mapping.
import type { CompositionPlan } from '../../src/composer/Composition.js';
import type { AgentProjectionPlan } from '../../src/projection/Projection.js';
import type { Harness } from '../../src/settings/Settings.js';

export interface ConformanceFixturePaths {
  readonly rootDirectory: string;
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly projectionDirectory: string;
}

export interface ConformanceOutcome {
  readonly composition: CompositionPlan;
  readonly projection: AgentProjectionPlan;
  readonly paths: ConformanceFixturePaths;
}

export type DocumentedSupportStatus = 'Supported' | 'Partial' | 'Roadmap' | 'Future';

export interface SupportedExpectation {
  readonly status: 'supported';
  readonly documentedStatus: DocumentedSupportStatus;
  readonly composition?: (paths: ConformanceFixturePaths) => CompositionPlan;
  readonly extensionLoadDirs?: (paths: ConformanceFixturePaths) => readonly string[];
  readonly passThroughArgs?: readonly string[];
  readonly assert: (outcome: ConformanceOutcome) => void;
}

export interface UnsupportedExpectation {
  readonly status: 'unsupported';
  readonly documentedStatus: DocumentedSupportStatus;
  readonly element: string;
  readonly composition: (paths: ConformanceFixturePaths) => CompositionPlan;
  /** Agent frontmatter used to verify --strict through the real run command. */
  readonly agentFrontmatter: string;
  readonly setupStrictFixture?: (paths: ConformanceFixturePaths) => void;
}

export interface DeferredExpectation {
  readonly status: 'deferred';
  readonly documentedStatus: DocumentedSupportStatus;
  readonly justification: string;
}

export type ConformanceExpectation = SupportedExpectation | UnsupportedExpectation | DeferredExpectation;

export interface ConformanceRow {
  readonly id: string;
  readonly description: string;
  readonly expectations: Readonly<Record<Harness, ConformanceExpectation>>;
}

export interface DocMatrixFileSpec {
  readonly key: string;
  readonly repoRelativePath: string;
  readonly harnessColumns: Readonly<Record<Harness, string>>;
}

export const docMatrixFiles: readonly DocMatrixFileSpec[] = [
  {
    key: 'support-matrix',
    repoRelativePath: 'docs/documentation/support-matrix.md',
    harnessColumns: { pi: 'Pi', claude: 'Claude Code' },
  },
  {
    key: 'controllable-elements',
    repoRelativePath: 'docs/architecture/controllable-elements.md',
    harnessColumns: { pi: 'Pi', claude: 'Claude' },
  },
];

export interface DocMatrixRow {
  readonly rowIds: readonly string[];
  readonly labels: Readonly<Record<string, string | undefined>>;
}

export const docMatrixRows: readonly DocMatrixRow[] = [
  {
    rowIds: ['agent_config_directory'],
    labels: { 'support-matrix': 'Agent config directory', 'controllable-elements': 'Agent Config Directory' },
  },
  {
    rowIds: ['session_directory'],
    labels: { 'support-matrix': 'Session directory', 'controllable-elements': 'Session Directory' },
  },
  {
    rowIds: ['identity'],
    labels: {
      'support-matrix': 'Agent identity (`system-prompt.md`, `agents.md`, `agents/<id>/agent.md`)',
      'controllable-elements': 'Personas',
    },
  },
  {
    rowIds: ['subagents'],
    labels: {
      'support-matrix': 'Subagents (`agents/<id>` as harness delegates)',
      'controllable-elements': 'Subagents',
    },
  },
  {
    rowIds: ['skills'],
    labels: { 'support-matrix': 'Skills (`skills/<id>`)', 'controllable-elements': 'Skills' },
  },
  {
    rowIds: ['commands'],
    labels: { 'support-matrix': 'Commands (`commands/`)', 'controllable-elements': 'Commands / Prompt Templates' },
  },
  {
    rowIds: ['knowledge'],
    labels: { 'support-matrix': 'Knowledge (`knowledge/`)', 'controllable-elements': 'Knowledge' },
  },
  {
    rowIds: ['model', 'thinking'],
    labels: { 'support-matrix': 'Model selection (`models.json`)', 'controllable-elements': 'Model Selection' },
  },
  {
    rowIds: ['mcp'],
    labels: { 'support-matrix': 'MCP servers (`mcp.json`)', 'controllable-elements': 'MCP Servers' },
  },
  {
    rowIds: ['extensions'],
    labels: {
      'support-matrix': 'Extensions (agent `extensions:` loadout)',
      'controllable-elements': 'Extensions',
    },
  },
  {
    rowIds: ['plugins'],
    labels: { 'support-matrix': 'Plugins (agent `plugins:` loadout)', 'controllable-elements': 'Plugins' },
  },
  {
    rowIds: ['environment'],
    labels: { 'support-matrix': 'Credentials and environment', 'controllable-elements': 'Credentials and Environment' },
  },
  {
    rowIds: ['tasks'],
    labels: { 'controllable-elements': 'Tasks' },
  },
  {
    rowIds: ['deepwork'],
    labels: { 'support-matrix': 'DeepWork job selection', 'controllable-elements': 'DeepWork Jobs' },
  },
  {
    rowIds: ['hooks'],
    labels: { 'support-matrix': 'Hooks', 'controllable-elements': 'Hooks' },
  },
  {
    rowIds: ['tool_availability'],
    labels: { 'support-matrix': 'Tool availability', 'controllable-elements': 'Tool Availability' },
  },
  {
    rowIds: ['theme'],
    labels: { 'support-matrix': 'Theme / UI presentation', 'controllable-elements': 'Theme / UI Presentation' },
  },
  {
    rowIds: ['working_directory'],
    labels: { 'support-matrix': 'Working directory', 'controllable-elements': 'Working Directory' },
  },
  {
    rowIds: ['pass_through_args'],
    labels: { 'support-matrix': 'Pass-through arguments', 'controllable-elements': 'Pass-through Arguments' },
  },
  {
    rowIds: ['bootstrap_hook'],
    labels: { 'support-matrix': 'Bootstrap hook', 'controllable-elements': 'Bootstrap Hook' },
  },
];

export const undocumentedRowIds: readonly { readonly id: string; readonly reason: string }[] = [
  {
    id: 'state_paths',
    reason: 'Projected state paths implement config/session placement and runtime write accounting.',
  },
];

export const expectedDocStatus = (
  docRow: DocMatrixRow,
  rows: readonly ConformanceRow[],
  harness: Harness,
): DocumentedSupportStatus => {
  const statuses = docRow.rowIds.map((rowId) => {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (row === undefined) throw new Error(`doc matrix references unknown conformance row '${rowId}'`);
    return row.expectations[harness].documentedStatus;
  });
  const [first] = statuses;
  if (first === undefined || statuses.some((status) => status !== first)) {
    throw new Error(`doc matrix row [${docRow.rowIds.join(', ')}] has inconsistent '${harness}' statuses`);
  }
  return first;
};
