// Runs the cross-adapter conformance suite: every adapter in the registry must
// declare an expectation for every conformance row, and each declaration is
// verified against real adapter behavior (supported ⇒ correct composite output
// and launch flags; roadmap ⇒ exact warning text and --strict escalation;
// not applicable ⇒ recorded justification).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentAdapter } from '../../src/agents/AgentAdapter.js';
import { createAgentAdapter, supportedAgentIds } from '../../src/agents/AgentRegistry.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import type { Profile } from '../../src/profiles/Profile.js';
import { conformanceRows } from './ConformanceRows.js';
import {
  untranslatableControlWarning,
  type ConformanceFixturePaths,
  type ConformanceRow,
  type RoadmapExpectation,
  type SupportedExpectation,
} from './ConformanceSpec.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createFixturePaths = (): ConformanceFixturePaths => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'outfitter-conformance-'));
  temporaryRoots.push(rootDirectory);
  const paths = {
    rootDirectory,
    homeDirectory: join(rootDirectory, 'home'),
    projectDirectory: join(rootDirectory, 'project'),
    profileFolder: join(rootDirectory, 'profile'),
    compositeRootDirectory: join(rootDirectory, 'composite'),
  };
  mkdirSync(paths.homeDirectory, { recursive: true });
  mkdirSync(paths.projectDirectory, { recursive: true });
  mkdirSync(paths.profileFolder, { recursive: true });
  return paths;
};

const runSupportedExpectation = (
  adapter: AgentAdapter,
  row: ConformanceRow,
  expectation: SupportedExpectation,
): void => {
  const paths = createFixturePaths();
  expectation.setup?.(paths);
  const profile: Profile = { id: `conformance-${row.id}`, inherits: [], controls: expectation.controls?.(paths) ?? {} };
  const profileLayers = expectation.profileLayers?.(paths, profile);

  const plan = adapter.createCompositeProfile(profile, {
    rootDirectory: paths.compositeRootDirectory,
    profilePaths: [join(paths.profileFolder, 'profile.yml')],
    profileFolders: [paths.profileFolder],
    profileLayers,
    homeDirectory: paths.homeDirectory,
    projectDirectory: paths.projectDirectory,
  });
  // A supported control must translate silently: no untranslatable-control or
  // resolution warnings are acceptable for the row's fixture.
  expect(plan.warnings).toEqual([]);

  const launchPlan = adapter.createLaunchPlan(plan.compositeProfile, profile, expectation.passThroughArgs ?? [], {
    profileFolders: [paths.profileFolder],
    profileLayers,
    projectDirectory: paths.projectDirectory,
  });

  expectation.assert({ adapter, profile, plan, launchPlan, paths });
};

const runRoadmapWarningExpectation = (
  adapter: AgentAdapter,
  row: ConformanceRow,
  expectation: RoadmapExpectation,
): void => {
  const paths = createFixturePaths();
  const profile: Profile = { id: `conformance-${row.id}`, inherits: [], controls: expectation.controls };

  const plan = adapter.createCompositeProfile(profile, {
    rootDirectory: paths.compositeRootDirectory,
    profilePaths: [],
    profileFolders: [paths.profileFolder],
    homeDirectory: paths.homeDirectory,
    projectDirectory: paths.projectDirectory,
  });

  expect(plan.warnings).toEqual([untranslatableControlWarning(adapter.id, expectation.warnsAbout)]);
};

const runStrictEscalationExpectation = async (agentId: string, expectation: RoadmapExpectation): Promise<void> => {
  const paths = createFixturePaths();
  const profileDirectory = join(paths.homeDirectory, '.outfitter', 'profiles', 'default');
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(
    join(paths.homeDirectory, '.outfitter', 'settings.yml'),
    'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
  );
  writeFileSync(
    join(profileDirectory, 'profile.yml'),
    `id: default\ncontrols: ${JSON.stringify(expectation.controls)}\n`,
  );

  await expect(
    executeRunCommand(
      { homeDirectory: paths.homeDirectory, projectDirectory: paths.projectDirectory, agentId, strict: true },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    ),
  ).rejects.toThrow(`Strict failed for ${agentId}: ${untranslatableControlWarning(agentId, expectation.warnsAbout)}`);
};

const registerRowTests = (adapter: AgentAdapter, row: ConformanceRow): void => {
  const expectation = row.expectations[adapter.id];

  // Missing declarations are reported by the completeness test.
  if (expectation === undefined) {
    return;
  }

  if (expectation.status === 'supported') {
    it(`${row.id}: supported — ${row.description}`, () => {
      runSupportedExpectation(adapter, row, expectation);
    });
    return;
  }

  if (expectation.status === 'roadmap') {
    it(`${row.id}: roadmap — warns with exact text`, () => {
      runRoadmapWarningExpectation(adapter, row, expectation);
    });
    it(`${row.id}: roadmap — --strict escalates the warning to a failure`, async () => {
      await runStrictEscalationExpectation(adapter.id, expectation);
    });
    return;
  }

  it(`${row.id}: not applicable — justification recorded`, () => {
    expect(expectation.justification.trim().length).toBeGreaterThan(0);
  });
};

for (const agentId of supportedAgentIds) {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.5, OFTR-006.3, OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  describe(`conformance (${agentId})`, () => {
    const adapter = createAgentAdapter(agentId);

    // Adding an adapter to the registry forces a declaration for every row.
    it('declares an expectation for every conformance row', () => {
      const undeclaredRows = conformanceRows
        .filter((row) => row.expectations[agentId] === undefined)
        .map((row) => row.id);
      expect(undeclaredRows, `adapter '${agentId}' must declare every conformance row`).toEqual([]);
    });

    for (const row of conformanceRows) {
      registerRowTests(adapter, row);
    }
  });
}

describe('conformance vocabulary', () => {
  it('has unique row ids', () => {
    const rowIds = conformanceRows.map((row) => row.id);
    expect(new Set(rowIds).size).toBe(rowIds.length);
  });

  it('declares expectations only for registered adapters', () => {
    const registeredAgentIds = new Set<string>(supportedAgentIds);
    const unknownAdapterIds = conformanceRows.flatMap((row) =>
      Object.keys(row.expectations).filter((adapterId) => !registeredAgentIds.has(adapterId)),
    );
    expect(unknownAdapterIds).toEqual([]);
  });
});
