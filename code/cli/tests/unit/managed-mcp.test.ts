import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mergeManagedMcpConfig } from '../../src/projection/ManagedMcp.js';

const roots: string[] = [];
const fixture = (): { target: string; source: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-managed-mcp-'));
  roots.push(root);
  return { target: join(root, 'mcp.json'), source: join(root, 'managed.json') };
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('managed native MCP configuration', () => {
  it('adds managed servers without needing a catalog MCP selection and retains env references', () => {
    const { target, source } = fixture();
    const server = { url: '${MANAGED_URL}', headers: { Authorization: 'Bearer ${MANAGED_TOKEN}' } };
    writeFileSync(source, JSON.stringify({ mcpServers: { managed: server } }));
    writeFileSync(target, mergeManagedMcpConfig(target, source));
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ mcpServers: { managed: server } });
  });

  it('preserves native overlay fields, catalog selections and identical existing definitions', () => {
    const { target, source } = fixture();
    const managed = { url: 'https://example.test', headers: { A: 'a', B: 'b' } };
    writeFileSync(
      target,
      JSON.stringify({ nativeSetting: true, mcpServers: { native: { command: 'native-server' }, managed } }),
    );
    writeFileSync(
      source,
      JSON.stringify({ mcpServers: { managed: { headers: { B: 'b', A: 'a' }, url: 'https://example.test' } } }),
    );
    writeFileSync(target, mergeManagedMcpConfig(target, source));
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({
      nativeSetting: true,
      mcpServers: { native: { command: 'native-server' }, managed },
    });
  });

  it('refuses managed keys that conflict with the existing native projection', () => {
    const { target, source } = fixture();
    const original = JSON.stringify({ mcpServers: { managed: { command: 'keep' } } });
    writeFileSync(target, original);
    writeFileSync(source, JSON.stringify({ mcpServers: { managed: { url: 'https://different.test' } } }));
    expect(() => mergeManagedMcpConfig(target, source)).toThrow('conflicts');
    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  it('treats special server names as data rather than object prototypes', () => {
    const { target, source } = fixture();
    writeFileSync(source, '{"mcpServers":{"__proto__":{"command":"special-server"}}}');
    writeFileSync(target, mergeManagedMcpConfig(target, source));
    expect(
      Object.hasOwn((JSON.parse(readFileSync(target, 'utf8')) as { mcpServers: object }).mcpServers, '__proto__'),
    ).toBe(true);
  });

  it.each([
    'not json with a SECRET_TOKEN',
    '{"mcpServers":[]}',
    '{"mcpServers":{"invalid":{}}}',
    '{"mcpServers":{"invalid":{"command":7}}}',
    '{"mcpServers":{"invalid":{"url":"https://example.test","headers":{"Authorization":7}}}}',
  ])('rejects invalid input without exposing its values: %s', (input) => {
    const { target, source } = fixture();
    writeFileSync(source, input);
    expect(() => mergeManagedMcpConfig(target, source)).toThrow(/managed native MCP configuration/i);
    expect(() => mergeManagedMcpConfig(target, source)).not.toThrow(/SECRET_TOKEN/);
  });

  it.each(['broken JSON', 'null', '[]', '{"mcpServers":null}', '{"mcpServers":[]}'])(
    'reports malformed native baseline separately: %s',
    (native) => {
      const { target, source } = fixture();
      writeFileSync(source, '{"mcpServers":{}}');
      writeFileSync(target, native);
      expect(() => mergeManagedMcpConfig(target, source)).toThrow(/existing native MCP configuration/i);
    },
  );

  it.each([{}, { adapterSettings: { imports: ['native-import'] } }])(
    'preserves an existing native document without an mcpServers field: %j',
    (native) => {
      const { target, source } = fixture();
      writeFileSync(source, '{"mcpServers":{"managed":{"url":"https://example.test"}}}');
      writeFileSync(target, JSON.stringify(native));
      expect(JSON.parse(mergeManagedMcpConfig(target, source))).toEqual({
        ...native,
        mcpServers: { managed: { url: 'https://example.test' } },
      });
    },
  );

  it('leaves existing native fields to the native harness validator', () => {
    const { target, source } = fixture();
    writeFileSync(source, '{"mcpServers":{"managed":{"url":"https://example.test"}}}');
    writeFileSync(target, '{"mcpServers":{"existing":{"nativeFutureField":true}}}');
    expect(JSON.parse(mergeManagedMcpConfig(target, source))).toEqual({
      mcpServers: { existing: { nativeFutureField: true }, managed: { url: 'https://example.test' } },
    });
  });

  it('never adopts an identical authored server for deletion when managed input drops it', () => {
    const { target, source } = fixture();
    const server = { command: 'authored-server' };
    writeFileSync(target, JSON.stringify({ mcpServers: { authored: server } }));
    writeFileSync(source, JSON.stringify({ mcpServers: { authored: server } }));
    writeFileSync(target, mergeManagedMcpConfig(target, source));
    writeFileSync(source, JSON.stringify({ mcpServers: {} }));
    expect(JSON.parse(mergeManagedMcpConfig(target, source))).toEqual({ mcpServers: { authored: server } });
  });

  it('rejects unreadable files without forwarding filesystem or credential detail', () => {
    const { target, source } = fixture();
    expect(() => mergeManagedMcpConfig(target, source)).toThrow('Could not read managed native MCP configuration.');
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('matches the operator native MCP validation conformance cases', () => {
  const cases = JSON.parse(
    readFileSync(new URL('../fixtures/managed-mcp-conformance.json', import.meta.url), 'utf8'),
  ) as { name: string; valid: boolean; document: unknown }[];
  for (const test of cases) {
    const { target, source } = fixture();
    writeFileSync(source, JSON.stringify(test.document));
    if (test.valid) expect(() => mergeManagedMcpConfig(target, source), test.name).not.toThrow();
    else expect(() => mergeManagedMcpConfig(target, source), test.name).toThrow();
  }
});
