import { Clock, Effect, Schema } from 'effect';

import {
  type FoldkitChange,
  type FoldkitContext,
  FoldkitSource,
} from './foldkit-schema.js';

export interface FoldkitRegistration<Model> {
  readonly boundary: string;
  readonly source: typeof FoldkitSource.Type;
  readonly targets: ReadonlyArray<{
    readonly selector: string;
    readonly events: ReadonlyArray<{
      readonly event: string;
      readonly message: string;
    }>;
  }>;
  readonly project: (model: Model) => Schema.JsonObject;
}

export interface FoldkitInspector {
  readonly inspect: (
    element: Element,
    includeModel: boolean,
  ) => FoldkitContext | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

const redact = (value: Schema.Json, depth = 0): Schema.Json => {
  if (depth > 5) return '[depth limit]';
  if (typeof value === 'string')
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, item]) => [
        key,
        /password|secret|token|authorization|cookie|credential|api.?key|private.?key|access.?key|session/i.test(
          key,
        )
          ? '[redacted]'
          : redact(item, depth + 1),
      ]),
  );
};

const projectSafely = <Model>(
  registration: FoldkitRegistration<Model>,
  model: Model,
): Schema.JsonObject => {
  try {
    const values = Schema.decodeUnknownSync(Schema.JsonObject)(
      redact(registration.project(model)),
    );
    return JSON.stringify(values).length > 8000
      ? { status: 'Projection exceeds 8KB; narrow the registered fields.' }
      : values;
  } catch {
    return { status: 'The registered Model projection could not be read.' };
  }
};

export const createFoldkitInspector = <Model>(options: {
  readonly initialModel: Model;
  readonly registrations: ReadonlyArray<FoldkitRegistration<Model>>;
}) => {
  const records: Array<{
    registration: FoldkitRegistration<Model>;
    model: Schema.JsonObject;
    history: Array<FoldkitChange>;
  }> = options.registrations.map((registration) => {
    const source = registration.source;
    if (
      source.file.startsWith('/') ||
      source.file.includes('..') ||
      /^[a-z]+:/i.test(source.file)
    ) {
      throw new Error(
        'creasekit source registrations must use project-relative file paths.',
      );
    }
    return {
      registration,
      model: projectSafely(registration, options.initialModel),
      history: [],
    };
  });
  const listeners = new Set<() => void>();

  const recordUpdate = (before: Model, after: Model, message: string): void => {
    const at = Effect.runSync(Clock.currentTimeMillis);
    for (const record of records) {
      const previous = projectSafely(record.registration, before);
      const next = projectSafely(record.registration, after);
      record.model = next;
      const registeredMessage = record.registration.targets.some((target) =>
        target.events.some((event) => event.message === message),
      );
      if (registeredMessage || JSON.stringify(previous) !== JSON.stringify(next)) {
        record.history.push({ message, at, before: previous, after: next });
        if (record.history.length > 10) record.history.shift();
      }
    }
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  };

  const inspect: FoldkitInspector['inspect'] = (element, includeModel) => {
    for (const record of records) {
      for (const target of record.registration.targets) {
        let owner: Element | null;
        try {
          owner = element.closest(target.selector);
        } catch {
          continue;
        }
        if (owner === null) continue;
        return {
          provenance: 'explicit-registration',
          boundary: record.registration.boundary,
          source: { ...record.registration.source },
          events: target.events.map((event) => ({ ...event })),
          ...(includeModel
            ? {
                model: structuredClone(record.model),
                history: structuredClone(record.history),
              }
            : {}),
          capturedAt: Effect.runSync(Clock.currentTimeMillis),
        };
      }
    }
    return undefined;
  };

  return {
    inspect,
    observeView:
      <Builder, Result>(view: (model: Model, builder: Builder) => Result) =>
      (model: Model, builder: Builder): Result => {
        const result = view(model, builder);
        Effect.runSync(
          Effect.sync(() => {
            let changed = false;
            for (const record of records) {
              const next = projectSafely(record.registration, model);
              if (JSON.stringify(record.model) !== JSON.stringify(next)) changed = true;
              record.model = next;
            }
            if (changed)
              for (const listener of listeners) {
                try {
                  listener();
                } catch {
                  listeners.delete(listener);
                }
              }
          }),
        );
        return result;
      },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    observeUpdate:
      <
        Message extends { readonly _tag: string },
        Result extends { readonly model: Model },
      >(
        update: (model: Model, message: Message) => Result,
      ) =>
      (model: Model, message: Message): Result => {
        const result = update(model, message);
        Effect.runSync(
          Effect.sync(() => recordUpdate(model, result.model, message._tag)),
        );
        return result;
      },
  };
};

export const withoutModel = (context: FoldkitContext): FoldkitContext => ({
  provenance: context.provenance,
  boundary: context.boundary,
  source: context.source,
  events: context.events,
  capturedAt: context.capturedAt,
});
