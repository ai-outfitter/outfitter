// Cross-checks hand-written support tables against the documented status declared for each row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HARNESSES } from '../../src/settings/Settings.js';
import { conformanceRows } from './ConformanceRows.js';
import { docMatrixFiles, docMatrixRows, expectedDocStatus, undocumentedRowIds } from './ConformanceSpec.js';
import type { DocMatrixFileSpec } from './ConformanceSpec.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface ParsedMatrixTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const isSeparatorRow = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-+:?$/u.test(cell));

const parseMatrixTable = (file: DocMatrixFileSpec): ParsedMatrixTable => {
  const cellRows = readFileSync(join(repoRoot, file.repoRelativePath), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !isSeparatorRow(cells));
  const [header, ...rows] = cellRows;
  if (header === undefined) throw new Error(`no markdown table found in ${file.repoRelativePath}`);
  return { header, rows };
};

const mappedRowsFor = (file: DocMatrixFileSpec) =>
  docMatrixRows.flatMap((row) => {
    const label = row.labels[file.key];
    return label === undefined ? [] : [{ row, label }];
  });

for (const file of docMatrixFiles) {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-007.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  describe(`support matrix drift (${file.repoRelativePath})`, () => {
    const table = parseMatrixTable(file);

    it('has a status column for every registered harness', () => {
      for (const harness of HARNESSES) expect(table.header).toContain(file.harnessColumns[harness]);
    });

    it('documents exactly the mapped conformance rows', () => {
      expect(table.rows.map((cells) => cells[0]).sort()).toEqual(
        mappedRowsFor(file)
          .map(({ label }) => label)
          .sort(),
      );
    });

    for (const { row, label } of mappedRowsFor(file)) {
      it(`row '${label}' matches its declared published status`, () => {
        const cells = table.rows.find((candidate) => candidate[0] === label);
        expect(cells).toBeDefined();
        for (const harness of HARNESSES) {
          const column = table.header.indexOf(file.harnessColumns[harness]);
          expect(cells?.[column]).toBe(expectedDocStatus(row, conformanceRows, harness));
        }
      });
    }
  });
}

describe('support matrix mapping completeness', () => {
  it('maps every conformance row exactly once or explicitly exempts it', () => {
    const referenced = [...docMatrixRows.flatMap((row) => row.rowIds), ...undocumentedRowIds.map((entry) => entry.id)];
    expect(new Set(referenced).size).toBe(referenced.length);
    expect([...referenced].sort()).toEqual(conformanceRows.map((row) => row.id).sort());
  });

  it('justifies every undocumented row', () => {
    for (const entry of undocumentedRowIds) expect(entry.reason.trim().length).toBeGreaterThan(0);
  });
});
