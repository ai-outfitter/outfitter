// Plays both roles. As the agent it writes a strong or weak summary depending
// on the variant; as the judge it reads the anonymized artifacts and scores
// them into scores.json, validating the schema the harness generated.
import { readFile, readdir, writeFile } from 'node:fs/promises';

const role = process.env.AGENTIC_EVAL_ROLE ?? 'agent';

if (role === 'agent') {
  const strong = process.env.AGENTIC_EVAL_VARIANT === 'strong';
  await writeFile(
    'summary.md',
    strong
      ? 'Post-quantum encryption replaces RSA/ECC with lattice-based schemes like ML-KEM that resist Shor breakage.\n'
      : 'Quantum computers are coming and encryption will change somehow.\n',
    'utf8',
  );
} else {
  const schema = JSON.parse(await readFile('scores.schema.json', 'utf8'));
  const labels = schema.properties.scores.required;
  const scores = {};
  for (const label of labels) {
    const summary = await readFile(`artifacts/${label}/summary.md`, 'utf8');
    const good = summary.includes('lattice');
    scores[label] = {
      criteria: { accuracy: good ? 9 : 2, clarity: good ? 8 : 4 },
      notes: good ? 'names concrete schemes' : 'vague',
    };
  }
  const artifactDirectories = await readdir('artifacts');
  if (artifactDirectories.length !== labels.length) {
    throw new Error('schema labels do not match artifact directories');
  }
  await writeFile('scores.json', JSON.stringify({ scores }, null, 2), 'utf8');
}
