import * as stylex from '@stylexjs/stylex';
import { Effect, Schema } from 'effect';
import { Runtime, type Update } from 'foldkit';
import * as Command from 'foldkit/command';
import { Document, Html, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { refractor } from 'refractor/core';
import bash from 'refractor/bash';
import ignore from 'refractor/ignore';
import json from 'refractor/json';
import typescript from 'refractor/typescript';

import metadata from '../package.json' with { type: 'json' };
import creasekitLogo from './assets/creasekit.svg';
import { styles } from './styles';

refractor.register(bash);
refractor.register(ignore);
refractor.register(json);
refractor.register(typescript);
refractor.alias('bash', ['npm', 'bun']);

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

type Feature = Readonly<{
  icon: FeatureIcon;
  name: string;
  description: string;
}>;

const SnippetId = Schema.Literals([
  'install-npm',
  'install-bun',
  'ignore-creasekit',
  'vite-config',
  'development-mount',
  'start-app',
  'mcp-config',
]);
type SnippetId = typeof SnippetId.Type;

type SetupSnippet = Readonly<{
  id: SnippetId;
  filename: string;
  language: string;
  copyLabel: string;
  code: string;
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

const setupSnippets: ReadonlyArray<SetupSnippet> = [
  {
    id: 'install-npm',
    filename: 'Terminal',
    language: 'npm',
    copyLabel: 'npm install command',
    code: 'npm install -D creasekit',
  },
  {
    id: 'install-bun',
    filename: 'Terminal',
    language: 'Bun',
    copyLabel: 'Bun install command',
    code: 'bun add -D creasekit',
  },
  {
    id: 'ignore-creasekit',
    filename: '.gitignore',
    language: 'gitignore',
    copyLabel: '.creasekit ignore rule',
    code: '.creasekit/',
  },
  {
    id: 'vite-config',
    filename: 'vite.config.ts',
    language: 'TypeScript',
    copyLabel: 'Vite configuration',
    code: [
      "import { foldkit } from '@foldkit/vite-plugin';",
      "import { creasekit } from 'creasekit/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      '  plugins: [foldkit(), creasekit()],',
      "  server: { host: '127.0.0.1' },",
      '});',
    ].join('\n'),
  },
  {
    id: 'development-mount',
    filename: 'src/entry.ts',
    language: 'TypeScript',
    copyLabel: 'development mount block',
    code: [
      'if (import.meta.env.DEV) {',
      "  const { createAgentConnection, mountCreasekit } = await import('creasekit');",
      '  const creasekit = mountCreasekit({',
      "    projectId: 'my-app',",
      '    agent: createAgentConnection(),',
      '  });',
      '',
      '  if (import.meta.hot) {',
      '    import.meta.hot.dispose(() => creasekit.destroy());',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    id: 'start-app',
    filename: 'Terminal',
    language: 'npm',
    copyLabel: 'development command',
    code: 'npm run dev',
  },
  {
    id: 'mcp-config',
    filename: 'mcp.json',
    language: 'JSON',
    copyLabel: 'MCP configuration',
    code: [
      '{',
      '  "mcpServers": {',
      '    "creasekit": {',
      '      "command": "bun",',
      '      "args": ["x", "creasekit", "--cwd", "/absolute/path/to/foldkit-app"]',
      '    }',
      '  }',
      '}',
    ].join('\n'),
  },
];

const setupSnippet = (id: SnippetId): SetupSnippet => {
  const snippet = setupSnippets.find((candidate) => candidate.id === id);
  if (snippet === undefined) throw new Error(`Unknown setup snippet: ${id}`);
  return snippet;
};

const CopyStatus = Schema.Struct({
  snippet: SnippetId,
  outcome: Schema.Literals(['copied', 'failed']),
});

export const Model = Schema.Struct({ copyStatus: Schema.NullOr(CopyStatus) });
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedCopySetupSnippet: { snippet: SnippetId },
  CopiedSetupSnippet: { snippet: SnippetId },
  FailedToCopySetupSnippet: { snippet: SnippetId },
});
export type Message = typeof Message.Type;

export const CopySetupSnippet = Command.define('CopySetupSnippet', {
  args: { snippet: SnippetId },
  messages: [Message.CopiedSetupSnippet, Message.FailedToCopySetupSnippet],
  execute: ({ snippet }) =>
    Effect.tryPromise(() =>
      navigator.clipboard.writeText(setupSnippet(snippet).code),
    ).pipe(
      Effect.as(Message.CopiedSetupSnippet({ snippet })),
      Effect.catch(() => Effect.succeed(Message.FailedToCopySetupSnippet({ snippet }))),
    ),
});

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { copyStatus: null },
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedCopySetupSnippet: ({ snippet }) => ({
      model: { copyStatus: null },
      commands: [CopySetupSnippet({ snippet })],
    }),
    CopiedSetupSnippet: ({ snippet }) => ({
      model: { copyStatus: { snippet, outcome: 'copied' } },
    }),
    FailedToCopySetupSnippet: ({ snippet }) => ({
      model: { copyStatus: { snippet, outcome: 'failed' } },
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

const copyFeedback = (model: Model, snippet: SetupSnippet): string | undefined => {
  if (model.copyStatus?.snippet !== snippet.id) return undefined;
  return model.copyStatus.outcome === 'copied'
    ? 'Copied to clipboard.'
    : 'Clipboard access was denied or is unavailable. Select this code and copy it manually.';
};

const tokenStyles: Readonly<Record<string, stylex.StyleXStyles>> = {
  comment: styles.codeComment,
  keyword: styles.codeKeyword,
  operator: styles.codeKeyword,
  string: styles.codeString,
  property: styles.codeProperty,
  number: styles.codeProperty,
  boolean: styles.codeProperty,
  constant: styles.codeProperty,
  function: styles.codeFunction,
  'function-name': styles.codeFunction,
  'class-name': styles.codeFunction,
  builtin: styles.codeBuiltin,
  parameter: styles.codeBuiltin,
  punctuation: styles.codePunctuation,
};

const codeToken = (
  h: HtmlBuilder<Message>,
  token: ReturnType<typeof refractor.highlight>['children'][number],
): Html | string => {
  if (token.type === 'text') return token.value;
  if (token.type !== 'element') return '';
  const names = Array.isArray(token.properties.className)
    ? token.properties.className.map(String)
    : [];
  const colors = names
    .map((name) => tokenStyles[name])
    .filter((style): style is stylex.StyleXStyles => style !== undefined);
  return h.span(
    [classAttr(h, css(...colors), ...names)],
    token.children.map((child) => codeToken(h, child)),
  );
};

const snippetBlock = (h: HtmlBuilder<Message>, model: Model, snippet: SetupSnippet) => {
  const feedback = copyFeedback(model, snippet);
  const copied =
    model.copyStatus?.snippet === snippet.id && model.copyStatus.outcome === 'copied';

  return h.div(
    [classAttr(h, css(styles.codeExample))],
    [
      h.div(
        [classAttr(h, css(styles.codeHeader))],
        [
          h.div(
            [classAttr(h, css(styles.codeLabel))],
            [
              h.span([classAttr(h, css(styles.codeFilename))], [snippet.filename]),
              h.span([classAttr(h, css(styles.codeLanguage))], [snippet.language]),
            ],
          ),
          h.button(
            [
              classAttr(h, css(styles.copyButton)),
              h.Type('button'),
              h.AriaLabel(`Copy ${snippet.copyLabel}`),
              h.OnClick(Message.ClickedCopySetupSnippet({ snippet: snippet.id })),
            ],
            [copied ? 'Copied' : 'Copy'],
          ),
        ],
      ),
      h.pre(
        [classAttr(h, css(styles.codeBlock))],
        [
          h.code(
            [
              classAttr(h, css(styles.code)),
              h.DataAttribute('language', snippet.language.toLowerCase()),
            ],
            refractor
              .highlight(snippet.code, snippet.language.toLowerCase())
              .children.map((token) => codeToken(h, token)),
          ),
        ],
      ),
      ...(feedback === undefined
        ? []
        : [
            h.p(
              [
                classAttr(
                  h,
                  css(
                    styles.copyFeedback,
                    model.copyStatus?.outcome === 'failed'
                      ? styles.copyFeedbackFailure
                      : styles.copyFeedbackSuccess,
                  ),
                ),
                h.Role('status'),
                h.AriaLive('polite'),
                h.AriaAtomic(true),
              ],
              [feedback],
            ),
          ]),
    ],
  );
};

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
              h.ol(
                [classAttr(h, css(styles.setupList))],
                [
                  h.li(
                    [classAttr(h, css(styles.setupStep))],
                    [
                      h.h3(
                        [classAttr(h, css(styles.stepTitle))],
                        ['Install creasekit'],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'Use Node.js 22.12 or later. From the root of your existing FoldKit application, install creasekit as a development dependency.',
                        ],
                      ),
                      h.div(
                        [classAttr(h, css(styles.snippetList))],
                        [
                          snippetBlock(h, model, setupSnippet('install-npm')),
                          snippetBlock(h, model, setupSnippet('install-bun')),
                        ],
                      ),
                    ],
                  ),
                  h.li(
                    [classAttr(h, css(styles.setupStep))],
                    [
                      h.h3([classAttr(h, css(styles.stepTitle))], ['Configure Vite']),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'Ignore creasekit’s local session directory, then add creasekit after foldkit and keep the Vite development server on loopback HTTP.',
                        ],
                      ),
                      h.div(
                        [classAttr(h, css(styles.snippetList))],
                        [
                          snippetBlock(h, model, setupSnippet('ignore-creasekit')),
                          snippetBlock(h, model, setupSnippet('vite-config')),
                        ],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepNote))],
                        [
                          'Do not expose this server over a network, tunnel, or HTTPS connection. MCP sharing is intentionally local-only.',
                        ],
                      ),
                    ],
                  ),
                  h.li(
                    [classAttr(h, css(styles.setupStep))],
                    [
                      h.h3(
                        [classAttr(h, css(styles.stepTitle))],
                        ['Mount and start in development'],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'To mount the overlay explicitly, add this development-only block after your existing Runtime.run(application) call.',
                        ],
                      ),
                      h.div(
                        [classAttr(h, css(styles.snippetList))],
                        [snippetBlock(h, model, setupSnippet('development-mount'))],
                      ),
                      h.div(
                        [classAttr(h, css(styles.snippetList))],
                        [snippetBlock(h, model, setupSnippet('start-app'))],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'Open your application’s Vite URL, then click the creasekit mark or press Alt+Shift+C to open the toolbar.',
                        ],
                      ),
                    ],
                  ),
                  h.li(
                    [classAttr(h, css(styles.setupStep))],
                    [
                      h.h3(
                        [classAttr(h, css(styles.stepTitle))],
                        ['Annotate and review context'],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'Inspect an element, leave a note, and review the Markdown or JSON handoff in Feedback before you copy or share it.',
                        ],
                      ),
                    ],
                  ),
                  h.li(
                    [classAttr(h, css(styles.setupStep))],
                    [
                      h.h3(
                        [classAttr(h, css(styles.stepTitle))],
                        ['Connect an agent (optional)'],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepText))],
                        [
                          'After the Vite server starts, configure your MCP client to run the local stdio server from the consuming application’s configured Vite root.',
                        ],
                      ),
                      h.div(
                        [classAttr(h, css(styles.snippetList))],
                        [snippetBlock(h, model, setupSnippet('mcp-config'))],
                      ),
                      h.p(
                        [classAttr(h, css(styles.stepNote))],
                        [
                          'The --cwd directory contains .creasekit/mcp-session.json. Choose Share snapshot only after reviewing the read-only snapshot, and choose Stop sharing to revoke the current one.',
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
    ],
  ),
});
