import { describe, expect, it } from 'vitest';

import type { Annotation } from './domain';
import { formatMarkdown } from './export';
import type { FoldkitContext } from './foldkit-schema';
import type { SourceEvidence } from './source-schema';

const revision = (character: string): string => character.repeat(64);

const source = (
  line: number,
  overrides: Partial<SourceEvidence> = {},
): SourceEvidence => ({
  file: 'src/page.ts',
  view: 'page',
  line,
  column: 3,
  endLine: line,
  endColumn: 24,
  revision: revision('a'),
  ...overrides,
});

const annotation = (foldkit: FoldkitContext | undefined): Annotation => ({
  version: 1,
  id: 'cr_source',
  comment: 'Increase the gap.',
  status: 'open',
  target: {
    tag: 'button',
    selector: '#app > button.deploy',
    role: 'button',
    text: 'Deploy',
    classes: 'deploy',
    url: 'http://localhost:5173/dashboard',
    reference: 'ck_private_reference',
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
    location: {
      pagePath: '/dashboard',
      pageHeading: 'Dashboard',
      region: { role: 'main', label: 'Deploy controls', labelSource: 'aria-label' },
      position: { index: 2, total: 3, kind: 'rendered-sibling' },
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
  ...(foldkit === undefined ? {} : { foldkit }),
});

describe('source-first Markdown', () => {
  it('places exact source evidence before feedback and distinguishes owner, calls, layout, and styles', () => {
    const styleDefinition = source(40, {
      file: 'src/styles.ts',
      view: 'buttonStyles',
      revision: revision('b'),
      snippet: 'export const button = { gap: 8 };',
      status: 'current',
    });
    const element = source(20, {
      snippet: "h.button({ class: styles.button }, ['Deploy'])",
      status: 'current',
      styles: [
        {
          expression: 'styles.button',
          use: source(20),
          definition: styleDefinition,
          reason: 'static class reference',
        },
      ],
    });
    const owner = source(5, {
      snippet: 'export const page = (model) => ...',
      status: 'current',
    });
    const invocation = source(12, {
      view: 'child',
      snippet: 'child(model.child)',
      status: 'current',
    });
    const layout = source(8, {
      view: 'page',
      snippet: 'h.main(...)',
      status: 'current',
    });
    const markdown = formatMarkdown([
      annotation({
        provenance: 'automatic-instrumentation',
        boundary: 'dashboard',
        source: owner,
        elementSource: element,
        modelSource: {
          expression: 'model.dashboard',
          file: 'src/page.ts',
          line: 4,
          column: 1,
          definition: source(2, {
            view: 'DashboardModel',
            snippet: 'interface DashboardModel {}',
            status: 'current',
          }),
        },
        calls: [{ kind: 'submodel', source: invocation }],
        layout: [
          {
            tag: 'main',
            source: layout,
            bounds: { x: 0, y: 0, width: 800, height: 400 },
            display: 'flex',
            position: 'relative',
            padding: '16px',
            border: '1px solid black',
            gap: '12px',
            overflow: 'auto',
            scrollTop: 4,
            scrollLeft: 2,
          },
        ],
        events: [],
        capturedAt: 1,
        instanceKey: 'runtime|secret-key',
      }),
    ]);

    expect(markdown.indexOf('**Element source:**')).toBeLessThan(
      markdown.indexOf('**Feedback:**'),
    );
    expect(markdown).toContain('src/page.ts:20:3–20:24 → page');
    expect(markdown).toContain("h.button({ class: styles.button }, ['Deploy'])");
    expect(markdown).toContain('**Source:** src/page.ts:5:3–5:24 → page');
    expect(markdown).toContain('**Observed submodel invocation:**');
    expect(markdown).toContain('### Parent layout candidates');
    expect(markdown).toContain('display: flex; position: relative');
    expect(markdown).toContain('### Style declaration candidates');
    expect(markdown).toContain('Definition candidate: src/styles.ts:40:3–40:24');
    expect(markdown).toContain('computed cascade winner');
    expect(markdown).toContain(
      '**Location:** Dashboard → Deploy controls → Item 2 of 3',
    );
    expect(markdown).toContain('**Bounds:** 40px, 80px (104 × 40px)');
    expect(markdown).not.toContain('ck_private_reference');
    expect(markdown).not.toContain('runtime|secret-key');
  });

  it('labels retained stale literals as stale rather than current', () => {
    const stale = source(20, {
      snippet: "h.button([], ['Old label'])",
      status: 'stale',
    });
    const markdown = formatMarkdown([
      annotation({
        provenance: 'automatic-instrumentation',
        boundary: 'dashboard',
        source: stale,
        elementSource: stale,
        events: [],
        capturedAt: 1,
      }),
    ]);

    expect(markdown).toContain('source status: stale');
    expect(markdown).toContain("h.button([], ['Old label'])");
    expect(markdown).not.toContain('source status: current (revision verified)');
  });

  it('uses a selector only when no exact element source exists', () => {
    const markdown = formatMarkdown([
      annotation({
        provenance: 'automatic-instrumentation',
        boundary: 'dashboard',
        source: source(5, { status: 'current' }),
        events: [],
        capturedAt: 1,
        instanceKey: 'private-instance',
      }),
    ]);

    expect(markdown).toContain('**Element source:** source unavailable');
    expect(markdown).toContain('**Selector:** `#app > button.deploy`');
    expect(markdown).not.toContain('private-instance');
  });

  it('uses fences longer than arbitrary source and comment backtick runs', () => {
    const item = annotation({
      provenance: 'automatic-instrumentation',
      boundary: 'dashboard',
      source: source(5, { status: 'current' }),
      elementSource: source(20, {
        snippet: 'const marker = ````;',
        status: 'current',
      }),
      events: [],
      capturedAt: 1,
    });
    const markdown = formatMarkdown([
      {
        ...item,
        comment: 'Keep this:\n```\nnot Markdown control\n```',
      },
    ]);

    expect(markdown).toContain('`````text\nconst marker = ````;\n`````');
    expect(markdown).toContain(
      '**Feedback:**\n````text\nKeep this:\n```\nnot Markdown control\n```\n````',
    );
  });
});
