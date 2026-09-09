import { Effect, Schema } from 'effect';

import { type Annotation, AnnotationArray } from './domain.js';
import { withoutModel } from './foldkit-context.js';

const keyFor = (projectId: string) => `creasekit:${projectId}:annotations`;

export const makeLocalPersistence = (projectId: string) => ({
  load: Effect.sync<ReadonlyArray<Annotation>>(() => {
    try {
      const legacyProjectId =
        projectId === 'creasekit-homepage' ? 'crease-homepage' : projectId;
      const raw =
        window.localStorage.getItem(keyFor(projectId)) ??
        window.localStorage.getItem(`crease:${legacyProjectId}:annotations`);
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
