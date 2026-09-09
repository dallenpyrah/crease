import { Schema } from 'effect';

import { AnnotationArray, ElementTarget } from './domain';
import { FoldkitContext } from './foldkit-schema';

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

export interface AgentConnection {
  readonly share: (snapshot: AgentSnapshot) => Promise<void>;
  readonly unshare: (runtimeId: string) => Promise<void>;
}
