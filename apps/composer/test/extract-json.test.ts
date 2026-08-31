import { describe, expect, it } from 'vitest';
import { extractLastJsonBlock } from '../src/chat/extract-json';

describe('extractLastJsonBlock', () => {
  it('extracts a ```json fenced block', () => {
    const text = 'Here you go:\n```json\n[{"version": "v0.9"}]\n```\nDone.';
    expect(extractLastJsonBlock(text)).toBe('[{"version": "v0.9"}]');
  });

  it('extracts a bare ``` fenced block when no json fence exists', () => {
    const text = 'Result:\n```\n[1, 2, 3]\n```';
    expect(extractLastJsonBlock(text)).toBe('[1, 2, 3]');
  });

  it('takes the LAST json block when several exist', () => {
    const text = ['```json', '["first"]', '```', 'and then', '```json', '["second"]', '```'].join(
      '\n',
    );
    expect(extractLastJsonBlock(text)).toBe('["second"]');
  });

  it('prefers json-tagged fences over bare ones regardless of order', () => {
    const text = ['```json', '["json one"]', '```', '```', '["bare afterwards"]', '```'].join('\n');
    expect(extractLastJsonBlock(text)).toBe('["json one"]');
  });

  it('ignores non-json language fences unless nothing else matches', () => {
    const text = ['```ts', 'const a = 1;', '```', '```json', '[]', '```'].join('\n');
    expect(extractLastJsonBlock(text)).toBe('[]');
    expect(extractLastJsonBlock('```ts\nconst a = 1;\n```')).toBeNull();
  });

  it('ignores inline code spans', () => {
    expect(extractLastJsonBlock('use `{"a":1}` inline and ```json``` words')).toBeNull();
  });

  it('returns null cleanly with no fences or an unclosed fence', () => {
    expect(extractLastJsonBlock('no fences here')).toBeNull();
    expect(extractLastJsonBlock('```json\n["cut off mid stre')).toBeNull();
  });

  it('keeps multi-line block content verbatim', () => {
    const body = '[\n  {\n    "version": "v0.9"\n  }\n]';
    expect(extractLastJsonBlock(`intro\n\`\`\`json\n${body}\n\`\`\``)).toBe(body);
  });
});
