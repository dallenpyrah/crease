import * as stylex from '@stylexjs/stylex';
import { Schema } from 'effect';
import { Runtime, type Update } from 'foldkit';
import { Document, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { evo } from 'foldkit/struct';

import metadata from '../package.json' with { type: 'json' };
import creasekitLogo from './assets/creasekit.svg';
import { styles } from './styles';

type FeatureIcon =
  | 'toggle'
  | 'inspect'
  | 'bounds'
  | 'box'
  | 'text'
  | 'color'
  | 'xray'
  | 'ruler'
  | 'distance'
  | 'annotation'
  | 'pin'
  | 'undo'
  | 'persist'
  | 'context'
  | 'resolve'
  | 'settings';

type CardIcon = 'playground' | 'foldkit';

type Feature = Readonly<{
  icon: FeatureIcon;
  name: string;
  description: string;
}>;

const className = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === 'string').join(' ');

const css = (...values: Array<stylex.StyleXStyles>): string =>
  stylex.props(...values).className ?? '';

const classAttr = (
  h: HtmlBuilder<Message>,
  ...values: Array<string | false | null | undefined>
) => h.Class(className(...values));

const featureIcon = (h: HtmlBuilder<Message>, name: FeatureIcon) => {
  const attributes = [
    classAttr(h, css(styles.featureIcon)),
    h.ViewBox('0 0 16 16'),
    h.Width('16'),
    h.Height('16'),
    h.Fill('none'),
    h.Stroke('currentColor'),
    h.StrokeWidth('1.25'),
    h.StrokeLinecap('round'),
    h.StrokeLinejoin('round'),
    h.AriaHidden(true),
  ];

  switch (name) {
    case 'toggle':
      return h.svg(attributes, [
        h.rect([h.X('1'), h.Y('4'), h.Width('14'), h.Height('8'), h.Rx('4')]),
        h.circle([h.Cx('5'), h.Cy('8'), h.R('2')]),
      ]);
    case 'inspect':
      return h.svg(attributes, [
        h.path([h.D('M3 2.5 12 7l-4.2 1.3L6.5 12.5 3 2.5Z')]),
        h.path([h.D('m8 9 3 3')]),
      ]);
    case 'bounds':
      return h.svg(attributes, [
        h.path([h.D('M5 2H2v3m9-3h3v3M2 11v3h3m9-3v3h-3')]),
        h.rect([h.X('5'), h.Y('5'), h.Width('6'), h.Height('6')]),
      ]);
    case 'box':
      return h.svg(attributes, [
        h.rect([h.X('2'), h.Y('2'), h.Width('12'), h.Height('12')]),
        h.rect([h.X('5'), h.Y('5'), h.Width('6'), h.Height('6')]),
      ]);
    case 'text':
      return h.svg(attributes, [h.path([h.D('M3 3h10M8 3v10m-3 0h6')])]);
    case 'color':
      return h.svg(attributes, [
        h.path([h.D('m10.8 2.2 3 3-7.5 7.5H3.2v-3.1l7.6-7.4Z')]),
        h.path([h.D('m9 4 3 3M2 14h5')]),
      ]);
    case 'xray':
      return h.svg(attributes, [
        h.rect([h.X('2'), h.Y('2'), h.Width('12'), h.Height('12')]),
        h.path([h.D('M2 6h12M6 2v12')]),
      ]);
    case 'ruler':
      return h.svg(attributes, [
        h.path([h.D('M2 11 11 2l3 3-9 9-3-3Z')]),
        h.path([h.D('m8 5 3 3M6 7l3 3M4 9l3 3')]),
      ]);
    case 'distance':
      return h.svg(attributes, [
        h.path([h.D('M2 4v8m12-8v8M4 8h8M4 6 2 8l2 2m8-4 2 2-2 2')]),
      ]);
    case 'annotation':
      return h.svg(attributes, [
        h.path([h.D('M3 2.5h10v8H7l-3.5 3v-3H3v-8Z')]),
        h.path([h.D('M6 5h4M6 7.5h3')]),
      ]);
    case 'pin':
      return h.svg(attributes, [
        h.path([h.D('m5 2 6 6-2 1.5-1.5 2-6-6L5 2Z')]),
        h.path([h.D('M8 10 3 15')]),
      ]);
    case 'undo':
      return h.svg(attributes, [
        h.path([h.D('M6 4 2.5 7.5 6 11')]),
        h.path([h.D('M3 7.5h6.2a3.3 3.3 0 1 1 0 6.5')]),
      ]);
    case 'persist':
      return h.svg(attributes, [
        h.path([h.D('M3 2h8l2 2v10H3V2Z')]),
        h.path([h.D('M5 2v4h5V2m-5 10h6')]),
      ]);
    case 'context':
      return h.svg(attributes, [h.path([h.D('M6 3 2.5 8 6 13M10 3l3.5 5-3.5 5')])]);
    case 'resolve':
      return h.svg(attributes, [
        h.circle([h.Cx('8'), h.Cy('8'), h.R('6')]),
        h.path([h.D('m5.2 8.1 1.8 1.8 3.8-4')]),
      ]);
    case 'settings':
      return h.svg(attributes, [
        h.circle([h.Cx('8'), h.Cy('8'), h.R('2.25')]),
        h.path([
          h.D(
            'M8 2v1.4m0 9.2V14M14 8h-1.4M3.4 8H2m10.2-4.2-1 1m-6.4 6.4-1 1m8.4 0-1-1M4.8 4.8l-1-1',
          ),
        ]),
      ]);
  }
};

