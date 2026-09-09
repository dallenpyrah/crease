import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Annotation, isAnnotation } from './domain';

describe('creasekit domain', () => {
  it('accepts the open annotation lifecycle', () => {
    const value = {
      version: 1,
      id: 'cr_1',
      comment: 'Move this closer.',
      status: 'open',
      target: {
        tag: 'button',
        selector: '#save',
        role: 'button',
        text: 'Save',
        classes: 'primary',
        url: 'http://localhost/',
        bounds: { x: 0, y: 0, width: 80, height: 40 },
        styles: {
          display: 'block',
          position: 'static',
          fontFamily: 'Inter',
          fontSize: '14px',
          lineHeight: '20px',
          color: 'black',
          backgroundColor: 'white',
          margin: '0px',
          padding: '8px',
          gap: '0px',
        },
      },
      capture: {
        viewportWidth: 100,
        viewportHeight: 100,
        scrollX: 0,
        scrollY: 0,
        capturedAt: 1,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    expect(isAnnotation(value)).toBe(true);
    expect(Schema.decodeUnknownSync(Annotation)(value).id).toBe('cr_1');
  });

  it('rejects an unknown lifecycle state', () => {
    expect(isAnnotation({ status: 'pending' })).toBe(false);
  });
});
