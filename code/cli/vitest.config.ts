// Configures Vitest coverage enforcement for the Outfitter project.
import { defineConfig } from 'vitest/config';

const coverage = {
  all: true,
  include: ['src/**/*.ts'],
  provider: 'v8' as const,
  reporter: ['text-summary', 'html'],
  thresholds: {
    // Negative thresholds cap uncovered item counts, avoiding routine source-level coverage ignores.
    statements: -72,
    branches: -108,
    functions: -12,
    lines: -69,
  },
};

export default defineConfig({
  test: {
    coverage,
    reporters: ['dot'],
    setupFiles: ['tests/setup.ts'],
  },
});
