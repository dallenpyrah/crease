import * as Story from 'foldkit/story';
import { describe, expect, it } from 'vitest';

import { Message, type Model, init, update } from './main';

const countIs = (expected: number) =>
  Story.model<Model>((model) => {
    expect(model.playgroundCount).toBe(expected);
  });

describe('homepage counter update', () => {
  it('starts at zero', () => {
    Story.story(
      update,
      Story.given(init().model),
      countIs(0),
      Story.Command.expectNone(),
    );
  });

  it('clamps a decrement at zero', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedDecrement()),
      countIs(0),
      Story.Command.expectNone(),
    );
  });

  it('increments once', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedIncrement()),
      countIs(1),
      Story.Command.expectNone(),
    );
  });

  it('accumulates repeated increments', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedIncrement()),
      Story.message(Message.ClickedIncrement()),
      Story.message(Message.ClickedIncrement()),
      countIs(3),
      Story.Command.expectNone(),
    );
  });

  it('resets a nonzero counter', () => {
    Story.story(
      update,
      Story.given({ playgroundCount: 3 }),
      Story.message(Message.ClickedReset()),
      countIs(0),
      Story.Command.expectNone(),
    );
  });

  it('keeps zero unchanged when reset', () => {
    Story.story(
      update,
      Story.given(init().model),
      Story.message(Message.ClickedReset()),
      countIs(0),
      Story.Command.expectNone(),
    );
  });
});
