// Guards against reintroducing hardcoded model identifiers into the CLI source tree. Pi owns
// model defaults; a model ID baked into Outfitter breaks every launch once pi rotates its catalog.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));

const modelIdPatterns: readonly RegExp[] = [
  // Provider-prefixed model IDs such as google/gemini-3.1-pro-preview or anthropic/claude-sonnet-4.
  /\b(?:google|openai|anthropic|meta-llama|mistralai?|x-ai|xai|deepseek|qwen)\/[a-z0-9][\w.:-]*/giu,
  // Bare model family IDs with version digits such as gpt-5, gemini-3.1, or claude-4.
  /\b(?:gpt|gemini|claude|llama|sonnet|opus|haiku|grok)-\d[\w.-]*/giu,
];

const listSourceFiles = (): readonly string[] =>
  readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(sourceRoot, entry));

describe('hardcoded model id gate', () => {
  it('keeps code/cli/src free of hardcoded model identifiers', () => {
    const sourceFiles = listSourceFiles();

    expect(sourceFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');

      for (const pattern of modelIdPatterns) {
        for (const match of content.matchAll(pattern)) {
          offenders.push(`${filePath}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
