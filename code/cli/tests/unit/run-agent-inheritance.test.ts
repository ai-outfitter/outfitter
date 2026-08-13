// Tests inherited prompt ordering and native Pi configuration projection through the run boundary.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-inheritance-'));
  roots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const tree = (): { readonly home: string; readonly project: string } => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'SYSTEM');
  write(join(project, '.agents', 'agents.md'), 'SHARED');
  return { home: join(root, 'home'), project };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run inherited agent', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('launches prompt fragments in exact inherited composition order with passthrough last', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'prompts', 'base.md'), 'BASE APPEND');
    write(join(project, '.agents', 'prompts', 'child.md'), 'CHILD APPEND');
    write(
      join(project, '.agents', 'agents', 'base', 'agent.md'),
      '---\nname: base\nappend_system_prompt:\n  - file: prompts/base.md\n---\n\nBASE BODY\n',
    );
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\ninherits: base\nappend_system_prompt:\n  - file: prompts/child.md\n---\n\nCHILD BODY\n',
    );

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        const appendPaths = plan.args
          .map((arg, index) => (arg === '--append-system-prompt' ? plan.args[index + 1] : undefined))
          .filter((path): path is string => path !== undefined);
        expect(appendPaths.map((path) => readFileSync(path, 'utf8'))).toEqual([
          'SHARED',
          'BASE APPEND',
          'CHILD APPEND',
          'BASE BODY\n',
          'CHILD BODY\n',
        ]);
        expect(plan.args.at(-1)).toBe('--print');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3, OFTR-006.5.6, OFTR-006.5.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  //
  // The requirement — deterministic composition order — has not changed. The projection it asserts
  // against has. This previously expected a repeated `--append-system-prompt` naming each fragment
  // by path, which Claude cannot honor: that flag takes a prompt *string*, so a path arrives as
  // literal text, and repeats overwrite instead of accumulating. Order was being verified against a
  // launch that discarded every fragment. OFTR-006.5.6 and .7 were added for exactly this, and the
  // composition order is now observable as the order within the single concatenated file.
  it('projects exact inherited prompt order through the Claude adapter', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'prompts', 'base.md'), 'BASE APPEND');
    write(
      join(project, '.agents', 'agents', 'base', 'agent.md'),
      '---\nname: base\nappend_system_prompt:\n  file: prompts/base.md\n---\n\nBASE BODY\n',
    );
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\ninherits: base\n---\n\nCHILD BODY\n',
    );

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        const composedPaths = plan.args
          .map((arg, index) => (arg === '--append-system-prompt-file' ? plan.args[index + 1] : undefined))
          .filter((path): path is string => path !== undefined);
        // Exactly one, because a second occurrence would silently discard the first.
        expect(composedPaths).toHaveLength(1);
        expect(plan.args).not.toContain('--append-system-prompt');
        // Blank-line separated, so a fragment ending mid-sentence cannot merge into the next.
        expect(readFileSync(composedPaths[0], 'utf8')).toBe(
          ['SHARED', 'BASE APPEND', 'BASE BODY', 'CHILD BODY'].map((fragment) => `${fragment}\n`).join('\n'),
        );
        return Promise.resolve(0);
      },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.9, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes inherited delegate identity and loadout controls', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki.\n');
    write(
      join(project, '.agents', 'agents', 'base-reviewer', 'agent.md'),
      '---\nname: base-reviewer\nmodel: inherited-model\nskills: [wiki]\nextensions: [review-ext]\ntools:\n  allow: [read, bash]\n  deny: [bash]\n---\n\nBASE REVIEW BODY\n',
    );
    write(
      join(project, '.agents', 'agents', 'reviewer', 'agent.md'),
      '---\nname: reviewer\ninherits: base-reviewer\nthinking: high\n---\n\nCHILD REVIEW BODY\n',
    );
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nsubagents: [reviewer]\n---\n\nLead.\n',
    );

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'lead',
      harness: 'pi',
      launcher: (plan) => {
        const delegate = readFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'agents', 'reviewer.md'), 'utf8');
        expect(delegate).toContain('model: "inherited-model"');
        expect(delegate).toContain('thinking: "high"');
        expect(delegate).toContain('tools: "read"');
        expect(delegate).toContain('skills: "wiki"');
        expect(delegate).toContain('extensions: "review-ext"');
        expect(delegate).toContain('BASE REVIEW BODY');
        expect(delegate).toContain('CHILD REVIEW BODY');
        return Promise.resolve(0);
      },
    });
  });

  it('fails before launch when a delegate inheritance graph is invalid', async () => {
    const { home, project } = tree();
    write(
      join(project, '.agents', 'agents', 'reviewer', 'agent.md'),
      '---\nname: reviewer\ninherits: missing-base\n---\n\nReview.\n',
    );
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nsubagents: [reviewer]\n---\n\nLead.\n',
    );
    let launched = false;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'lead',
      harness: 'pi',
      strict: true,
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(launched).toBe(false);
    expect(result.messages.join(' ')).toContain("Subagent 'reviewer' is invalid");
    expect(result.messages.join(' ')).toContain('reviewer -> missing-base');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('enters inherited composition through the public Commander run path', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'agents', 'base', 'agent.md'), '---\nname: base\n---\n\nBASE BODY\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\ninherits: base\n---\n\nCHILD BODY\n',
    );
    const program = new Command();
    let inheritedBodies: readonly string[] = [];
    createRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: () => undefined,
      launcher: (plan) => {
        inheritedBodies = plan.args
          .map((arg, index) => (arg === '--append-system-prompt' ? plan.args[index + 1] : undefined))
          .filter((path): path is string => path !== undefined)
          .map((path) => readFileSync(path, 'utf8'));
        return Promise.resolve(0);
      },
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'run', 'engineer', '--harness', 'pi']);

    expect(inheritedBodies).toEqual(['SHARED', 'BASE BODY\n', 'CHILD BODY\n']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails before Claude launch when prompt_template is selected under --strict', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'prompts', 'template.md'), 'Template {{input}}');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nprompt_template:\n  file: prompts/template.md\n---\n\nBody.\n',
    );
    let launched = false;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      strict: true,
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(launched).toBe(false);
    expect(result.messages.join(' ')).toContain("cannot project loadout element 'prompt_template'");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.10, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('overlays inherited Pi configuration parent-first with the child authoritative', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'agents', 'base', 'agent.md'), '---\nname: base\n---\n\nBase.\n');
    write(join(project, '.agents', 'agents', 'base', 'pi', 'settings.json'), '{"owner":"base"}');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\ninherits: base\n---\n\nChild.\n',
    );
    write(join(project, '.agents', 'agents', 'engineer', 'pi', 'settings.json'), '{"owner":"child"}');

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher: (plan) => {
        expect(JSON.parse(readFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8'))).toEqual({
          owner: 'child',
          quietStartup: true,
        });
        return Promise.resolve(0);
      },
    });
  });
});
