import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

// The CLI stamps these placeholders into an isolated copy before Pi loads it.
const OUTFITTER_HOME = '__OUTFITTER_HOME__';
const OUTFITTER_PROJECT = '__OUTFITTER_PROJECT__';
const OUTFITTER_SETUP_RESULT_PATH = '__OUTFITTER_SETUP_RESULT_PATH__';
const OUTFITTER_AGENT_CHOICES = '__OUTFITTER_AGENT_CHOICES__';
const OUTFITTER_CURRENT_DEFAULT = '__OUTFITTER_CURRENT_DEFAULT__';
const OUTFITTER_SETUP_SOURCE_URI = '__OUTFITTER_SETUP_SOURCE_URI__';
const OUTFITTER_AUTO_OPEN = '__OUTFITTER_AUTO_OPEN__';
// The offline placeholder provider the CLI gives this setup shell so Pi starts cleanly; it is not a
// real model provider and never counts as one.
const OUTFITTER_SETUP_PROVIDER = '__OUTFITTER_SETUP_PROVIDER__';
const OUTFITTER_ASCII_ART = [
  '▄▄▄▄▄▄▄ ▄▄▄ ▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄',
  '███ ███ ███ ███   ███   ███ ███   ███     ███     ███   ███ ▀▀▀ ███ ███',
  '███ ███ ███ ███   ███   ███▄▄     ███     ███     ███   ███▀    ███▄██▀',
  '███▄███ ███▄███   ███   ███     ▄▄███▄▄   ███     ███   ███▄███ ███ ███',
  '▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀   ▀▀▀   ▀▀▀     ▀▀▀▀▀▀▀   ▀▀▀     ▀▀▀   ▀▀▀▀▀▀▀ ▀▀▀ ▀▀▀',
].join('\n');
const OUTFITTER_ASCII_GRADIENT = ['success', 'accent', 'text', 'muted', 'dim'];
// Must match the CLI's agent-slug rule (Setup.ts `agentSlugPattern`) exactly, so any id the
// walkthrough accepts also passes `applySetupSelection`'s validation instead of crashing after setup.
const OUTFITTER_PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const OUTFITTER_PLAN_TOOLS = ['read', 'grep', 'find', 'ls'];
const OUTFITTER_DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'];
// Keep this dialog in sync with outfitter-runtime-extension.js, which shows the same prompt for
// users who already have .agents but no provider.
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
const OUTFITTER_LOGIN_POLL_MS = 150;
// Polls allowed for Pi to open its /login UI after the command is submitted (about three seconds).
const OUTFITTER_LOGIN_OPEN_POLLS = 20;
const loadPrivateCatalogOnboarding = () => import('./pi-extension/privateCatalogOnboarding.js');

