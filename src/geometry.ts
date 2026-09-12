import {
  type Bounds,
  type ElementLocation,
  type ElementStyles,
  type ElementTarget,
  redactedPageUrl,
} from './domain.js';

const MAX_TEXT_LENGTH = 120;
const PRIVATE_SELECTOR =
  '[data-creasekit-private], [data-crease-private], [data-creasekit-root]';

const automaticReference = (element: Element): string | undefined => {
  const reference = element.getAttribute('data-creasekit-ref');
  return reference !== null && /^ck_[0-9a-f-]{36}$/i.test(reference)
    ? reference
    : undefined;
};

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
    const reference = automaticReference(current);
    if (
      reference !== undefined &&
      document.querySelectorAll(`[data-creasekit-ref="${reference}"]`).length === 1
    ) {
      parts.unshift(`[data-creasekit-ref="${reference}"]`);
      break;
    }
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

const accessibleLabel = (
  element: Element,
): { label: string; labelSource: 'aria-label' | 'aria-labelledby' } | undefined => {
  if (element.closest(PRIVATE_SELECTOR)) return undefined;
  const ids = element.getAttribute('aria-labelledby')?.trim().split(/\s+/).slice(0, 10);
  const labels = ids?.map((id) => document.getElementById(id));
  if (
    labels?.length &&
    labels.every((label) => label !== null && !label.closest(PRIVATE_SELECTOR))
  ) {
    const label = labels
      .map((label) => (label === null ? '' : visibleText(label)))
      .join(' ')
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
    if (label) return { label, labelSource: 'aria-labelledby' };
  }
  const label = element
    .getAttribute('aria-label')
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return label ? { label, labelSource: 'aria-label' } : undefined;
};

const locationFor = (element: Element): ElementLocation => {
  const location: { -readonly [K in keyof ElementLocation]: ElementLocation[K] } = {
    pagePath: window.location.pathname,
  };
  if (element.closest(`${PRIVATE_SELECTOR}, input, textarea, select`)) return location;
  const pageHeading = Array.from(
    document.querySelectorAll('main h1, [role="main"] h1, body > h1'),
  ).find((heading) => !heading.closest(PRIVATE_SELECTOR));
  if (pageHeading !== undefined) {
    const label = visibleText(pageHeading);
    if (label) location.pageHeading = label;
  }
  const regions =
    'nav, main, aside, section, [role="list"], [role="listbox"], [role="grid"], [role="table"], [role="region"], [role="navigation"]';
  const region = element.parentElement?.closest(regions);
  if (region !== null && region !== undefined && !region.closest(PRIVATE_SELECTOR)) {
    const explicit = accessibleLabel(region);
    const heading = Array.from(region.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
      (candidate) =>
        candidate.closest(regions) === region && !candidate.closest(PRIVATE_SELECTOR),
    );
    const headingLabel = heading === undefined ? '' : visibleText(heading);
    location.region = {
      role: region.getAttribute('role') ?? region.tagName.toLowerCase(),
      ...(explicit ?? {
        label: headingLabel || region.tagName.toLowerCase(),
        labelSource: headingLabel ? 'heading' : 'tag',
      }),
    };
  }
  const name = accessibleLabel(element);
  if (name !== undefined) location.accessibleName = name.label;
  const row = element.closest(
    'li, article, tr, [role="listitem"], [role="row"], [role="option"]',
  );
  if (row !== null && row.parentElement !== null) {
    const siblings = Array.from(row.parentElement.children).filter(
      (candidate) =>
        candidate.tagName === row.tagName &&
        candidate.getAttribute('role') === row.getAttribute('role') &&
        !candidate.matches('[hidden], [aria-hidden="true"]') &&
        !candidate.closest(PRIVATE_SELECTOR) &&
        getComputedStyle(candidate).display !== 'none',
    );
    const index = siblings.indexOf(row);
    if (index >= 0)
      location.position = {
        index: index + 1,
        total: siblings.length,
        kind: 'rendered-sibling',
      };
  }
  const current =
    element.getAttribute('aria-current') ?? row?.getAttribute('aria-current');
  if (
    current &&
    ['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(current)
  )
    location.current = current;
  const selected =
    element.getAttribute('aria-selected') ?? row?.getAttribute('aria-selected');
  if (selected === 'true' || selected === 'false')
    location.selected = selected === 'true';
  const link = element.closest('a[href]');
  if (link !== null) {
    try {
      const href = new URL(link.getAttribute('href') ?? '', window.location.href);
      if (
        href.origin === window.location.origin &&
        !href.username &&
        !href.password &&
        ['http:', 'https:'].includes(href.protocol)
      )
        location.href = redactedPageUrl(href.href);
    } catch {}
  }
  return location;
};

export const snapshotElement = (element: Element): ElementTarget => {
  const reference = element.closest(PRIVATE_SELECTOR)
    ? undefined
    : automaticReference(element);
  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
    role: implicitRole(element),
    text: visibleText(element),
    classes: element.getAttribute('class') ?? '',
    url: redactedPageUrl(window.location.href),
    bounds: elementBounds(element),
    styles: elementStyles(element),
    ...(reference === undefined ? {} : { reference }),
    location: locationFor(element),
  };
};

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
