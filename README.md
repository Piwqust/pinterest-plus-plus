# Pinterest Plus Plus

A polished Chrome extension for Pinterest that adds native-feeling media actions and a stable, resizable grid.

## Features

- Copy any Pinterest image to the clipboard as a full-resolution PNG from the action beside its three-dot menu.
- Get the same actions on board and profile pages, where they sit in the pin's footer beside Pinterest's favourite star instead of inside the hover overlay, so they stay visible without hovering the tile.
- Get the same Copy and Download actions on the pin close-up, beside the three-dot menu in its action bar, sized to match Pinterest's own controls there. They act on the pin being viewed rather than on the related-pins grid around it.
- Download any image or video from the highest-quality Pinterest CDN source available.
- Copy a video's first decoded frame; if Pinterest blocks video decoding, the highest-quality poster is used as a graceful fallback.
- Resize Pinterest grid tiles from an on-page control that reaches all the way to two full-width pins per row. On release, the extension asks Pinterest's own masonry engine to reflow exact-width centered columns, preserving its virtual-scroll geometry; the setting syncs across Chrome profiles where Chrome Sync is enabled.
- Step whole columns at a time from the panel, and read the resulting tile width and column count straight from the live grid. The slider's upper limit follows the real grid width, so it always offers at least two columns and never proposes a layout Pinterest cannot render.
- Track the viewport: resizing the window recomputes the column layout in place, and a narrower window temporarily narrows tiles without discarding the stored preference.
- Works across Pinterest's client-side navigation and dynamically loaded pins without relying on generated CSS class names. Pinterest remains responsible for tile order, placement, and infinite-scroll lifecycle.

## Install the production build

1. Run `npm install` and `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `.output/chrome-mv3`.
5. Open Pinterest. Copy and Download stay beside each main-grid pin's three-dot menu and beside the pin close-up's; the tile-size slider stays visible in the lower-right corner.

For a distributable archive, run `npm run zip`. To publish that archive to the Chrome Web Store, follow [store/SUBMIT.md](./store/SUBMIT.md). Listing copy, permission justifications, and graphic assets live in `store/`.

## Development

```text
npm run dev        Start WXT development mode
npm run typecheck  Run strict TypeScript checks
npm test           Run the media and settings test suite
npm run build      Create the production MV3 bundle
npm run zip        Create the Chrome Web Store archive
npm run store:assets  Rebuild store screenshots and promo tiles
```

The extension requests only the permissions used by its visible features: Pinterest/Pinimg host access, downloads, clipboard write, offscreen media conversion, and synced settings. It contains no analytics, remote code, accounts, or external services.

## Quality and compatibility notes

- Requires Chrome 109 or newer because clipboard conversion uses Manifest V3 offscreen documents.
- Original Pinterest CDN URLs are tried before rendered thumbnails; downloads fall back to the next available candidate if the original is unavailable.
- Clipboard images are intentionally encoded as PNG because Chromium and operating-system clipboards support it reliably.
- Grid resizing verifies Pinterest's masonry contract before changing it. If Pinterest ships an incompatible layout, the extension restores the native grid and stops resizing instead of applying a visually scaled fallback. It retries a bounded number of times after a client-side navigation or a feed remount, so one incompatible page does not disable the control for the whole session.
- Pinterest renders the home feed with a class-based Masonry and search, pin close-up, and profile feeds with a hooks-based one. Both are supported: the class instance is driven directly, while a hooks grid is driven by overriding the layout props on its own component, so the override survives Pinterest re-rendering it. Where a hooks grid does not expose a position store, resizing still applies but the scroll position is not re-anchored.
- Pin actions are attached only to pins near the viewport, and media sources are resolved when a button is clicked rather than while scrolling.
- Each pin is anchored to the control it actually renders: the footer's favourite star where there is one, otherwise the three-dot menu, and only a card that offers neither — the gated representation used for boards a viewer cannot act on — gets the buttons overlaid on its image. A card that gains a footer after being decorated is re-anchored to it.
- The close-up is located structurally rather than by generated class or id. On a pin's permalink the extension takes the largest media rendered outside the grid and walks up to the card that also holds a three-dot menu, skipping the menus of the related pins Pinterest lays out around that card. Layouts that render the action bar in a separate branch of the page are covered by a document-wide search for the one menu that belongs neither to the grid nor to the page's own chrome. The actions are anchored to the item the action bar lays its menu out in, not inside the menu button, and act on the branch that holds only the pin's own media, so a carousel contributes every slide while the card's avatar stays out.
- Pinterest is a trademark of Pinterest, Inc. This independent extension is not affiliated with or endorsed by Pinterest.

## Privacy

See [PRIVACY.md](./PRIVACY.md). All media processing happens locally in the browser.
