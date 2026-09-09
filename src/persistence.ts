import { Effect, Schema } from 'effect';

import { type Annotation, AnnotationArray } from './domain';
import { withoutModel } from './foldkit-context';

const keyFor = (projectId: string) => `crease:${projectId}:annotations`;

export const makeLocalPersistence = (projectId: string) => ({
  load: Effect.sync<ReadonlyArray<Annotation>>(() => {
    try {
      const raw = window.localStorage.getItem(keyFor(projectId));
      if (raw === null) {
        return [];
      }
      return Schema.decodeUnknownSync(AnnotationArray)(JSON.parse(raw));
    } catch {
      return [];
    }
  }),
  save: (annotations: ReadonlyArray<Annotation>) =>
    Effect.sync(() => {
      window.localStorage.setItem(
        keyFor(projectId),
        JSON.stringify(
          annotations.map((annotation) =>
            annotation.foldkit === undefined
              ? annotation
              : { ...annotation, foldkit: withoutModel(annotation.foldkit) },
          ),
        ),
      );
    }),
});
