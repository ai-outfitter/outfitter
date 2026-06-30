// Installs global Vitest safeguards that keep successful test runs quiet.
import { afterEach } from 'vitest';

import { installTestConsoleGuard, resetAllowedTestConsoleOutput } from './test-console.js';

installTestConsoleGuard();

afterEach(() => {
  resetAllowedTestConsoleOutput();
});
