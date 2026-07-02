// Verifies the published support matrices agree with the declared conformance
// statuses, so the user-facing docs cannot drift from adapter behavior. The
// tables stay hand-written prose; this suite parses them and cross-checks every
// row and adapter column against the conformance declarations that the
// behavioral suite (conformance.test.ts) enforces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { supportedAgentIds } from '../../src/agents/AgentRegistry.js';
import { conformanceRows } from './ConformanceRows.js';
import {
  docMatrixFiles,
  docMatrixRows,
  expectedDocStatus,
  undocumentedRowIds,
  type DocMatrixFileSpec,
} from './ConformanceSpec.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface ParsedMatrixTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const isSeparatorRow = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-+:?$/.test(cell));

const parseMatrixTable = (docFile: DocMatrixFileSpec): ParsedMatrixTable => {
  const markdown = readFileSync(join(repoRoot, docFile.repoRelativePath), 'utf8');
  const cellRows = markdown
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

  if (header === undefined) {
    throw new Error(`no markdown table found in ${docFile.repoRelativePath}`);
  }

  return { header, rows };
};

const mappedDocRowsFor = (docFile: DocMatrixFileSpec) =>
  docMatrixRows.flatMap((docRow) => {
    const label = docRow.labels[docFile.key];
    return label === undefined ? [] : [{ docRow, label }];
  });

for (const docFile of docMatrixFiles) {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-007.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  describe(`support matrix drift (${docFile.repoRelativePath})`, () => {
    const table = parseMatrixTable(docFile);

    it('has a status column for every registered adapter', () => {
      for (const agentId of supportedAgentIds) {
        const columnLabel = docFile.adapterColumns[agentId];
        expect(columnLabel, `adapter '${agentId}' has no documented matrix column`).toBeDefined();
        expect(table.header, `column '${columnLabel ?? agentId}' missing`).toContain(columnLabel);
      }
    });

    it('documents exactly the conformance-mapped rows', () => {
      const documentedLabels = table.rows.map((cells) => cells[0]).sort();
      const mappedLabels = mappedDocRowsFor(docFile)
        .map((mapped) => mapped.label)
        .sort();
      expect(documentedLabels).toEqual(mappedLabels);
    });

    for (const { docRow, label } of mappedDocRowsFor(docFile)) {
      it(`row '${label}' matches the declared conformance statuses`, () => {
        const tableRow = table.rows.find((cells) => cells[0] === label);
        expect(tableRow, `table row '${label}' missing`).toBeDefined();

        for (const agentId of supportedAgentIds) {
          const columnIndex = table.header.indexOf(docFile.adapterColumns[agentId] ?? '');
          expect(columnIndex).toBeGreaterThan(0);
          expect(tableRow?.[columnIndex], `status for '${agentId}' in row '${label}'`).toBe(
            expectedDocStatus(docRow, conformanceRows, agentId, docFile.statusVocabulary),
          );
        }
      });
    }
  });
}

describe('support matrix mapping completeness', () => {
  it('maps every conformance row to a documentation row or an explicit exemption', () => {
    const mappedRowIds = docMatrixRows.flatMap((docRow) => docRow.rowIds);
    const exemptRowIds = undocumentedRowIds.map((exemption) => exemption.id);
    const referencedRowIds = [...mappedRowIds, ...exemptRowIds];

    expect(new Set(referencedRowIds).size, 'conformance rows must be referenced exactly once').toBe(
      referencedRowIds.length,
    );
    expect([...referencedRowIds].sort()).toEqual(conformanceRows.map((row) => row.id).sort());
  });

  it('gives every exempt row a justification', () => {
    for (const exemption of undocumentedRowIds) {
      expect(exemption.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
