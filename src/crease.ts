import { Clock, Effect } from 'effect';

import type { AgentConnection, AgentSnapshot } from './agent-contract';
import { type Annotation, makeAnnotation, redactedPageUrl } from './domain';
import { formatJson, formatMarkdown } from './export';
import * as Feedback from './feedback';
import { type FoldkitInspector, withoutModel } from './foldkit-context';
import {
  isInspectable,
  selectorFor,
  snapshotElement,
  spacingToNearestSibling,
} from './geometry';
import { type IconName, icon } from './icons';
import { distanceMarkup, distancesBetween, rulerMarkup } from './measurements';
import { overlayStyles } from './overlay-styles';
import { makeLocalPersistence } from './persistence';

type Mode = 'inspect' | 'annotate' | 'typography' | 'color';
type OutputFormat = 'notes' | 'markdown' | 'json';

export interface CreaseOptions {
  readonly target?: HTMLElement;
  readonly projectId?: string;
  readonly startOpen?: boolean;
  readonly foldkit?: FoldkitInspector;
  readonly agent?: AgentConnection;
}

export interface CreaseHandle {
  readonly destroy: () => void;
  readonly open: () => void;
  readonly close: () => void;
  readonly showOutput: () => void;
}

interface State {
  open: boolean;
  mode: Mode | null;
  hovered: Element | null;
  selected: Element | null;
  feedback: Feedback.Model;
  draft: string;
  editingId: string | null;
  composerOpen: boolean;
  outputOpen: boolean;
  outputFormat: OutputFormat;
  settingsOpen: boolean;
  rulers: boolean;
  xray: boolean;
  pins: boolean;
  alt: boolean;
  includeModel: boolean;
  storageError: boolean;
  shared: boolean;
  sharing: boolean;
  shareError: boolean;
  copyFallback: string | null;
}

const get = <T extends Element>(root: ShadowRoot, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (element === null)
    throw new Error(`Crease overlay element not found: ${selector}`);
  return element;
};

const currentTime = (): number => Effect.runSync(Clock.currentTimeMillis);
const number = (value: number): string => `${Math.round(value * 10) / 10}`;
const tool = (action: string, name: IconName, label: string): string =>
  `<button type="button" data-action="${action}" aria-label="${label}" data-tip="${label}">${icon(name)}</button>`;
const actionButton = (action: string, name: IconName, label: string): string =>
  `<button type="button" class="crease-action" data-action="${action}">${icon(name)}${label}</button>`;

