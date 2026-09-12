import { Schema } from 'effect';

import { SourceEvidence } from './source-schema.js';

export const FoldkitSource = SourceEvidence;

export const FoldkitLayout = Schema.Struct({
  tag: Schema.String,
  source: Schema.optionalKey(FoldkitSource),
  bounds: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  display: Schema.String,
  position: Schema.String,
  padding: Schema.String,
  border: Schema.String,
  gap: Schema.String,
  overflow: Schema.String,
  scrollTop: Schema.Number,
  scrollLeft: Schema.Number,
});

export const FoldkitModelSource = Schema.Struct({
  expression: Schema.String,
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  definition: Schema.optionalKey(FoldkitSource),
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
  provenance: Schema.Literals(['explicit-registration', 'automatic-instrumentation']),
  boundary: Schema.String,
  source: FoldkitSource,
  elementSource: Schema.optionalKey(FoldkitSource),
  calls: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(['submodel', 'helper']),
        source: FoldkitSource,
      }),
    ),
  ),
  layout: Schema.optionalKey(Schema.Array(FoldkitLayout)),
  modelSource: Schema.optionalKey(FoldkitModelSource),
  instanceKey: Schema.optionalKey(Schema.String),
  availability: Schema.optionalKey(Schema.Array(Schema.String)),
  events: Schema.Array(FoldkitEvent),
  model: Schema.optionalKey(Schema.JsonObject),
  history: Schema.optionalKey(Schema.Array(FoldkitChange)),
  capturedAt: Schema.Number,
});
export type FoldkitContext = typeof FoldkitContext.Type;
