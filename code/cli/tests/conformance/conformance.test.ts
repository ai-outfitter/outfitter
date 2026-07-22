// Runs every conformance declaration against the real CompositionPlan projection and strict path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { HARNESSES } from '../../src/settings/Settings.js';
import type { Harness } from '../../src/settings/Settings.js';
import { baseComposition, conformanceRows } from './ConformanceRows.js';
import type {
  ConformanceFixturePaths,
  ConformanceRow,
  SupportedExpectation,
  UnsupportedExpectation,
} from './ConformanceSpec.js';

const temporaryRoots: string[] = [];

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const createFixturePaths = (): ConformanceFixturePaths => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'outfitter-conformance-'));
  temporaryRoots.push(rootDirectory);
  return {
    rootDirectory,
    homeDirectory: join(rootDirectory, 'home'),
    projectDirectory: join(rootDirectory, 'project'),
    projectionDirectory: join(rootDirectory, 'projection'),
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const runSupportedExpectation = (harness: Harness, expectation: SupportedExpectation): void => {
  const paths = createFixturePaths();
  const composition = expectation.composition?.(paths) ?? baseComposition();
  const projection = projectComposition(composition, {
    harness,
    rootDirectory: paths.projectionDirectory,
    homeDirectory: paths.homeDirectory,
    passThroughArgs: expectation.passThroughArgs,
    extensionLoadDirs: expectation.extensionLoadDirs?.(paths),
  });
  expect(projection.unsupported).toEqual([]);
  expectation.assert({ composition, projection, paths });
};

const runUnsupportedExpectation = (harness: Harness, expectation: UnsupportedExpectation): void => {
  const paths = createFixturePaths();
  const composition = expectation.composition(paths);
  const projection = projectComposition(composition, {
    harness,
    rootDirectory: paths.projectionDirectory,
    homeDirectory: paths.homeDirectory,
  });
  expect(projection.unsupported).toContain(expectation.element);
};

const runStrictExpectation = async (harness: Harness, expectation: UnsupportedExpectation): Promise<void> => {
  const paths = createFixturePaths();
  expectation.setupStrictFixture?.(paths);
  write(
    join(paths.projectDirectory, '.agents', 'agents', 'conformance', 'agent.md'),
    `---\nname: conformance\n${expectation.agentFrontmatter}\n---\n\nConformance.\n`,
  );
  let launched = false;
  const result = await executeRunAgentCommand({
    homeDirectory: paths.homeDirectory,
    projectDirectory: paths.projectDirectory,
    agent: 'conformance',
    harness,
    strict: true,
    writeLine: () => undefined,
    launcher: () => {
      launched = true;
      return Promise.resolve(0);
    },
  });
  expect(result.exitCode).toBe(1);
  expect(result.messages.join(' ')).toContain(`loadout element '${expectation.element}'`);
  expect(launched).toBe(false);
};

const registerRowTests = (harness: Harness, row: ConformanceRow): void => {
  const expectation = row.expectations[harness];
  if (expectation.status === 'supported') {
    it(`${row.id}: supported — ${row.description}`, () => runSupportedExpectation(harness, expectation));
    return;
  }
  if (expectation.status === 'unsupported') {
    it(`${row.id}: unsupported — reported by projection`, () => runUnsupportedExpectation(harness, expectation));
    it(`${row.id}: unsupported — --strict prevents launch`, async () => runStrictExpectation(harness, expectation));
    return;
  }
  it(`${row.id}: deferred — transition justification recorded`, () => {
    expect(expectation.justification.trim().length).toBeGreaterThan(0);
  });
};

for (const harness of HARNESSES) {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.5, OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  describe(`conformance (${harness})`, () => {
    it('declares an expectation for every conformance row', () => {
      expect(conformanceRows.every((row) => row.expectations[harness] !== undefined)).toBe(true);
    });
    for (const row of conformanceRows) registerRowTests(harness, row);
  });
}

describe('conformance vocabulary', () => {
  it('has unique row ids', () => {
    const ids = conformanceRows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares exactly the registered harnesses', () => {
    for (const row of conformanceRows) expect(Object.keys(row.expectations).sort()).toEqual([...HARNESSES].sort());
  });
});
