// Configures Vitest coverage enforcement for the Outfitter project.
import { defineConfig } from 'vitest/config';

const coverage = {
  all: true,
  include: ['src/**/*.ts'],
  provider: 'v8' as const,
  reporter: ['text-summary', 'html'],
  thresholds: {
    statements: 99,
    branches: 99,
    functions: 99,
    lines: 99,
  },
};

export default defineConfig({
  test: {
    coverage,
    reporters: ['dot'],
    setupFiles: ['tests/setup.ts'],
  },
});
