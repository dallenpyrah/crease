import { Schema } from 'effect';

import { FoldkitContext } from './foldkit-schema.js';

export const Bounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type Bounds = typeof Bounds.Type;

export const ElementStyles = Schema.Struct({
  display: Schema.String,
  position: Schema.String,
  fontFamily: Schema.String,
  fontSize: Schema.String,
  lineHeight: Schema.String,
  color: Schema.String,
  backgroundColor: Schema.String,
  margin: Schema.String,
  padding: Schema.String,
  gap: Schema.String,
});
export type ElementStyles = typeof ElementStyles.Type;

export const ElementLocation = Schema.Struct({
  pagePath: Schema.String,
  pageHeading: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(
    Schema.Struct({
      role: Schema.String,
      label: Schema.String,
      labelSource: Schema.Literals(['aria-label', 'aria-labelledby', 'heading', 'tag']),
    }),
  ),
  accessibleName: Schema.optionalKey(Schema.String),
  position: Schema.optionalKey(
    Schema.Struct({
      index: Schema.Number,
      total: Schema.Number,
      kind: Schema.Literal('rendered-sibling'),
    }),
  ),
  current: Schema.optionalKey(Schema.String),
  selected: Schema.optionalKey(Schema.Boolean),
  href: Schema.optionalKey(Schema.String),
});
export type ElementLocation = typeof ElementLocation.Type;

export const ElementTarget = Schema.Struct({
  tag: Schema.String,
  selector: Schema.String,
  role: Schema.String,
  text: Schema.String,
  classes: Schema.String,
  url: Schema.String,
  bounds: Bounds,
  styles: ElementStyles,
  reference: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(ElementLocation),
});
export type ElementTarget = typeof ElementTarget.Type;

export const Capture = Schema.Struct({
  viewportWidth: Schema.Number,
  viewportHeight: Schema.Number,
  scrollX: Schema.Number,
  scrollY: Schema.Number,
  capturedAt: Schema.Number,
});
export type Capture = typeof Capture.Type;

export const AnnotationStatus = Schema.Literals(['open', 'resolved']);
export type AnnotationStatus = typeof AnnotationStatus.Type;

export const AnnotationReply = Schema.Struct({
  id: Schema.String,
  author: Schema.Literals(['user', 'agent']),
  comment: Schema.String,
  createdAt: Schema.Number,
});
export type AnnotationReply = typeof AnnotationReply.Type;

export const Annotation = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  comment: Schema.String,
  status: AnnotationStatus,
  target: ElementTarget,
  capture: Capture,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  replies: Schema.optionalKey(Schema.Array(AnnotationReply)),
  foldkit: Schema.optionalKey(FoldkitContext),
});
export type Annotation = typeof Annotation.Type;

export const AnnotationArray = Schema.Array(Annotation);

export const redactedPageUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(unknown page)';
  }
};

export const isAnnotation = (value: unknown): value is Annotation => {
  try {
    Schema.decodeUnknownSync(Annotation)(value);
    return true;
  } catch {
    return false;
  }
};

export const makeAnnotation = (
  target: ElementTarget,
  comment: string,
  now: number,
  id: string,
): Annotation => ({
  version: 1,
  id: `cr_${id}`,
  comment: comment.trim(),
  status: 'open',
  target,
  capture: {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    capturedAt: now,
  },
  createdAt: now,
  updatedAt: now,
});
