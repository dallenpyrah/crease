import {
  type Bounds,
  type ElementStyles,
  type ElementTarget,
  redactedPageUrl,
} from './domain.js';

const MAX_TEXT_LENGTH = 120;

const escapeSelector = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
};

const implicitRole = (element: Element): string => {
  const explicitRole = element.getAttribute('role');
  if (explicitRole !== null && explicitRole.length > 0) {
    return explicitRole;
  }

  const roles: Record<string, string> = {
    a: 'link',
    article: 'article',
    button: 'button',
    dialog: 'dialog',
    form: 'form',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    img: 'img',
    input: 'textbox',
    li: 'listitem',
    nav: 'navigation',
    progress: 'progressbar',
    table: 'table',
  };
  return roles[element.tagName.toLowerCase()] ?? '';
};

const visibleText = (element: Element): string => {
  if (
    element.closest(
      '[data-creasekit-private], [data-crease-private], input, textarea, select',
    ) !== null
  )
    return '[redacted]';
  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) return '';
  for (const privateElement of clone.querySelectorAll(
    'script, style, [hidden], [aria-hidden="true"], [data-creasekit-private], [data-crease-private], input, textarea, select, [data-creasekit-root]',
  ))
    privateElement.remove();
  return (clone.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
};

const elementBounds = (element: Element): Bounds => {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  };
};

const elementStyles = (element: Element): ElementStyles => {
  const styles = getComputedStyle(element);
  return {
    display: styles.display,
    position: styles.position,
    fontFamily: styles.fontFamily,
    fontSize: styles.fontSize,
    lineHeight: styles.lineHeight,
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    margin: styles.margin,
    padding: styles.padding,
    gap: styles.gap,
  };
};

const sameTagSiblings = (element: Element): Array<Element> => {
  const parent = element.parentElement;
  if (parent === null) {
    return [];
  }
  return Array.from(parent.children).filter(
    (sibling) => sibling.tagName === element.tagName,
  );
};

export const selectorFor = (element: Element): string => {
  const parts: Array<string> = [];
  let current: Element | null = element;

  while (current !== null && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    if (current.id.length > 0) {
      parts.unshift(`#${escapeSelector(current.id)}`);
      break;
    }

    const stableTarget = current.getAttribute('data-creasekit-target');
    if (
      stableTarget &&
      document.querySelectorAll(
        `[data-creasekit-target="${escapeSelector(stableTarget)}"]`,
      ).length === 1
    ) {
      parts.unshift(`[data-creasekit-target="${escapeSelector(stableTarget)}"]`);
      break;
    }

    const siblings = sameTagSiblings(current);
    const siblingIndex = siblings.indexOf(current);
    const classNames = Array.from(current.classList).filter(Boolean).slice(0, 2);
    const classes = classNames.map((name) => `.${escapeSelector(name)}`).join('');
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblingIndex + 1})` : '';
    parts.unshift(`${tag}${classes}${suffix}`);

    if (current.parentElement?.id.length) {
      parts.unshift(`#${escapeSelector(current.parentElement.id)}`);
      break;
    }
    current = current.parentElement;
  }

  return parts.join(' > ');
};

export const snapshotElement = (element: Element): ElementTarget => ({
  tag: element.tagName.toLowerCase(),
  selector: selectorFor(element),
  role: implicitRole(element),
  text: visibleText(element),
  classes: element.getAttribute('class') ?? '',
  url: redactedPageUrl(window.location.href),
  bounds: elementBounds(element),
  styles: elementStyles(element),
});

export const spacingToNearestSibling = (
  element: Element,
): { readonly axis: 'horizontal' | 'vertical'; readonly value: number } | null => {
  const parent = element.parentElement;
  if (parent === null) {
    return null;
  }
  const current = element.getBoundingClientRect();
  const sibling = Array.from(parent.children)
    .filter((candidate) => candidate !== element)
    .map((candidate) => ({
      element: candidate,
      rect: candidate.getBoundingClientRect(),
    }))
    .map((candidate) => {
      const horizontal = Math.max(
        0,
        Math.max(
          candidate.rect.left - current.right,
          current.left - candidate.rect.right,
        ),
      );
      const vertical = Math.max(
        0,
        Math.max(
          candidate.rect.top - current.bottom,
          current.top - candidate.rect.bottom,
        ),
      );
      if (horizontal > 0 && vertical === 0) {
        return { axis: 'horizontal' as const, value: horizontal };
      }
      if (vertical > 0 && horizontal === 0) {
        return { axis: 'vertical' as const, value: vertical };
      }
      return null;
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => left.value - right.value)[0];

  return sibling === undefined
    ? null
    : { axis: sibling.axis, value: Math.round(sibling.value * 10) / 10 };
};

export const isInspectable = (element: Element, ignoredRoot: Element): boolean =>
  element !== ignoredRoot &&
  !ignoredRoot.contains(element) &&
  element instanceof HTMLElement &&
  element.getBoundingClientRect().width > 0 &&
  element.getBoundingClientRect().height > 0;