const cardIcon = (h: HtmlBuilder<Message>, name: CardIcon) => {
  const attributes = [
    classAttr(h, css(styles.cardIcon)),
    h.ViewBox('0 0 24 24'),
    h.Width('24'),
    h.Height('24'),
    h.Fill('none'),
    h.Stroke('currentColor'),
    h.StrokeWidth('1.8'),
    h.StrokeLinecap('round'),
    h.StrokeLinejoin('round'),
    h.AriaHidden(true),
  ];

  if (name === 'playground') {
    return h.svg(attributes, [
      h.circle([h.Cx('12'), h.Cy('12'), h.R('8')]),
      h.path([h.D('m10 8 6 4-6 4V8Z')]),
    ]);
  }

  return h.svg(attributes, [
    h.path([h.D('M5 3h14v18H5V3Z')]),
    h.path([h.D('M9 8h6M9 12h6M9 16h4')]),
  ]);
};

const features: ReadonlyArray<Feature> = [
  {
    icon: 'toggle',
    name: 'Toggle on/off',
    description: 'Enable or hide the overlay with a shortcut',
  },
  {
    icon: 'inspect',
    name: 'Inspect mode',
    description: 'Click elements to measure their bounds',
  },
  {
    icon: 'bounds',
    name: 'Element bounds',
    description: 'Read position and dimensions at a glance',
  },
  {
    icon: 'box',
    name: 'Box model',
    description: 'Inspect margin, padding, and border',
  },
  {
    icon: 'text',
    name: 'Text inspector',
    description: 'Read typography from the selected element',
  },
  {
    icon: 'color',
    name: 'Sample color',
    description: 'Copy computed foreground and background colors',
  },
  {
    icon: 'xray',
    name: 'X-ray mode',
    description: 'Reveal visible elements in the page',
  },
  {
    icon: 'ruler',
    name: 'Rulers',
    description: 'Show viewport rulers',
  },
  {
    icon: 'distance',
    name: 'Distance overlays',
    description: 'Hold Alt to compare spacing',
  },
  {
    icon: 'annotation',
    name: 'Text annotations',
    description: 'Leave notes on elements',
  },
  {
    icon: 'pin',
    name: 'Annotation pins',
    description: 'Keep notes anchored to their targets',
  },
  {
    icon: 'undo',
    name: 'Undo/redo',
    description: 'Reverse note changes',
  },
  {
    icon: 'persist',
    name: 'Persist state',
    description: 'Keep your feedback on reload',
  },
  {
    icon: 'context',
    name: 'Agent context',
    description: 'Export Markdown or JSON',
  },
  {
    icon: 'resolve',
    name: 'Resolve feedback',
    description: 'Mark notes resolved and reopen them',
  },
  {
    icon: 'settings',
    name: 'Settings',
    description: 'Configure pin visibility',
  },
];

export const Model = Schema.Struct({ playgroundCount: Schema.Number });
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedDecrement: {},
  ClickedIncrement: {},
  ClickedReset: {},
});
export type Message = typeof Message.Type;

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { playgroundCount: 0 },
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedDecrement: () => ({
      model: evo(model, {
        playgroundCount: (count) => Math.max(0, count - 1),
      }),
    }),
    ClickedIncrement: () => ({
      model: evo(model, { playgroundCount: (count) => count + 1 }),
    }),
    ClickedReset: () => ({
      model: evo(model, { playgroundCount: () => 0 }),
    }),
  });

