import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Annotation, AnnotationArray } from './domain';
import { formatJson, formatMarkdown } from './export';

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

describe('creasekit exports', () => {
  it('produces deterministic Markdown for an agent', () => {
    expect(formatMarkdown([annotation])).toContain('Make the gap 12px.');
    expect(formatMarkdown([annotation])).toContain(
      '**Selector:** `#demo > button.primary`',
    );
    expect(formatMarkdown([annotation])).toContain(
      '**Bounds:** 40px, 80px (104 × 40px)',
    );
  });

  it('produces schema-compatible JSON', () => {
    const output = Schema.decodeUnknownSync(AnnotationArray)(
      JSON.parse(formatJson([annotation])),
    );
    expect(output).toHaveLength(1);
    expect(output[0]?.target.tag).toBe('button');
    expect(output[0]?.status).toBe('open');
  });
});
