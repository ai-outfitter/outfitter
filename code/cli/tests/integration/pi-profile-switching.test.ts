import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';

import { attachPiRuntimeExtension } from '../../src/cli/commands/PiRuntimeLaunch.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';

interface ProviderRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
}

const serverSource = `
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [log, identity] = process.argv.slice(2);
const record = (method) => appendFileSync(log, identity + ':' + method + '\\n');
record('start');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  record(request.method);
  if (request.id === undefined) return;
  const result = request.method === 'initialize'
    ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: identity, version: '1' } }
    : request.method === 'tools/list'
      ? { tools: identity === 'broken' ? null : [{ name: 'ping', description: identity + ' tool', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: identity + ' called' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`;

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it.each(['tui', 'print'] as const)(
  'replaces real Pi %s provider requests across profile switches in one persisted session, with isolated MCP activation',
  async (mode) => {
    const root = mkdtempSync(join(process.cwd(), '.pi-switch-integration-'));
    const requests: ProviderRequest[] = [];
    const http = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const parsed = JSON.parse(body) as ProviderRequest;
        requests.push(parsed);
        const tool = parsed.tools?.find((entry) => entry.function.name.startsWith('mcp_'));
        const call = tool !== undefined && parsed.messages.at(-1)?.role !== 'tool';
        const delta = call
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call-${requests.length}`,
                  type: 'function',
                  function: { name: tool.function.name, arguments: '{}' },
                },
              ],
            }
          : { role: 'assistant', content: 'fixture response' };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: parsed.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n` +
            `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: parsed.model, choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\n` +
            'data: [DONE]\n\n',
        );
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('No fixture provider address.');
    const auth = AuthStorage.inMemory();
    const models = ModelRegistry.inMemory(auth);
    models.registerProvider('outfitter-fixture', {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: 'fixture-not-a-real-key',
      api: 'openai-completions',
      models: ['alpha', 'beta'].map((id) => ({
        id,
        name: id,
        reasoning: true,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    });
    const mcpScript = join(root, 'mcp.mjs');
    const mcpLog = join(root, 'mcp.log');
    writeFileSync(mcpScript, serverSource);
    const makePlan = (id: string): CompositionPlan => {
      const skill = join(root, `skill-${id}`);
      mkdirSync(skill);
      writeFileSync(
        join(skill, 'SKILL.md'),
        `---\nname: skill-${id}\ndescription: Selected ${id} capability\n---\n${id}`,
      );
      return {
        agent: id,
        identity: { agentBody: `ONLY-${id}-PROMPT`, label: id },
        warnings: [],
        loadout: {
          skills: [
            {
              kind: 'skill',
              slug: `skill-${id}`,
              winner: {
                kind: 'skill',
                slug: `skill-${id}`,
                path: join(skill, 'SKILL.md'),
                layer: { root, origin: 'workspace', label: 'fixture' },
              },
              shadowed: [],
            },
          ],
          delegateSkills: [],
          subagents: [],
          mcp: [id],
          mcpServers: { [id]: { command: process.execPath, args: [mcpScript, mcpLog, id] } },
          extensions: [],
          plugins: [],
          model: `outfitter-fixture/${id}`,
          thinking: id === 'alpha' ? 'low' : 'high',
          tools: {
            allow: [
              id === 'alpha' ? 'read' : 'bash',
              `mcp_${createHash('sha256')
                .update(JSON.stringify([id, 'ping']))
                .digest('hex')
                .slice(0, 48)}`,
            ],
          },
        },
      };
    };
    const alpha = makePlan('alpha');
    const beta = makePlan('beta');
    const profiles = [
      { agent: 'alpha', fingerprint: 'fingerprint-alpha', plan: alpha },
      { agent: 'beta', fingerprint: 'fingerprint-beta', plan: beta },
      {
        agent: 'defaults',
        fingerprint: 'fingerprint-defaults',
        plan: { ...alpha, agent: 'defaults', loadout: { ...alpha.loadout, model: undefined, thinking: undefined } },
      },
      {
        agent: 'missing-model',
        fingerprint: 'bad-model',
        plan: { ...beta, loadout: { ...beta.loadout, model: 'missing/model' } },
      },
      {
        agent: 'bad-mcp',
        fingerprint: 'bad-mcp',
        plan: {
          ...beta,
          loadout: {
            ...beta.loadout,
            mcp: ['broken'],
            mcpServers: { broken: { command: process.execPath, args: [mcpScript, mcpLog, 'broken'] } },
          },
        },
      },
      {
        agent: 'launch-only',
        fingerprint: 'launch-only',
        plan: { ...beta, loadout: { ...beta.loadout, extensions: ['different-extension'] } },
      },
      {
        agent: 'launch-model-registry',
        fingerprint: 'launch-model-registry',
        plan: { ...beta, models: { configured: true, document: { providers: {} } } },
      },
      {
        agent: 'launch-delegates',
        fingerprint: 'launch-delegates',
        plan: { ...beta, loadout: { ...beta.loadout, delegateSkills: alpha.loadout.skills } },
      },
    ];
    const launch = attachPiRuntimeExtension(
      { command: 'pi', args: ['--print'], env: {} },
      { rootDirectory: root, profile: { id: 'alpha' }, registry: { profiles } },
    );
    const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager: settings,
      noExtensions: true,
      additionalExtensionPaths: [launch.args[1]],
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: 'STALE-NATIVE-PROMPT',
    });
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    try {
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      const manager = SessionManager.create(root, join(root, 'sessions'));
      ({ session } = await createAgentSession({
        cwd: root,
        agentDir: root,
        model: models.find('outfitter-fixture', 'beta'),
        thinkingLevel: 'medium',
        authStorage: auth,
        modelRegistry: models,
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: manager,
      }));
      const errors: string[] = [];
      await session.bindExtensions({ mode, onError: (error) => errors.push(error.error) });
      expect(errors).toEqual([]);
      const sessionId = manager.getSessionId();
      await session.prompt('first turn');
      expect(requests[0].model).toBe('alpha');
      expect(session.thinkingLevel).toBe('low');
      expect(JSON.stringify(requests[0].messages[0])).toContain('ONLY-alpha-PROMPT');
      expect(JSON.stringify(requests[0].messages[0])).not.toContain('STALE-NATIVE');
      expect(JSON.stringify(requests[0].messages[0])).toContain('skill-alpha');
      expect(JSON.stringify(requests[0].messages[0])).not.toContain('skill-beta');
      expect(requests[0].tools!.map((tool) => tool.function.name)).toContain('read');
      expect(requests[0].tools!.map((tool) => tool.function.name)).not.toContain('bash');
      expect(readFileSync(mcpLog, 'utf8')).toContain('alpha:tools/call');
      expect(readFileSync(mcpLog, 'utf8')).not.toContain('beta:start');
      const beforeSwitch = requests.length;
      await session.prompt('/outfitter profile beta');
      await session.prompt('second turn');
      expect(requests[beforeSwitch].model).toBe('beta');
      expect(JSON.stringify(requests[beforeSwitch].messages[0])).toContain('ONLY-beta-PROMPT');
      expect(JSON.stringify(requests[beforeSwitch].messages[0])).not.toContain('ONLY-alpha-PROMPT');
      expect(JSON.stringify(requests[beforeSwitch].messages[0])).not.toContain('skill-alpha');
      expect(requests[beforeSwitch].tools!.map((tool) => tool.function.name)).toContain('bash');
      expect(requests[beforeSwitch].tools!.map((tool) => tool.function.name)).not.toContain('read');
      expect(requests[beforeSwitch].tools!.map((tool) => tool.function.name)).not.toContain(
        requests[0].tools!.find((tool) => tool.function.name.startsWith('mcp_'))!.function.name,
      );
      expect(session.thinkingLevel).toBe('high');
      expect(readFileSync(mcpLog, 'utf8')).toContain('beta:tools/call');
      const active = session.getActiveToolNames();
      for (const failed of ['missing-model', 'bad-mcp', 'launch-only', 'launch-model-registry', 'launch-delegates']) {
        await session.prompt(`/outfitter profile ${failed}`);
        expect(session.model!.id).toBe('beta');
        expect(session.getActiveToolNames()).toEqual(active);
        expect(session.thinkingLevel).toBe('high');
      }
      await session.prompt('after failed switches');
      expect(JSON.stringify(requests.at(-1)!.messages[0])).toContain('ONLY-beta-PROMPT');
      expect(manager.getSessionId()).toBe(sessionId);
      const persisted = readFileSync(manager.getSessionFile()!, 'utf8');
      expect(persisted).toContain('"oldFingerprint":"fingerprint-alpha"');
      expect(persisted).toContain('"newFingerprint":"fingerprint-beta"');
      expect(persisted).toContain('"turnBoundary":2');
      expect(persisted).not.toContain('"newFingerprint":"bad-mcp"');
      expect(readFileSync(mcpLog, 'utf8')).toContain('broken:tools/list');
      expect(readFileSync(mcpLog, 'utf8')).not.toContain('broken:tools/call');
      await session.prompt('/outfitter profile defaults');
      expect(session.model!.id).toBe('beta');
      expect(session.thinkingLevel).toBe('medium');
      expect(errors).toEqual([]);
    } finally {
      await session?.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session?.dispose();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