const featureRow = (h: HtmlBuilder<Message>, feature: Feature) =>
  h.li(
    [classAttr(h, css(styles.feature))],
    [
      featureIcon(h, feature.icon),
      h.p(
        [classAttr(h, css(styles.featureText))],
        [
          h.span([classAttr(h, css(styles.featureName))], [feature.name]),
          h.span(
            [classAttr(h, css(styles.featureDescription))],
            [` - ${feature.description}`],
          ),
        ],
      ),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'creasekit — visual feedback for FoldKit',
  body: h.div(
    [classAttr(h, css(styles.page), 'creasekit-home-page')],
    [
      h.main(
        [classAttr(h, css(styles.shell), 'creasekit-home-shell')],
        [
          h.header(
            [],
            [
              h.img([
                classAttr(h, css(styles.brandMark)),
                h.Src(creasekitLogo),
                h.Alt('creasekit'),
                h.Width('36'),
                h.Height('36'),
              ]),
              h.p(
                [classAttr(h, css(styles.brandLine))],
                [
                  h.span([], ['creasekit']),
                  h.span([classAttr(h, css(styles.version))], [`v${metadata.version}`]),
                ],
              ),
              h.h1(
                [classAttr(h, css(styles.introTitle))],
                ['Inspect, annotate, and give feedback on any FoldKit interface'],
              ),
              h.p(
                [classAttr(h, css(styles.introText))],
                [
                  'creasekit runs directly where you build. Share feedback with your agents and your team.',
                ],
              ),
            ],
          ),
          h.section(
            [classAttr(h, css(styles.featureSection))],
            [
              h.h2([classAttr(h, css(styles.sectionTitle))], ['Features']),
              h.ul(
                [classAttr(h, css(styles.featureList))],
                features.map((feature) => featureRow(h, feature)),
              ),
            ],
          ),
          h.section(
            [classAttr(h, css(styles.howSection))],
            [
              h.h2([classAttr(h, css(styles.sectionTitle))], ['How to use']),
              h.div(
                [classAttr(h, css(styles.howCards), 'creasekit-home-cards')],
                [
                  h.article(
                    [classAttr(h, css(styles.howCard))],
                    [
                      cardIcon(h, 'playground'),
                      h.h3([classAttr(h, css(styles.cardTitle))], ['Live playground']),
                      h.p(
                        [classAttr(h, css(styles.cardText))],
                        [
                          'Use the counter below as a real FoldKit surface to inspect and annotate.',
                        ],
                      ),
                      h.a(
                        [classAttr(h, css(styles.cardLink)), h.Href('#playground')],
                        ['Try the playground'],
                      ),
                    ],
                  ),
                  h.article(
                    [classAttr(h, css(styles.howCard))],
                    [
                      cardIcon(h, 'foldkit'),
                      h.h3([classAttr(h, css(styles.cardTitle))], ['FoldKit setup']),
                      h.p(
                        [classAttr(h, css(styles.cardText))],
                        [
                          'Mount the local overlay from the same FoldKit project while you develop.',
                        ],
                      ),
                      h.pre(
                        [classAttr(h, css(styles.setupCode))],
                        [
                          h.code(
                            [],
                            [
                              "import { mountCreasekit } from 'creasekit'\nmountCreasekit({ projectId: 'my-app' })",
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.section(
            [classAttr(h, css(styles.playgroundSection)), h.Id('playground')],
            [
              h.h2([classAttr(h, css(styles.sectionTitle))], ['Live playground']),
              h.p(
                [classAttr(h, css(styles.playgroundLead))],
                [
                  'Toggle creasekit off to try the counter. Turn it back on to inspect or annotate this live FoldKit view.',
                ],
              ),
              h.div(
                [
                  classAttr(h, css(styles.playground), 'creasekit-home-playground'),
                  h.DataAttribute('creasekit-target', 'playground'),
                ],
                [
                  h.div(
                    [h.DataAttribute('creasekit-target', 'playground-counter')],
                    [
                      h.p(
                        [classAttr(h, css(styles.playgroundLabel))],
                        ['Counter value'],
                      ),
                      h.output(
                        [
                          classAttr(h, css(styles.playgroundValue)),
                          h.DataAttribute('creasekit-target', 'playground-value'),
                          h.AriaLabel('Counter value'),
                          h.AriaLive('polite'),
                        ],
                        [`${model.playgroundCount}`],
                      ),
                    ],
                  ),
                  h.div(
                    [
                      classAttr(
                        h,
                        css(styles.playgroundControls),
                        'creasekit-home-playground-controls',
                      ),
                    ],
                    [
                      h.button(
                        [
                          classAttr(
                            h,
                            css(
                              styles.playgroundButton,
                              styles.playgroundButtonSecondary,
                            ),
                          ),
                          h.Type('button'),
                          h.DataAttribute('creasekit-target', 'playground-decrement'),
                          h.AriaLabel('Decrease counter'),
                          h.OnClick(Message.ClickedDecrement()),
                        ],
                        ['−'],
                      ),
                      h.button(
                        [
                          classAttr(h, css(styles.playgroundButton)),
                          h.Type('button'),
                          h.DataAttribute('creasekit-target', 'playground-increment'),
                          h.AriaLabel('Increase counter'),
                          h.OnClick(Message.ClickedIncrement()),
                        ],
                        ['+'],
                      ),
                      h.button(
                        [
                          classAttr(
                            h,
                            css(
                              styles.playgroundButton,
                              styles.playgroundButtonSecondary,
                            ),
                          ),
                          h.Type('button'),
                          h.DataAttribute('creasekit-target', 'playground-reset'),
                          h.OnClick(Message.ClickedReset()),
                        ],
                        ['Reset'],
                      ),
                    ],
                  ),
                  h.p(
                    [classAttr(h, css(styles.playgroundHint))],
                    [
                      'The mounted toolbar can select these controls and capture their element context.',
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  ),
});
