import { Schema } from 'effect';
import { Runtime, type Update } from 'foldkit';
import { Document, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';

export const Model = Schema.Struct({ count: Schema.Number });
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({ ClickedIncrement: {}, ClickedReset: {} });
export type Message = typeof Message.Type;

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { count: 0 },
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedIncrement: () => ({ model: { count: model.count + 1 } }),
    ClickedReset: () => ({ model: { count: 0 } }),
  });

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'creasekit in a FoldKit project',
  body: h.main(
    [],
    [
      h.h1([], ['A separate FoldKit project']),
      h.p([], ['This app installs creasekit from the packed npm artifact.']),
      h.p([h.DataAttribute('counter-value', '')], [`Count: ${model.count}`]),
      h.button(
        [
          h.DataAttribute('counter-increment', ''),
          h.OnClick(Message.ClickedIncrement()),
        ],
        ['Increment'],
      ),
      h.button(
        [h.DataAttribute('counter-reset', ''), h.OnClick(Message.ClickedReset())],
        ['Reset'],
      ),
      h.p(
        [],
        [
          'Turn creasekit off to use the counter. Turn it back on to inspect a control and share a note.',
        ],
      ),
    ],
  ),
});
