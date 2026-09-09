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

export const ElementTarget = Schema.Struct({
  tag: Schema.String,
  selector: Schema.String,
  role: Schema.String,
  text: Schema.String,
  classes: Schema.String,
  url: Schema.String,
  bounds: Bounds,
  styles: ElementStyles,
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

export const Annotation = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  comment: Schema.String,
  status: AnnotationStatus,
  target: ElementTarget,
  capture: Capture,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
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