export default function outfitter(pi) {
  let onboardingRunning = false;
  let mode = 'build';
  let buildModeTools;

  const updateModeStatus = (ctx) => {
    const color = mode === 'plan' ? 'warning' : 'muted';
    ctx.ui.setStatus('outfitter-mode', ctx.ui.theme.fg(color, 'mode: ' + mode));
  };

  const enterPlanMode = (ctx) => {
    if (mode !== 'plan') buildModeTools = pi.getActiveTools();
    mode = 'plan';
    const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
    const planTools = OUTFITTER_PLAN_TOOLS.filter((toolName) => availableTools.has(toolName));
    pi.setActiveTools(planTools.length > 0 ? planTools : OUTFITTER_PLAN_TOOLS);
    updateModeStatus(ctx);
    ctx.ui.notify('Outfitter mode: plan (read-only tools; Shift+Tab to switch back)', 'info');
  };

  const enterBuildMode = (ctx) => {
    mode = 'build';
    pi.setActiveTools(buildModeTools ?? OUTFITTER_DEFAULT_TOOLS);
    buildModeTools = undefined;
    updateModeStatus(ctx);
    ctx.ui.notify('Outfitter mode: build (normal tools; Shift+Tab for plan mode)', 'info');
  };

  const cycleOutfitterMode = (ctx) => (mode === 'plan' ? enterBuildMode(ctx) : enterPlanMode(ctx));

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

  const createQuestionUi = (ctx) => ({
    async selectSetupMode() {
      const options = [
        'Use the default Outfitter profile catalog',
        'Create your own profile',
        'Provide a different catalog to import',
      ];
      const selected = await ctx.ui.select('How would you like to set up Outfitter?', options);
      if (selected === undefined) return undefined;
      return options.indexOf(selected) === 1 ? 'create' : options.indexOf(selected) === 2 ? 'catalog' : 'default';
    },
    async selectInstallTarget() {
      const items = [
        {
          value: 'home',
          label: 'Home folder (~/.agents)',
          description: 'These profiles will be available anywhere you start outfitter.',
        },
        {
          value: 'project',
          label: 'Current project directory (.agents)',
          description:
            'These profiles will only be available in the current project directory and will compose the profiles of the same name in the home folder.',
        },
      ];
      return selectFromItems(ctx, ['Where should Outfitter install these settings?'], items, 'home');
    },
    async selectProfile(profiles, currentDefault) {
      const items = profiles.map((profile) => ({
        value: profile.id,
        label: formatProfileLabel(profile, currentDefault),
        description: profile.description,
      }));
      const title = [
        'Outfitter profile setup',
        '',
        "Choose the default profile from the selected catalog for future 'outfitter' launches.",
        'The current Pi process keeps the profile it started with; this setting applies on the next launch.',
      ];
      const initialProfileId =
        currentDefault ?? (profiles.some((profile) => profile.id === 'engineer') ? 'engineer' : profiles[0]?.id);
      const selectedId = await selectFromItems(ctx, title, items, initialProfileId);
      if (selectedId === undefined) return undefined;
      return profiles.find((profile) => profile.id === selectedId);
    },
    async selectCliAgent() {
      const items = [
        {
          value: 'pi',
          label: 'Pi / Outfitter (Recommended)',
          description: 'Use the coding agent bundled with Outfitter.',
        },
        {
          value: 'claude',
          label: 'Claude Code',
          description: "Use Anthropic's separately installed Claude Code CLI.",
        },
        {
          value: 'codex',
          label: 'Codex CLI',
          description:
            "Use OpenAI's separately installed Codex CLI. Projects model and MCP servers only; agent identity is not projected yet.",
        },
      ];
      return selectFromItems(ctx, ['Which CLI agent should Outfitter use by default?'], items, 'pi');
    },
    async input(message, defaultValue) {
      if (typeof ctx.ui.input === 'function') {
        return ctx.ui.input(message, defaultValue === undefined ? undefined : { defaultValue });
      }
      const suffix = defaultValue === undefined ? '' : ' [' + defaultValue + ']';
      return ctx.ui.select(message + suffix, [defaultValue ?? '']);
    },
    async confirmPrivateCatalog(repository) {
      const { confirmPrivateCatalog } = await loadPrivateCatalogOnboarding();
      return confirmPrivateCatalog(ctx, selectDescribedOption, repository);
    },
    notify: (message, type = 'info') => ctx.ui.notify(message, type),
  });

  // Real providers only: the CLI stamps a placeholder provider into this setup shell so Pi starts
  // without a login warning, and that placeholder must never satisfy the provider check.
  const countConnectedModels = async (ctx) => {
    if (ctx.modelRegistry === undefined || typeof ctx.modelRegistry.getAvailable !== 'function') return 0;
    try {
      const available = await ctx.modelRegistry.getAvailable();
      return Array.isArray(available)
        ? available.filter((model) => model?.provider !== OUTFITTER_SETUP_PROVIDER).length
        : 0;
    } catch {
      return 0;
    }
  };

  // Submits /login and resolves 'connected' once a real provider is available, or 'cancelled' when
  // the user leaves Pi's login UI without one. Pi emits no auth event and keeps the placeholder
  // model selected after a login (so `model_select` never fires here); completion is observed
  // through the model registry, which Pi refreshes right after saving credentials, and abandonment
  // through focus returning to the editor after the login UI was shown.
  const openLoginAndWait = (ctx) =>
    ctx.ui.custom(
      (tui, _theme, _keybindings, done) => {
        let editor;
        let loginUiSeen = false;
        let polls = 0;
        const poll = async () => {
          if ((await countConnectedModels(ctx)) > 0) return done('connected');
          polls += 1;
          if (tui.focusedComponent !== editor) loginUiSeen = true;
          else if (loginUiSeen || polls >= OUTFITTER_LOGIN_OPEN_POLLS) return done('cancelled');
          setTimeout(poll, OUTFITTER_LOGIN_POLL_MS);
        };
        ctx.ui.setEditorText('/login');
        setTimeout(() => {
          editor = tui.focusedComponent;
          // Without a focused editor the command cannot be submitted, so there is nothing to wait for.
          if (editor?.handleInput === undefined) return done('cancelled');
          editor.handleInput('\r');
          setTimeout(poll, OUTFITTER_LOGIN_POLL_MS);
        }, 25);
        return { render: () => [], invalidate: () => undefined };
      },
      { overlay: true, overlayOptions: { nonCapturing: true, visible: () => false } },
    );

  // Second half of the guided first run: once .agents is written, offer Pi's native /login inside
  // this same session so the relaunched profile starts with credentials in place. Escape skips and
  // the CLI prints the one-line /login hint instead of prompting again.
  const connectModelProvider = async (ctx) => {
    if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') return 'unavailable';
    if ((await countConnectedModels(ctx)) > 0) return 'available';
    const selected = await selectDescribedOption(
      ctx,
      OUTFITTER_PROVIDER_PROMPT.title,
      OUTFITTER_PROVIDER_PROMPT.items,
      'connect',
      { footer: OUTFITTER_PROVIDER_PROMPT.footer },
    );
    if (selected === 'connect' && (await openLoginAndWait(ctx)) === 'connected') return 'connected';
    return 'skipped';
  };

  // `run` relaunches the selected profile as soon as this shell exits, so no restart notice here.
  // Only the Pi harness needs a Pi model provider.
  const finish = async (ctx, selection, message) => {
    await writeSetupResult(selection);
    ctx.ui.notify(
      [
        message,
        'Pseudonymous usage analytics are on by default; turn them off with telemetry.enabled: false in ~/.agents/settings.yml.',
      ].join('\n'),
      'info',
    );
    if (selection.harness === 'pi' && (await connectModelProvider(ctx)) === 'skipped') {
      await writeSetupResult({ ...selection, providerConnection: 'skipped' });
    }
    ctx.shutdown();
  };

  const cancel = (ctx) => {
    ctx.ui.notify('Outfitter setup cancelled; no settings were changed.', 'warning');
    ctx.shutdown();
  };

  const runDefaultCatalogOnboarding = async (ctx, questionUi) => {
    if (OUTFITTER_AGENT_CHOICES.length === 0) {
      questionUi.notify(
        'No profiles were found in the default Outfitter profile catalog. Fix the catalog sync or provide a different catalog.',
        'error',
      );
      return;
    }
    const selectedProfile = await questionUi.selectProfile(OUTFITTER_AGENT_CHOICES, OUTFITTER_CURRENT_DEFAULT);
    if (selectedProfile === undefined) return cancel(ctx);
    if (!OUTFITTER_PROFILE_ID_PATTERN.test(selectedProfile.id)) {
      questionUi.notify('Selected profile id is not filesystem-safe; no settings were changed.', 'error');
      return;
    }
    const choice = await askTargetAndHarness(questionUi);
    if (choice === undefined) return cancel(ctx);
    const { target, harness } = choice;
    const settingsPath = installRoot(target) + '/.agents/settings.yml';
    await finish(
      ctx,
      { setupMode: 'default', agentId: selectedProfile.id, harness, target },
      [
        "Outfitter saved default profile '" + selectedProfile.id + "' to " + settingsPath + '.',
        'Profile choices were loaded from the default Outfitter profile catalog, not generated locally.',
      ].join('\n'),
    );
  };

  const runCreateProfileOnboarding = async (ctx, questionUi) => {
    const enteredProfileId = normalizeInputValue(await questionUi.input('Profile id', 'my_profile'));
    const profileId = enteredProfileId?.replaceAll('_', '-');
    if (!profileId || !OUTFITTER_PROFILE_ID_PATTERN.test(profileId)) {
      questionUi.notify('Profile id is not filesystem-safe; no settings were changed.', 'error');
      return;
    }
    const label = normalizeInputValue(await questionUi.input('Profile label', profileId));
    const choice = await askTargetAndHarness(questionUi);
    if (choice === undefined) return cancel(ctx);
    const { target, harness } = choice;
    const root = installRoot(target);
    const profilePath = root + '/.agents/agents/' + profileId + '/agent.md';
    const settingsPath = root + '/.agents/settings.yml';
    await finish(
      ctx,
      { setupMode: 'create', agentId: profileId, agentLabel: label, harness, target },
      [
        "Outfitter created profile '" + profileId + "' at " + profilePath + '.',
        'Outfitter saved settings to ' + settingsPath + '.',
      ].join('\n'),
    );
  };

  const runRemoteSettingsOnboarding = async (ctx, questionUi) => {
    const github = normalizeInputValue(
      await questionUi.input('GitHub catalog repo (owner/repo)', 'my_account/outfitter_config'),
    );
    const ref = normalizeInputValue(await questionUi.input('Catalog ref', 'main')) || 'main';
    const settingsPath =
      normalizeInputValue(await questionUi.input('Catalog settings path', 'settings.yml')) || 'settings.yml';
    if (!github || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(github)) {
      questionUi.notify('Catalog repo must use owner/repo syntax; no settings were changed.', 'error');
      return;
    }
    if (settingsPath.startsWith('/') || settingsPath.includes('..')) {
      questionUi.notify('Catalog settings path must stay inside the repository; no settings were changed.', 'error');
      return;
    }
    const { existsSync, readFileSync } = await import('node:fs');
    const homeSettingsPath = OUTFITTER_HOME + '/.agents/settings.yml';
    const privateCatalogOnboarding = await loadPrivateCatalogOnboarding();
    const privateCatalogsAlreadyEnabled = privateCatalogOnboarding.readPrivateProfileCatalogsEnabled(
      { existsSync, readFileSync },
      homeSettingsPath,
    );
    let privateCatalogAccepted = false;
    if (
      !privateCatalogsAlreadyEnabled &&
      (await privateCatalogOnboarding.classifyGitHubRepositoryVisibility(github)) === 'private'
    ) {
      privateCatalogAccepted = await questionUi.confirmPrivateCatalog(github);
      if (!privateCatalogAccepted) {
        questionUi.notify('Private catalog setup was cancelled; no settings were changed.', 'warning');
        return;
      }
    }
    const choice = await askTargetAndHarness(questionUi);
    if (choice === undefined) return cancel(ctx);
    const { target, harness } = choice;
    const destination = installRoot(target) + '/.agents/settings.yml';
    if (!(await confirmSettingsReplacement(ctx, questionUi, destination))) return;
    await finish(
      ctx,
      {
        setupMode: 'catalog',
        github,
        ref,
        settingsPath,
        harness,
        privateCatalogsEnabled: privateCatalogsAlreadyEnabled || privateCatalogAccepted || undefined,
        privateCatalogAccepted: privateCatalogAccepted || undefined,
        target,
      },
      privateCatalogAccepted
        ? 'Outfitter enabled private profile catalogs in ~/.agents/settings.yml and saved this catalog.'
        : [
            'Outfitter saved remote settings catalog to ' + destination + '.',
            "Run 'outfitter sync' or restart Outfitter after the catalog is reachable.",
          ].join('\n'),
    );
  };

  const runProvidedSourceOnboarding = async (ctx, questionUi, sourceUri) => {
    const choice = await askTargetAndHarness(questionUi);
    if (choice === undefined) return cancel(ctx);
    const { target, harness } = choice;
    const destination = installRoot(target) + '/.agents/settings.yml';
    if (!(await confirmSettingsReplacement(ctx, questionUi, destination))) return;
    await finish(
      ctx,
      { setupMode: 'source', sourceUri, harness, target },
      [
        'Outfitter saved setup source to ' + destination + '.',
        "Run 'outfitter sync' or restart Outfitter after the source is reachable.",
      ].join('\n'),
    );
  };

  const runOutfitterOnboarding = async (ctx) => {
    if (!ctx.hasUI || onboardingRunning) return;
    onboardingRunning = true;
    try {
      const questionUi = createQuestionUi(ctx);
      if (OUTFITTER_SETUP_SOURCE_URI !== undefined) {
        return await runProvidedSourceOnboarding(ctx, questionUi, OUTFITTER_SETUP_SOURCE_URI);
      }
      const setupMode = await questionUi.selectSetupMode();
      if (setupMode === undefined) return cancel(ctx);
      if (setupMode === 'catalog') return await runRemoteSettingsOnboarding(ctx, questionUi);
      if (setupMode === 'create') return await runCreateProfileOnboarding(ctx, questionUi);
      return await runDefaultCatalogOnboarding(ctx, questionUi);
    } finally {
      onboardingRunning = false;
    }
  };

  pi.registerCommand('outfitter', {
    description: 'Configure Outfitter profile onboarding',
    handler: async (_args, ctx) => runOutfitterOnboarding(ctx),
  });

  pi.registerCommand('mode', {
    description: 'Toggle Outfitter build/plan mode',
    handler: async (_args, ctx) => {
      if (ctx.mode === 'tui') cycleOutfitterMode(ctx);
    },
  });

  pi.on('project_trust', async (event) => {
    if (OUTFITTER_AUTO_OPEN && event.cwd === OUTFITTER_PROJECT) return { trusted: 'yes', remember: true };
    return { trusted: 'undecided' };
  });

  pi.on('session_start', async (event, ctx) => {
    if (ctx.mode !== 'tui') return;
    ctx.ui.setHeader((_tui, theme) => {
      let cachedWidth;
      let cachedLines;
      return {
        render: (width) => {
          const maxWidth = typeof width === 'number' && width > 0 ? width : 120;
          if (cachedLines === undefined || cachedWidth !== maxWidth) {
            cachedLines = createStartupHeaderLines(theme, maxWidth);
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
    updateModeStatus(ctx);
    ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, 'shift+tab')) return undefined;
      cycleOutfitterMode(ctx);
      return { consume: true };
    });
    if (event.reason === 'startup' && OUTFITTER_AUTO_OPEN) await submitSlashCommand(ctx, '/outfitter');
  });

  pi.on('tool_call', async (event) => {
    if (mode !== 'plan' || event.toolName !== 'bash') return;
    return {
      block: true,
      reason:
        'Outfitter plan mode blocks Bash commands. Press Shift+Tab to return to build mode. Command: ' +
        String(event.input?.command ?? ''),
    };
  });

  pi.on('context', async (event) => {
    const messages = event.messages.filter((message) => message.customType !== 'outfitter-mode-context');
    if (mode !== 'plan') return { messages };
    return {
      messages: [
        ...messages,
        {
          role: 'custom',
          customType: 'outfitter-mode-context',
          content:
            '[OUTFITTER PLAN MODE ACTIVE]\n' +
            'You are in read-only planning mode. Inspect files and explain the implementation plan, but do not modify files, run Bash commands, or claim changes are done. Ask before leaving planning mode.',
          display: false,
        },
      ],
    };
  });
}

const normalizeInputValue = (value) => (typeof value === 'string' ? value.trim() : undefined);

const installRoot = (target) => (target === 'project' ? OUTFITTER_PROJECT : OUTFITTER_HOME);

// Every onboarding branch ends by asking for the install target then the CLI agent, cancelling on
// either escape. Returns undefined when the user cancels so the caller can `return cancel(ctx)`.
const askTargetAndHarness = async (questionUi) => {
  const target = await questionUi.selectInstallTarget();
  if (target === undefined) return undefined;
  const harness = await questionUi.selectCliAgent();
  if (harness === undefined) return undefined;
  return { target, harness };
};

// Catalog/source setup writes a fresh settings file at `destination`, replacing whatever is there.
// Never clobber existing settings without an explicit confirmation; returns true only when the file
// is absent or the user chose to replace it, and notifies+shuts down otherwise so nothing is written.
const confirmSettingsReplacement = async (ctx, questionUi, destination) => {
  const { existsSync } = await import('node:fs');
  if (!existsSync(destination)) return true;
  const decision = await selectFromItems(
    ctx,
    ['Outfitter settings already exist at ' + destination + '.', 'Replace them with your selections?'],
    [
      { value: 'keep', label: 'Keep my current settings', description: 'Leave the existing file unchanged and exit.' },
      { value: 'replace', label: 'Replace them', description: 'Overwrite the existing file with these selections.' },
    ],
    'keep',
  );
  if (decision === 'replace') return true;
  questionUi.notify('Kept your existing Outfitter settings; no changes were made.', 'warning');
  ctx.shutdown();
  return false;
};

const writeSetupResult = async (selection) => {
  const [{ mkdirSync, renameSync, rmSync, writeFileSync }, { dirname }] = await Promise.all([
    import('node:fs'),
    import('node:path'),
  ]);
  const temporaryPath = OUTFITTER_SETUP_RESULT_PATH + '.tmp';
  mkdirSync(dirname(OUTFITTER_SETUP_RESULT_PATH), { recursive: true });
  try {
    writeFileSync(temporaryPath, JSON.stringify(selection) + '\n', { flag: 'wx' });
    renameSync(temporaryPath, OUTFITTER_SETUP_RESULT_PATH);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const createStartupHeaderLines = (theme, maxWidth) => {
  const lines = [];
  const add = (line) => lines.push(visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line);
  const addWrapped = (line) => {
    for (const wrapped of wrapTextWithAnsi(line, Math.max(1, maxWidth))) add(wrapped);
  };

  OUTFITTER_ASCII_ART.split('\n').forEach((line, index) =>
    add(theme.fg(OUTFITTER_ASCII_GRADIENT[index] ?? 'accent', line)),
  );
  lines.push('');
  add(theme.bold(theme.fg('accent', 'Outfitter')) + theme.fg('dim', ' + pi'));
  addWrapped(theme.fg('muted', '/ commands · ! bash · shift+tab mode · ctrl+shift+t thinking · ctrl+o more'));
  lines.push('');
  addWrapped(theme.fg('dim', 'Outfitter turns Pi into a configured working environment:'));
  addWrapped(theme.fg('dim', '• profiles define model, tools, prompts, skills, and extensions'));
  addWrapped(theme.fg('dim', '• settings can live in your home folder or this project'));
  addWrapped(theme.fg('dim', '• catalogs let teams share setups through GitHub'));
  return lines;
};

// Runs the described-option picker when Pi supports custom UI, otherwise falls back to a plain
// label list, then resolves whichever form's answer back to the chosen item's `value`.
const selectFromItems = async (ctx, titleLines, items, initialValue) => {
  const selected =
    typeof ctx.ui.custom === 'function'
      ? await selectDescribedOption(ctx, titleLines, items, initialValue)
      : await ctx.ui.select(
          titleLines.join('\n'),
          items.map((item) => item.label),
        );
  if (selected === undefined) return undefined;
  return items.some((item) => item.value === selected)
    ? selected
    : items.find((item) => item.label === selected)?.value;
};

// `options.footer` overrides the key legend; by default a single-item list omits "↑↓ navigate"
// because the arrow keys do nothing there.
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

const formatProfileLabel = (profile, currentDefault) => {
  const current = profile.id === currentDefault ? ' (current)' : '';
  const recommended = currentDefault === undefined && profile.id === 'engineer' ? ' (Recommended)' : '';
  const label = profile.label ? ' — ' + profile.label : '';
  return profile.id + label + current + recommended;
};

const pickerFooter = (itemCount) =>
  (itemCount > 1 ? '↑↓ navigate  ' : '') + 'enter select  escape/ctrl+c cancel';
