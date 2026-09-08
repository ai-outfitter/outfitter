import { stageMcp } from './outfitter-mcp.js';

const thinkingLevels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export function installProfileController(pi, profiles, initialId, updateHeader) {
  let active;
  let activeMcp;
  let baselineModel;
  let baselineThinking;
  let baselineTools;
  let activeToolNames;
  let boundary = 0;
  let activating;
  let queue = Promise.resolve();
  const registered = new Map();
  const legacyMcpTools = () =>
    new Set(
      pi
        .getAllTools()
        .filter(
          (tool) =>
            !registered.has(tool.name) &&
            (/^mcp(?:[_-]|$)/i.test(tool.name) || /(?:^|[/@._-])mcp(?:[/._-]|$)/i.test(tool.sourceInfo?.path ?? '')),
        )
        .map((tool) => tool.name),
    );
  const initial = profiles.find((profile) => profile.id === initialId);
  if (!initial) throw new Error(`Compiled profile '${initialId}' is absent from the registry.`);

  const activate = async (profile, ctx) => {
    if (profile.envelope !== initial.envelope) {
      throw new Error(
        'This profile changes process-scoped extensions, plugins, native overlays, delegates, prompt templates or model registry; launch it in a new Pi process.',
      );
    }
    const thinking = profile.thinking ?? baselineThinking;
    if (!thinkingLevels.has(thinking)) throw new Error(`Unsupported thinking level '${thinking}'.`);
    let model = baselineModel ?? ctx.model;
    if (profile.model !== undefined) {
      const models = await ctx.modelRegistry.getAvailable();
      const matches = models.filter((candidate) =>
        profile.model.includes('/')
          ? `${candidate.provider}/${candidate.id}` === profile.model
          : candidate.id === profile.model,
      );
      if (matches.length !== 1) throw new Error(`Profile model '${profile.model}' is unavailable or ambiguous.`);
      model = matches[0];
    }
    if (!model) throw new Error('Connect a model provider before activating a compiled profile.');
    const selectedServers = Object.fromEntries(
      (profile.mcp ?? Object.keys(profile.mcpServers)).map((name) => {
        if (!Object.hasOwn(profile.mcpServers, name))
          throw new Error(`MCP server '${name}' is missing from this profile.`);
        return [name, profile.mcpServers[name]];
      }),
    );
    const staged = await stageMcp(selectedServers, ctx.cwd);
    const oldTools = pi.getActiveTools();
    const oldModel = ctx.model;
    const oldThinking = pi.getThinkingLevel();
    const previousDefinitions = new Map(registered);
    const stagedNames = new Set(staged.tools.map((tool) => tool.name));
    const allTools = pi.getAllTools().map((tool) => tool.name);
    const legacyMcp = legacyMcpTools();
    const candidates = profile.tools?.allow ?? [...baselineTools, ...stagedNames];
    const denied = new Set(profile.tools?.deny ?? []);
    const selected = [...new Set(candidates)].filter((name) => !denied.has(name));
    try {
      for (const name of selected) {
        if (legacyMcp.has(name))
          throw new Error(`Legacy MCP tool '${name}' cannot bypass the compiled MCP controller.`);
        if (!allTools.includes(name) && !stagedNames.has(name))
          throw new Error(`Profile tool '${name}' is unavailable.`);
        if (registered.has(name) && !stagedNames.has(name))
          throw new Error(`MCP tool '${name}' is not selected by this profile.`);
      }
      for (const tool of staged.tools) {
        if (allTools.includes(tool.name) && !registered.has(tool.name)) {
          throw new Error(`MCP tool '${tool.name}' conflicts with another extension.`);
        }
      }
      if (!(await pi.setModel(model))) throw new Error('Pi could not activate the selected model.');
      for (const tool of staged.tools) {
        const definition = {
          ...tool,
          execute: (...args) => {
            const selectedTool = activeMcp?.tools.find((entry) => entry.name === tool.name);
            if (!selectedTool || !pi.getActiveTools().includes(tool.name)) {
              throw new Error('This MCP tool is not active in the selected profile.');
            }
            return selectedTool.execute(...args);
          },
        };
        pi.registerTool(definition);
        registered.set(tool.name, definition);
      }
      pi.setThinkingLevel(thinking);
      if (pi.getThinkingLevel() !== thinking)
        throw new Error(`Selected model does not support thinking level '${thinking}'.`);
      pi.setActiveTools(selected);
      if (selected.some((name) => !pi.getActiveTools().includes(name))) {
        throw new Error('Pi launch-time tool restrictions prevent this profile from activating.');
      }
    } catch (error) {
      staged.close();
      for (const [name, definition] of previousDefinitions) {
        pi.registerTool(definition);
        registered.set(name, definition);
      }
      if (oldModel) await pi.setModel(oldModel);
      pi.setThinkingLevel(oldThinking);
      pi.setActiveTools(oldTools);
      throw error;
    }
    const previous = active;
    const previousMcp = activeMcp;
    active = profile;
    activeToolNames = selected;
    activeMcp = staged;
    previousMcp?.close();
    const audit = {
      oldProfile: previous?.id ?? null,
      newProfile: profile.id,
      oldFingerprint: previous?.fingerprint ?? null,
      newFingerprint: profile.fingerprint,
      turnBoundary: boundary,
      sessionLeaf: ctx.sessionManager.getLeafId(),
    };
    pi.appendEntry('outfitter-profile-switch', audit);
    pi.sendMessage({
      customType: 'outfitter-profile-switch',
      content: `Outfitter profile ${audit.oldProfile ?? '(launch)'} [${audit.oldFingerprint ?? '-'}] → ${profile.id} [${profile.fingerprint}] at turn boundary ${boundary}.`,
      display: true,
      details: audit,
    });
    updateHeader(ctx, profile);
  };

  pi.on('session_start', async (_event, ctx) => {
    baselineModel ??= ctx.model;
    baselineThinking ??= pi.getThinkingLevel();
    const legacyMcp = legacyMcpTools();
    baselineTools ??= pi.getActiveTools().filter((name) => !registered.has(name) && !legacyMcp.has(name));
    if (legacyMcp.size > 0) {
      ctx.ui.notify(
        'Legacy MCP extension tools are disabled. Remove their extension to avoid duplicate background servers.',
        'warning',
      );
    }
    activating = activate(active ?? initial, ctx);
    try {
      await activating;
    } finally {
      activating = undefined;
    }
  });
  pi.on('before_agent_start', async () => {
    await activating?.catch(() => {});
    if (!active) throw new Error('No compiled Outfitter profile is active.');
    pi.setActiveTools(activeToolNames);
    const skillSummary = active.skills.length
      ? '\n\nSelected skills (read the referenced SKILL.md when needed):\n' +
        active.skills.map((skill) => `- ${skill.name}: ${skill.description ?? ''}\n  ${skill.path}`).join('\n')
      : '';
    return { systemPrompt: active.prompt + skillSummary };
  });
  pi.on('input', async (_event, ctx) => {
    await activating?.catch(() => {});
    if (!active) {
      ctx.ui.notify('No compiled profile is active. Connect a provider and use /outfitter profile <slug>.', 'error');
      return { action: 'handled' };
    }
    return { action: 'continue' };
  });
  pi.on('turn_end', () => {
    boundary += 1;
  });
  pi.on('session_shutdown', () => activeMcp?.close());
  pi.registerCommand('outfitter', {
    description: 'Switch compiled profile: /outfitter profile <slug>',
    getArgumentCompletions: (prefix) =>
      profiles
        .map((profile) => ({ value: `profile ${profile.id}`, label: `profile ${profile.id}` }))
        .filter((item) => item.value.startsWith(prefix)),
    handler: async (args, ctx) => {
      const match = /^profile\s+(\S+)\s*$/.exec(args.trim());
      const profile = match && profiles.find((entry) => entry.id === match[1]);
      if (!profile) {
        ctx.ui.notify(`Usage: /outfitter profile <${profiles.map((entry) => entry.id).join('|')}>`, 'error');
        return;
      }
      const operation = queue.then(async () => {
        await ctx.waitForIdle();
        activating = activate(profile, ctx);
        try {
          await activating;
        } finally {
          activating = undefined;
        }
      });
      queue = operation.catch(() => {});
      try {
        await operation;
      } catch (error) {
        ctx.ui.notify(`Profile unchanged: ${error.message}`, 'error');
      }
    },
  });
}
