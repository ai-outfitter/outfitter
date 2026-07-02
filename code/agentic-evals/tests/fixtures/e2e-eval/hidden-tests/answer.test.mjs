import assert from 'node:assert/strict';
import test from 'node:test';
import { answer } from '../src/answer.mjs';

test('answer is 42', () => {
  assert.equal(answer(), 42);
});
