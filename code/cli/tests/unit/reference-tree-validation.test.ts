// Tests reference-tree entry types that require platform filesystem primitives.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot !== undefined) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('reference tree validation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.2, OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps validating a parseable skill after its name does not match its directory', () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'outfitter-reference-tree-'));
    const project = join(temporaryRoot, 'project');
    const skillPath = join(project, '.agents', 'skills', 'directory-name', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      `---
name: different-name
references:
  - file: docs/missing.md
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(temporaryRoot, 'home'),
      projectDirectory: project,
    }).findings.filter((finding) => finding.resource === 'skill:directory-name');

    expect(findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['invalid-name', 'missing-description', 'reference-missing']),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects an empty reference instead of scanning its complete root', () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'outfitter-reference-tree-'));
    const project = join(temporaryRoot, 'project');
    const skillPath = join(project, '.agents', 'skills', 'empty-reference', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      `---
name: empty-reference
description: Validate references. Use when a skill declares materialization inputs.
references:
  - file: ""
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(temporaryRoot, 'home'),
      projectDirectory: project,
    }).findings;

    const finding = findings.find(
      (candidate) => candidate.code === 'resource-invalid' && candidate.resource === 'skill:empty-reference',
    );
    expect(finding?.message).toContain('must not be empty');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a reference target that is not a regular file or directory', () => {
    if (process.platform === 'win32') return;

    temporaryRoot = mkdtempSync(join(tmpdir(), 'outfitter-reference-tree-'));
    const project = join(temporaryRoot, 'project');
    const agentsRoot = join(project, '.agents');
    const fifoPath = join(agentsRoot, 'docs', 'events.fifo');
    mkdirSync(dirname(fifoPath), { recursive: true });
    execFileSync('mkfifo', [fifoPath]);
    const skillPath = join(agentsRoot, 'skills', 'special-file', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      `---
name: special-file
description: Validate reference types. Use when a catalog contains special filesystem entries.
references:
  - file: docs/events.fifo
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(temporaryRoot, 'home'),
      projectDirectory: project,
    }).findings;

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'resource-invalid', resource: 'skill:special-file' })]),
    );
  });
});
