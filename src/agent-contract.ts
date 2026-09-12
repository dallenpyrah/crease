import { Schema } from 'effect';

import { AnnotationArray, ElementTarget } from './domain.js';
import { FoldkitContext } from './foldkit-schema.js';

export const AGENT_COMMAND_TIMEOUT_MS = 4_000;

export const AgentSelection = Schema.Struct({
  target: ElementTarget,
  foldkit: Schema.optionalKey(FoldkitContext),
});

export const AgentSnapshot = Schema.Struct({
  version: Schema.Literal(1),
  runtimeId: Schema.String,
  projectId: Schema.String,
  page: Schema.String,
  sharedAt: Schema.Number,
  selection: Schema.NullOr(AgentSelection),
  annotations: AnnotationArray,
});
export type AgentSnapshot = typeof AgentSnapshot.Type;

const AgentReplyCommand = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('reply'),
  annotationId: Schema.String,
  comment: Schema.String,
  createdAt: Schema.Number,
});

const AgentDeleteCommand = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('delete'),
  annotationId: Schema.String,
  createdAt: Schema.Number,
});

const AgentClearCommand = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('clear'),
  annotationIds: Schema.Array(Schema.String),
  createdAt: Schema.Number,
});

export const AgentCommand = Schema.Union([
  AgentReplyCommand,
  AgentDeleteCommand,
  AgentClearCommand,
]);
export type AgentCommand = typeof AgentCommand.Type;

export const AgentSyncRequest = Schema.Struct({
  snapshot: AgentSnapshot,
  acknowledgedCommandIds: Schema.Array(Schema.String),
});
export type AgentSyncRequest = typeof AgentSyncRequest.Type;

export const AgentSyncResponse = Schema.Struct({
  commands: Schema.Array(AgentCommand),
});
export type AgentSyncResponse = typeof AgentSyncResponse.Type;

export interface AgentConnection {
  readonly share: (snapshot: AgentSnapshot) => Promise<void>;
  readonly unshare: (runtimeId: string) => Promise<void>;
  readonly sync?: (request: AgentSyncRequest) => Promise<AgentSyncResponse>;
  readonly watch?: (runtimeId: string, signal: AbortSignal) => Promise<void>;
}
