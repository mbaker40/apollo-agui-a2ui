/**
 * Extracts the LAST fenced JSON block from assistant prose.
 * Prefers ```json fences; falls back to bare ``` fences. Fences are
 * line-anchored, so inline `code` spans are ignored. Returns null when no
 * closed fenced block exists (e.g. a stream cut off mid-block).
 */
export function extractLastJsonBlock(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const blocks: { lang: string; content: string }[] = [];
  let open: { lang: string; buffer: string[] } | null = null;

  for (const line of lines) {
    if (open === null) {
      const match = /^\s{0,3}```([A-Za-z0-9_-]*)\s*$/.exec(line);
      if (match) {
        open = { lang: (match[1] ?? '').toLowerCase(), buffer: [] };
      }
      continue;
    }
    if (/^\s{0,3}```\s*$/.test(line)) {
      blocks.push({ lang: open.lang, content: open.buffer.join('\n') });
      open = null;
      continue;
    }
    open.buffer.push(line);
  }

  const jsonBlocks = blocks.filter((b) => b.lang === 'json');
  const candidates = jsonBlocks.length > 0 ? jsonBlocks : blocks.filter((b) => b.lang === '');
  const last = candidates.at(-1);
  return last === undefined ? null : last.content;
}
