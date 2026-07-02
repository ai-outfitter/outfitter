// Rendering and keyboard-navigation tests for the described-option selector.
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';

import { selectDescribedOption } from '../src/describedSelect.js';
import type { DescribedOption, OutfitterContext } from '../src/types.js';
import { keySequences } from './harness.js';

interface CapturedSelector {
  outfitterOptions: readonly string[];
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

const captureSelector = (
  items: readonly DescribedOption[],
  initialValue: string | undefined,
  titleLines: readonly string[] = ['Pick an option', 'Details below'],
): { selector: CapturedSelector; result: Promise<string | undefined>; renderCount: () => number } => {
  let selector: CapturedSelector | undefined;
  let renders = 0;
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const ctx = {
    ui: {
      custom: <T>(
        factory: (tui: unknown, factoryTheme: typeof theme, keybindings: unknown, done: (result: T) => void) => unknown,
      ) =>
        new Promise<T>((resolve) => {
          selector = factory(
            {
              requestRender: () => {
                renders += 1;
              },
            },
            theme,
            {},
            resolve,
          ) as CapturedSelector;
        }),
    },
  } as unknown as OutfitterContext;

  const result = selectDescribedOption(ctx, titleLines, items, initialValue);

  if (selector === undefined) {
    throw new Error('selector component was not created.');
  }

  return { selector, result, renderCount: () => renders };
};

const items: readonly DescribedOption[] = [
  { value: 'first', label: 'First option', description: 'Shown when selected and wraps within the viewport width.' },
  { value: 'second', label: 'Second option' },
  { value: 'third', label: 'Third option', description: 'Another description.' },
];

describe('selectDescribedOption', () => {
  it('navigates with arrow keys, clamps at the edges, and resolves the highlighted value', async () => {
    const { selector, result } = captureSelector(items, 'second');

    selector.handleInput(keySequences.up);
    selector.handleInput(keySequences.up);
    selector.handleInput(keySequences.down);
    selector.handleInput(keySequences.down);
    selector.handleInput(keySequences.down);
    selector.handleInput(keySequences.enter);

    await expect(result).resolves.toBe('third');
  });

  it('resolves undefined for escape and defaults to the first row for unknown initial values', async () => {
    const { selector, result } = captureSelector(items, 'missing-value');

    expect(selector.render(80).join('\n')).toContain('→ First option');
    selector.handleInput(keySequences.escape);

    await expect(result).resolves.toBeUndefined();
  });

  it('resolves undefined for ctrl+c and ignores unmatched keys', async () => {
    const { selector, result } = captureSelector(items, 'first');

    selector.handleInput('x');
    selector.handleInput('\x03');

    await expect(result).resolves.toBeUndefined();
  });

  it('caches rendered lines per width and invalidates on demand', () => {
    const { selector, renderCount } = captureSelector(items, 'first');

    const first = selector.render(80);
    expect(selector.render(80)).toBe(first);
    expect(selector.render(60)).not.toBe(first);

    selector.invalidate();
    expect(renderCount()).toBe(1);
    expect(selector.render(80)).not.toBe(first);
  });

  it('falls back to a 120-column viewport for non-positive widths', () => {
    const { selector } = captureSelector(items, 'first');

    const lines = selector.render(0);
    expect(lines[0]).toBe('─'.repeat(120));
    expect(lines.at(-1)).toBe('─'.repeat(120));
  });

  it('wraps long selected descriptions below the row on narrow viewports and truncates overlong lines', () => {
    const narrow = captureSelector(
      [{ value: 'only', label: 'A very long option label used here', description: 'Long description text.' }],
      'only',
      ['A title line that definitely exceeds the tiny viewport width used in this test'],
    );

    const lines = narrow.selector.render(24);
    expect(lines.join('\n')).toContain('Long description');
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
  });
});
