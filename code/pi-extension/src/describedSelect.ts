// Full-width selector overlay with per-option descriptions, rendered with pi-tui primitives.
import type { Theme } from '@earendil-works/pi-coding-agent';

import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from './piTui.js';

import type { DescribedOption, OutfitterContext } from './types.js';

interface DescribedSelectState {
  selectedIndex: number;
  cachedWidth: number | undefined;
  cachedLines: string[] | undefined;
}

export const selectDescribedOption = (
  ctx: OutfitterContext,
  titleLines: readonly string[],
  items: readonly DescribedOption[],
  initialValue: string | undefined,
): Promise<string | undefined> =>
  ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const state: DescribedSelectState = {
      selectedIndex: Math.max(
        0,
        items.findIndex((item) => item.value === initialValue),
      ),
      cachedWidth: undefined,
      cachedLines: undefined,
    };
    const labelWidth = Math.max(...items.map((item) => item.label.length));

    const finish = (value: string | undefined): void => {
      done(value);
    };
    const refresh = (): void => {
      state.cachedWidth = undefined;
      state.cachedLines = undefined;
      tui.requestRender();
    };
    const move = (delta: number): void => {
      state.selectedIndex = Math.max(0, Math.min(items.length - 1, state.selectedIndex + delta));
      refresh();
    };

    const render = (width: number): string[] => {
      const maxWidth = typeof width === 'number' && width > 0 ? width : 120;
      if (state.cachedLines !== undefined && state.cachedWidth === maxWidth) {
        return state.cachedLines;
      }

      const lines = renderDescribedSelectLines(theme, titleLines, items, state.selectedIndex, labelWidth, maxWidth);
      state.cachedWidth = maxWidth;
      state.cachedLines = lines;
      return lines;
    };

    return {
      outfitterOptions: items.map((item) => item.label),
      render,
      invalidate: refresh,
      handleInput: (data: string): void => {
        if (matchesKey(data, Key.up)) {
          move(-1);
        } else if (matchesKey(data, Key.down)) {
          move(1);
        } else if (matchesKey(data, Key.enter)) {
          finish(items[state.selectedIndex]?.value);
        } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
          finish(undefined);
        }
      },
    };
  });

const renderDescribedSelectLines = (
  theme: Theme,
  titleLines: readonly string[],
  items: readonly DescribedOption[],
  selectedIndex: number,
  labelWidth: number,
  maxWidth: number,
): string[] => {
  const lines: string[] = [];
  const add = (line: string): void => {
    lines.push(visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line);
  };
  const addWrapped = (line: string, widthForWrap: number = maxWidth, prefix = ''): void => {
    for (const wrappedLine of wrapTextWithAnsi(line, Math.max(1, widthForWrap))) {
      add(prefix + wrappedLine);
    }
  };
  const renderSelectedItem = (prefix: string, label: string, description: string | undefined): void => {
    const baseLine = prefix + label;
    if (description === undefined || description === '') {
      add(baseLine);
      return;
    }

    const inlineDescriptionWidth = maxWidth - visibleWidth(baseLine) - 2;
    const descriptionText = theme.fg('muted', description);
    if (inlineDescriptionWidth >= 30) {
      const [firstLine = '', ...remainingLines] = wrapTextWithAnsi(descriptionText, inlineDescriptionWidth);
      add(baseLine + '  ' + firstLine);
      const continuationPrefix = ' '.repeat(Math.min(maxWidth, visibleWidth(baseLine) + 2));
      for (const line of remainingLines) {
        add(continuationPrefix + line);
      }
      return;
    }

    add(baseLine);
    addWrapped(descriptionText, maxWidth - 2, '  ');
  };

  add(theme.fg('accent', '─'.repeat(maxWidth)));
  titleLines.forEach((line, index) => {
    addWrapped(index === 0 ? theme.fg('text', ' ' + line) : theme.fg('dim', ' ' + line));
  });
  lines.push('');

  items.forEach((item, index) => {
    const selected = index === selectedIndex;
    const prefix = selected ? theme.fg('accent', '→ ') : '  ';
    const paddedLabel = item.label.padEnd(labelWidth);
    const label = selected ? theme.fg('accent', paddedLabel) : paddedLabel;
    renderSelectedItem(prefix, label, selected ? item.description : undefined);
  });

  lines.push('');
  add(theme.fg('dim', '↑↓ navigate  enter select  escape/ctrl+c cancel'));
  add(theme.fg('accent', '─'.repeat(maxWidth)));

  return lines;
};
