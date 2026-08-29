export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
}

/** Task as returned by the API: tags embedded (denormalized read for the MWE;
 * a production facade would resolve the relation with a dataloader). */
export interface Task {
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
  priority: Priority;
  tags: Tag[];
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
