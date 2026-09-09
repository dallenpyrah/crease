import { Schema } from 'effect';

export const FoldkitSource = Schema.Struct({
  file: Schema.String,
  view: Schema.String,
  line: Schema.optionalKey(Schema.Number),
});

export const FoldkitEvent = Schema.Struct({
  event: Schema.String,
  message: Schema.String,
});

export const FoldkitChange = Schema.Struct({
  message: Schema.String,
  at: Schema.Number,
  before: Schema.JsonObject,
  after: Schema.JsonObject,
});
export type FoldkitChange = typeof FoldkitChange.Type;

export const FoldkitContext = Schema.Struct({
  provenance: Schema.Literal('explicit-registration'),
  boundary: Schema.String,
  source: FoldkitSource,
  events: Schema.Array(FoldkitEvent),
  model: Schema.optionalKey(Schema.JsonObject),
  history: Schema.optionalKey(Schema.Array(FoldkitChange)),
  capturedAt: Schema.Number,
});
export type FoldkitContext = typeof FoldkitContext.Type;
