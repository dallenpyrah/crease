import { Schema } from 'effect';

export const SourceSpan = Schema.Struct({
  file: Schema.String,
  view: Schema.String,
  line: Schema.optionalKey(Schema.Number),
  column: Schema.optionalKey(Schema.Number),
  endLine: Schema.optionalKey(Schema.Number),
  endColumn: Schema.optionalKey(Schema.Number),
  revision: Schema.optionalKey(Schema.String),
});
export type SourceSpan = typeof SourceSpan.Type;

const SourceStatus = Schema.Literals(['current', 'stale', 'unavailable']);

const SourceDefinition = Schema.Struct({
  ...SourceSpan.fields,
  snippet: Schema.optionalKey(Schema.String),
  snippetTruncated: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(SourceStatus),
});

const SourceStyle = Schema.Struct({
  expression: Schema.String,
  use: SourceSpan,
  definition: Schema.optionalKey(SourceDefinition),
  reason: Schema.optionalKey(Schema.String),
});

export const SourceEvidence = Schema.Struct({
  ...SourceSpan.fields,
  snippet: Schema.optionalKey(Schema.String),
  snippetTruncated: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(SourceStatus),
  styles: Schema.optionalKey(Schema.Array(SourceStyle)),
});
export type SourceEvidence = typeof SourceEvidence.Type;
