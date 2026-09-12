import { Clock, Effect } from 'effect';

import {
  AGENT_COMMAND_TIMEOUT_MS,
  type AgentConnection,
  type AgentSnapshot,
} from './agent-contract.js';
import { type Annotation, makeAnnotation, redactedPageUrl } from './domain.js';
import { formatJson, formatMarkdown } from './export.js';
import * as Feedback from './feedback.js';
import {
  type FoldkitInspector,
  getDefaultFoldkitInspector,
  withoutModel,
} from './foldkit-context.js';
import {
  isInspectable,
  selectorFor,
  snapshotElement,
  spacingToNearestSibling,
} from './geometry.js';
import { type IconName, icon } from './icons.js';
import { distanceMarkup, distancesBetween, rulerMarkup } from './measurements.js';
import { overlayStyles } from './overlay-styles.js';
import { makeLocalPersistence } from './persistence.js';
import {
  type SourceEvidenceOptions,
  enrichAnnotations,
  enrichSelection,
  enrichSnapshot,
} from './source-evidence.js';

type Mode = 'inspect' | 'annotate' | 'typography' | 'color';
type OutputFormat = 'notes' | 'markdown' | 'json';

export interface CreasekitOptions {
  readonly target?: HTMLElement;
  readonly projectId?: string;
  readonly startOpen?: boolean;
  readonly foldkit?: FoldkitInspector;
  readonly agent?: AgentConnection;
  readonly sourceEvidence?: SourceEvidenceOptions;
}

export interface CreasekitHandle {
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
  copyFallback: string | null;
}

const get = <T extends Element>(root: ShadowRoot, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (element === null)
    throw new Error(`creasekit overlay element not found: ${selector}`);
  return element;
};

const currentTime = (): number => Effect.runSync(Clock.currentTimeMillis);
const needsSourceEvidence = (selection: AgentSnapshot['selection']): boolean =>
  selection?.foldkit?.provenance === 'automatic-instrumentation' &&
  (selection.foldkit.source.revision !== undefined ||
    selection.foldkit.elementSource?.revision !== undefined);
const number = (value: number): string => `${Math.round(value * 10) / 10}`;
const tool = (action: string, name: IconName, label: string): string =>
  `<button type="button" data-action="${action}" aria-label="${label}" data-tip="${label}">${icon(name)}</button>`;
const actionButton = (action: string, name: IconName, label: string): string =>
  `<button type="button" class="creasekit-action" data-action="${action}">${icon(name)}${label}</button>`;

const mounts = new WeakMap<
  HTMLElement,
  {
    readonly handle: CreasekitHandle;
    readonly host: HTMLElement;
    readonly configure: (options: CreasekitOptions) => void;
  }
>();

