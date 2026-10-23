import { DEFAULT_ROW_SIZE } from './media-action-host';
import { ANY_PIN_SELECTOR } from './pin-grid-roots';

/** The three-dot menu in a grid card's footer. */
const MENU_SELECTOR = '[data-test-id="more-actions-button"]';
/** Every card Pinterest's masonry lays out carries this. */
const GRID_ITEM_SELECTOR = '[data-grid-item]';
/** Wrappers between the footer row and the menu button, each holding only it. */
const MAX_ANCHOR_LIFT = 6;
/**
 * A host React keeps taking out is not fought over: past this many returns it
 * stays out, and the hover panel serves that card instead.
 */
const MAX_REINSERTS = 3;

type CreateHost = (resolvePin: () => HTMLElement | null, size: number) => HTMLElement;

interface Placement {
  menu: HTMLElement;
}

interface Plan extends Placement {
  anchor: HTMLElement;
  pin: HTMLElement;
  size: number;
}

/** The single pin of the grid card a control belongs to. */
function pinOfCard(control: Element): HTMLElement | null {
  // A menu inside the image belongs to the hover overlay, not the footer.
  if (control.closest(ANY_PIN_SELECTOR)) return null;
  const card = control.closest(GRID_ITEM_SELECTOR);
  if (!card) return null;
  const pins = card.querySelectorAll<HTMLElement>(ANY_PIN_SELECTOR);
  return pins.length === 1 ? pins[0]! : null;
}

/**
 * The item of the footer row that holds the menu: the menu button is wrapped
 * in a few elements that each hold only it, and the first ancestor with
 * siblings of its own is the row.
 */
function rowItemOf(menu: HTMLElement): HTMLElement | null {
  let item = menu;
  for (let depth = 0; depth < MAX_ANCHOR_LIFT; depth += 1) {
    const parent = item.parentElement;
    if (!parent) return null;
    const children = Array.from(parent.children).filter((child) => !(child as HTMLElement).dataset?.pppRowHost);
    if (children.length > 1) return item;
    item = parent;
  }
  return null;
}

/**
 * Only a single-line flex row is entered. Everything about why insertion is
 * safe depends on it: the title gives up width instead of the row wrapping.
 */
function isSingleLineFlexRow(row: HTMLElement): boolean {
  const style = getComputedStyle(row);
  return /flex/.test(style.display) && !/wrap/.test(style.flexWrap.replace('nowrap', '')) &&
    !/column/.test(style.flexDirection);
}

/** The menu's size in CSS pixels; a transform on the card does not change it. */
function menuSize(menu: HTMLElement): number {
  return menu.offsetHeight || DEFAULT_ROW_SIZE;
}

/**
 * Puts Copy and Download in every grid card's footer, beside Pinterest's own
 * three-dot menu, for those who want them always in view rather than over the
 * image on hover.
 *
 * Measured on the live feed: the footer is a single-line flex row of a title
 * column (`flex: 1 1 auto; min-width: 0`) and the menu's column (`flex: 0 0
 * auto`), outside the `pinWrapper` that holds the image and the hover overlay.
 * So the buttons, inserted just before the menu's column at the menu's own
 * size, take their room from the title, which already truncates; the row
 * neither wraps nor grows, nothing of Pinterest's covers it, and hovering the
 * card does not rebuild it. Earlier versions put buttons in the hover row on
 * the image instead, where none of that held.
 *
 * Pinterest scales whole cards with a CSS transform, so every size here is a
 * layout size, never a screen one: a host measured on screen was 1.4 times the
 * menu and pushed the footer into the card below.
 *
 * The feed is virtualized, and a card that scrolls back into view is a new
 * subtree. Cards are decorated from the mutation records themselves, which
 * are delivered before the frame is painted, so the buttons arrive with them.
 * A scroll mounts many cards at once, so all of them are measured before any
 * is changed: interleaving the two would lay the page out once per card.
 */
export class RowActionManager {
  private observer = new MutationObserver((records) => this.onMutations(records));
  private hosts = new Map<HTMLElement, Placement>();
  private pinHosts = new WeakMap<HTMLElement, HTMLElement>();
  private reinserts = new WeakMap<HTMLElement, number>();
  private running = false;

  constructor(private createHost: CreateHost) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.decorate(document.querySelectorAll<HTMLElement>(MENU_SELECTOR));
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.observer.disconnect();
    for (const host of this.hosts.keys()) host.remove();
    this.hosts.clear();
  }

  /** Whether the card a pin belongs to carries buttons of ours. */
  serves(pin: HTMLElement): boolean {
    return Boolean(this.running && this.pinHosts.get(pin)?.isConnected);
  }

  private onMutations(records: MutationRecord[]): void {
    const menus = new Set<HTMLElement>();
    for (const record of records) {
      for (const node of record.removedNodes) {
        const placement = node instanceof HTMLElement ? this.hosts.get(node) : undefined;
        if (placement && this.shouldRestore(node as HTMLElement, placement)) menus.add(placement.menu);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || node.dataset.pppRowHost) continue;
        if (node.matches(MENU_SELECTOR)) menus.add(node);
        else for (const menu of node.querySelectorAll<HTMLElement>(MENU_SELECTOR)) menus.add(menu);
      }
    }
    for (const [host, placement] of this.hosts) {
      if (!host.isConnected && !placement.menu.isConnected) this.hosts.delete(host);
    }
    if (menus.size > 0) this.decorate(menus);
  }

  /**
   * Whether to put back a host that left while its menu stayed: Pinterest
   * re-rendered the row around it. A card that keeps doing so is left to the
   * hover panel.
   */
  private shouldRestore(host: HTMLElement, placement: Placement): boolean {
    this.hosts.delete(host);
    if (!placement.menu.isConnected) return false;
    const count = (this.reinserts.get(placement.menu) ?? 0) + 1;
    this.reinserts.set(placement.menu, count);
    return count <= MAX_REINSERTS;
  }

  private decorate(menus: Iterable<HTMLElement>): void {
    const plans: Plan[] = [];
    for (const menu of menus) {
      const plan = this.plan(menu);
      if (plan) plans.push(plan);
    }
    for (const plan of plans) this.attach(plan);
  }

  /** Everything about a card that has to be read, before anything is written. */
  private plan(menu: HTMLElement): Plan | null {
    if (!menu.isConnected || menu.closest('[data-ppp-ignore="true"]')) return null;
    const pin = pinOfCard(menu);
    if (!pin) return null;
    const anchor = rowItemOf(menu);
    const row = anchor?.parentElement;
    if (!anchor || !row || !isSingleLineFlexRow(row)) return null;
    const previous = anchor.previousElementSibling as HTMLElement | null;
    if (previous?.dataset.pppRowHost) {
      this.pinHosts.set(pin, previous);
      return null;
    }
    return { menu, anchor, pin, size: menuSize(menu) };
  }

  private attach({ menu, anchor, pin, size }: Plan): void {
    const host = this.createHost(() => this.pinFor(host), size);
    host.dataset.pppRowHost = 'true';
    anchor.before(host);
    this.hosts.set(host, { menu });
    this.pinHosts.set(pin, host);
  }

  /** Resolved at click time: the card may have re-rendered since. */
  private pinFor(host: HTMLElement): HTMLElement | null {
    return host.isConnected ? pinOfCard(host) : null;
  }
}
