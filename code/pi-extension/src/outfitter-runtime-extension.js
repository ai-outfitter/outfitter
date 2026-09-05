import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

const OUTFITTER_ACTIVE_PROFILE = '__OUTFITTER_ACTIVE_PROFILE__';
// 'dialog' offers /login when no provider is connected. 'hint' only prints the one-line reminder;
// the CLI stamps it when the user skipped the provider step of first-run setup moments earlier.
const OUTFITTER_PROVIDER_PROMPT_MODE = '__OUTFITTER_PROVIDER_PROMPT_MODE__';
// Keep this dialog in sync with outfitter-extension.js, which shows the same prompt right after
// the first-run walkthrough.
const OUTFITTER_PROVIDER_PROMPT = {
  title: [
    'Pi does not have a model provider connected yet.',
    'Connect one now so Outfitter can use Pi. Credentials stay inside Pi.',
    'Press Enter to open /login, or Escape to skip and connect later.',
  ],
  items: [
    {
      value: 'connect',
      label: 'Connect a model provider',
      description: 'Opens Pi /login to sign in via OAuth or paste an API key.',
    },
  ],
  footer: 'enter connect  escape skip',
};
const OUTFITTER_PROVIDER_HINT = "No model provider connected yet. Run '/login' inside Outfitter to connect one.";

// Outfitter runtime extension. Unlike the setup walkthrough extension
// (outfitter-extension.js), this file is loaded into the real profile pi session. It restores the
// compact Outfitter + profile header, plus the "no provider connected yet" sign-in prompt for
// users who already have .agents but no provider: when pi starts with no models available, it
// offers to connect one and delegates to pi's native /login command, which persists credentials in
// pi's own agent directory and selects a default model in-session. First-run users normally
// connect a provider inside the setup walkthrough instead (OFTR-010.1.4), so this prompt does not
// repeat right after setup. The CLI stamps profile metadata into a per-run copy before loading it
// via --extension.

export default function outfitterRuntime(pi) {
  let loginSubmitted = false;

  const submitSlashCommand = async (ctx, command) => {
    if (ctx.mode !== 'tui') return false;
    ctx.ui.setEditorText(command);
    await ctx.ui.custom(
      (tui, _theme, _keybindings, done) => {
        setTimeout(() => {
          tui.focusedComponent?.handleInput?.('\r');
          done(true);
        }, 25);
        return { render: () => [], invalidate: () => undefined };
      },
      { overlay: true, overlayOptions: { nonCapturing: true, visible: () => false } },
    );
    return true;
  };

  const getAvailableModelCount = async (ctx) => {
    if (ctx.modelRegistry === undefined || typeof ctx.modelRegistry.getAvailable !== 'function') {
      return ctx.model === undefined ? 0 : 1;
    }
    try {
      const available = await ctx.modelRegistry.getAvailable();
      return Array.isArray(available) ? available.length : 0;
    } catch {
      return ctx.model === undefined ? 0 : 1;
    }
  };

  const confirmModelProviderConnection = async (ctx) => {
    if (typeof ctx.ui.custom !== 'function') return true;
    const selected = await selectDescribedOption(
      ctx,
      OUTFITTER_PROVIDER_PROMPT.title,
      OUTFITTER_PROVIDER_PROMPT.items,
      'connect',
      { footer: OUTFITTER_PROVIDER_PROMPT.footer },
    );
    return selected === 'connect';
  };

  const openLoginIfNoModels = async (ctx) => {
    if (loginSubmitted || ctx.mode !== 'tui') return;
    const availableModelCount = await getAvailableModelCount(ctx);
    if (availableModelCount > 0) return;
    if (OUTFITTER_PROVIDER_PROMPT_MODE === 'hint' || !(await confirmModelProviderConnection(ctx))) {
      ctx.ui.notify(OUTFITTER_PROVIDER_HINT, 'warning');
      return;
    }
    loginSubmitted = await submitSlashCommand(ctx, '/login');
  };

  pi.on('session_start', async (event, ctx) => {
    if (ctx.mode !== 'tui') return;
    setRuntimeHeader(ctx);
    if (event.reason === 'startup') await openLoginIfNoModels(ctx);
  });
}

