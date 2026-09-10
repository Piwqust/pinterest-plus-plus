export const ICONS = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8v-4m0 0h4M5 4l3 3a7 7 0 1 1-1.4 7.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  smaller: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  larger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
};

export const SHADOW_CSS = `
  :host {
    all: initial;
    --ppp-ink: #2f2f2e;
    --ppp-muted: #787774;
    --ppp-subtle: #f7f6f3;
    --ppp-surface: #ffffff;
    --ppp-border: #eaeaea;
    --ppp-accent: #9f2f2d;
    --ppp-accent-soft: #fdebec;
    --ppp-focus: rgba(159, 47, 45, .3);
  }
  *, *::before, *::after { box-sizing: border-box; }
  .ppp-layer {
    position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
    color: var(--ppp-ink); font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Helvetica Neue", Arial, sans-serif;
  }
  button, input { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  .ppp-pin-actions {
    display: inline-flex; align-items: center; gap: 6px; margin-right: 2px; padding: 0; line-height: 0; vertical-align: middle;
    background: transparent; transition: opacity 120ms ease-out;
  }
  /* A grid tile keeps its buttons out of the way until the pin is pointed at
     or they take focus, the way Pinterest treats its own tile controls. */
  :host([data-ppp-hidden="true"]) .ppp-pin-actions { opacity: 0; pointer-events: none; }
  .ppp-action {
    appearance: none; position: relative; isolation: isolate; width: 28px; height: 28px; min-width: 28px; margin: 0; padding: 0; border: 0; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--ppp-ink); background: transparent; cursor: pointer;
    transition: color 140ms ease-out, background 140ms ease-out, transform 140ms ease-out;
  }
  .ppp-action::before {
    position: absolute; inset: 0; z-index: -1; border-radius: inherit; content: "";
    background: rgba(0, 0, 0, .07); opacity: 0; transform: none;
    transition: opacity 140ms ease-out;
  }
  @media (hover: hover) and (pointer: fine) {
    .ppp-action:hover::before { opacity: 1; }
    .ppp-action:hover { color: var(--ppp-ink); }
  }
  .ppp-action:active { transform: scale(.97); }
  .ppp-action:active::before { opacity: 1; }
  .ppp-action:focus-visible { outline: 2px solid var(--ppp-focus); outline-offset: 2px; }
  .ppp-action:disabled { cursor: wait; opacity: .58; }
  .ppp-action svg, .ppp-reset svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .ppp-action span { display: none; }
  /* On the grid the pair floats over a pin's own media, so it carries the
     surface the extension uses elsewhere rather than borrowing Pinterest's. */
  .ppp-pin-actions[data-scope="grid"] {
    gap: 2px; margin: 0; padding: 2px;
    border: 1px solid var(--ppp-border); border-radius: 9px;
    background: var(--ppp-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .18);
  }
  .ppp-pin-actions[data-scope="grid"] .ppp-action { border-radius: 7px; }
  /* The close-up's action bar is built from larger controls than a grid tile's. */
  .ppp-pin-actions[data-scope="closeup"] { gap: 4px; margin-right: 0; }
  .ppp-pin-actions[data-scope="closeup"] .ppp-action { width: 40px; height: 40px; min-width: 40px; }
  .ppp-pin-actions[data-scope="closeup"] .ppp-action svg { width: 21px; height: 21px; }
  .ppp-grid-shell {
    position: fixed; right: 14px; bottom: 14px; pointer-events: auto;
    opacity: .7; transition: opacity 140ms ease-out;
  }
  .ppp-grid-shell:hover, .ppp-grid-shell:focus-within,
  .ppp-grid-shell:has(.ppp-grid-panel[aria-busy="true"]),
  .ppp-grid-shell:has(.ppp-grid-status[data-visible="true"]) { opacity: 1; }
  .ppp-grid-panel {
    width: 196px; padding: 4px 8px 6px; border: 1px solid var(--ppp-border); border-radius: 9px;
    display: grid; row-gap: 2px; background: var(--ppp-surface); pointer-events: auto;
  }
  .ppp-picker-eyebrow { color: var(--ppp-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .ppp-grid-foot { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; column-gap: 2px; }
  .ppp-grid-value { padding: 0 2px; color: var(--ppp-muted); background: transparent; font-family: "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; text-align: center; white-space: nowrap; }
  .ppp-range-row { display: block; min-width: 0; }
  .ppp-range { appearance: none; display: block; width: 100%; height: 22px; margin: 0; border: 0; background: transparent; cursor: ew-resize; -webkit-appearance: none; }
  .ppp-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--ppp-border); }
  .ppp-range::-webkit-slider-thumb { width: 13px; height: 13px; margin-top: -4.5px; border: 2px solid var(--ppp-surface); border-radius: 50%; background: var(--ppp-ink); box-shadow: 0 0 0 1px var(--ppp-border); -webkit-appearance: none; }
  .ppp-range:disabled { cursor: not-allowed; opacity: .52; }
  .ppp-grid-status { display: none; margin: 2px 0 2px; padding: 6px 7px; border: 1px solid #f1d5d6; border-radius: 6px; color: var(--ppp-accent); background: var(--ppp-accent-soft); font-size: 11px; font-weight: 600; line-height: 1.3; }
  .ppp-grid-status[data-visible="true"] { display: block; }
  .ppp-reset, .ppp-step {
    appearance: none; width: 22px; height: 22px; margin: 0; padding: 0; border: 0; border-radius: 5px; display: grid; place-items: center;
    color: var(--ppp-muted); background: transparent; cursor: pointer; transition: background 140ms ease-out, color 140ms ease-out, transform 140ms ease-out;
  }
  .ppp-reset svg { width: 12px; height: 12px; }
  .ppp-step svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .ppp-reset span, .ppp-step span { display: none; }
  .ppp-reset:hover, .ppp-step:hover:not(:disabled) { color: var(--ppp-ink); background: var(--ppp-subtle); }
  .ppp-reset:active, .ppp-step:active:not(:disabled) { transform: scale(.94); }
  .ppp-step:disabled { cursor: default; opacity: .3; }
  .ppp-reset:focus-visible, .ppp-step:focus-visible, .ppp-range:focus-visible { outline: 2px solid var(--ppp-focus); outline-offset: 1px; }
  .ppp-toast {
    position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom)); max-width: min(420px, calc(100vw - 36px)); padding: 11px 15px;
    border: 1px solid var(--ppp-ink); border-radius: 8px; color: #ffffff; background: var(--ppp-ink);
    opacity: 0; transform: translate(-50%, 8px); transition: opacity 140ms ease-out, transform 180ms ease-out;
    pointer-events: none; text-align: center;
  }
  .ppp-toast[data-visible="true"] { opacity: 1; transform: translate(-50%, 0); }
  .ppp-toast[data-error="true"] { border-color: var(--ppp-accent); background: var(--ppp-accent); }
  .ppp-media-picker {
    position: fixed; z-index: 1; display: flex; flex-direction: column; width: min(336px, calc(100vw - 24px)); max-height: min(530px, calc(100vh - 24px)); padding: 12px;
    border: 1px solid var(--ppp-border); border-radius: 12px; color: var(--ppp-ink); background: var(--ppp-surface); pointer-events: auto;
  }
  .ppp-media-picker[data-density="dense"], .ppp-media-picker[data-density="compact"] { width: min(326px, calc(100vw - 24px)); }
  .ppp-media-picker[hidden] { display: none; }
  .ppp-picker-header { display: flex; flex: 0 0 auto; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 1px 1px 12px; }
  .ppp-picker-title-block { display: grid; gap: 2px; }
  .ppp-picker-title { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
  .ppp-picker-subtitle { color: var(--ppp-muted); font-size: 12px; font-weight: 500; line-height: 1.35; }
  .ppp-picker-close {
    appearance: none; width: 28px; height: 28px; margin: -1px -1px -1px 0; padding: 0; border: 1px solid var(--ppp-border); border-radius: 6px;
    display: grid; place-items: center; color: var(--ppp-muted); background: var(--ppp-surface); cursor: pointer; transition: color 140ms ease-out, background 140ms ease-out, transform 140ms ease-out;
  }
  .ppp-picker-close:hover { color: var(--ppp-ink); background: var(--ppp-subtle); }
  .ppp-picker-close:active { transform: scale(.97); }
  .ppp-picker-close:focus-visible, .ppp-media-option:focus-visible { outline: 2px solid var(--ppp-focus); outline-offset: 2px; }
  .ppp-picker-close svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .ppp-picker-close span { display: none; }
  .ppp-picker-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 2px 2px 0; scrollbar-color: #c6c5c3 transparent; scrollbar-width: thin; }
  .ppp-picker-scroll::-webkit-scrollbar { width: 8px; }
  .ppp-picker-scroll::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 4px; background: #c6c5c3; background-clip: padding-box; }
  .ppp-picker-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .ppp-media-picker[data-density="dense"] .ppp-picker-grid, .ppp-media-picker[data-density="compact"] .ppp-picker-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .ppp-media-option { appearance: none; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: 8px; color: inherit; background: transparent; cursor: pointer; text-align: left; transition: transform 140ms ease-out; }
  .ppp-media-option:disabled { cursor: wait; opacity: .58; }
  .ppp-media-option:hover .ppp-media-preview-wrap { border-color: #c6c5c3; }
  .ppp-media-option:active { transform: scale(.98); }
  .ppp-media-preview-wrap { position: relative; display: block; overflow: hidden; border: 1px solid var(--ppp-border); border-radius: 8px; background: var(--ppp-subtle); aspect-ratio: 4 / 3; transition: border-color 140ms ease-out; }
  .ppp-media-preview { display: block; width: 100%; height: 100%; object-fit: contain; }
  .ppp-media-preview-fallback { display: grid; width: 100%; height: 100%; place-items: center; color: var(--ppp-muted); font-size: 12px; }
  .ppp-media-kind { position: absolute; right: 5px; bottom: 5px; padding: 3px 5px; border-radius: 4px; color: #ffffff; background: var(--ppp-ink); font-size: 10px; font-weight: 700; line-height: 1; }
  .ppp-media-label { display: block; overflow: hidden; margin: 5px 1px 0; font-size: 11px; font-weight: 650; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .ppp-media-picker[data-density="dense"] .ppp-media-preview-wrap, .ppp-media-picker[data-density="compact"] .ppp-media-preview-wrap { aspect-ratio: 1 / 1; }
  .ppp-media-picker[data-density="compact"] .ppp-media-label { margin-top: 4px; font-size: 10px; }
  @media (max-width: 480px) {
    .ppp-grid-shell { right: 10px; bottom: 10px; }
    .ppp-grid-panel { width: min(196px, calc(100vw - 20px)); }
  }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }
`;
