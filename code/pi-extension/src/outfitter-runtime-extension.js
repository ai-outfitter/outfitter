import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

const OUTFITTER_ACTIVE_PROFILE = '__OUTFITTER_ACTIVE_PROFILE__';
// Durable compiled-profile registry written by `outfitter sync` into the persistent Pi agent home.
// The CLI stamps the resolved path at launch; the extension reads it on demand so an in-session
// `/outfitter profile <slug>` switch consumes the compiled composition instead of recomposing one.
const OUTFITTER_PROFILES_REGISTRY = '__OUTFITTER_PROFILES_REGISTRY__';
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
// connect a provider inside the setup walkthrough instead (OFTR-010.7), so this prompt does not
// repeat right after setup. The CLI stamps profile metadata into a per-run copy before loading it
// via --extension.
//
// In-session profile switching (issue #387): `/outfitter profile <slug>` selects one compiled
// composition from the registry for the NEXT turn of the same process and session. The switch
// replaces — never appends to — the per-turn system prompt through `before_agent_start`, applies
// the destination profile's tool allowlist, thinking level, and model, and appends an auditable
// profile-change entry. A failed activation (unknown slug, missing model) leaves the prior active
// profile and every selector untouched. This is posture switching inside one trusted process: it
// does not restart pi, create a session, or change operating-system identity, and it is not a
// security boundary.
export default function outfitterRuntime(pi) {
  let loginSubmitted = false;
  // The launch-time profile from the CLI stamp; `switched` marks any in-session change so
  // `before_agent_start` knows when to start replacing the system prompt.
  let activeProfile =
    typeof OUTFITTER_ACTIVE_PROFILE === 'object' && OUTFITTER_ACTIVE_PROFILE !== null
      ? { slug: OUTFITTER_ACTIVE_PROFILE.id, label: OUTFITTER_ACTIVE_PROFILE.label, switched: false }
      : undefined;

  const readProfilesRegistry = async () => {
    if (typeof OUTFITTER_PROFILES_REGISTRY !== 'string' || OUTFITTER_PROFILES_REGISTRY.length === 0) return undefined;
    try {
      const fs = await import('node:fs');
      const parsed = JSON.parse(fs.readFileSync(OUTFITTER_PROFILES_REGISTRY, 'utf8'));
      return Array.isArray(parsed?.profiles) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const findCompiledProfile = async (slug) => {
    const registry = await readProfilesRegistry();
    if (registry === undefined) return { error: "No compiled profile registry was found. Run 'outfitter sync' first." };
    const profile = registry.profiles.find((candidate) => candidate?.agent === slug);
    if (profile === undefined) {
      const available = registry.profiles.map((candidate) => candidate.agent).join(', ');
      return { error: "No compiled profile '" + slug + "'. Available: " + (available || 'none') + '.' };
    }
    return { profile };
  };

  // Resolves the model to switch to, or an error string. Validation happens before any selector is
  // touched so a failed activation leaves the prior profile and selectors unchanged.
  const resolveModel = (ctx, profile) => {
    if (typeof profile?.model !== 'string' || profile.model.length === 0) return { model: undefined };
    let provider;
    let id = profile.model;
    if (profile.modelTarget && typeof profile.modelTarget.providerId === 'string') {
      provider = profile.modelTarget.providerId;
      id = profile.modelTarget.modelId;
    } else {
      const separator = profile.model.indexOf('/');
      if (separator > 0 && separator < profile.model.length - 1) {
        provider = profile.model.slice(0, separator);
        id = profile.model.slice(separator + 1);
      }
    }
    const registry = ctx.modelRegistry;
    const find = registry && typeof registry.find === 'function' ? registry.find : undefined;
    if (find === undefined) {
      return { error: "Pi exposes no model registry in this session; cannot switch to model '" + profile.model + "'." };
    }
    const found = find.call(registry, provider, id);
    if (found === undefined) {
      return { error: "Model '" + profile.model + "' is not available in this session; profile unchanged." };
    }
    return { model: found };
  };

  const renderProfileSystemPrompt = (profile) => {
    const parts = [];
    if (typeof profile.systemPrompt === 'string' && profile.systemPrompt.length > 0) parts.push(profile.systemPrompt);
    const skills = Array.isArray(profile.skills) ? profile.skills : [];
    if (skills.length > 0) {
      const lines = skills.map((skill) => {
        const name =
          skill && typeof skill.name === 'string' && skill.name.length > 0 ? skill.name : String(skill?.slug ?? '');
        const description = skill && typeof skill.description === 'string' ? skill.description : '';
        return '- ' + name + (description.length > 0 ? ': ' + description : '');
      });
      parts.push('## Skills\n' + lines.join('\n'));
    }
    return parts.join('\n\n');
  };

  const applyTools = (profile) => {
    if (!Array.isArray(profile.toolAllowlist)) return undefined;
    const available = new Set((pi.getAllTools?.() ?? []).map((tool) => tool?.name).filter(Boolean));
    const next = profile.toolAllowlist.filter((tool) => available.has(tool));
    const missing = profile.toolAllowlist.filter((tool) => !available.has(tool));
    pi.setActiveTools(next);
    return missing;
  };

  // Switches the active composition for the next turn. Every selector is validated first, applied
  // with best-effort rollback, and only then committed: a failed activation must leave the prior
  // active profile and all selectors unchanged.
  const switchProfile = async (ctx, slug) => {
    const outcome = await findCompiledProfile(slug);
    if (outcome.error !== undefined) {
      ctx.ui.notify(outcome.error, 'error');
      return;
    }
    const profile = outcome.profile;
    const modelOutcome = resolveModel(ctx, profile);
    if (modelOutcome.error !== undefined) {
      ctx.ui.notify(modelOutcome.error, 'error');
      return;
    }

    const previousTools = pi.getActiveTools?.();
    const previousThinking = pi.getThinkingLevel?.();
    try {
      const missingTools = applyTools(profile);
      if (typeof profile.thinking === 'string' && profile.thinking.length > 0) pi.setThinkingLevel(profile.thinking);
      if (modelOutcome.model !== undefined) {
        const switched = await pi.setModel(modelOutcome.model);
        if (switched === false) throw new Error("No API key for model '" + profile.model + "'.");
      }
      const previous = activeProfile;
      activeProfile = {
        slug: profile.agent,
        label: typeof profile.label === 'string' && profile.label.length > 0 ? profile.label : profile.agent,
        fingerprint: profile.fingerprint,
        systemPrompt: profile.systemPrompt,
        skills: profile.skills,
        switched: true,
      };
      renderHeader(ctx);
      try {
        pi.appendEntry('outfitter-profile-change', {
          from: previous?.slug,
          to: profile.agent,
          fromFingerprint: previous?.fingerprint,
          toFingerprint: profile.fingerprint,
          boundary: 'next-turn',
        });
      } catch {
        // The audit entry is best-effort; the switch itself already succeeded.
      }
      const suffix =
        missingTools !== undefined && missingTools.length > 0
          ? ' (tools not available here: ' + missingTools.join(', ') + ')'
          : '';
      ctx.ui.notify('Outfitter profile: ' + activeProfile.slug + suffix + ' — applies from your next message.', 'info');
    } catch (error) {
      if (previousTools !== undefined) {
        try {
          pi.setActiveTools(previousTools);
        } catch {
          // Rollback is best-effort; report the failure either way.
        }
      }
      if (previousThinking !== undefined) {
        try {
          pi.setThinkingLevel(previousThinking);
        } catch {
          // Rollback is best-effort; report the failure either way.
        }
      }
      ctx.ui.notify(
        "Outfitter profile switch to '" +
          slug +
          "' failed: " +
          (error?.message ?? String(error)) +
          ' The previous profile stays active.',
        'error',
      );
    }
  };

  const handleCommand = async (args, ctx) => {
    if (ctx.mode !== 'tui') return;
    const parts = String(args ?? '')
      .trim()
      .split(/\s+/u)
      .filter((part) => part.length > 0);
    if (parts[0] === 'profile') {
      if (parts.length < 2) {
        const registry = await readProfilesRegistry();
        const names = registry === undefined ? [] : registry.profiles.map((profile) => profile.agent);
        const current = activeProfile === undefined ? 'none' : activeProfile.slug;
        ctx.ui.notify(
          'Active Outfitter profile: ' +
            current +
            '. Compiled profiles: ' +
            (names.join(', ') || 'none') +
            ". Switch with '/outfitter profile <slug>'.",
          'info',
        );
        return;
      }
      await switchProfile(ctx, parts[1]);
      return;
    }
    ctx.ui.notify('Usage: /outfitter profile <slug> — switch the compiled profile for the next turn.', 'info');
  };

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

  pi.registerCommand('outfitter', {
    description: 'Show or switch the active compiled Outfitter profile',
    handler: handleCommand,
  });

  // Replaces — never appends to — the system prompt once a profile switch happened in-session, so
  // the next turn runs exactly the destination composition. Without a switch, pi's native
  // launch-time prompt stays untouched.
  pi.on('before_agent_start', async () => {
    if (!activeProfile?.switched) return undefined;
    return { systemPrompt: renderProfileSystemPrompt(activeProfile) };
  });

  pi.on('session_start', async (event, ctx) => {
    if (ctx.mode !== 'tui') return;
    renderHeader(ctx);
    if (event.reason === 'startup') await openLoginIfNoModels(ctx);
  });

  // The header reads the mutable active profile at render time, so an in-session switch is visible
  // without restarting; re-registering a fresh factory drops the width cache.
  const renderHeader = (ctx) => {
    ctx.ui.setHeader((_tui, theme) => {
      let cachedWidth;
      let cachedLines;
      return {
        render: (width) => {
          const maxWidth = typeof width === 'number' && width > 0 ? width : 120;
          if (cachedLines === undefined || cachedWidth !== maxWidth) {
            const label = activeProfile?.label ?? activeProfile?.slug;
            const line = theme.bold(theme.fg('accent', 'Outfitter')) + (label ? theme.fg('dim', ` · ${label}`) : '');
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
}

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
          for (const line of remainingLines) add(continuationPrefix + ' ' + line);
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
