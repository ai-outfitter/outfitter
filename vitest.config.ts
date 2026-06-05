// Configures Vitest coverage enforcement for the ApplePi project.
import { defineConfig } from 'vitest/config';

const coverage = {
  all: true,
  include: ['src/**/*.ts'],
  provider: 'v8' as const,
  reporter: ['text-summary', 'html'],
  thresholds: {
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
  },
};

export default defineConfig({
  test: {
    coverage,
    reporters: ['dot'],
    setupFiles: ['tests/setup.ts'],
  },
});