export const mountCreasekit = (options: CreasekitOptions = {}): CreasekitHandle => {
  const target = options.target ?? document.body;
  const existing = mounts.get(target);
  if (existing !== undefined && existing.host.isConnected) {
    existing.configure(options);
    return existing.handle;
  }
  existing?.handle.destroy();
  const defaultInspector = getDefaultFoldkitInspector();
  if (options.foldkit === undefined && defaultInspector !== undefined)
    options = { ...options, foldkit: defaultInspector };
  const host = document.createElement('div');
  host.setAttribute('data-creasekit-root', '');
  host.setAttribute('aria-label', 'creasekit visual feedback tools');
  (options.target ?? document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${overlayStyles}</style>
    <div class="creasekit-layer">
      <div class="creasekit-visual" aria-hidden="true">
        <svg class="creasekit-svg" xmlns="http://www.w3.org/2000/svg">
          <g class="creasekit-xray"></g>
          <rect class="creasekit-rect is-hover" hidden/>
          <rect class="creasekit-rect is-selected" hidden/>
          <g class="creasekit-selection-handles"></g>
          <g class="creasekit-distances"></g>
          <g class="creasekit-rulers"></g>
        </svg>
        <div class="creasekit-hover-label" hidden></div>
        <div class="creasekit-size-label" hidden></div>
      </div>
      <div class="creasekit-pins"></div>
      <div class="creasekit-limit" hidden>Showing up to 500 visible elements</div>
      <section class="creasekit-panel creasekit-card" hidden aria-label="Element inspector">
        <div class="creasekit-card-head">
          <span class="creasekit-tag"></span><h2 class="creasekit-card-title"></h2>
          <button class="creasekit-close" data-action="close-card" aria-label="Close inspector">${icon('close')}</button>
        </div>
        <div class="creasekit-details"></div>
        <section class="creasekit-foldkit" hidden aria-label="FoldKit context"></section>
        <div class="creasekit-composer" hidden>
          <textarea aria-label="Feedback" placeholder="What should change about this element?" maxlength="4000"></textarea>
          <div class="creasekit-actions"><span class="creasekit-card-hint">⌘ ↵ to save</span>
            <button class="creasekit-action" data-action="cancel-composer">Cancel</button>
            <button class="creasekit-action is-primary" data-action="add">Add feedback</button>
          </div>
        </div>
        <div class="creasekit-actions creasekit-card-actions">
          ${actionButton('copy-selected', 'copy', 'Copy element')}
          ${actionButton('compose', 'note', 'Add feedback')}
        </div>
      </section>
      <section class="creasekit-panel creasekit-output" hidden aria-label="Agent context">
        <div class="creasekit-output-head">
          <div><h2 class="creasekit-output-title">Feedback</h2><p class="creasekit-subtitle">Annotations for your agent, right on the page.</p></div>
          <button class="creasekit-close" data-action="close-output" aria-label="Close feedback">${icon('close')}</button>
        </div>
        <div class="creasekit-tabs" role="tablist" aria-label="Feedback format">
          <button role="tab" data-output-format="notes" aria-controls="creasekit-notes">Annotations</button>
          <button role="tab" data-output-format="markdown" aria-controls="creasekit-export">Markdown</button>
          <button role="tab" data-output-format="json" aria-controls="creasekit-export">JSON</button>
        </div>
        <div class="creasekit-list" id="creasekit-notes" role="tabpanel" aria-label="Annotations"></div>
        <pre class="creasekit-output-code" id="creasekit-export" role="tabpanel" aria-label="Export preview" tabindex="0" hidden></pre>
        <div class="creasekit-storage-warning" role="status" hidden>Storage unavailable. Feedback is in memory only; copy it before closing.</div>
        <div class="creasekit-agent" hidden>
          <p class="creasekit-agent-status" role="status">Connecting to your local agent bridge…</p>
        </div>
        <div class="creasekit-output-footer">
          <div class="creasekit-output-actions">
            ${actionButton('clear-annotations', 'trash', 'Clear all')}
            <button class="creasekit-close" data-action="undo" aria-label="Undo annotation change" title="Undo (⌘ Z)">${icon('undo')}</button>
            <button class="creasekit-close" data-action="redo" aria-label="Redo annotation change" title="Redo (⌘ ⇧ Z)">${icon('redo')}</button>
          </div>
          ${actionButton('copy-output', 'copy', 'Copy for agent')}
        </div>
      </section>
      <section class="creasekit-panel creasekit-settings" hidden aria-label="creasekit settings">
        <div class="creasekit-settings-head"><strong class="creasekit-output-title">Settings</strong><button class="creasekit-close" data-action="close-settings" aria-label="Close settings">${icon('close')}</button></div>
        <div class="creasekit-settings-body">
          <label class="creasekit-setting">Show annotation pins<input type="checkbox" data-setting="pins" checked></label>
          <label class="creasekit-setting">Viewport rulers<input type="checkbox" data-setting="rulers"></label>
          <label class="creasekit-setting creasekit-model-setting" hidden>Include scoped Model & history<input type="checkbox" data-setting="model"></label>
          <p class="creasekit-subtitle creasekit-model-setting" hidden>Only scoped, sanitized Model fields are included. Model values stay out of local storage.</p>
          <p class="creasekit-subtitle creasekit-sync-hint">Annotations persist locally. Visual settings apply to this session.</p>
          <p class="creasekit-subtitle">Drag the toolbar grip to move it. Hide or restore everything with Alt+Shift+H.</p>
          <div class="creasekit-shortcuts"><span>Toggle creasekit</span><kbd>⌥ ⇧ C</kbd><span>Inspect / annotate</span><span><kbd>I</kbd> <kbd>N</kbd></span><span>Typography / color</span><span><kbd>A</kbd> <kbd>P</kbd></span><span>X-ray / rulers</span><span><kbd>X</kbd> <kbd>R</kbd></span><span>Distance to selected element</span><kbd>hold ⌥</kbd><span>Undo / redo note change</span><span><kbd>⌘ Z</kbd> <kbd>⌘ ⇧ Z</kbd></span><span>Dismiss / exit</span><kbd>esc</kbd></div>
        </div>
      </section>
      <div class="creasekit-toolbar" role="toolbar" aria-label="creasekit tools">
        <button type="button" class="creasekit-drag" aria-label="Move toolbar" aria-description="Drag to move, or use arrow keys when focused">⠿</button>
        <button class="creasekit-launcher" data-action="toggle-open" aria-label="Toggle creasekit" data-tip="Toggle creasekit · ⌥ ⇧ C">${icon('creasekit')}</button>
        <div class="creasekit-toolrow">
          ${tool('annotate', 'note', 'Annotate (N)')}<span class="creasekit-divider"></span>
          ${tool('inspect', 'inspect', 'Inspect (I)')}
          ${tool('xray', 'xray', 'X-ray (X)')}
          ${tool('rulers', 'ruler', 'Rulers (R)')}
          ${tool('typography', 'type', 'Typography (A)')}
          ${tool('color', 'color', 'Sample color (P)')}<span class="creasekit-divider"></span>
          <button data-action="open-output" aria-label="Open feedback" data-tip="Feedback & agent context">${icon('output')}<span class="creasekit-count" hidden></span></button>
          ${tool('settings', 'settings', 'Settings')}
        </div>
        ${tool('hide', 'close', 'Hide creasekit (Alt+Shift+H)')}
      </div>
      <div class="creasekit-toast" role="status" aria-live="polite" hidden></div>
      <div class="creasekit-tooltip" id="creasekit-tooltip" role="tooltip" hidden></div>
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
    copyFallback: null,
  };
  const runtimeId = Effect.runSync(Effect.sync(() => crypto.randomUUID()));
  const card = get<HTMLElement>(shadow, '.creasekit-card');
  const details = get<HTMLElement>(shadow, '.creasekit-details');
  const composer = get<HTMLElement>(shadow, '.creasekit-composer');
  const textarea = get<HTMLTextAreaElement>(shadow, 'textarea');
  const list = get<HTMLElement>(shadow, '.creasekit-list');
  const output = get<HTMLElement>(shadow, '.creasekit-output');
  const outputCode = get<HTMLElement>(shadow, '.creasekit-output-code');
  const hoverRect = get<SVGRectElement>(shadow, '.is-hover');
  const selectedRect = get<SVGRectElement>(shadow, '.is-selected');
  const hoverLabel = get<HTMLElement>(shadow, '.creasekit-hover-label');
  const sizeLabel = get<HTMLElement>(shadow, '.creasekit-size-label');
  const toast = get<HTMLElement>(shadow, '.creasekit-toast');
  const pins = get<HTMLElement>(shadow, '.creasekit-pins');
  const toolbar = get<HTMLElement>(shadow, '.creasekit-toolbar');
  const layer = get<HTMLElement>(shadow, '.creasekit-layer');
  const dragHandle = get<HTMLButtonElement>(shadow, '.creasekit-drag');
  const tooltip = get<HTMLElement>(shadow, '.creasekit-tooltip');
  let hidden = false;
  let toolbarPosition: { x: number; y: number } | null = null;
  let drag: { pointerId: number; x: number; y: number } | null = null;
  const placeToolbar = (): void => {
    const inset = state.open && state.rulers ? 28 : window.innerWidth <= 480 ? 12 : 16;
    const rect = toolbar.getBoundingClientRect();
    const position = toolbarPosition ?? {
      x: inset,
      y: inset,
    };
    const x = Math.max(0, Math.min(position.x, window.innerWidth - rect.width));
    const y = Math.max(0, Math.min(position.y, window.innerHeight - rect.height));
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
    if (toolbarPosition !== null) toolbarPosition = { x, y };
    for (const panel of [output, get<HTMLElement>(shadow, '.creasekit-settings')]) {
      if (panel.hidden) continue;
      const below = Math.max(0, window.innerHeight - y - rect.height - 20);
      const above = Math.max(0, y - 20);
      panel.style.maxHeight = `${Math.max(0, window.innerHeight - 24)}px`;
      const bounds = panel.getBoundingClientRect();
      const useBelow = bounds.height <= below || below >= above;
      panel.style.maxHeight = `${useBelow ? below : above}px`;
      const height = Math.min(bounds.height, useBelow ? below : above);
      panel.style.left = `${Math.max(12, Math.min(x, window.innerWidth - bounds.width - 12))}px`;
      panel.style.top = `${useBelow ? y + rect.height + 8 : y - height - 8}px`;
    }
  };
  let tooltipTimer: number | null = null;
  let tooltipTarget: HTMLElement | null = null;
  const hideTooltip = (): void => {
    if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
    tooltipTimer = null;
    tooltip.hidden = true;
    tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = null;
  };
  const showTooltip = (event: Event): void => {
    if (drag !== null || hidden || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-tip]');
    if (target === null || target === tooltipTarget) return;
    hideTooltip();
    tooltipTarget = target;
    tooltipTimer = window.setTimeout(() => {
      if (drag !== null || hidden || tooltipTarget !== target) return;
      tooltip.textContent = target.dataset.tip ?? '';
      tooltip.hidden = false;
      const anchor = target.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(anchor.x + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(anchor.bottom + bounds.height + 16 > window.innerHeight ? anchor.top - bounds.height - 8 : anchor.bottom + 8, window.innerHeight - bounds.height - 8))}px`;
      target.setAttribute('aria-describedby', tooltip.id);
    }, 350);
  };
  const controller = new AbortController();
  let frame: number | null = null;
  let toastTimer: number | null = null;
  let layoutDirty = true;
  let selectedSelector = '';
  let destroyed = false;
  let pageInactive = false;
  let pageEpoch = 0;
  let pageRemoval = Promise.resolve();

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

  let evidencePreview:
    | {
        feedback: Feedback.Model;
        includeModel: boolean;
        annotations: ReadonlyArray<Annotation>;
      }
    | undefined;
  let savingNote = false;

  const previewAnnotations = (): ReadonlyArray<Annotation> =>
    evidencePreview?.feedback === state.feedback &&
    evidencePreview.includeModel === state.includeModel
      ? evidencePreview.annotations
      : exportAnnotations();

  const refreshEvidencePreview = async (): Promise<void> => {
    const feedback = state.feedback;
    const includeModel = state.includeModel;
    const annotations = await enrichAnnotations(
      exportAnnotations(),
      options.sourceEvidence,
    );
    if (destroyed || feedback !== state.feedback || includeModel !== state.includeModel)
      return;
    evidencePreview = { feedback, includeModel, annotations };
    if (state.outputOpen) render();
  };

  const copyOutput = async (): Promise<void> => {
    if (state.copyFallback !== null) {
      await copy(state.copyFallback);
      return;
    }
    const format = state.outputFormat;
    const includeModel = state.includeModel;
    const captured = exportAnnotations();
    const annotations = captured.some(needsSourceEvidence)
      ? await enrichAnnotations(captured, options.sourceEvidence)
      : captured;
    if (destroyed || (includeModel && !state.includeModel)) return;
    await copy(
      format === 'json' ? formatJson(annotations) : formatMarkdown(annotations),
    );
  };

  const copySelected = async (): Promise<void> => {
    const selected = state.selected;
    if (selected === null) return;
    const includeModel = state.includeModel;
    const annotations = exportAnnotations().filter(
      (annotation) => findTarget(annotation) === selected,
    );
    const selection = selectedSnapshot();
    const text =
      annotations.length > 0
        ? formatMarkdown(
            annotations.some(needsSourceEvidence)
              ? await enrichAnnotations(annotations, options.sourceEvidence)
              : annotations,
          )
        : JSON.stringify(
            needsSourceEvidence(selection)
              ? await enrichSelection(selection, options.sourceEvidence)
              : selection,
            null,
            2,
          );
    if (destroyed || (includeModel && !state.includeModel)) return;
    await copy(text);
  };

  let syncTimer: number | null = null;
  let syncing = false;
  let syncCompletion = Promise.resolve();
  let syncAgain = false;
  let watching = false;
  const acknowledgedCommands = new Set<string>();
  const syncFeedback = async (): Promise<void> => {
    const agent = options.agent;
    if (destroyed || pageInactive || agent === undefined) return;
    if (syncing) {
      syncAgain = true;
      return syncCompletion;
    }
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncing = true;
    let finishSync = (): void => {};
    syncCompletion = new Promise<void>((resolve) => {
      finishSync = resolve;
    });
    syncAgain = false;
    const includedModel = state.includeModel;
    const epoch = pageEpoch;
    const acknowledgedCommandIds = [...acknowledgedCommands];
    try {
      const feedback = state.feedback;
      const captured: AgentSnapshot = {
        version: 1,
        runtimeId,
        projectId: options.projectId ?? 'default',
        page: `${window.location.origin}${window.location.pathname}`,
        sharedAt: currentTime(),
        selection: selectedSnapshot(),
        annotations: exportAnnotations(),
      };
      const snapshot =
        needsSourceEvidence(captured.selection) ||
        captured.annotations.some(needsSourceEvidence)
          ? await enrichSnapshot(captured, options.sourceEvidence)
          : captured;
      if (
        destroyed ||
        pageInactive ||
        epoch !== pageEpoch ||
        (includedModel && !state.includeModel)
      ) {
        syncAgain = !destroyed && !pageInactive;
        return;
      }
      if (feedback === state.feedback && includedModel === state.includeModel) {
        evidencePreview = {
          feedback,
          includeModel: includedModel,
          annotations: snapshot.annotations,
        };
        if (state.outputOpen) render();
      }
      const commands =
        agent.sync === undefined
          ? (await agent.share(snapshot), [])
          : (await agent.sync({ snapshot, acknowledgedCommandIds })).commands;
      if (epoch !== pageEpoch) {
        if (destroyed || pageInactive) await agent.unshare(runtimeId);
        syncAgain = !destroyed && !pageInactive;
        return;
      }
      if (destroyed || pageInactive || (includedModel && !state.includeModel)) {
        await agent.unshare(runtimeId);
        syncAgain = !destroyed && !pageInactive;
        return;
      }
      for (const id of acknowledgedCommandIds) acknowledgedCommands.delete(id);
      let changed = false;
      for (const command of commands) {
        if (acknowledgedCommands.has(command.id)) continue;
        if (command.createdAt + AGENT_COMMAND_TIMEOUT_MS <= currentTime()) {
          acknowledgedCommands.add(command.id);
          syncAgain = true;
          continue;
        }
        const previous = state.feedback;
        if (command.type === 'delete' && command.annotationId !== undefined)
          state.feedback = Feedback.remove(state.feedback, command.annotationId).model;
        else if (command.type === 'clear')
          state.feedback = Feedback.clear(
            state.feedback,
            command.annotationIds ?? [],
          ).model;
        changed ||= state.feedback !== previous;
        acknowledgedCommands.add(command.id);
        syncAgain = true;
      }
      if (changed) {
        state.feedback = Feedback.initialModel(state.feedback.annotations);
        state.copyFallback = null;
        resetDeletedAnnotation();
        persist();
        render();
      }
      get<HTMLElement>(shadow, '.creasekit-agent-status').textContent =
        agent.sync === undefined
          ? 'Feedback is available to your agent. Update the connection to enable clearing annotations.'
          : 'Annotations synced with your local agent.';
      void watchFeedback();
    } catch {
      if (!destroyed && !pageInactive)
        get<HTMLElement>(shadow, '.creasekit-agent-status').textContent =
          'Feedback could not sync. It stays local; retrying automatically…';
    } finally {
      syncing = false;
      finishSync();
      if (!destroyed && !pageInactive) {
        if (syncAgain) void syncFeedback();
        else syncTimer = window.setTimeout(() => void syncFeedback(), 1000);
      }
    }
  };

  const watchFeedback = async (): Promise<void> => {
    const agent = options.agent;
    if (
      watching ||
      destroyed ||
      pageInactive ||
      agent?.watch === undefined ||
      agent.sync === undefined
    )
      return;
    watching = true;
    try {
      while (!destroyed && !pageInactive && options.agent === agent) {
        await agent.watch(runtimeId, controller.signal);
        if (!destroyed && !pageInactive) await syncFeedback();
      }
    } catch {
      if (!destroyed && !pageInactive)
        get<HTMLElement>(shadow, '.creasekit-agent-status').textContent =
          'Agent bridge reconnecting. Feedback stays local until synchronization resumes.';
    } finally {
      watching = false;
    }
  };

  const resetDeletedAnnotation = (): void => {
    if (
      state.editingId !== null &&
      !state.feedback.annotations.some(
        (annotation) => annotation.id === state.editingId,
      )
    ) {
      state.editingId = null;
      state.draft = '';
      textarea.value = '';
      state.composerOpen = false;
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
      if (annotation.target.reference !== undefined) {
        const matches = document.querySelectorAll(
          `[data-creasekit-ref="${CSS.escape(annotation.target.reference)}"]`,
        );
        const match = matches.length === 1 ? matches[0] : undefined;
        if (
          match === undefined ||
          match.closest('[data-creasekit-private],[data-crease-private]')
        )
          return null;
        const href = annotation.target.location?.href;
        if (href !== undefined && snapshotElement(match).location?.href !== href)
          return null;
        return match;
      }
      if (annotation.foldkit?.provenance === 'automatic-instrumentation')
        return options.foldkit?.resolve?.(annotation.foldkit) ?? null;
      const matches = document.querySelectorAll(annotation.target.selector);
      return matches.length === 1 ? (matches[0] ?? null) : null;
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
      pin.className = 'creasekit-pin';
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
    const handles = get<SVGGElement>(shadow, '.creasekit-selection-handles');
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
    get<SVGGElement>(shadow, '.creasekit-distances').innerHTML =
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
    get<SVGGElement>(shadow, '.creasekit-rulers').innerHTML =
      state.open && state.rulers
        ? rulerMarkup(window.innerWidth, window.innerHeight)
        : '';
    const xray = get<SVGGElement>(shadow, '.creasekit-xray');
    xray.replaceChildren();
    get<HTMLElement>(shadow, '.creasekit-limit').hidden = true;
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
      get<HTMLElement>(shadow, '.creasekit-limit').hidden =
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
    container.className = 'creasekit-detail';
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
    get<HTMLElement>(shadow, '.creasekit-tag').textContent = target.tag;
    get<HTMLElement>(shadow, '.creasekit-card-title').textContent =
      target.text || target.role || target.tag;
    const selector = document.createElement('code');
    selector.className = 'creasekit-selector';
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
      hint.className = 'creasekit-subtitle';
      hint.textContent = 'Computed CSS colors. Click a swatch to copy.';
      details.append(hint);
      for (const { label, value } of [
        { label: 'Text', value: style.color },
        { label: 'Background', value: style.backgroundColor },
      ]) {
        const swatch = document.createElement('button');
        swatch.className = 'creasekit-swatch';
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
    dimensions.className = 'creasekit-dimensions';
    dimensions.innerHTML = `<div class="creasekit-dimension"><span>W</span>${number(target.bounds.width)}</div><div class="creasekit-dimension"><span>H</span>${number(target.bounds.height)}</div>`;
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
    label.className = 'creasekit-section-label';
    label.textContent = 'Element locator';
    details.append(label, selector);
  };

  const renderFoldkit = (): void => {
    const panel = get<HTMLElement>(shadow, '.creasekit-foldkit');
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
    const deployedSource = context.source.verification === 'deployed-build';
    const heading = document.createElement('div');
    heading.className = 'creasekit-foldkit-heading';
    heading.innerHTML = `${icon('creasekit')}<strong>FoldKit</strong><span>${context.provenance === 'automatic-instrumentation' ? 'Automatic context' : 'Registered context'}</span>`;
    panel.append(heading);
    const source = document.createElement('button');
    source.className = 'creasekit-source';
    source.dataset.action = 'open-source';
    source.dataset.source = `${context.source.file}${context.source.line === undefined ? '' : `:${context.source.line}`}${context.source.column === undefined ? '' : `:${context.source.column}`}`;
    source.textContent = `${source.dataset.source} → ${context.source.view}`;
    source.disabled = deployedSource;
    source.title = deployedSource
      ? 'Source from this deployed build; use Copy for agent'
      : 'Open view source in your editor';
    panel.append(source, row('Scope', context.boundary));
    for (const [label, location] of [
      ['Element source', context.elementSource],
      ['Model declaration', context.modelSource?.definition],
    ] as const) {
      if (location === undefined) continue;
      const link = document.createElement('button');
      link.className = 'creasekit-source';
      link.dataset.action = 'open-source';
      link.dataset.source = `${location.file}:${location.line ?? 1}:${location.column ?? 1}`;
      link.textContent = `${label}: ${link.dataset.source}`;
      link.disabled = deployedSource;
      if (deployedSource)
        link.title = 'Source from this deployed build; use Copy for agent';
      panel.append(link);
    }
    if (context.modelSource !== undefined)
      panel.append(
        row(
          'Model supplied',
          `${context.modelSource.expression} (${context.modelSource.file}:${context.modelSource.line}:${context.modelSource.column})`,
        ),
      );
    for (const event of context.events) panel.append(row(event.event, event.message));
    const consent = document.createElement('button');
    consent.className = 'creasekit-action creasekit-model-toggle';
    consent.dataset.action = 'toggle-model';
    consent.setAttribute('aria-pressed', `${state.includeModel}`);
    consent.textContent = state.includeModel
      ? 'Hide Model & history'
      : 'Include scoped Model & history';
    if (!deployedSource) panel.append(consent);
    const hint = document.createElement('p');
    hint.className = 'creasekit-subtitle';
    hint.textContent = deployedSource
      ? 'This public demo uses bundled source evidence. Model capture and local-editor actions are unavailable.'
      : 'Opt-in fields may be captured in feedback and synced with your local agent. Model values are never saved to local storage.';
    panel.append(hint);
    for (const reason of context.availability ?? []) {
      const note = document.createElement('p');
      note.className = 'creasekit-subtitle';
      note.textContent = reason;
      panel.append(note);
    }
    if (context.model === undefined) return;
    const model = document.createElement('pre');
    model.className = 'creasekit-model-code';
    model.textContent = JSON.stringify(context.model, null, 2);
    panel.append(model);
    if (context.history === undefined) return;
    const history = document.createElement('details');
    history.className = 'creasekit-context-history';
    history.open = historyOpen;
    const summary = document.createElement('summary');
    summary.textContent = `Observed scope updates (${context.history?.length ?? 0})`;
    history.append(summary);
    const disclaimer = document.createElement('p');
    disclaimer.className = 'creasekit-subtitle';
    disclaimer.textContent =
      'Updates observed in this registered scope, not inferred element-to-Command causality.';
    history.append(disclaimer);
    for (const change of [...(context.history ?? [])].reverse()) {
      const item = document.createElement('pre');
      item.className = 'creasekit-model-code';
      item.textContent = `${change.message}\n${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
      history.append(item);
    }
    panel.append(history);
  };

  const renderNotes = (): void => {
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (state.feedback.annotations.length === 0) {
      list.innerHTML = `<div class="creasekit-empty">${icon('note')}<strong>Add an annotation.</strong><p>Choose Annotate, click an element,<br>and tell your agent what should change.</p></div>`;
      return;
    }
    state.feedback.annotations.forEach((annotation, index) => {
      const item = document.createElement('article');
      item.className = 'creasekit-list-item';
      item.dataset.annotationId = annotation.id;
      const head = document.createElement('div');
      head.className = 'creasekit-list-item-head';
      const target = document.createElement('button');
      target.className = 'creasekit-list-target';
      target.dataset.action = 'focus-note';
      target.dataset.annotationId = annotation.id;
      const region = annotation.target.location?.region;
      target.textContent = `${index + 1}. ${region !== undefined && region.labelSource !== 'tag' ? region.label : annotation.target.tag} · ${annotation.target.location?.accessibleName ?? (annotation.target.text || annotation.target.role)}`;
      head.append(target);
      if (findTarget(annotation) === null) {
        const detached = document.createElement('span');
        detached.textContent = 'Detached';
        head.append(detached);
      }
      const comment = document.createElement('p');
      comment.className = 'creasekit-list-item-comment';
      comment.textContent = annotation.comment;
      const actions = document.createElement('div');
      actions.className = 'creasekit-list-item-actions';
      actions.innerHTML =
        actionButton('edit-note', 'note', 'Edit') +
        actionButton('delete-annotation', 'trash', 'Delete');
      for (const button of actions.querySelectorAll('button'))
        button.dataset.annotationId = annotation.id;
      item.append(head, comment, actions);
      list.append(item);
    });
    list.scrollTop = scrollTop;
  };

  function render(): void {
    layer.hidden = hidden;
    get<HTMLElement>(shadow, '.creasekit-toolrow').hidden = !state.open;
    get<HTMLElement>(shadow, '.creasekit-launcher').setAttribute(
      'aria-expanded',
      `${state.open}`,
    );
    const count = get<HTMLElement>(shadow, '.creasekit-count');
    const openCount = state.feedback.annotations.length;
    count.textContent = `${openCount}`;
    count.hidden = openCount === 0;
    card.hidden =
      !state.open ||
      (state.selected === null && state.editingId === null) ||
      state.outputOpen ||
      state.settingsOpen;
    output.hidden = !state.open || !state.outputOpen;
    get<HTMLElement>(shadow, '.creasekit-settings').hidden =
      !state.open || !state.settingsOpen;
    composer.hidden = !state.composerOpen;
    get<HTMLElement>(shadow, '.creasekit-card-actions').hidden = state.composerOpen;
    get<HTMLButtonElement>(shadow, '[data-action="add"]').textContent = savingNote
      ? 'Capturing source…'
      : state.editingId === null
        ? 'Add feedback'
        : 'Save changes';
    get<HTMLButtonElement>(shadow, '[data-action="add"]').disabled =
      savingNote || state.draft.trim().length === 0;
    renderDetails();
    renderFoldkit();
    renderNotes();
    list.hidden = state.outputFormat !== 'notes';
    outputCode.hidden = state.outputFormat === 'notes';
    outputCode.textContent =
      state.copyFallback ??
      (state.outputFormat === 'json'
        ? formatJson(previewAnnotations())
        : formatMarkdown(previewAnnotations()));
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
      if (action === 'toggle-open' || action === 'hide')
        button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', `${active}`);
    }
    get<HTMLInputElement>(shadow, '[data-setting="pins"]').checked = state.pins;
    get<HTMLInputElement>(shadow, '[data-setting="rulers"]').checked = state.rulers;
    get<HTMLButtonElement>(shadow, '[data-action="undo"]').disabled =
      state.feedback.undo.length === 0;
    get<HTMLButtonElement>(shadow, '[data-action="redo"]').disabled =
      state.feedback.redo.length === 0;
    for (const item of shadow.querySelectorAll<HTMLElement>('.creasekit-model-setting'))
      item.hidden = options.foldkit === undefined;
    get<HTMLInputElement>(shadow, '[data-setting="model"]').checked =
      state.includeModel;
    get<HTMLElement>(shadow, '.creasekit-storage-warning').hidden = !state.storageError;
    get<HTMLElement>(shadow, '.creasekit-agent').hidden = options.agent === undefined;
    get<HTMLElement>(shadow, '.creasekit-sync-hint').textContent =
      options.agent === undefined
        ? 'Annotations persist locally. Visual settings apply to this session.'
        : 'Annotations persist locally and sync with your agent while this page is loaded, even when the toolbar is hidden.';
    get<HTMLButtonElement>(shadow, '[data-action="clear-annotations"]').disabled =
      state.feedback.annotations.length === 0;
    if (!hidden) placeToolbar();
    renderVisual(true);
  }

  const mutate = (change: ReturnType<typeof Feedback.update>): void => {
    state.copyFallback = null;
    state.feedback = change.model;
    resetDeletedAnnotation();
    const persisted = persist();
    render();
    void syncFeedback();
    if (!persisted) showToast('Feedback is in memory only. Copy it before closing.');
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

  const saveNote = async (): Promise<void> => {
    if (
      savingNote ||
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
      let annotation: Annotation = {
        ...makeAnnotation(
          selected.target,
          state.draft,
          currentTime(),
          Effect.runSync(Effect.sync(() => crypto.randomUUID())),
        ),
        ...(selected.foldkit === undefined ? {} : { foldkit: selected.foldkit }),
      };
      if (needsSourceEvidence(selected)) {
        const feedback = state.feedback;
        const element = state.selected;
        const draft = state.draft;
        savingNote = true;
        render();
        try {
          annotation =
            (await enrichAnnotations([annotation], options.sourceEvidence))[0] ??
            annotation;
        } finally {
          savingNote = false;
        }
        if (destroyed) return;
        if (
          feedback !== state.feedback ||
          element !== state.selected ||
          draft !== state.draft ||
          !state.composerOpen
        ) {
          render();
          return;
        }
        if (!state.includeModel && annotation.foldkit !== undefined)
          annotation = { ...annotation, foldkit: withoutModel(annotation.foldkit) };
      }
      change = Feedback.add(state.feedback, annotation);
    }
    state.draft = '';
    state.editingId = null;
    textarea.value = '';
    state.composerOpen = false;
    mutate(change);
    get<HTMLButtonElement>(shadow, '[data-action="compose"]').focus();
    if (!state.storageError) showToast('Feedback saved');
  };

  const close = (): void => {
    hideTooltip();
    state.open = false;
    state.hovered = null;
    state.alt = false;
    render();
  };
  const open = (): void => {
    hidden = false;
    state.open = true;
    render();
  };
  const showOutput = (): void => {
    hidden = false;
    state.open = true;
    state.outputOpen = true;
    state.settingsOpen = false;
    state.hovered = null;
    render();
    void refreshEvidencePreview();
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
    if (drag !== null && event.pointerId === drag.pointerId) {
      toolbarPosition = { x: event.clientX - drag.x, y: event.clientY - drag.y };
      placeToolbar();
      return;
    }
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
    else if (action === 'hide') {
      hidden = true;
      close();
    } else if (
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
    } else if (action === 'add') void saveNote();
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
    } else if (action === 'copy-output') void copyOutput();
    else if (action === 'copy-selected' && state.selected !== null) {
      void copySelected();
    } else if (action === 'clear-annotations') {
      mutate(Feedback.clear(state.feedback));
      showToast('Feedback cleared. Undo to restore it.');
    } else if (action === 'toggle-model') {
      state.includeModel = !state.includeModel;
      render();
      void syncFeedback();
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
      else if (action === 'focus-note') {
        state.selected = findTarget(annotation);
        state.outputOpen = true;
        state.settingsOpen = false;
        state.outputFormat = 'notes';
        render();
        const item = Array.from(list.children).find(
          (item) =>
            item instanceof HTMLElement && item.dataset.annotationId === annotation.id,
        );
        item?.scrollIntoView({ block: 'nearest' });
      } else if (action === 'edit-note') {
        const element = findTarget(annotation);
        if (element === null) {
          state.selected = null;
          state.outputOpen = false;
          showToast('Editing saved feedback; its target is detached.');
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
    if (event.key === 'Escape') hideTooltip();
    if (
      target === dragHandle &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      const rect = toolbar.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      toolbarPosition = {
        x:
          rect.x +
          (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y:
          rect.y +
          (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      };
      placeToolbar();
      return;
    }
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
    if (event.altKey && event.shiftKey && event.code === 'KeyH' && !typing) {
      event.preventDefault();
      if (!event.repeat) {
        if (hidden) open();
        else {
          hidden = true;
          close();
        }
      }
      return;
    }
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
      get<HTMLButtonElement>(shadow, '.creasekit-launcher').focus();
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
  dragHandle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      hideTooltip();
      const rect = toolbar.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        x: event.clientX - rect.x,
        y: event.clientY - rect.y,
      };
      dragHandle.setPointerCapture(event.pointerId);
      dragHandle.classList.add('is-dragging');
      event.preventDefault();
    },
    { signal: controller.signal },
  );
  const stopDrag = (): void => {
    if (drag !== null && dragHandle.hasPointerCapture(drag.pointerId))
      dragHandle.releasePointerCapture(drag.pointerId);
    drag = null;
    dragHandle.classList.remove('is-dragging');
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    dragHandle.addEventListener(type, stopDrag, { signal: controller.signal });
  document.addEventListener('click', onClick, {
    capture: true,
    signal: controller.signal,
  });
  document.addEventListener('visibilitychange', () => void syncFeedback(), {
    signal: controller.signal,
  });
  window.addEventListener(
    'pagehide',
    () => {
      pageInactive = true;
      pageEpoch += 1;
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      pageRemoval =
        options.agent?.unshare(runtimeId).catch(() => {}) ?? Promise.resolve();
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    'pageshow',
    () => {
      if (!pageInactive) return;
      pageInactive = false;
      void pageRemoval.then(() => syncFeedback());
    },
    { signal: controller.signal },
  );
  window.addEventListener('scroll', () => scheduleVisual(true), {
    capture: true,
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener(
    'resize',
    () => {
      hideTooltip();
      if (!hidden) placeToolbar();
      scheduleVisual(true);
    },
    {
      signal: controller.signal,
    },
  );
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
      stopDrag();
      hideTooltip();
      state.alt = false;
      state.hovered = null;
      scheduleVisual();
    },
    { signal: controller.signal },
  );
  shadow.addEventListener('click', onOverlayClick, { signal: controller.signal });
  for (const type of ['pointerover', 'focusin'])
    shadow.addEventListener(type, showTooltip, { signal: controller.signal });
  for (const type of ['pointerout', 'focusout', 'pointerdown'])
    shadow.addEventListener(type, hideTooltip, { signal: controller.signal });
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
        void syncFeedback();
      }
      render();
    },
    { signal: controller.signal },
  );
  let unsubscribeContext = options.foldkit?.subscribe(() => scheduleVisual(true));
  render();
  void syncFeedback();

  const handle: CreasekitHandle = {
    open,
    close,
    showOutput,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      hideTooltip();
      mounts.delete(target);
      controller.abort();
      unsubscribeContext?.();
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      void options.agent?.unshare(runtimeId).catch(() => {});
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      host.remove();
    },
  };
  mounts.set(target, {
    handle,
    host,
    configure: (next) => {
      if (next.foldkit !== undefined && next.foldkit !== options.foldkit) {
        unsubscribeContext?.();
        unsubscribeContext = next.foldkit.subscribe(() => scheduleVisual(true));
      }
      options = { ...options, ...next };
      render();
      void syncFeedback();
    },
  });
  return handle;
};

export { selectorFor };
