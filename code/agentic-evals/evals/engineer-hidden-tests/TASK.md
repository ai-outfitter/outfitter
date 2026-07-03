# Task: run-length encoding

Implement `encode` and `decode` in `src/rle.js`.

## `encode(input)`

- Takes a string of letters (`A-Z`, `a-z`) and returns its run-length
  encoding: each run of the same character becomes the character followed by
  the run length, except runs of length 1, which stay a bare character.
- `encode('AABBBC')` → `'A2B3C'`; `encode('ABC')` → `'ABC'`.
- Empty string encodes to the empty string.
- Throw a `TypeError` for non-string input and a `RangeError` if the input
  contains anything other than ASCII letters.

## `decode(input)`

- Inverse of `encode`: `decode(encode(s)) === s` for every valid `s`.
- Multi-digit run lengths must work: `decode('A12')` → `'AAAAAAAAAAAA'`.
- Throw a `TypeError` for non-string input and a `RangeError` for malformed
  encodings (a count with no preceding character, e.g. `'2A'`).
