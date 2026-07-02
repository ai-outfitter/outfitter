// Configures Vitest coverage enforcement for the Outfitter Pi extension workspace.
import { defineConfig } from 'vitest/config';

const coverage = {
  all: true,
  include: ['src/**/*.ts'],
  provider: 'v8' as const,
  reporter: ['text-summary', 'html'],
  thresholds: {
    statements: 98,
    branches: 98,
    functions: 98,
    lines: 98,
  },
};

export default defineConfig({
  test: {
    coverage,
    reporters: ['dot'],
  },
});
