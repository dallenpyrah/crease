import * as Scene from 'foldkit/scene';
import { describe, it } from 'vitest';

import { type Model, update, view } from './main';

const model = (playgroundCount = 0): Model => ({ playgroundCount });

const counterValue = Scene.role('status', { name: 'Counter value' });
const decreaseCounter = Scene.role('button', { name: 'Decrease counter' });
const increaseCounter = Scene.role('button', { name: 'Increase counter' });
const resetCounter = Scene.role('button', { name: 'Reset' });

describe('homepage view', () => {
  it('renders the branded heading hierarchy', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(Scene.role('img', { name: 'creasekit' })).toHaveAttr('src'),
      Scene.expect(
        Scene.role('heading', {
          name: 'Inspect, annotate, and give feedback on any FoldKit interface',
          level: 1,
        }),
      ).toExist(),
      Scene.expect(Scene.role('heading', { name: 'Features', level: 2 })).toExist(),
      Scene.expect(Scene.role('heading', { name: 'How to use', level: 2 })).toExist(),
      Scene.expect(
        Scene.role('heading', { name: 'Live playground', level: 2 }),
      ).toExist(),
    );
  });

  it('renders the feature list and playground link', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expectAll(Scene.all.role('listitem')).toHaveCount(16),
      Scene.expect(Scene.text('Toggle on/off')).toExist(),
      Scene.expect(Scene.text('Settings')).toExist(),
      Scene.expect(Scene.role('link', { name: 'Try the playground' })).toHaveAttr(
        'href',
        '#playground',
      ),
    );
  });

  it('exposes the initial counter through accessible controls and output', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.expect(counterValue).toHaveAccessibleName('Counter value'),
      Scene.expect(counterValue).toHaveAttr('aria-live', 'polite'),
      Scene.expect(counterValue).toHaveText('0'),
      Scene.expect(decreaseCounter).toBeEnabled(),
      Scene.expect(increaseCounter).toBeEnabled(),
      Scene.expect(resetCounter).toBeEnabled(),
    );
  });

  it('updates the rendered output for repeated increments', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.click(increaseCounter),
      Scene.expectHandled(),
      Scene.expect(counterValue).toHaveText('1'),
      Scene.click(increaseCounter),
      Scene.expectHandled(),
      Scene.expect(counterValue).toHaveText('2'),
      Scene.Command.expectNone(),
    );
  });

  it('keeps the rendered output at zero when decremented', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.click(decreaseCounter),
      Scene.expectHandled(),
      Scene.expect(counterValue).toHaveText('0'),
      Scene.Command.expectNone(),
    );
  });

  it('resets the rendered output and leaves a zero reset unchanged', () => {
    Scene.scene(
      { update, view },
      Scene.given(model()),
      Scene.click(increaseCounter),
      Scene.expectHandled(),
      Scene.click(increaseCounter),
      Scene.expectHandled(),
      Scene.click(resetCounter),
      Scene.expectHandled(),
      Scene.expect(counterValue).toHaveText('0'),
      Scene.click(resetCounter),
      Scene.expectHandled(),
      Scene.expect(counterValue).toHaveText('0'),
      Scene.Command.expectNone(),
    );
  });
});
