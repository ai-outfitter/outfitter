// Provides the readline-based terminal prompt for state_persistence 'prompt' decisions.
import { createInterface } from 'node:readline/promises';

import type { CompositeProfileStateWritePrompt } from '../../../compositeProfile/StatePersistence.js';

/* v8 ignore start -- readline prompting is direct terminal behavior; tests inject a prompt. */
export const createTerminalStateWritePrompt =
  (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): CompositeProfileStateWritePrompt =>
  async (request) => {
    const readline = createInterface({ input, output });

    try {
      for (;;) {
        const answer = (
          await readline.question(
            `${request.agentId} wrote state path '${request.relativePath}' (state_persistence 'prompt'). ` +
              `[p]ersist to ${request.sourcePath ?? 'its durable source'} / [d]iscard / ` +
              `[a]lways persist for this profile: `,
          )
        )
          .trim()
          .toLowerCase();

        if (answer === 'p' || answer === 'persist') {
          return 'persist';
        }

        if (answer === 'd' || answer === 'discard') {
          return 'discard';
        }

        if (answer === 'a' || answer === 'always') {
          return 'always';
        }
      }
    } finally {
      readline.close();
    }
  };
/* v8 ignore stop */
