import assert from 'node:assert/strict';
import test from 'node:test';
import { decode, encode } from '../src/rle.js';

test('encodes runs, leaving singletons bare', () => {
  assert.equal(encode('AABBBC'), 'A2B3C');
  assert.equal(encode('ABC'), 'ABC');
  assert.equal(encode('aaAA'), 'a2A2');
});

test('encodes the empty string', () => {
  assert.equal(encode(''), '');
});

test('encodes long runs with multi-digit counts', () => {
  assert.equal(encode('Z'.repeat(12)), 'Z12');
});

test('encode rejects invalid input', () => {
  assert.throws(() => encode(42), TypeError);
  assert.throws(() => encode(null), TypeError);
  assert.throws(() => encode('AB1'), RangeError);
  assert.throws(() => encode('A B'), RangeError);
});

test('decodes bare characters and counted runs', () => {
  assert.equal(decode('A2B3C'), 'AABBBC');
  assert.equal(decode('ABC'), 'ABC');
  assert.equal(decode('A12'), 'AAAAAAAAAAAA');
  assert.equal(decode(''), '');
});

test('decode rejects invalid input', () => {
  assert.throws(() => decode(42), TypeError);
  assert.throws(() => decode('2A'), RangeError);
});

test('decode inverts encode', () => {
  for (const sample of ['', 'A', 'AAAA', 'AaAa', 'QQQQQQQQQQQwwE', 'xyzzy']) {
    assert.equal(decode(encode(sample)), sample);
  }
});
