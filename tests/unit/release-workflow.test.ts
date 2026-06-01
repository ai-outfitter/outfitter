// Tests the GitHub Actions workflow that publishes Bridl to npm.
import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | boolean>>;
  readonly env?: Readonly<Record<string, string>>;
}

interface WorkflowJob {
  readonly steps: readonly WorkflowStep[];
}

interface WorkflowDocument {
  readonly on: {
    readonly release: {
      readonly types: readonly string[];
    };
  };
  readonly jobs: {
    readonly 'publish-npm': WorkflowJob;
  };
}

const loadReleaseWorkflow = (): WorkflowDocument =>
  parse(readFileSync('.github/workflows/release.yml', 'utf8')) as WorkflowDocument;

const findStep = (workflow: WorkflowDocument, stepName: string): WorkflowStep => {
  const step = workflow.jobs['publish-npm'].steps.find((step) => step.name === stepName);

  if (step === undefined) {
    throw new Error(`Missing release workflow step '${stepName}'.`);
  }

  return step;
};

describe('release workflow', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-009.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('publishes the bridl npm package only after release preparation and checks', () => {
    const workflow = loadReleaseWorkflow();
    const stepNames = workflow.jobs['publish-npm'].steps.map((step) => step.name);

    expect(workflow.on.release.types).toEqual(['published']);
    expect(findStep(workflow, 'Setup Node.js').with?.['registry-url']).toBe('https://registry.npmjs.org/');
    expect(findStep(workflow, 'Install dependencies').run).toBe('npm ci');
    expect(findStep(workflow, 'Sync release version').run).toBe(
      'node scripts/sync-release-version.mjs "${GITHUB_REF_NAME}"',
    );
    expect(findStep(workflow, 'Format synchronized release metadata').run).toBe(
      'npm exec -- prettier --write package.json package-lock.json',
    );
    expect(findStep(workflow, 'Run CI checks').run).toBe('npm run check-ci');
    expect(findStep(workflow, 'Build package').run).toBe('npm run build');
    expect(findStep(workflow, 'Publish package to npm')).toMatchObject({
      run: 'npm publish --access public',
      env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' },
    });
    expect(stepNames).toEqual([
      'Checkout',
      'Setup Node.js',
      'Install dependencies',
      'Sync release version',
      'Format synchronized release metadata',
      'Run CI checks',
      'Build package',
      'Publish package to npm',
    ]);
  });
});
