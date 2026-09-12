export const overlayStyles = `
:host { all: initial; color-scheme: light; direction: ltr; font: 12px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, textarea, input { font: inherit; }
button { color: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .32; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid #009dff; outline-offset: 3px; }
button svg { width: 17px; height: 17px; flex-shrink: 0; }
.creasekit-layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font: 12px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; }
.creasekit-visual, .creasekit-svg { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.creasekit-svg { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-rect { fill: #009dff0d; stroke: #008ee5; stroke-width: 1; vector-effect: non-scaling-stroke; }
.creasekit-rect.is-hover { fill: #009dff09; stroke: #009dff; stroke-dasharray: 3 2; }
.creasekit-selection-handles rect { fill: #fff; stroke: #008ee5; }
.creasekit-rulers { fill: #777; font-size: 8px; }
.creasekit-hover-label, .creasekit-size-label { position: fixed; max-width: calc(100vw - 16px); width: max-content; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; background: #009dff; color: #fff; border-radius: 3px; font: 10px/16px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-toolbar { position: fixed; top: 16px; left: 16px; display: flex; align-items: center; width: max-content; height: 42px; padding: 4px; gap: 2px; border: 1px solid #e9e9e9; border-radius: 12px; background: #fffffff5; box-shadow: 0 2px 5px #00000012, 0 4px 16px #00000010; pointer-events: auto; backdrop-filter: blur(16px); }
.creasekit-toolrow { display: flex; align-items: center; gap: 2px; }
.creasekit-toolbar button { position: relative; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 7px; background: transparent; }
.creasekit-toolbar button:hover { background: #f0f0f0; }
.creasekit-toolbar .creasekit-drag { width: 20px; cursor: grab; touch-action: none; user-select: none; font-size: 22px; color: #777; }
.creasekit-toolbar .creasekit-drag.is-dragging { cursor: grabbing; }
.creasekit-toolbar { max-width: calc(100vw - 24px); height: auto; min-height: 42px; }
.creasekit-toolrow { flex-wrap: wrap; min-width: 0; }
.creasekit-toolbar > button { flex-shrink: 0; }
.creasekit-toolbar button.is-active { background: #009dff; color: #fff; }
.creasekit-toolbar .creasekit-launcher { background: #f1f2f4; color: #353b44; }
.creasekit-launcher svg { width: 21px; height: 21px; }
.creasekit-divider { align-self: stretch; width: 1px; margin: -4px 4px; background: #e9e9e9; }
.creasekit-tooltip { position: fixed; width: max-content; max-width: calc(100vw - 16px); padding: 5px 8px; border-radius: 5px; background: #23252a; color: #fff; font-size: 11px; pointer-events: none; box-shadow: 0 2px 6px #0002; overflow-wrap: anywhere; }
.creasekit-count { position: absolute; top: -2px; right: -2px; display: grid; place-items: center; min-width: 14px; height: 14px; padding: 0 3px; border: 2px solid #fff; border-radius: 10px; background: #009dff; color: #fff; font-size: 8px; }
.creasekit-panel { position: fixed; width: min(320px, calc(100vw - 24px)); max-height: calc(100vh - 92px); overflow: auto; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; box-shadow: 0 2px 5px #00000014, 0 7px 24px #00000014; pointer-events: auto; }
.creasekit-card { top: 74px; left: 16px; }
.creasekit-card-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px; }
.creasekit-tag { max-width: 90px; overflow: hidden; text-overflow: ellipsis; padding: 1px 5px; background: #202632; color: #fff; border-radius: 3px; font: 10px/16px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-card-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #81858d; font-size: 11px; font-weight: 400; margin: 0; }
.creasekit-close { display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 4px; background: none; color: #92969d; }
.creasekit-close svg { width: 13px; height: 13px; }
.creasekit-close:hover { background: #f1f2f4; color: #111; }
.creasekit-details { padding: 0 12px 12px; }
.creasekit-section-label { margin: 12px 0 7px; color: #9b9da2; text-transform: uppercase; letter-spacing: .07em; font-size: 9px; }
.creasekit-detail { display: flex; align-items: baseline; gap: 12px; margin: 5px 0; font-size: 11px; }
.creasekit-detail > span { flex: 0 0 68px; color: #898d96; }
.creasekit-detail > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #353943; font: 10px/16px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-dimensions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 1px 0 12px; }
.creasekit-dimension { padding: 7px 9px; border-radius: 5px; background: #f7f8f9; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-dimension span { display: inline-block; min-width: 22px; color: #969ba4; }
.creasekit-selector { display: block; padding: 8px; border: 1px solid #eceef0; border-radius: 5px; background: #fafafa; color: #858a94; font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; max-height: 58px; overflow: auto; }
.creasekit-swatch { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; margin-top: 6px; border: 1px solid #eceef0; border-radius: 6px; background: #fff; text-align: left; }
.creasekit-swatch i { width: 24px; height: 24px; border: 1px solid #0002; border-radius: 5px; }
.creasekit-swatch span { flex: 1; font: 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-swatch small { display: block; color: #989ba3; font: 10px/1.5 Inter, sans-serif; }
.creasekit-swatch svg { width: 13px; color: #999; }
.creasekit-composer { padding: 0 12px 12px; }
.creasekit-composer textarea { display: block; width: 100%; min-height: 100px; max-height: 220px; resize: vertical; padding: 10px; border: 1px solid #dfe3e8; border-radius: 7px; color: #292d34; background: #fff; font-size: 12px; line-height: 1.6; }
.creasekit-composer textarea::placeholder { color: #a0a4ab; }
.creasekit-composer textarea:focus { border-color: #009dff; outline: none; box-shadow: 0 0 0 3px #009dff12; }
.creasekit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 9px; }
.creasekit-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; padding: 5px 9px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; color: #686d77; font-size: 11px; }
.creasekit-action:hover { background: #f8f9fa; color: #202124; }
.creasekit-action svg { width: 13px; height: 13px; }
.creasekit-action.is-primary { color: #fff; background: #009dff; border-color: #009dff; }
.creasekit-action.is-primary:hover { background: #008ee5; }
.creasekit-card-actions { justify-content: space-between; margin: 0; padding: 10px 12px; border-top: 1px solid #eff0f2; }
.creasekit-card-hint { margin: 0; color: #a1a5ad; font-size: 10px; }
.creasekit-pin { position: fixed; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 2px solid #fff; border-radius: 50% 50% 50% 4px; box-shadow: 0 2px 5px #007ab440; background: #009dff; color: #fff; font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events: auto; }
.creasekit-pin:hover { transform: scale(1.15); }
.creasekit-output { left: 16px; top: 70px; width: min(400px, calc(100vw - 24px)); }
.creasekit-output-head, .creasekit-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #eff0f2; }
.creasekit-output-title { font-size: 12px; font-weight: 500; margin: 0; }
.creasekit-subtitle { margin: 2px 0 0; color: #9499a2; font-size: 10px; }
.creasekit-output-actions { display: flex; align-items: center; gap: 5px; }
.creasekit-tabs { display: flex; gap: 4px; padding: 10px 12px; }
.creasekit-tabs button { flex: 1; padding: 5px 8px; border: none; border-radius: 5px; background: transparent; color: #8b909a; font-size: 11px; }
.creasekit-tabs button.is-active { background: #f0f2f5; color: #2b3038; }
.creasekit-output-code { max-height: min(440px, calc(100vh - 280px)); overflow: auto; margin: 0 12px 12px; padding: 12px; border: 1px solid #eef0f3; border-radius: 7px; background: #fafbfc; color: #616b7c; font: 10px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.creasekit-output-footer { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-top: 1px solid #eff0f2; }
.creasekit-list { display: grid; gap: 8px; max-height: min(430px, calc(100vh - 280px)); overflow: auto; padding: 0 12px 12px; }
.creasekit-list-item { border: 1px solid #e9ecf0; border-radius: 8px; padding: 10px; }
.creasekit-list-item-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #9297a0; font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-list-target { max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: none; color: #5a6575; text-align: left; font: inherit; }
.creasekit-list-item-comment { margin: 9px 0; color: #434a54; font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.creasekit-conversation-author { margin-top: 10px; color: #626d7e; font-size: 10px; }
.creasekit-list-item-actions { display: flex; gap: 5px; }
.creasekit-list-item-actions .creasekit-action { min-height: 24px; padding: 3px 6px; font-size: 10px; }
.creasekit-conversation { display: grid; gap: 8px; margin-top: 10px; }
.creasekit-message { padding: 8px 10px; border-radius: 7px; background: #f5f6f8; }
.creasekit-message.is-agent { background: #eef7fd; }
.creasekit-message strong { color: #626d7e; font-size: 10px; font-weight: 500; }
.creasekit-message p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.creasekit-reply { display: block; width: 100%; min-height: 52px; max-height: 150px; resize: vertical; margin-top: 10px; padding: 8px; border: 1px solid #e1e5ea; border-radius: 6px; background: #fff; color: #434a54; }
.creasekit-send-reply { margin-top: 6px; }
.creasekit-empty { padding: 25px 18px 30px; text-align: center; color: #959ba5; }
.creasekit-empty svg { display: block; width: 28px; height: 28px; margin: 0 auto 12px; color: #bbc2cd; }
.creasekit-empty strong { display: block; color: #454d59; font-size: 12px; font-weight: 500; }
.creasekit-empty p { margin: 6px 0 0; font-size: 11px; }
.creasekit-settings { left: 16px; top: 70px; }
.creasekit-settings-body { padding: 2px 14px 14px; }
.creasekit-setting { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f2f4; }
.creasekit-setting input { accent-color: #009dff; width: 15px; height: 15px; }
.creasekit-shortcuts { display: grid; grid-template-columns: 1fr auto; gap: 8px; color: #828993; font-size: 11px; padding-top: 14px; }
kbd { display: inline-block; padding: 0 4px; border: 1px solid #e7e9ed; border-radius: 3px; color: #9299a4; background: #fafbfc; font: 10px/17px ui-monospace, SFMono-Regular, Menlo, monospace; }
.creasekit-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 8px 13px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; box-shadow: 0 3px 12px #0001; color: #555e6a; font-size: 11px; }
.creasekit-limit { position: fixed; top: 72px; right: 16px; padding: 4px 7px; background: #fff; border: 1px solid #eee; border-radius: 5px; color: #999; font-size: 10px; }
.creasekit-foldkit { margin: 0 12px 12px; padding-top: 10px; border-top: 1px solid #e9ecef; }
.creasekit-foldkit-heading { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 11px; }
.creasekit-foldkit-heading img { width: 15px; height: 15px; }
.creasekit-foldkit-heading strong { font-weight: 500; }
.creasekit-foldkit-heading span { margin-left: auto; color: #929aa3; font-size: 9px; }
.creasekit-source { display: block; max-width: 100%; padding: 0; border: 0; background: none; color: #007cb6; font: 10px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: left; overflow-wrap: anywhere; }
.creasekit-source:hover { text-decoration: underline; }
.creasekit-model-toggle { margin: 7px 0; width: 100%; }
.creasekit-model-code { margin: 8px 0; padding: 8px; max-height: 150px; overflow: auto; border: 1px solid #e7ebef; border-radius: 5px; background: #f8fafb; color: #475563; font: 10px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.creasekit-context-history summary { color: #6f7b88; cursor: pointer; font-size: 10px; padding: 3px 0; }
.creasekit-agent { margin: 0 12px 12px; padding: 10px; border: 1px solid #e1e8df; border-radius: 7px; background: #fafcf8; }
.creasekit-agent strong { font-size: 11px; font-weight: 500; }
.creasekit-agent-status { margin: 3px 0 0; color: #798371; font-size: 10px; }
.creasekit-storage-warning { margin: 0 12px 12px; padding: 8px; border-radius: 5px; background: #fff7e2; color: #8d6618; font-size: 11px; }
@media (max-width: 480px) { .creasekit-toolbar { left: 12px; top: 12px; gap: 0; } .creasekit-toolbar button { width: 30px; } .creasekit-toolrow { gap: 0; } .creasekit-divider { margin-inline: 3px; } .creasekit-output, .creasekit-settings { left: 12px; top: 66px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
`;
