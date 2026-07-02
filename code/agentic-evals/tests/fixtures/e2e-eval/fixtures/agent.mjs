// Mock agent: simulates a run. The "good" variant produces everything the
// eval grades for; the "bad" variant misses the question and the hidden test.
import { mkdir, writeFile } from 'node:fs/promises';

const variant = process.env.AGENTIC_EVAL_VARIANT ?? 'good';
const good = variant === 'good';

await writeFile('report.html', '<html><body><h1>Report</h1><p>Readmission summary.</p></body></html>\n', 'utf8');
await writeFile(
  'answers.md',
  good ? '1. Heart Failure had the highest readmission rate.\n' : '1. Unclear from the data.\n',
  'utf8',
);
await mkdir('src', { recursive: true });
await writeFile(
  'src/answer.mjs',
  good ? 'export const answer = () => 42;\n' : 'export const answer = () => 41;\n',
  'utf8',
);