export const mountCrease = (options: CreaseOptions = {}): CreaseHandle => {
  const host = document.createElement('div');
  host.setAttribute('data-crease-root', '');
  host.setAttribute('aria-label', 'Crease visual feedback tools');
  (options.target ?? document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${overlayStyles}</style>
    <div class="crease-layer">
      <div class="crease-visual" aria-hidden="true">
        <svg class="crease-svg" xmlns="http://www.w3.org/2000/svg">
          <g class="crease-xray"></g>
          <rect class="crease-rect is-hover" hidden/>
          <rect class="crease-rect is-selected" hidden/>
          <g class="crease-selection-handles"></g>
          <g class="crease-distances"></g>
          <g class="crease-rulers"></g>
        </svg>
        <div class="crease-hover-label" hidden></div>
        <div class="crease-size-label" hidden></div>
      </div>
      <div class="crease-pins"></div>
      <div class="crease-limit" hidden>Showing up to 500 visible elements</div>
      <section class="crease-panel crease-card" hidden aria-label="Element inspector">
        <div class="crease-card-head">
          <span class="crease-tag"></span><h2 class="crease-card-title"></h2>
          <button class="crease-close" data-action="close-card" aria-label="Close inspector">${icon('close')}</button>
        </div>
        <div class="crease-details"></div>
        <section class="crease-foldkit" hidden aria-label="FoldKit context"></section>
        <div class="crease-composer" hidden>
          <textarea aria-label="Feedback" placeholder="What should change about this element?" maxlength="4000"></textarea>
          <div class="crease-actions"><span class="crease-card-hint">⌘ ↵ to save</span>
            <button class="crease-action" data-action="cancel-composer">Cancel</button>
            <button class="crease-action is-primary" data-action="add">Add note</button>
          </div>
        </div>
        <div class="crease-actions crease-card-actions">
          ${actionButton('copy-selected', 'copy', 'Copy element')}
          ${actionButton('compose', 'note', 'Add a note')}
        </div>
      </section>
      <section class="crease-panel crease-output" hidden aria-label="Agent context">
        <div class="crease-output-head">
          <div><h2 class="crease-output-title">Feedback</h2><p class="crease-subtitle">Local notes. You choose what to share.</p></div>
          <button class="crease-close" data-action="close-output" aria-label="Close feedback">${icon('close')}</button>
        </div>
        <div class="crease-tabs" role="tablist" aria-label="Feedback format">
          <button role="tab" data-output-format="notes" aria-controls="crease-notes">Notes</button>
          <button role="tab" data-output-format="markdown" aria-controls="crease-export">Markdown</button>
          <button role="tab" data-output-format="json" aria-controls="crease-export">JSON</button>
        </div>
        <div class="crease-list" id="crease-notes" role="tabpanel" aria-label="Notes"></div>
        <pre class="crease-output-code" id="crease-export" role="tabpanel" aria-label="Export preview" tabindex="0" hidden></pre>
        <div class="crease-storage-warning" role="status" hidden>Storage unavailable. Notes are in memory only; copy them before closing.</div>
        <div class="crease-agent" hidden>
          <div><strong>Crease MCP</strong><p class="crease-agent-status">Share a read-only snapshot with your local agent.</p></div>
          <div class="crease-actions">${actionButton('unshare', 'close', 'Stop sharing')}${actionButton('share', 'output', 'Share snapshot')}</div>
        </div>
        <div class="crease-output-footer">
          <div class="crease-output-actions">
            <button class="crease-close" data-action="undo" aria-label="Undo annotation change" title="Undo (⌘ Z)">${icon('undo')}</button>
            <button class="crease-close" data-action="redo" aria-label="Redo annotation change" title="Redo (⌘ ⇧ Z)">${icon('redo')}</button>
          </div>
          ${actionButton('copy-output', 'copy', 'Copy for agent')}
        </div>
      </section>
      <section class="crease-panel crease-settings" hidden aria-label="Crease settings">
        <div class="crease-settings-head"><strong class="crease-output-title">Settings</strong><button class="crease-close" data-action="close-settings" aria-label="Close settings">${icon('close')}</button></div>
        <div class="crease-settings-body">
          <label class="crease-setting">Show annotation pins<input type="checkbox" data-setting="pins" checked></label>
          <label class="crease-setting">Viewport rulers<input type="checkbox" data-setting="rulers"></label>
          <label class="crease-setting crease-model-setting" hidden>Include scoped Model & history<input type="checkbox" data-setting="model"></label>
          <p class="crease-subtitle crease-model-setting" hidden>Only developer-registered fields are included. Model values stay out of local storage.</p>
          <p class="crease-subtitle">Notes persist locally. Visual settings apply to this session.</p>
          <div class="crease-shortcuts"><span>Toggle Crease</span><kbd>⌥ ⇧ C</kbd><span>Inspect / annotate</span><span><kbd>I</kbd> <kbd>N</kbd></span><span>Typography / color</span><span><kbd>A</kbd> <kbd>P</kbd></span><span>X-ray / rulers</span><span><kbd>X</kbd> <kbd>R</kbd></span><span>Distance to selected element</span><kbd>hold ⌥</kbd><span>Undo / redo note change</span><span><kbd>⌘ Z</kbd> <kbd>⌘ ⇧ Z</kbd></span><span>Dismiss / exit</span><kbd>esc</kbd></div>
        </div>
      </section>
      <div class="crease-toolbar" role="toolbar" aria-label="Crease tools">
        <button class="crease-launcher" data-action="toggle-open" aria-label="Toggle Crease" data-tip="Toggle Crease · ⌥ ⇧ C">${icon('crease')}</button>
        <div class="crease-toolrow">
          ${tool('annotate', 'note', 'Annotate (N)')}<span class="crease-divider"></span>
          ${tool('inspect', 'inspect', 'Inspect (I)')}
          ${tool('xray', 'xray', 'X-ray (X)')}
          ${tool('rulers', 'ruler', 'Rulers (R)')}
          ${tool('typography', 'type', 'Typography (A)')}
          ${tool('color', 'color', 'Sample color (P)')}<span class="crease-divider"></span>
          <button data-action="open-output" aria-label="Open feedback" data-tip="Feedback & agent context">${icon('output')}<span class="crease-count" hidden></span></button>
          ${tool('settings', 'settings', 'Settings')}
        </div>
      </div>
      <div class="crease-toast" role="status" aria-live="polite" hidden></div>
    </div>`;

  const persistence = makeLocalPersistence(options.projectId ?? 'default');
  const state: State = {
    open: options.startOpen ?? false,
    mode: 'inspect',
    hovered: null,
    selected: null,
    feedback: Feedback.initialModel(Effect.runSync(persistence.load)),
    draft: '',
    editingId: null,
    composerOpen: false,
    outputOpen: false,
    outputFormat: 'notes',
    settingsOpen: false,
    rulers: false,
    xray: false,
    pins: true,
    alt: false,
    includeModel: false,
    storageError: false,
    shared: false,
    sharing: false,
    shareError: false,
    copyFallback: null,
  };
  const runtimeId = Effect.runSync(Effect.sync(() => crypto.randomUUID()));
  const card = get<HTMLElement>(shadow, '.crease-card');
  const details = get<HTMLElement>(shadow, '.crease-details');
  const composer = get<HTMLElement>(shadow, '.crease-composer');
  const textarea = get<HTMLTextAreaElement>(shadow, 'textarea');
  const list = get<HTMLElement>(shadow, '.crease-list');
  const output = get<HTMLElement>(shadow, '.crease-output');
  const outputCode = get<HTMLElement>(shadow, '.crease-output-code');
  const hoverRect = get<SVGRectElement>(shadow, '.is-hover');
  const selectedRect = get<SVGRectElement>(shadow, '.is-selected');
  const hoverLabel = get<HTMLElement>(shadow, '.crease-hover-label');
  const sizeLabel = get<HTMLElement>(shadow, '.crease-size-label');
  const toast = get<HTMLElement>(shadow, '.crease-toast');
  const pins = get<HTMLElement>(shadow, '.crease-pins');
  const toolbar = get<HTMLElement>(shadow, '.crease-toolbar');
  const controller = new AbortController();
  let frame: number | null = null;
  let toastTimer: number | null = null;
  let layoutDirty = true;
  let selectedSelector = '';
  let destroyed = false;

  const showToast = (message: string): void => {
    if (destroyed) return;
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  };

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      shadow.append(input);
      input.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      input.remove();
      if (!copied) {
        state.copyFallback = text;
        state.outputFormat =
          text.startsWith('{') || text.startsWith('[') ? 'json' : 'markdown';
        state.outputOpen = true;
        state.settingsOpen = false;
        render();
        outputCode.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(outputCode);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      showToast(
        copied
          ? 'Copied to clipboard'
          : 'Clipboard unavailable. Select the export text to copy it.',
      );
    }
  };

  const persist = (): boolean => {
    try {
      Effect.runSync(persistence.save(state.feedback.annotations));
      state.storageError = false;
      return true;
    } catch {
      state.storageError = true;
      return false;
    }
  };

  const exportAnnotations = (): ReadonlyArray<Annotation> =>
    state.feedback.annotations.map((annotation) => ({
      ...annotation,
      target: { ...annotation.target, url: redactedPageUrl(annotation.target.url) },
      ...(!state.includeModel && annotation.foldkit !== undefined
        ? { foldkit: withoutModel(annotation.foldkit) }
        : {}),
    }));

  const selectedSnapshot = (): AgentSnapshot['selection'] => {
    if (state.selected === null) return null;
    const foldkit = options.foldkit?.inspect(state.selected, state.includeModel);
    return {
      target: snapshotElement(state.selected),
      ...(foldkit === undefined ? {} : { foldkit }),
    };
  };

  const unshare = async (): Promise<void> => {
    if (options.agent === undefined || !state.shared || state.sharing) return;
    state.sharing = true;
    state.shareError = false;
    render();
    try {
      await options.agent.unshare(runtimeId);
      state.shared = false;
      showToast('Shared snapshot removed from Crease MCP');
    } catch {
      state.shareError = true;
      showToast('Could not stop sharing. Retry while the local dev server is running.');
    } finally {
      state.sharing = false;
      if (!destroyed) render();
    }
  };

  const share = async (): Promise<void> => {
    if (options.agent === undefined || state.sharing) return;
    state.sharing = true;
    state.shareError = false;
    const includedModel = state.includeModel;
    render();
    try {
      await options.agent.share({
        version: 1,
        runtimeId,
        projectId: options.projectId ?? 'default',
        page: `${window.location.origin}${window.location.pathname}`,
        sharedAt: currentTime(),
        selection: selectedSnapshot(),
        annotations: exportAnnotations(),
      });
      if (destroyed || (includedModel && !state.includeModel)) {
        await options.agent.unshare(runtimeId);
        state.shared = false;
        return;
      }
      state.shared = true;
      showToast('Snapshot shared with Crease MCP');
    } catch {
      state.shared = true;
      state.shareError = true;
      showToast(
        'Sharing could not be confirmed. Retry or stop sharing to revoke the snapshot.',
      );
    } finally {
      state.sharing = false;
      if (!destroyed) render();
    }
  };

  const findTarget = (annotation: Annotation): Element | null => {
    try {
      const url = new URL(annotation.target.url);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== window.location.pathname
      )
        return null;
      return document.querySelector(annotation.target.selector);
    } catch {
      return null;
    }
  };

  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(value, maximum));

  const placeCard = (): void => {
    if (card.hidden || state.selected === null) return;
    const bounds = state.selected.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let x = bounds.x + bounds.width / 2 - width / 2;
    let y = bounds.bottom + (state.mode === 'inspect' && !state.composerOpen ? 30 : 10);
    if (y + height > window.innerHeight - 12 && bounds.top - height - 30 > 70)
      y = bounds.top - height - 30;
    else if (
      y + height > window.innerHeight - 12 &&
      bounds.right + width + 24 < window.innerWidth
    ) {
      x = bounds.right + 12;
      y = bounds.top;
    }
    card.style.left = `${clamp(x, 12, window.innerWidth - width - 12)}px`;
    card.style.top = `${clamp(y, 70, window.innerHeight - height - 12)}px`;
  };

  const setRect = (rect: SVGRectElement, element: Element | null): void => {
    const visible = state.open && element !== null && element.isConnected;
    rect.toggleAttribute('hidden', !visible);
    if (!visible || element === null) return;
    const bounds = element.getBoundingClientRect();
    for (const name of ['x', 'y', 'width', 'height'] as const)
      rect.setAttribute(name, `${bounds[name]}`);
  };

  const renderPins = (): void => {
    pins.replaceChildren();
    if (!state.open || !state.pins) return;
    const targetCounts = new Map<Element, number>();
    state.feedback.annotations.forEach((annotation, index) => {
      const target = findTarget(annotation);
      if (target === null) return;
      const bounds = target.getBoundingClientRect();
      if (
        bounds.width === 0 ||
        bounds.height === 0 ||
        bounds.bottom < 0 ||
        bounds.top > window.innerHeight
      )
        return;
      const pin = document.createElement('button');
      pin.className = `crease-pin${annotation.status === 'resolved' ? ' is-resolved' : ''}`;
      pin.textContent = `${index + 1}`;
      pin.dataset.action = 'focus-note';
      pin.dataset.annotationId = annotation.id;
      pin.setAttribute('aria-label', `Annotation ${index + 1}: ${annotation.comment}`);
      pin.title = annotation.comment;
      const ordinal = targetCounts.get(target) ?? 0;
      targetCounts.set(target, ordinal + 1);
      pin.style.left = `${clamp(bounds.right - 10 - ordinal * 25, 4, window.innerWidth - 26)}px`;
      pin.style.top = `${clamp(bounds.top - 12, 4, window.innerHeight - 26)}px`;
      pins.append(pin);
    });
  };

  const renderVisual = (layout: boolean): void => {
    setRect(
      hoverRect,
      state.mode !== null && state.hovered !== state.selected ? state.hovered : null,
    );
    setRect(selectedRect, state.selected);
    const element = state.selected ?? state.hovered;
    const handles = get<SVGGElement>(shadow, '.crease-selection-handles');
    handles.replaceChildren();
    hoverLabel.hidden = !state.open || element === null;
    sizeLabel.hidden =
      hoverLabel.hidden ||
      state.composerOpen ||
      state.mode === 'typography' ||
      state.mode === 'color';
    if (element !== null && state.open) {
      const b = element.getBoundingClientRect();
      hoverLabel.textContent = element.tagName.toLowerCase();
      hoverLabel.style.left = `${clamp(b.x, 4, window.innerWidth - 100)}px`;
      hoverLabel.style.top = `${clamp(b.y - 23, 2, window.innerHeight - 24)}px`;
      sizeLabel.textContent = `${number(b.width)} × ${number(b.height)}`;
      sizeLabel.style.left = `${clamp(b.x + b.width / 2 - 40, 4, window.innerWidth - 100)}px`;
      sizeLabel.style.top = `${clamp(b.bottom + 3, 4, window.innerHeight - 24)}px`;
      if (state.selected !== null)
        handles.innerHTML = [
          { x: b.left, y: b.top },
          { x: b.right, y: b.top },
          { x: b.left, y: b.bottom },
          { x: b.right, y: b.bottom },
        ]
          .map(({ x, y }) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4"/>`)
          .join('');
    }
    get<SVGGElement>(shadow, '.crease-distances').innerHTML =
      state.open &&
      state.alt &&
      state.selected !== null &&
      state.hovered !== null &&
      state.selected !== state.hovered
        ? distanceMarkup(
            distancesBetween(
              state.selected.getBoundingClientRect(),
              state.hovered.getBoundingClientRect(),
            ),
          )
        : '';
    if (!layout) return;
    get<SVGGElement>(shadow, '.crease-rulers').innerHTML =
      state.open && state.rulers
        ? rulerMarkup(window.innerWidth, window.innerHeight)
        : '';
    const xray = get<SVGGElement>(shadow, '.crease-xray');
    xray.replaceChildren();
    get<HTMLElement>(shadow, '.crease-limit').hidden = true;
    if (state.open && state.xray) {
      const outlines: Array<string> = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let scanned = 0;
      while (scanned < 2000 && outlines.length < 500) {
        const element = walker.nextNode();
        if (element === null) break;
        scanned++;
        if (!(element instanceof Element) || element === host || host.contains(element))
          continue;
        const b = element.getBoundingClientRect();
        if (
          b.width <= 0 ||
          b.height <= 0 ||
          b.bottom < 0 ||
          b.top > window.innerHeight ||
          b.right < 0 ||
          b.left > window.innerWidth
        )
          continue;
        outlines.push(
          `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#009dff" stroke-opacity=".24" stroke-width=".7"/>`,
        );
      }
      xray.innerHTML = outlines.join('');
      get<HTMLElement>(shadow, '.crease-limit').hidden =
        outlines.length < 500 && scanned < 2000;
    }
    renderPins();
    placeCard();
  };

  const scheduleVisual = (layout = false): void => {
    layoutDirty ||= layout;
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (state.selected !== null && !state.selected.isConnected) {
        try {
          state.selected = document.querySelector(selectedSelector);
        } catch {
          state.selected = null;
        }
        render();
      } else {
        if (layoutDirty) {
          renderDetails();
          renderFoldkit();
        }
        renderVisual(layoutDirty);
      }
      layoutDirty = false;
    });
  };

  const row = (label: string, value: string): HTMLElement => {
    const container = document.createElement('div');
    container.className = 'crease-detail';
    const key = document.createElement('span');
    key.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    content.title = value;
    container.append(key, content);
    return container;
  };

  const renderDetails = (): void => {
    details.replaceChildren();
    const saved = state.feedback.annotations.find(
      (annotation) => annotation.id === state.editingId,
    );
    const target =
      state.selected === null ? saved?.target : snapshotElement(state.selected);
    if (target === undefined) return;
    get<HTMLElement>(shadow, '.crease-tag').textContent = target.tag;
    get<HTMLElement>(shadow, '.crease-card-title').textContent =
      target.text || target.role || target.tag;
    const selector = document.createElement('code');
    selector.className = 'crease-selector';
    selector.textContent = target.selector;
    if (state.composerOpen) {
      if (state.selected === null)
        details.append(row('Target', 'Detached · showing saved context'));
      details.append(selector);
      return;
    }
    if (state.selected === null) return;
    const style = getComputedStyle(state.selected);
    if (state.mode === 'typography') {
      details.append(
        row('Family', style.fontFamily),
        row('Size', style.fontSize),
        row('Weight', `${style.fontWeight} / ${style.fontStyle}`),
        row('Line', style.lineHeight),
        row('Tracking', style.letterSpacing),
      );
      return;
    }
    if (state.mode === 'color') {
      const hint = document.createElement('p');
      hint.className = 'crease-subtitle';
      hint.textContent = 'Computed CSS colors. Click a swatch to copy.';
      details.append(hint);
      for (const { label, value } of [
        { label: 'Text', value: style.color },
        { label: 'Background', value: style.backgroundColor },
      ]) {
        const swatch = document.createElement('button');
        swatch.className = 'crease-swatch';
        swatch.dataset.action = 'copy-color';
        swatch.dataset.color = value;
        const color = document.createElement('i');
        color.style.backgroundColor = value;
        const content = document.createElement('span');
        const caption = document.createElement('small');
        caption.textContent = label;
        content.append(caption, value);
        swatch.append(color, content);
        swatch.insertAdjacentHTML('beforeend', icon('copy'));
        details.append(swatch);
      }
      return;
    }
    const dimensions = document.createElement('div');
    dimensions.className = 'crease-dimensions';
    dimensions.innerHTML = `<div class="crease-dimension"><span>W</span>${number(target.bounds.width)}</div><div class="crease-dimension"><span>H</span>${number(target.bounds.height)}</div>`;
    details.append(
      dimensions,
      row('Position', `${number(target.bounds.x)}, ${number(target.bounds.y)}`),
      row('Display', style.display),
      row('Padding', style.padding),
      row('Margin', style.margin),
      row('Border', style.borderWidth || '0px'),
      row('Radius', style.borderRadius || '0px'),
    );
    const spacing = spacingToNearestSibling(state.selected);
    if (spacing !== null)
      details.append(row('Distance', `${spacing.value}px ${spacing.axis}`));
    const label = document.createElement('p');
    label.className = 'crease-section-label';
    label.textContent = 'Element locator';
    details.append(label, selector);
  };

  const renderFoldkit = (): void => {
    const panel = get<HTMLElement>(shadow, '.crease-foldkit');
    const historyOpen = panel.querySelector('details')?.open ?? false;
    panel.replaceChildren();
    panel.hidden =
      options.foldkit === undefined || state.selected === null || state.composerOpen;
    if (panel.hidden || state.selected === null) return;
    const context = options.foldkit?.inspect(state.selected, state.includeModel);
    if (context === undefined) {
      panel.hidden = true;
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'crease-foldkit-heading';
    heading.innerHTML = `${icon('crease')}<strong>FoldKit</strong><span>Registered context</span>`;
    panel.append(heading);
    const source = document.createElement('button');
    source.className = 'crease-source';
    source.dataset.action = 'open-source';
    source.dataset.source = `${context.source.file}${context.source.line === undefined ? '' : `:${context.source.line}`}`;
    source.textContent = `${context.source.file}${context.source.line === undefined ? '' : `:${context.source.line}`} → ${context.source.view}`;
    source.title = 'Open registered source in your editor';
    panel.append(source, row('Scope', context.boundary));
    for (const event of context.events) panel.append(row(event.event, event.message));
    const consent = document.createElement('button');
    consent.className = 'crease-action crease-model-toggle';
    consent.dataset.action = 'toggle-model';
    consent.setAttribute('aria-pressed', `${state.includeModel}`);
    consent.textContent = state.includeModel
      ? 'Hide Model & history'
      : 'Include scoped Model & history';
    panel.append(consent);
    const hint = document.createElement('p');
    hint.className = 'crease-subtitle';
    hint.textContent =
      'Opt-in fields may be captured in notes and shared snapshots. Model values are never saved to local storage.';
    panel.append(hint);
    if (context.model === undefined) return;
    const model = document.createElement('pre');
    model.className = 'crease-model-code';
    model.textContent = JSON.stringify(context.model, null, 2);
    panel.append(model);
    const history = document.createElement('details');
    history.className = 'crease-context-history';
    history.open = historyOpen;
    const summary = document.createElement('summary');
    summary.textContent = `Observed scope updates (${context.history?.length ?? 0})`;
    history.append(summary);
    const disclaimer = document.createElement('p');
    disclaimer.className = 'crease-subtitle';
    disclaimer.textContent =
      'Updates observed in this registered scope, not inferred element-to-Command causality.';
    history.append(disclaimer);
    for (const change of [...(context.history ?? [])].reverse()) {
      const item = document.createElement('pre');
      item.className = 'crease-model-code';
      item.textContent = `${change.message}\n${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
      history.append(item);
    }
    panel.append(history);
  };

  const renderNotes = (): void => {
    list.replaceChildren();
    if (state.feedback.annotations.length === 0) {
      list.innerHTML = `<div class="crease-empty">${icon('note')}<strong>A little context goes a long way.</strong><p>Choose Annotate, click an element,<br>and leave your first note.</p></div>`;
      return;
    }
    state.feedback.annotations.forEach((annotation, index) => {
      const item = document.createElement('article');
      item.className = 'crease-list-item';
      const head = document.createElement('div');
      head.className = 'crease-list-item-head';
      const target = document.createElement('button');
      target.className = 'crease-list-target';
      target.dataset.action = 'focus-note';
      target.dataset.annotationId = annotation.id;
      target.textContent = `${index + 1}. ${annotation.target.tag} · ${annotation.target.text || annotation.target.role}`;
      const status = document.createElement('span');
      status.className = `crease-list-item-status${annotation.status === 'open' ? ' is-open' : ''}`;
      status.textContent =
        findTarget(annotation) === null ? 'Detached' : annotation.status;
      head.append(target, status);
      const comment = document.createElement('p');
      comment.className = 'crease-list-item-comment';
      comment.textContent = annotation.comment;
      const actions = document.createElement('div');
      actions.className = 'crease-list-item-actions';
      actions.innerHTML =
        actionButton(
          'toggle-status',
          'check',
          annotation.status === 'open' ? 'Resolve' : 'Reopen',
        ) +
        actionButton('edit-note', 'note', 'Edit') +
        actionButton('delete-annotation', 'trash', 'Delete');
      for (const button of actions.querySelectorAll('button'))
        button.dataset.annotationId = annotation.id;
      item.append(head, comment, actions);
      list.append(item);
    });
  };

  function render(): void {
    get<HTMLElement>(shadow, '.crease-toolrow').hidden = !state.open;
    get<HTMLElement>(shadow, '.crease-launcher').setAttribute(
      'aria-expanded',
      `${state.open}`,
    );
    const count = get<HTMLElement>(shadow, '.crease-count');
    const openCount = state.feedback.annotations.filter(
      (annotation) => annotation.status === 'open',
    ).length;
    count.textContent = `${openCount}`;
    count.hidden = openCount === 0;
    card.hidden =
      !state.open ||
      (state.selected === null && state.editingId === null) ||
      state.outputOpen ||
      state.settingsOpen;
    output.hidden = !state.open || !state.outputOpen;
    get<HTMLElement>(shadow, '.crease-settings').hidden =
      !state.open || !state.settingsOpen;
    composer.hidden = !state.composerOpen;
    get<HTMLElement>(shadow, '.crease-card-actions').hidden = state.composerOpen;
    get<HTMLButtonElement>(shadow, '[data-action="add"]').textContent =
      state.editingId === null ? 'Add note' : 'Save changes';
    get<HTMLButtonElement>(shadow, '[data-action="add"]').disabled =
      state.draft.trim().length === 0;
    renderDetails();
    renderFoldkit();
    renderNotes();
    list.hidden = state.outputFormat !== 'notes';
    outputCode.hidden = state.outputFormat === 'notes';
    outputCode.textContent =
      state.copyFallback ??
      (state.outputFormat === 'json'
        ? formatJson(exportAnnotations())
        : formatMarkdown(exportAnnotations()));
    for (const button of shadow.querySelectorAll<HTMLButtonElement>(
      '[data-output-format]',
    )) {
      const active = button.dataset.outputFormat === state.outputFormat;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', `${active}`);
      button.tabIndex = active ? 0 : -1;
    }
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      const action = button.dataset.action;
      const active =
        action === state.mode ||
        (action === 'rulers' && state.rulers) ||
        (action === 'xray' && state.xray) ||
        (action === 'open-output' && state.outputOpen) ||
        (action === 'settings' && state.settingsOpen);
      button.classList.toggle('is-active', active);
      if (action === 'toggle-open') button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', `${active}`);
    }
    get<HTMLInputElement>(shadow, '[data-setting="pins"]').checked = state.pins;
    get<HTMLInputElement>(shadow, '[data-setting="rulers"]').checked = state.rulers;
    get<HTMLButtonElement>(shadow, '[data-action="undo"]').disabled =
      state.feedback.undo.length === 0;
    get<HTMLButtonElement>(shadow, '[data-action="redo"]').disabled =
      state.feedback.redo.length === 0;
    for (const item of shadow.querySelectorAll<HTMLElement>('.crease-model-setting'))
      item.hidden = options.foldkit === undefined;
    get<HTMLInputElement>(shadow, '[data-setting="model"]').checked =
      state.includeModel;
    get<HTMLElement>(shadow, '.crease-storage-warning').hidden = !state.storageError;
    get<HTMLElement>(shadow, '.crease-agent').hidden = options.agent === undefined;
    get<HTMLButtonElement>(shadow, '[data-action="share"]').disabled = state.sharing;
    get<HTMLButtonElement>(shadow, '[data-action="unshare"]').hidden = !state.shared;
    get<HTMLButtonElement>(shadow, '[data-action="unshare"]').disabled = state.sharing;
    get<HTMLElement>(shadow, '.crease-agent-status').textContent = state.sharing
      ? 'Updating shared snapshot…'
      : state.shareError
        ? 'Shared state could not be confirmed. Retry or stop sharing.'
        : state.shared
          ? 'A captured snapshot is shared. Share again to refresh it.'
          : 'Share a read-only snapshot with your local agent.';
    toolbar.style.transform = state.open && state.rulers ? 'translate(12px, 12px)' : '';
    renderVisual(true);
  }

  const mutate = (change: ReturnType<typeof Feedback.update>): void => {
    state.copyFallback = null;
    state.feedback = change.model;
    const persisted = persist();
    render();
    if (!persisted) showToast('Notes are in memory only. Copy them before closing.');
  };

  const history = (back: boolean): void => {
    const previous = state.feedback;
    mutate(back ? Feedback.undo(state.feedback) : Feedback.redo(state.feedback));
    if (state.feedback === previous || state.storageError) return;
    showToast(back ? 'Annotation change undone' : 'Annotation change redone');
  };

  const select = (element: Element): void => {
    if (state.selected !== element) {
      state.draft = '';
      state.editingId = null;
      textarea.value = '';
    }
    state.selected = element;
    selectedSelector = selectorFor(element);
    state.hovered = null;
    state.outputOpen = false;
    state.settingsOpen = false;
    state.composerOpen = state.mode === 'annotate';
    resizeObserver?.disconnect();
    resizeObserver?.observe(element);
    render();
    if (state.composerOpen) textarea.focus();
  };

  const saveNote = (): void => {
    if (
      (state.selected === null && state.editingId === null) ||
      state.draft.trim().length === 0
    )
      return;
    let change: ReturnType<typeof Feedback.update>;
    if (state.editingId !== null) {
      change = Feedback.edit(
        state.feedback,
        state.editingId,
        state.draft,
        currentTime(),
      );
    } else {
      const selected = selectedSnapshot();
      if (selected === null) return;
      change = Feedback.add(state.feedback, {
        ...makeAnnotation(
          selected.target,
          state.draft,
          currentTime(),
          Effect.runSync(Effect.sync(() => crypto.randomUUID())),
        ),
        ...(selected.foldkit === undefined ? {} : { foldkit: selected.foldkit }),
      });
    }
    state.draft = '';
    state.editingId = null;
    textarea.value = '';
    state.composerOpen = false;
    mutate(change);
    get<HTMLButtonElement>(shadow, '[data-action="compose"]').focus();
    if (!state.storageError) showToast('Note saved locally');
  };

  const close = (): void => {
    state.open = false;
    state.hovered = null;
    state.alt = false;
    render();
  };
  const open = (): void => {
    state.open = true;
    render();
  };
  const showOutput = (): void => {
    state.open = true;
    state.outputOpen = true;
    state.settingsOpen = false;
    state.hovered = null;
    render();
  };
  const setMode = (mode: Mode): void => {
    state.mode = state.mode === mode ? null : mode;
    state.hovered = null;
    state.settingsOpen = false;
    state.outputOpen = false;
    state.composerOpen = state.mode === 'annotate' && state.selected !== null;
    render();
    if (state.composerOpen) textarea.focus();
  };

  const inside = (event: Event): boolean => event.composedPath().includes(host);
  const pick = (event: MouseEvent): Element | null => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element !== null && isInspectable(element, host) ? element : null;
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!state.open || state.mode === null) return;
    const next =
      inside(event) || state.outputOpen || state.settingsOpen ? null : pick(event);
    if (next === state.hovered) return;
    state.hovered = next;
    scheduleVisual();
  };
  const onClick = (event: MouseEvent): void => {
    if (
      !state.open ||
      state.mode === null ||
      inside(event) ||
      state.outputOpen ||
      state.settingsOpen
    )
      return;
    const next = pick(event);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    select(next);
  };

  const onOverlayClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button');
    if (button === null) return;
    const format = button.dataset.outputFormat;
    if (format === 'notes' || format === 'markdown' || format === 'json') {
      state.copyFallback = null;
      state.outputFormat = format;
      render();
      return;
    }
    const action = button.dataset.action;
    if (action === 'toggle-open') state.open ? close() : open();
    else if (
      action === 'inspect' ||
      action === 'annotate' ||
      action === 'typography' ||
      action === 'color'
    )
      setMode(action);
    else if (action === 'rulers' || action === 'xray') {
      state[action] = !state[action];
      render();
    } else if (action === 'close-card') {
      state.selected = null;
      state.composerOpen = false;
      state.editingId = null;
      state.draft = '';
      textarea.value = '';
      render();
    } else if (action === 'compose') {
      state.mode = 'annotate';
      state.composerOpen = true;
      render();
      textarea.focus();
    } else if (action === 'cancel-composer') {
      state.composerOpen = false;
      state.editingId = null;
      state.draft = '';
      textarea.value = '';
      render();
    } else if (action === 'add') saveNote();
    else if (action === 'open-output')
      state.outputOpen ? ((state.outputOpen = false), render()) : showOutput();
    else if (action === 'close-output') {
      state.outputOpen = false;
      render();
      get<HTMLButtonElement>(shadow, '[data-action="open-output"]').focus();
    } else if (action === 'settings') {
      state.settingsOpen = !state.settingsOpen;
      state.outputOpen = false;
      render();
    } else if (action === 'close-settings') {
      state.settingsOpen = false;
      render();
    } else if (action === 'copy-output')
      void copy(
        state.copyFallback ??
          (state.outputFormat === 'json'
            ? formatJson(exportAnnotations())
            : formatMarkdown(exportAnnotations())),
      );
    else if (action === 'copy-selected' && state.selected !== null) {
      const selected = state.selected;
      const annotations = exportAnnotations().filter(
        (annotation) => findTarget(annotation) === selected,
      );
      void copy(
        annotations.length > 0
          ? formatMarkdown(annotations)
          : JSON.stringify(selectedSnapshot(), null, 2),
      );
    } else if (action === 'share') void share();
    else if (action === 'unshare') void unshare();
    else if (action === 'toggle-model') {
      state.includeModel = !state.includeModel;
      render();
      if (!state.includeModel) void unshare();
    } else if (action === 'open-source' && button.dataset.source) {
      void fetch(`/__open-in-editor?file=${encodeURIComponent(button.dataset.source)}`)
        .then((response) => {
          showToast(
            response.ok
              ? 'Requested source in your editor'
              : 'Your editor could not be opened. The registered source path is shown above.',
          );
        })
        .catch(() =>
          showToast('The local development server is required to open source.'),
        );
    } else if (action === 'copy-color' && button.dataset.color)
      void copy(button.dataset.color);
    else if (action === 'undo' || action === 'redo') history(action === 'undo');
    else if (button.dataset.annotationId !== undefined) {
      const annotation = state.feedback.annotations.find(
        (item) => item.id === button.dataset.annotationId,
      );
      if (annotation === undefined) return;
      if (action === 'delete-annotation')
        mutate(Feedback.remove(state.feedback, annotation.id));
      else if (action === 'toggle-status')
        mutate(
          Feedback.changeStatus(
            state.feedback,
            annotation.id,
            annotation.status === 'open' ? 'resolved' : 'open',
            currentTime(),
          ),
        );
      else if (action === 'focus-note' || action === 'edit-note') {
        const element = findTarget(annotation);
        if (element === null) {
          state.selected = null;
          state.outputOpen = false;
          showToast('Editing the saved note; its target is detached.');
        } else {
          element.scrollIntoView({ block: 'center', behavior: 'instant' });
          select(element);
        }
        state.mode = 'annotate';
        state.editingId = annotation.id;
        state.draft = annotation.comment;
        textarea.value = annotation.comment;
        state.composerOpen = true;
        render();
        textarea.focus();
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLButtonElement &&
      target.dataset.outputFormat !== undefined &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
      const tabs = Array.from(
        shadow.querySelectorAll<HTMLButtonElement>('[data-output-format]'),
      );
      const current = tabs.indexOf(target);
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
              tabs.length;
      const next = tabs[index];
      if (next !== undefined) {
        event.preventDefault();
        next.click();
        next.focus();
      }
      return;
    }
    const typing =
      target instanceof Element &&
      (target.matches('input,textarea,select') ||
        target.closest('[contenteditable="true"]') !== null);
    if (event.altKey && event.shiftKey && event.code === 'KeyC' && !typing) {
      event.preventDefault();
      state.open ? close() : open();
      return;
    }
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.outputOpen) state.outputOpen = false;
      else if (state.settingsOpen) state.settingsOpen = false;
      else if (state.composerOpen) state.composerOpen = false;
      else if (state.selected !== null || state.editingId !== null) {
        state.selected = null;
        state.editingId = null;
      } else {
        close();
        return;
      }
      render();
      get<HTMLButtonElement>(shadow, '.crease-launcher').focus();
      return;
    }
    if (
      target === textarea &&
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter'
    ) {
      event.preventDefault();
      saveNote();
      return;
    }
    if (typing) return;
    if (event.key === 'Alt') {
      state.alt = true;
      scheduleVisual();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if ((event.shiftKey ? state.feedback.redo : state.feedback.undo).length > 0) {
        event.preventDefault();
        history(!event.shiftKey);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'i') setMode('inspect');
    else if (key === 'n') setMode('annotate');
    else if (key === 'a') setMode('typography');
    else if (key === 'p') setMode('color');
    else if (key === 'x') {
      state.xray = !state.xray;
      render();
    } else if (key === 'r') {
      state.rulers = !state.rulers;
      render();
    } else return;
    event.preventDefault();
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          renderDetails();
          scheduleVisual(true);
        });
  const mutationObserver = new MutationObserver((records) => {
    if (
      state.open &&
      records.some((record) => record.target !== host && !host.contains(record.target))
    )
      scheduleVisual(true);
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  document.addEventListener('pointermove', onPointerMove, {
    capture: true,
    signal: controller.signal,
  });
  document.addEventListener('click', onClick, {
    capture: true,
    signal: controller.signal,
  });
  window.addEventListener('scroll', () => scheduleVisual(true), {
    capture: true,
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener('resize', () => scheduleVisual(true), {
    signal: controller.signal,
  });
  window.addEventListener('keydown', onKeyDown, { signal: controller.signal });
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Alt') {
        state.alt = false;
        scheduleVisual();
      }
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    'blur',
    () => {
      state.alt = false;
      state.hovered = null;
      scheduleVisual();
    },
    { signal: controller.signal },
  );
  shadow.addEventListener('click', onOverlayClick, { signal: controller.signal });
  shadow.addEventListener('toggle', placeCard, {
    capture: true,
    signal: controller.signal,
  });
  shadow.addEventListener(
    'input',
    (event) => {
      if (event.target === textarea) {
        state.draft = textarea.value;
        get<HTMLButtonElement>(shadow, '[data-action="add"]').disabled =
          state.draft.trim().length === 0;
      }
    },
    { signal: controller.signal },
  );
  shadow.addEventListener(
    'change',
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.dataset.setting === 'pins') state.pins = input.checked;
      if (input.dataset.setting === 'rulers') state.rulers = input.checked;
      if (input.dataset.setting === 'model') {
        state.includeModel = input.checked;
        if (!state.includeModel) void unshare();
      }
      render();
    },
    { signal: controller.signal },
  );
  const unsubscribeContext = options.foldkit?.subscribe(() => scheduleVisual(true));
  render();

  return {
    open,
    close,
    showOutput,
    destroy: () => {
      destroyed = true;
      controller.abort();
      unsubscribeContext?.();
      if (state.shared) void options.agent?.unshare(runtimeId).catch(() => {});
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      host.remove();
    },
  };
};

export { selectorFor };
