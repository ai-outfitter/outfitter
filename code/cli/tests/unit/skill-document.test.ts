// Tests SKILL.md frontmatter parsing, validation, and reference sections.
import { describe, expect, it } from 'vitest';

import {
  isSkillDocumentIssue,
  isValidSkillId,
  parseSkillDocument,
  readSkillDocument,
} from '../../src/skills/SkillDocument.js';

const parse = (content: string) => parseSkillDocument(content, '/x/SKILL.md');

const expectMessage = (value: ReturnType<typeof parseSkillDocument>, substring: string): void => {
  expect(isSkillDocumentIssue(value)).toBe(true);
  if (isSkillDocumentIssue(value)) {
    expect(value.message).toContain(substring);
  }
};

describe('skill document', () => {
  it('parses name, description, and reference sections', () => {
    const document = parse(
      '---\nname: wiki\ndescription: A wiki skill.\nreferences:\n  - file: docs/a.md\nscripts:\n  - repo_file: s.sh\n---\n\nBody.\n',
    );
    expect(isSkillDocumentIssue(document)).toBe(false);
    if (isSkillDocumentIssue(document)) return;
    expect(document.name).toBe('wiki');
    expect(document.description).toBe('A wiki skill.');
    expect(document.references).toEqual([{ file: 'docs/a.md' }]);
    expect(document.scripts).toEqual([{ repo_file: 's.sh' }]);
    expect(document.assets).toEqual([]);
  });

  it('validates skill ids', () => {
    expect(isValidSkillId('wiki-2')).toBe(true);
    expect(isValidSkillId('Wiki')).toBe(false);
    expect(isValidSkillId('a'.repeat(65))).toBe(false);
  });

  it('reports missing frontmatter, invalid YAML, non-mapping, and bad names', () => {
    expectMessage(parse('no frontmatter'), 'frontmatter block');
    expectMessage(parse('---\nname: wiki\n'), 'frontmatter block');
    expectMessage(parse('---\n: bad: yaml:\n---\n'), 'not valid YAML');
    expectMessage(parse('---\n- 1\n---\n'), 'must be a YAML mapping');
    expectMessage(parse('---\nname: Bad Name\n---\n'), "'name' must use");
  });

  it('rejects malformed reference entries', () => {
    expectMessage(parse('---\nname: wiki\nreferences:\n  - nope: x\n---\n'), "'references' entries");
  });

  it('reports a read error for a missing file', () => {
    expectMessage(readSkillDocument('/missing/SKILL.md'), 'Could not read');
  });
});
