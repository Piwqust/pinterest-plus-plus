export const PIN_SELECTOR = '[data-test-id="pinWrapper"]';
export const MAX_SCANNED_PINS = 400;
/**
 * Pins a container must hold to count as a grid. Large tiles mean Pinterest's
 * virtualization keeps very few of them mounted, so this cannot be a "looks
 * busy" threshold; the container's width is what separates a grid from a rail.
 */
export const MIN_ROOT_PINS = 2;

export function containsPin(node: Node): boolean {
  return node instanceof HTMLElement &&
    (node.matches(PIN_SELECTOR) || Boolean(node.querySelector(PIN_SELECTOR)));
}

/**
 * A bounded sample of the rendered pins. Deep feeds hold thousands of nodes, so
 * the head and tail are enough to locate every mounted grid.
 */
export function samplePins(doc: Document | ParentNode): HTMLElement[] {
  const pins = Array.from(doc.querySelectorAll<HTMLElement>(PIN_SELECTOR));
  if (pins.length <= MAX_SCANNED_PINS) return pins;
  return [...pins.slice(0, MAX_SCANNED_PINS / 2), ...pins.slice(-MAX_SCANNED_PINS / 2)];
}

/**
 * Walks up from each pin to the nearest ancestor that holds a real grid: at
 * least five pins and at least half the viewport wide. Nested candidates are
 * dropped so only the outermost grid of each region survives.
 */
export function findPinGridRootsFrom(
  pins: HTMLElement[],
  viewportWidth: number,
  doc: Document,
  isAcceptable: (ancestor: HTMLElement) => boolean = () => true,
): HTMLElement[] {
  const pinCountCache = new WeakMap<HTMLElement, number>();
  const countPins = (element: HTMLElement): number => {
    const cached = pinCountCache.get(element);
    if (cached !== undefined) return cached;
    const count = element.querySelectorAll(PIN_SELECTOR).length;
    pinCountCache.set(element, count);
    return count;
  };

  const requiredWidth = Math.max(280, viewportWidth * .48);
  const candidates = new Set<HTMLElement>();
  for (const pin of pins) {
    let ancestor = pin.parentElement;
    for (let depth = 0; depth < 10 && ancestor && ancestor !== doc.body; depth += 1, ancestor = ancestor.parentElement) {
      if (countPins(ancestor) >= MIN_ROOT_PINS && ancestor.getBoundingClientRect().width >= requiredWidth) {
        if (isAcceptable(ancestor)) candidates.add(ancestor);
        break;
      }
    }
  }
  return [...candidates].filter((candidate) =>
    ![...candidates].some((other) => other !== candidate && candidate.contains(other)),
  );
}

export function findPinGridRoots(doc: Document, viewportWidth: number): HTMLElement[] {
  return findPinGridRootsFrom(samplePins(doc), viewportWidth, doc);
}