const setRuntimeHeader = (ctx) => {
  ctx.ui.setHeader((_tui, theme) => {
    let cachedWidth;
    let cachedLines;
    return {
      render: (width) => {
        const maxWidth = typeof width === 'number' && width > 0 ? width : 120;
        if (cachedLines === undefined || cachedWidth !== maxWidth) {
          const profile =
            typeof OUTFITTER_ACTIVE_PROFILE === 'object' && OUTFITTER_ACTIVE_PROFILE !== null
              ? (OUTFITTER_ACTIVE_PROFILE.label ?? OUTFITTER_ACTIVE_PROFILE.id)
              : undefined;
          const line = theme.bold(theme.fg('accent', 'Outfitter')) + (profile ? theme.fg('dim', ` · ${profile}`) : '');
          cachedLines = [visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line];
          cachedWidth = maxWidth;
        }
        return cachedLines;
      },
      invalidate: () => {
        cachedWidth = undefined;
        cachedLines = undefined;
      },
    };
  });
};

// Renders a described-option picker identical to the setup walkthrough's, so the runtime sign-in
// prompt matches the rest of the Outfitter UI. `options.footer` overrides the key legend; by
// default a single-item list omits "↑↓ navigate" because the arrow keys do nothing there.
const selectDescribedOption = (ctx, titleLines, items, initialValue, options = {}) =>
  ctx.ui.custom((tui, theme, _keybindings, done) => {
    let selectedIndex = Math.max(
      0,
      items.findIndex((item) => item.value === initialValue),
    );
    const labelWidth = Math.max(...items.map((item) => item.label.length));
    let cachedWidth;
    let cachedLines;

    const finish = (value) => done(value);
    const refresh = () => {
      cachedWidth = undefined;
      cachedLines = undefined;
      tui.requestRender?.();
    };
    const move = (delta) => {
      selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + delta));
      refresh();
    };
    const render = (width) => {
      const maxWidth = typeof width === 'number' && width > 0 ? width : 120;
      if (cachedLines && cachedWidth === maxWidth) return cachedLines;
      const lines = [];
      const add = (line) => lines.push(visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line);
      const addWrapped = (line, widthForWrap = maxWidth, prefix = '') => {
        for (const wrappedLine of wrapTextWithAnsi(line, Math.max(1, widthForWrap))) add(prefix + wrappedLine);
      };
      const renderSelectedItem = (prefix, label, description) => {
        const baseLine = prefix + label;
        if (!description) {
          add(baseLine);
          return;
        }
        const inlineDescriptionWidth = maxWidth - visibleWidth(baseLine) - 2;
        const descriptionText = theme.fg('muted', description);
        if (inlineDescriptionWidth >= 30) {
          const [firstLine = '', ...remainingLines] = wrapTextWithAnsi(descriptionText, inlineDescriptionWidth);
          add(baseLine + '  ' + firstLine);
          const continuationPrefix = ' '.repeat(Math.min(maxWidth, visibleWidth(baseLine) + 2));
          for (const line of remainingLines) add(continuationPrefix + line);
          return;
        }
        add(baseLine);
        addWrapped(descriptionText, maxWidth - 2, '  ');
      };

      add(theme.fg('accent', '─'.repeat(maxWidth)));
      titleLines.forEach((line, index) =>
        addWrapped(index === 0 ? theme.fg('text', ' ' + line) : theme.fg('dim', ' ' + line)),
      );
      lines.push('');
      items.forEach((item, index) => {
        const selected = index === selectedIndex;
        const prefix = selected ? theme.fg('accent', '→ ') : '  ';
        const paddedLabel = item.label.padEnd(labelWidth);
        const label = selected ? theme.fg('accent', paddedLabel) : paddedLabel;
        renderSelectedItem(prefix, label, selected ? item.description : undefined);
      });
      lines.push('');
      add(theme.fg('dim', options.footer ?? pickerFooter(items.length)));
      add(theme.fg('accent', '─'.repeat(maxWidth)));
      cachedWidth = maxWidth;
      cachedLines = lines;
      return lines;
    };

    return {
      outfitterOptions: items.map((item) => item.label),
      render,
      invalidate: refresh,
      handleInput: (data) => {
        if (matchesKey(data, Key.up)) move(-1);
        else if (matchesKey(data, Key.down)) move(1);
        else if (matchesKey(data, Key.enter)) finish(items[selectedIndex]?.value);
        else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) finish(undefined);
      },
    };
  });

const pickerFooter = (itemCount) => (itemCount > 1 ? '↑↓ navigate  ' : '') + 'enter select  escape/ctrl+c cancel';
