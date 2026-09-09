import { Schema } from 'effect';
import { defineMessageUnion } from 'foldkit/message';

import {
  type Annotation,
  AnnotationArray,
  Annotation as AnnotationSchema,
  AnnotationStatus,
} from './domain';

export const Model = Schema.Struct({
  annotations: AnnotationArray,
  undo: Schema.Array(AnnotationArray),
  redo: Schema.Array(AnnotationArray),
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  AddedAnnotation: { annotation: AnnotationSchema },
  EditedAnnotation: {
    id: Schema.String,
    comment: Schema.String,
    updatedAt: Schema.Number,
  },
  ChangedStatus: {
    id: Schema.String,
    status: AnnotationStatus,
    updatedAt: Schema.Number,
  },
  DeletedAnnotation: { id: Schema.String },
  UndidChange: {},
  RedidChange: {},
});
export type Message = typeof Message.Type;

const HISTORY_LIMIT = 50;

type Update = Readonly<{ model: Model }>;

const unchanged = (model: Model): Update => ({ model });

const appendHistory = (
  history: ReadonlyArray<ReadonlyArray<Annotation>>,
  snapshot: ReadonlyArray<Annotation>,
): ReadonlyArray<ReadonlyArray<Annotation>> =>
  [...history, snapshot].slice(-HISTORY_LIMIT);

const mutate = (model: Model, annotations: ReadonlyArray<Annotation>): Update => ({
  model: {
    annotations,
    undo: appendHistory(model.undo, model.annotations),
    redo: [],
  },
});

export const add = (model: Model, annotation: Annotation): Update => {
  if (model.annotations.some((current) => current.id === annotation.id)) {
    return unchanged(model);
  }
  return mutate(model, [...model.annotations, annotation]);
};

export const edit = (
  model: Model,
  id: string,
  comment: string,
  updatedAt: number,
): Update => {
  const trimmedComment = comment.trim();
  const current = model.annotations.find((annotation) => annotation.id === id);
  if (
    current === undefined ||
    trimmedComment.length === 0 ||
    current.comment === trimmedComment
  ) {
    return unchanged(model);
  }
  return mutate(
    model,
    model.annotations.map((annotation) =>
      annotation.id === id
        ? { ...annotation, comment: trimmedComment, updatedAt }
        : annotation,
    ),
  );
};

export const changeStatus = (
  model: Model,
  id: string,
  status: Annotation['status'],
  updatedAt: number,
): Update => {
  const current = model.annotations.find((annotation) => annotation.id === id);
  if (current === undefined || current.status === status) {
    return unchanged(model);
  }
  return mutate(
    model,
    model.annotations.map((annotation) =>
      annotation.id === id ? { ...annotation, status, updatedAt } : annotation,
    ),
  );
};

export const remove = (model: Model, id: string): Update => {
  if (!model.annotations.some((annotation) => annotation.id === id)) {
    return unchanged(model);
  }
  return mutate(
    model,
    model.annotations.filter((annotation) => annotation.id !== id),
  );
};

export const undo = (model: Model): Update => {
  const previous = model.undo.at(-1);
  if (previous === undefined) {
    return unchanged(model);
  }
  return {
    model: {
      annotations: previous,
      undo: model.undo.slice(0, -1),
      redo: appendHistory(model.redo, model.annotations),
    },
  };
};

export const redo = (model: Model): Update => {
  const next = model.redo.at(-1);
  if (next === undefined) {
    return unchanged(model);
  }
  return {
    model: {
      annotations: next,
      undo: appendHistory(model.undo, model.annotations),
      redo: model.redo.slice(0, -1),
    },
  };
};

export const initialModel = (annotations: ReadonlyArray<Annotation>): Model => ({
  annotations: [...annotations],
  undo: [],
  redo: [],
});

export const update = (model: Model, message: Message): Update =>
  Message.match<Update>(message, {
    AddedAnnotation: ({ annotation }) => add(model, annotation),
    EditedAnnotation: ({ id, comment, updatedAt }) =>
      edit(model, id, comment, updatedAt),
    ChangedStatus: ({ id, status, updatedAt }) =>
      changeStatus(model, id, status, updatedAt),
    DeletedAnnotation: ({ id }) => remove(model, id),
    UndidChange: () => undo(model),
    RedidChange: () => redo(model),
  });
