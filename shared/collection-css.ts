/**
 * The collection panel wears the brand of the popup and the store art — a
 * graphite surface lit in white — rather than the light controls that sit on
 * pins. It is the extension's own workspace laid over the page, not a control
 * that has to blend into Pinterest's.
 *
 * Its launcher is the exception: it sits in the corner beside the grid slider
 * and wears the slider's light tokens, so the two read as one pair. Only its
 * count keeps the graphite, as a hint of the panel it opens.
 */
export const COLLECTION_CSS = `
  .ppp-c-panel {
    --c-canvas: #0b0b0d;
    --c-raised: #151518;
    --c-panel: rgba(255, 255, 255, .035);
    --c-hover: rgba(255, 255, 255, .07);
    --c-line: rgba(255, 255, 255, .08);
    --c-line-strong: rgba(255, 255, 255, .18);
    --c-text: #f4f4f6;
    --c-muted: #9b9ba4;
    --c-faint: #6c6c75;
    --c-error: #ff9d96;
    --c-focus: rgba(214, 220, 255, .65);
    --c-ease: cubic-bezier(.2, 0, 0, 1);
    color-scheme: dark;
    font: 500 13px/1.3 Inter, "Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .ppp-c-panel svg, .ppp-c-launch svg {
    fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
  }
  /* Zero specificity, so each control's own class still sets its colour. */
  :where(.ppp-c-panel) :where(button, input, select) { font: inherit; color: inherit; }
  .ppp-c-panel button { -webkit-tap-highlight-color: transparent; }
  .ppp-c-panel :focus-visible { outline: 2px solid var(--c-focus); outline-offset: 2px; }

  /* A square key beside the grid panel, as tall as it, with the count on its corner. */
  .ppp-c-launch {
    appearance: none; position: relative; flex: 0 0 auto; width: 52px; margin: 0; padding: 0;
    display: grid; place-items: center; border: 1px solid var(--ppp-border); border-radius: 9px;
    color: var(--ppp-ink); background: var(--ppp-surface); cursor: pointer; pointer-events: auto;
    transition: background 140ms ease-out, transform 140ms ease-out;
  }
  .ppp-c-launch svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .ppp-c-launch:hover { background: var(--ppp-subtle); }
  .ppp-c-launch:active { transform: scale(.96); }
  .ppp-c-launch:focus-visible { outline: 2px solid var(--ppp-focus); outline-offset: 2px; }
  .ppp-c-launch-count {
    position: absolute; top: -8px; right: -8px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px;
    display: grid; place-items: center; color: #ffffff; background: #0b0b0d; box-shadow: 0 0 0 2px var(--ppp-surface);
    font-size: 11px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;
  }
  .ppp-c-launch-count[data-empty="true"] { display: none; }
  .ppp-layer[data-collection-open="true"] .ppp-grid-shell { visibility: hidden; }

  .ppp-c-panel {
    position: fixed; top: 12px; right: 12px; bottom: 12px; width: min(388px, calc(100vw - 24px));
    display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
    border: 1px solid rgba(255, 255, 255, .1); border-radius: 16px; color: var(--c-text); background: var(--c-canvas);
    box-shadow: 0 24px 64px -16px rgba(0, 0, 0, .6), 0 0 0 1px rgba(0, 0, 0, .4);
    animation: ppp-c-in 180ms var(--c-ease);
  }
  .ppp-c-panel[hidden] { display: none; }
  @keyframes ppp-c-in { from { opacity: 0; transform: translateX(12px); } }
  .ppp-c-panel::before {
    position: absolute; inset: 0 0 auto; height: 160px; content: ""; pointer-events: none;
    background:
      radial-gradient(ellipse 70% 60% at 22% 0%, rgba(255, 255, 255, .08), transparent 70%),
      linear-gradient(rgba(255, 255, 255, .03) 1px, transparent 1px) 0 0 / 20px 20px,
      linear-gradient(90deg, rgba(255, 255, 255, .03) 1px, transparent 1px) 0 0 / 20px 20px;
    -webkit-mask-image: radial-gradient(ellipse 90% 100% at 20% 0%, #000 10%, transparent 75%);
  }
  .ppp-c-panel > * { position: relative; flex: 0 0 auto; }
  .ppp-c-panel > .ppp-c-scroll { flex: 1 1 auto; }

  .ppp-c-head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 10px 16px; }
  .ppp-c-head-text { display: grid; flex: 1 1 auto; min-width: 0; row-gap: 2px; }
  .ppp-c-title {
    margin: 0; font-size: 16px; font-weight: 650; line-height: 1.1; letter-spacing: -.03em;
    background: linear-gradient(180deg, #ffffff 35%, #b9b9c2); -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .ppp-c-sub { margin: 0; color: var(--c-faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .ppp-c-icon {
    appearance: none; flex: 0 0 auto; width: 30px; height: 30px; margin: 0; padding: 0; border: 0; border-radius: 8px;
    display: grid; place-items: center; color: var(--c-muted); background: transparent; cursor: pointer;
    transition: background 140ms var(--c-ease), color 140ms var(--c-ease);
  }
  .ppp-c-icon svg { width: 17px; height: 17px; }
  .ppp-c-icon:hover { color: var(--c-text); background: var(--c-hover); }

  .ppp-c-section { margin: 0 12px 10px; }
  .ppp-c-card { padding: 10px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-panel); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .04); }
  .ppp-c-scan { display: grid; row-gap: 9px; }
  .ppp-c-scan-row { display: flex; align-items: center; gap: 8px; }

  .ppp-c-primary {
    appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; margin: 0; padding: 0 14px;
    border: 0; border-radius: 9px; color: #0b0b0d; background: linear-gradient(180deg, #ffffff, #e4e4e9);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, .12), 0 0 0 1px rgba(255, 255, 255, .1), 0 6px 18px -8px rgba(255, 255, 255, .4);
    font-size: 13px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; cursor: pointer;
    transition: transform 140ms var(--c-ease), box-shadow 160ms var(--c-ease), opacity 140ms var(--c-ease);
  }
  .ppp-c-primary svg { width: 15px; height: 15px; stroke-width: 2.2; }
  .ppp-c-primary:hover { box-shadow: inset 0 -1px 0 rgba(0, 0, 0, .12), 0 0 0 1px rgba(255, 255, 255, .14), 0 8px 24px -8px rgba(255, 255, 255, .55); }
  .ppp-c-primary:active { transform: scale(.97); }
  .ppp-c-primary:disabled { cursor: default; opacity: .45; box-shadow: none; transform: none; }
  .ppp-c-primary[data-busy="true"] { color: var(--c-text); background: rgba(255, 255, 255, .1); box-shadow: inset 0 0 0 1px var(--c-line-strong); }
  .ppp-c-grow { flex: 1 1 auto; }

  .ppp-c-seg { display: inline-flex; flex: 0 0 auto; padding: 2px; border: 1px solid var(--c-line); border-radius: 9px; background: rgba(0, 0, 0, .3); }
  .ppp-c-seg button {
    appearance: none; height: 28px; margin: 0; padding: 0 9px; border: 0; border-radius: 7px; color: var(--c-muted); background: transparent;
    font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer;
    transition: background 140ms var(--c-ease), color 140ms var(--c-ease);
  }
  .ppp-c-seg button:hover { color: var(--c-text); }
  .ppp-c-seg button[aria-pressed="true"] { color: var(--c-text); background: rgba(255, 255, 255, .12); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06); }
  .ppp-c-seg[data-size="small"] button { height: 24px; padding: 0 8px; font-size: 11.5px; }

  .ppp-c-checks { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--c-muted); font-size: 12px; }
  .ppp-c-check { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
  .ppp-c-check input {
    appearance: none; position: relative; width: 26px; height: 16px; margin: 0; border-radius: 999px; background: rgba(255, 255, 255, .14); cursor: pointer;
    transition: background 160ms var(--c-ease);
  }
  .ppp-c-check input::after {
    position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; content: ""; background: #9b9ba4;
    transition: transform 160ms var(--c-ease), background 160ms var(--c-ease);
  }
  .ppp-c-check input:checked { background: rgba(255, 255, 255, .85); }
  .ppp-c-check input:checked::after { background: #0b0b0d; transform: translateX(10px); }
  .ppp-c-check:hover { color: var(--c-text); }
  .ppp-c-link {
    appearance: none; margin: 0; padding: 2px 0; border: 0; color: var(--c-muted); background: transparent; font-size: 12px; font-weight: 550;
    text-decoration: underline; text-decoration-color: rgba(255, 255, 255, .2); text-underline-offset: 3px; cursor: pointer;
  }
  .ppp-c-link:hover { color: var(--c-text); text-decoration-color: currentColor; }
  .ppp-c-link[data-danger="true"]:hover, .ppp-c-link[data-armed="true"] { color: var(--c-error); }

  .ppp-c-folders { display: flex; gap: 6px; margin: 0 0 10px; padding: 0 12px; overflow-x: auto; scrollbar-width: none; }
  .ppp-c-folders::-webkit-scrollbar { display: none; }
  .ppp-c-chip {
    appearance: none; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; height: 30px; margin: 0; padding: 0 11px;
    border: 1px solid var(--c-line); border-radius: 999px; color: var(--c-muted); background: var(--c-panel);
    font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer;
    transition: background 140ms var(--c-ease), color 140ms var(--c-ease), border-color 140ms var(--c-ease);
  }
  .ppp-c-chip svg { width: 14px; height: 14px; }
  .ppp-c-chip b { color: var(--c-faint); font-weight: 600; font-variant-numeric: tabular-nums; }
  .ppp-c-chip:hover { color: var(--c-text); background: var(--c-hover); }
  .ppp-c-chip[aria-pressed="true"] { color: var(--c-text); border-color: rgba(255, 255, 255, .4); background: rgba(255, 255, 255, .08); }
  .ppp-c-chip[aria-pressed="true"] b { color: var(--c-muted); }
  .ppp-c-chip[data-add] { padding: 0 9px; border-style: dashed; }
  .ppp-c-name {
    flex: 0 0 150px; height: 30px; margin: 0; padding: 0 11px; border: 1px solid rgba(255, 255, 255, .4); border-radius: 999px;
    color: var(--c-text); background: rgba(0, 0, 0, .35); font-size: 12px; font-weight: 600; outline: none;
  }
  .ppp-c-name::placeholder { color: var(--c-faint); }

  .ppp-c-filters { display: grid; row-gap: 10px; }
  .ppp-c-filter-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ppp-c-seg[data-icons] button { display: grid; width: 30px; padding: 0; place-items: center; }
  .ppp-c-seg[data-icons] svg { width: 16px; height: 16px; stroke-width: 1.8; }
  .ppp-c-swatches { display: flex; justify-content: space-between; gap: 6px; padding: 0 2px; }
  .ppp-c-swatch {
    appearance: none; width: 20px; height: 20px; margin: 0; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .14); transition: transform 140ms var(--c-ease), box-shadow 140ms var(--c-ease);
  }
  .ppp-c-swatch:hover { transform: scale(1.12); }
  .ppp-c-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--c-canvas), 0 0 0 4px #ffffff; }

  .ppp-c-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 22px; margin: 0 16px 8px; color: var(--c-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .ppp-c-status-actions { display: inline-flex; flex: 0 0 auto; gap: 12px; }

  .ppp-c-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 12px 12px; scrollbar-color: rgba(255, 255, 255, .18) transparent; scrollbar-width: thin; }
  .ppp-c-grid { columns: 3 96px; column-gap: 6px; }
  .ppp-c-item { position: relative; break-inside: avoid; margin: 0 0 6px; }
  .ppp-c-tile {
    appearance: none; position: relative; display: block; width: 100%; margin: 0; padding: 0; border: 0; border-radius: 10px; overflow: hidden;
    background: var(--c-raised); cursor: pointer;
  }
  .ppp-c-tile img { display: block; width: 100%; height: auto; min-height: 40px; object-fit: cover; transition: transform 220ms var(--c-ease), opacity 160ms var(--c-ease); }
  .ppp-c-tile::after {
    position: absolute; inset: 0; border-radius: inherit; content: ""; pointer-events: none;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .06); transition: box-shadow 140ms var(--c-ease);
  }
  .ppp-c-tile:hover img { transform: scale(1.03); }
  .ppp-c-tile[aria-pressed="true"]::after { box-shadow: inset 0 0 0 2px #ffffff, inset 0 0 0 4px rgba(0, 0, 0, .35); }
  .ppp-c-tile[aria-pressed="true"] img { opacity: .82; }
  .ppp-c-tick {
    position: absolute; top: 6px; left: 6px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
    color: transparent; background: rgba(11, 11, 13, .55); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .7);
    opacity: 0; transition: opacity 140ms var(--c-ease), background 140ms var(--c-ease);
  }
  .ppp-c-tick svg { width: 12px; height: 12px; stroke-width: 3; }
  .ppp-c-tile:hover .ppp-c-tick, .ppp-c-tile:focus-visible .ppp-c-tick, .ppp-c-grid[data-selecting="true"] .ppp-c-tick { opacity: 1; }
  .ppp-c-tile[aria-pressed="true"] .ppp-c-tick { color: #0b0b0d; background: #ffffff; box-shadow: none; opacity: 1; }
  .ppp-c-badge {
    position: absolute; left: 6px; bottom: 6px; padding: 3px 6px; border-radius: 5px; color: #ffffff; background: rgba(11, 11, 13, .7);
    font-size: 10px; font-weight: 700; letter-spacing: .02em;
  }
  .ppp-c-open {
    position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center;
    color: #ffffff; background: rgba(11, 11, 13, .6); opacity: 0; transition: opacity 140ms var(--c-ease), background 140ms var(--c-ease);
  }
  .ppp-c-open svg { width: 13px; height: 13px; }
  .ppp-c-item:hover .ppp-c-open, .ppp-c-open:focus-visible { opacity: 1; }
  .ppp-c-open:hover { background: rgba(11, 11, 13, .85); }

  .ppp-c-empty { display: grid; justify-items: center; row-gap: 8px; margin: 28px 18px; color: var(--c-muted); font-size: 12.5px; line-height: 1.45; text-align: center; }
  .ppp-c-empty svg { width: 28px; height: 28px; color: var(--c-faint); }
  .ppp-c-empty strong { color: var(--c-text); font-size: 13.5px; font-weight: 650; }
  .ppp-c-empty[hidden] { display: none; }

  .ppp-c-foot { display: grid; row-gap: 9px; padding: 10px 12px 12px; border-top: 1px solid var(--c-line); background: rgba(255, 255, 255, .015); }
  .ppp-c-foot-row { display: flex; align-items: center; gap: 8px; }
  .ppp-c-selection { display: flex; align-items: center; gap: 10px; color: var(--c-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .ppp-c-selection[hidden] { display: none; }
  .ppp-c-select {
    appearance: none; height: 28px; margin: 0 0 0 auto; padding: 0 26px 0 10px; border: 1px solid var(--c-line); border-radius: 8px;
    color: var(--c-text); font-size: 12px; font-weight: 600; cursor: pointer;
    background: rgba(0, 0, 0, .3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239b9ba4' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E") no-repeat right 7px center / 13px;
  }
  .ppp-c-select option { color: #f4f4f6; background: #151518; }
  .ppp-c-busy { display: grid; row-gap: 7px; }
  .ppp-c-busy[hidden] { display: none; }
  .ppp-c-busy-text { display: flex; justify-content: space-between; gap: 8px; color: var(--c-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .ppp-c-bar { height: 3px; overflow: hidden; border-radius: 2px; background: rgba(255, 255, 255, .1); }
  .ppp-c-bar span { display: block; width: 0; height: 100%; border-radius: inherit; background: #ffffff; box-shadow: 0 0 10px rgba(255, 255, 255, .5); transition: width 200ms var(--c-ease); }
  .ppp-c-note { margin: 0; color: var(--c-muted); font-size: 11.5px; line-height: 1.35; }
  .ppp-c-note[data-error="true"] { color: var(--c-error); }
  .ppp-c-note:empty { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .ppp-c-panel { animation: none; }
    .ppp-c-tile:hover img { transform: none; }
  }
`;
