export interface Task {
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
  createdAt: string;
}

export type AuditDecision = 'allowed' | 'denied';

export interface AuditEntry {
  ts: string;
  decision: AuditDecision;
  reason?: string;
  callerService: string | null;
  userId: string | null;
  userEmail?: string | null;
  runId?: string | null;
  tool: string | null;
  method: string;
  route: string;
  entityId?: string;
  status?: number;
}

/** Identity extracted from verified headers; attached to the request by the compliance guard. */
export interface CallerIdentity {
  callerService: string;
  userId: string;
  userEmail?: string;
  agentRunId?: string;
  toolName: string;
}
