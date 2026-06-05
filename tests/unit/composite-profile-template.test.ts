// Tests ApplePi-time template rendering for generated compositeProfile files.
import { describe, expect, it } from 'vitest';

import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import { renderCompositeProfileTemplates } from '../../src/compositeProfile/CompositeProfileTemplate.js';

describe('compositeProfile template rendering', () => {
  it('renders ApplePi compositeProfile templates with custom delimiters and leaves common shell conditionals alone', () => {
    const compositeProfile = createCompositeProfile('/tmp/applepi-template-test', [
      createCompositeProfileFile({
        relativePath: 'settings.yml',
        content: [
          'lint: "[[= applepi.custom_settings.build_commands.lint ]]"',
          'commands:',
          '[[% for command in applepi.custom_settings.commands %]]',
          '  - "[[= command ]]"',
          '[[% endfor %]]',
          'shell: "[[ -f package.json ]]"',
          '',
        ].join('\n'),
        sourceInputs: ['/profiles/default/profile.yml'],
      }),
    ]);

    const rendered = renderCompositeProfileTemplates({
      compositeProfile,
      settings: {
        customSettings: {
          build_commands: { lint: 'npm run lint' },
          commands: ['npm test', 'npm run build'],
        },
      },
      settingsPaths: ['/home/example/.applepi/settings.yml'],
      profile: { id: 'default', inherits: [], controls: {} },
      agentId: 'pi',
      projectDirectory: '/work/project',
    });

    expect(rendered.files[0]?.content).toContain('lint: "npm run lint"');
    expect(rendered.files[0]?.content).toContain('  - "npm test"');
    expect(rendered.files[0]?.content).toContain('  - "npm run build"');
    expect(rendered.files[0]?.content).toContain('shell: "[[ -f package.json ]]"');
    expect(rendered.files[0]?.sourceInputs).toEqual([
      '/profiles/default/profile.yml',
      '/home/example/.applepi/settings.yml',
    ]);
    expect(() =>
      renderCompositeProfileTemplates({
        compositeProfile: createCompositeProfile('/tmp/applepi-template-test', [
          createCompositeProfileFile({
            relativePath: 'bad.yml',
            content: 'missing: [[= applepi.custom_settings.missing ]]\n',
          }),
        ]),
        settings: { customSettings: {} },
        settingsPaths: [],
        profile: { id: 'default', inherits: [], controls: {} },
        agentId: 'pi',
        projectDirectory: '/work/project',
      }),
    ).toThrow("Cannot render ApplePi template in compositeProfile file 'bad.yml'");
  });

  it('renders built-in context when no custom settings are defined', () => {
    const rendered = renderCompositeProfileTemplates({
      compositeProfile: createCompositeProfile('/tmp/applepi-template-test', [
        createCompositeProfileFile({ relativePath: 'agent.txt', content: 'agent=[[= applepi.agent ]]\n' }),
      ]),
      settings: {},
      settingsPaths: [],
      profile: { id: 'default', inherits: [], controls: {} },
      agentId: 'pi',
      projectDirectory: '/work/project',
    });

    expect(rendered.files[0]?.content).toBe('agent=pi\n');
  });
});
