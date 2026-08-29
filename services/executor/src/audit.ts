import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from './types.js';

/**
 * Append-only audit log: every request through the compliance middleware —
 * allowed or denied — lands here with who (user), which run (x-agent-run-id),
 * and what (tool + route + entity). Kept in memory for the /audit endpoint and
 * mirrored to a JSONL file when a data dir is configured.
 */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private filePath: string | null = null;

  constructor(dataDir?: string | null) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.filePath = join(dataDir, 'audit.log.jsonl');
    }
  }

  append(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.filePath) {
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
  }

  query(filter: { runId?: string; userId?: string } = {}): AuditEntry[] {
    return this.entries.filter(
      (e) =>
        (filter.runId === undefined || e.runId === filter.runId) &&
        (filter.userId === undefined || e.userId === filter.userId),
    );
  }
}
