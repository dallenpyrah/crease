import { Schema } from 'effect';
import { Command, given, message, model, story } from 'foldkit/story';
import { describe, expect, it } from 'vitest';

import { type Annotation } from './domain';
import {
  type Model as FeedbackModel,
  Message,
  Model,
  initialModel,
  update,
} from './feedback';

const annotation: Annotation = {
  version: 1,
  id: 'cr_test',
  comment: 'Make the gap 12px.',
  status: 'open',
  target: {
    tag: 'button',
    selector: '#demo > button.primary',
    role: 'button',
    text: 'Deploy',
    classes: 'primary',
    url: 'http://localhost:5173/',
    bounds: { x: 40, y: 80, width: 104, height: 40 },
    styles: {
      display: 'block',
      position: 'static',
      fontFamily: 'Inter',
      fontSize: '13px',
      lineHeight: '20px',
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(32, 33, 31)',
      margin: '0px',
      padding: '11px 17px',
      gap: '8px',
    },
  },
  capture: {
    viewportWidth: 1440,
    viewportHeight: 900,
    scrollX: 0,
    scrollY: 0,
    capturedAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
};

const annotationAt = (index: number): Annotation => ({
  ...annotation,
  id: `cr_${index}`,
  comment: `Comment ${index}`,
  createdAt: index,
  updatedAt: index,
  capture: { ...annotation.capture, capturedAt: index },
});

const onlyAnnotation = (annotations: ReadonlyArray<Annotation>): Annotation => {
  const value = annotations[0];
  if (value === undefined) throw new Error('Expected one annotation');
  return value;
};

describe('Feedback annotation stories', () => {
  it('starts with schema-compatible annotations and empty history', () => {
    const initial = initialModel([annotation]);

    expect(Schema.decodeUnknownSync(Model)(initial)).toEqual(initial);
    story(
      update,
      given(initial),
      model((current: FeedbackModel) => {
        expect(current).toBe(initial);
        expect(current.annotations).toEqual([annotation]);
        expect(current.undo).toEqual([]);
        expect(current.redo).toEqual([]);
      }),
      Command.expectNone(),
    );
  });

  it('runs an add, edit, status, and delete lifecycle through update', () => {
    const initial = initialModel([]);

    story(
      update,
      given(initial),
      message(Message.AddedAnnotation({ annotation })),
      model((current: FeedbackModel) => {
        expect(current.annotations).toEqual([annotation]);
        expect(current.undo).toEqual([[]]);
        expect(current.redo).toEqual([]);
      }),
      message(
        Message.EditedAnnotation({
          id: annotation.id,
          comment: '  Tighten the gap.  ',
          updatedAt: 10,
        }),
      ),
      model((current: FeedbackModel) => {
        const edited = onlyAnnotation(current.annotations);
        expect(edited.comment).toBe('Tighten the gap.');
        expect(edited.updatedAt).toBe(10);
        expect(edited.target).toEqual(annotation.target);
        expect(edited.capture).toEqual(annotation.capture);
        expect(edited.createdAt).toBe(annotation.createdAt);
        expect(current.undo).toHaveLength(2);
      }),
      message(
        Message.ChangedStatus({ id: annotation.id, status: 'resolved', updatedAt: 11 }),
      ),
      model((current: FeedbackModel) => {
        const resolved = onlyAnnotation(current.annotations);
        expect(resolved.status).toBe('resolved');
        expect(resolved.updatedAt).toBe(11);
        expect(current.undo).toHaveLength(3);
      }),
      message(Message.DeletedAnnotation({ id: annotation.id })),
      model((current: FeedbackModel) => {
        expect(current.annotations).toEqual([]);
        expect(current.undo).toHaveLength(4);
        expect(current.redo).toEqual([]);
      }),
      Command.expectNone(),
    );
  });

  it('moves snapshots through undo and redo without losing annotation metadata', () => {
    const initial = initialModel([annotation]);
    const edited = { ...annotation, comment: 'Updated copy', updatedAt: 20 };

    story(
      update,
      given(initial),
      message(
        Message.EditedAnnotation({
          id: annotation.id,
          comment: 'Updated copy',
          updatedAt: 20,
        }),
      ),
      message(Message.UndidChange()),
      model((current: FeedbackModel) => {
        expect(current.annotations).toEqual(initial.annotations);
        expect(current.undo).toEqual([]);
        expect(current.redo).toEqual([[edited]]);
      }),
      message(Message.RedidChange()),
      model((current: FeedbackModel) => {
        const edited = onlyAnnotation(current.annotations);
        expect(edited.comment).toBe('Updated copy');
        expect(edited.updatedAt).toBe(20);
        expect(edited.id).toBe(annotation.id);
        expect(edited.target).toEqual(annotation.target);
        expect(edited.capture).toEqual(annotation.capture);
        expect(edited.createdAt).toBe(annotation.createdAt);
        expect(current.undo).toEqual([initial.annotations]);
        expect(current.redo).toEqual([]);
      }),
      Command.expectNone(),
    );
  });

  it('clears redo history when a new branch mutation follows undo', () => {
    const initial = initialModel([]);
    const added = annotationAt(1);
    let branchModel: FeedbackModel | undefined;

    story(
      update,
      given(initial),
      message(Message.AddedAnnotation({ annotation: added })),
      message(Message.UndidChange()),
      message(Message.AddedAnnotation({ annotation })),
      model((current: FeedbackModel) => {
        branchModel = current;
        expect(current.annotations).toEqual([annotation]);
        expect(current.undo).toEqual([[]]);
        expect(current.redo).toEqual([]);
      }),
      message(Message.RedidChange()),
      model((current: FeedbackModel) => {
        expect(current).toBe(branchModel);
      }),
      Command.expectNone(),
    );
  });

  it('returns the original model for unknown, blank, duplicate, and identical changes', () => {
    const initial = initialModel([annotation]);
    const unchanged = model((current: FeedbackModel) => {
      expect(current).toBe(initial);
    });

    story(
      update,
      given(initial),
      message(
        Message.EditedAnnotation({
          id: 'cr_missing',
          comment: 'New text',
          updatedAt: 2,
        }),
      ),
      unchanged,
      message(
        Message.EditedAnnotation({ id: annotation.id, comment: '   ', updatedAt: 3 }),
      ),
      unchanged,
      message(
        Message.EditedAnnotation({
          id: annotation.id,
          comment: `  ${annotation.comment}  `,
          updatedAt: 4,
        }),
      ),
      unchanged,
      message(
        Message.ChangedStatus({ id: 'cr_missing', status: 'resolved', updatedAt: 5 }),
      ),
      unchanged,
      message(
        Message.ChangedStatus({
          id: annotation.id,
          status: annotation.status,
          updatedAt: 6,
        }),
      ),
      unchanged,
      message(Message.DeletedAnnotation({ id: 'cr_missing' })),
      unchanged,
      message(Message.AddedAnnotation({ annotation })),
      unchanged,
      Command.expectNone(),
    );
  });

  it('caps mutation snapshots at fifty entries while keeping the newest metadata', () => {
    const initial = initialModel([]);
    const additions = Array.from({ length: 55 }, (_, index) =>
      message(Message.AddedAnnotation({ annotation: annotationAt(index) })),
    );

    story(
      update,
      given(initial),
      ...additions,
      model((current: FeedbackModel) => {
        expect(current.annotations).toHaveLength(55);
        expect(current.undo).toHaveLength(50);
        expect(current.undo[0]).toHaveLength(5);
        expect(current.undo[0]?.[0]?.id).toBe('cr_0');
        expect(current.undo[49]).toHaveLength(54);
        const newest = current.annotations[54];
        expect(newest?.id).toBe('cr_54');
        expect(newest?.createdAt).toBe(54);
        expect(newest?.capture.capturedAt).toBe(54);
      }),
      Command.expectNone(),
    );
  });

  it('keeps prior edit snapshots immutable across successive edits', () => {
    const initial = initialModel([annotation]);
    let firstEdit: FeedbackModel | undefined;

    story(
      update,
      given(initial),
      message(
        Message.EditedAnnotation({
          id: annotation.id,
          comment: 'First edit',
          updatedAt: 30,
        }),
      ),
      model((current: FeedbackModel) => {
        firstEdit = current;
        expect(current.undo[0]).toEqual(initial.annotations);
      }),
      message(
        Message.EditedAnnotation({
          id: annotation.id,
          comment: 'Second edit',
          updatedAt: 31,
        }),
      ),
      model((current: FeedbackModel) => {
        expect(current.undo[0]).toEqual(initial.annotations);
        expect(current.undo[1]).toEqual(firstEdit?.annotations);
        expect(onlyAnnotation(current.undo[1] ?? []).comment).toBe('First edit');
        expect(onlyAnnotation(current.annotations).comment).toBe('Second edit');
      }),
      Command.expectNone(),
    );
  });

  it('leaves empty undo and redo operations as identity-preserving no-ops', () => {
    const initial = initialModel([annotation]);

    story(
      update,
      given(initial),
      message(Message.UndidChange()),
      model((current: FeedbackModel) => {
        expect(current).toBe(initial);
      }),
      message(Message.RedidChange()),
      model((current: FeedbackModel) => {
        expect(current).toBe(initial);
      }),
      Command.expectNone(),
    );
  });
});
