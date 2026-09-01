import { describe, expect, it } from 'vitest';
import { USAGE_EXAMPLE_MAX_CHARS, buildSystemPrompt } from '../src/chat/system-prompt';
import { CATALOG_ID, SURFACE_ID } from '../src/lib/surface-doc';

const CATALOG = {
  title: 'Basic Catalog',
  components: { Text: { name: 'Text' }, Button: { name: 'Button' }, Card: { name: 'Card' } },
};
const USAGES = {
  Text: { usage: [{ id: 'root', component: 'Text', text: 'Example' }] },
  Button: {
    usage: [{ id: 'root', component: 'Button', child: 'label' }],
    data: { form: { ok: true } },
  },
};
const LAYOUT = '[\n  { "version": "v0.9" }\n]';

describe('buildSystemPrompt', () => {
  it('pins the §3 constants verbatim', () => {
    const prompt = buildSystemPrompt({ catalog: CATALOG, usages: USAGES, layoutJson: LAYOUT });
    expect(prompt).toContain(`"surfaceId": "${SURFACE_ID}"`);
    expect(prompt).toContain(`"catalogId": "${CATALOG_ID}"`);
    expect(prompt).toContain('"value"');
    expect(prompt).toContain('never "contents"');
    expect(prompt).toContain('FLAT list');
    expect(prompt).toContain('"id": "root"');
    expect(prompt).toContain('"v0.9"');
  });

  it('lists component names from the catalog payload', () => {
    const prompt = buildSystemPrompt({ catalog: CATALOG, usages: USAGES, layoutJson: LAYOUT });
    expect(prompt).toContain('Button, Card, Text');
  });

  it('falls back to usage keys when the catalog is missing', () => {
    const prompt = buildSystemPrompt({ catalog: null, usages: USAGES, layoutJson: LAYOUT });
    expect(prompt).toContain('Button, Text');
  });

  it('embeds usage examples and the current layout', () => {
    const prompt = buildSystemPrompt({ catalog: CATALOG, usages: USAGES, layoutJson: LAYOUT });
    expect(prompt).toContain('"component":"Button"');
    expect(prompt).toContain('"form":{"ok":true}');
    expect(prompt).toContain(LAYOUT);
  });

  it('truncates oversized usage examples', () => {
    const huge = {
      Text: { usage: [{ id: 'root', component: 'Text', text: 'x'.repeat(5000) }] },
    };
    const prompt = buildSystemPrompt({ catalog: null, usages: huge, layoutJson: LAYOUT });
    const line = prompt.split('\n').find((l) => l.startsWith('Text: '));
    expect(line).toBeDefined();
    expect(line!.length).toBeLessThanOrEqual('Text: '.length + USAGE_EXAMPLE_MAX_CHARS + 1);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('demands exactly one fenced json block with the full payload', () => {
    const prompt = buildSystemPrompt({ catalog: null, usages: null, layoutJson: LAYOUT });
    expect(prompt).toContain('EXACTLY ONE fenced');
    expect(prompt).toContain('FULL new RenderA2uiItem[]');
  });

  it('handles a completely empty handshake gracefully', () => {
    const prompt = buildSystemPrompt({ catalog: null, usages: null, layoutJson: LAYOUT });
    expect(prompt).toContain('(catalog not loaded yet)');
    expect(prompt).toContain('usages not loaded yet');
  });
});
