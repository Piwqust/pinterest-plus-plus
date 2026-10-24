# Pinterest Plus Plus

A polished Chrome extension for Pinterest that adds native-feeling media actions and a stable, resizable grid.

## Features

- Copy any Pinterest image to the clipboard as a full-resolution PNG. Point at a pin on any grid — home feed, boards, profiles, search — and Copy and Download appear in the lower-left corner of its image, rising above Pinterest's own "Visit site" button when a pin has one. Prefer them always in view? Switch the popup's **Pin buttons** to *Next to ⋯* and they sit under every pin, beside its three-dot menu.
- Get the same Copy and Download actions on the pin close-up, beside the three-dot menu in its action bar, sized to match Pinterest's own controls there. They act on the pin being viewed rather than on the related-pins grid around it.
- Download any image or video from the highest-quality Pinterest CDN source available.
- Collect pins into a collection of your own. A third button on every pin (a bookmark) adds it, or **Scan** in the collection panel scrolls the feed and gathers 50, 100 or 250 pins, skipping promoted pins and, optionally, anything collected before. Sort pins into folders, filter them by type (image or video), shape (portrait, square, landscape) and colour, select with click, Shift-click or Ctrl+A, and save them as one ZIP or as separate files. Videos are included, assembled from Pinterest's stream when no file is published. A ZIP can carry `sources.csv` with every pin's title and link. Open the panel from the left segment of the corner card that holds the grid slider; it shows how many pins you have. The collection lives in `chrome.storage.local` on this device and holds up to 2,000 pins.
- Copy a video's first decoded frame; if Pinterest blocks video decoding, the highest-quality poster is used as a graceful fallback.
- Set the tile width from the toolbar popup as well, without opening Pinterest first. The popup writes the same synced preference, so every open Pinterest tab reflows immediately; it needs no tab access to do it.
- Resize Pinterest grid tiles from an on-page control that reaches all the way to two full-width pins per row. On release, the extension asks Pinterest's own masonry engine to reflow exact-width centered columns, preserving its virtual-scroll geometry; the setting syncs across Chrome profiles where Chrome Sync is enabled.
- Step whole columns at a time from the panel, and read the resulting tile width and column count straight from the live grid. The slider's upper limit follows the real grid width, so it always offers at least two columns and never proposes a layout Pinterest cannot render.
- Track the viewport: resizing the window recomputes the column layout in place, and a narrower window temporarily narrows tiles without discarding the stored preference.
- Works across Pinterest's client-side navigation and dynamically loaded pins without relying on generated CSS class names. Pinterest remains responsible for tile order, placement, and infinite-scroll lifecycle.

## Install the production build

1. Run `npm install` and `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `.output/chrome-mv3`.
5. Open Pinterest. Point at a pin and Copy and Download appear in its lower-left corner (or, with *Next to ⋯* chosen in the popup, under every pin beside its menu); on a pin close-up they sit beside the three-dot menu; the tile-size slider stays visible in the lower-right corner.

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

The extension requests only the permissions used by its visible features: Pinterest/Pinimg host access, downloads, clipboard write, offscreen media conversion and archive packing, synced settings, and the local collection. The collection added no permissions. It contains no analytics, remote code, accounts, or external services.

## Quality and compatibility notes

- Requires Chrome 111 or newer. Clipboard conversion needs Manifest V3 offscreen documents (Chrome 109), and the grid bridge needs `world: "MAIN"` on a manifest-declared content script, which Chrome honours only from 111. Below that the bridge would load in the isolated world and resizing would silently do nothing.
- Original Pinterest CDN URLs are tried before rendered thumbnails; downloads fall back to the next available candidate if the original is unavailable.
- Clipboard images are intentionally encoded as PNG because Chromium and operating-system clipboards support it reliably.
- Grid resizing verifies Pinterest's masonry contract before changing it. If Pinterest ships an incompatible layout, the extension restores the native grid and stops resizing instead of applying a visually scaled fallback. It retries a bounded number of times after a client-side navigation or a feed remount, so one incompatible page does not disable the control for the whole session.
- Pinterest renders the home feed with a class-based Masonry and search, pin close-up, and profile feeds with a hooks-based one. Both are supported: the class instance is driven directly, while a hooks grid is driven by overriding the layout props on its own component, so the override survives Pinterest re-rendering it. Where a hooks grid does not expose a position store, resizing still applies but the scroll position is not re-anchored.
- One Copy/Download panel serves the whole grid. It lives in the extension's own top-level layer rather than in Pinterest's tiles, follows the pin under the pointer, and resolves media sources only when a button is clicked. Nothing is inserted into Pinterest's layout, so their re-renders cannot discard it and it cannot shift their controls.
- The close-up is located structurally rather than by generated class or id. On a pin's permalink the extension takes the largest media rendered outside the grid and walks up to the card that also holds a three-dot menu, skipping the menus of the related pins Pinterest lays out around that card. Layouts that render the action bar in a separate branch of the page are covered by a document-wide search for the one menu that belongs neither to the grid nor to the page's own chrome. The actions are anchored to the item the action bar lays its menu out in, not inside the menu button, and act on the branch that holds only the pin's own media, so a carousel contributes every slide while the card's avatar stays out.
- The collection's colour filter reads each pin's 236 px preview at 24×24 on a canvas and keeps up to four colour bands that each cover at least 6% of it; a pin matches a swatch when that band covers 14% or more. The tile Pinterest rendered cannot be used for this, since it was loaded without CORS and would taint the canvas, so the preview is fetched again from Pinimg's cache.
- Archives are written by a small built-in ZIP writer (`shared/zip.ts`) that stores rather than deflates: Pinterest's JPEG, PNG, WebP and MP4 files are already compressed. Names are UTF-8. The offscreen document fetches and packs the files, because only a document can give Chrome's download manager a `blob:` URL; progress reaches the panel over a runtime port, which also keeps the service worker awake for a long archive. An archive holds up to 500 pins.
- Promoted pins are recognised by the "Promoted by" / "Sponsored" label Pinterest prints on the card, or a test id that names it. If Pinterest changes that wording, a scan may let ads into the collection; nothing else depends on it.
- Pinterest is a trademark of Pinterest, Inc. This independent extension is not affiliated with or endorsed by Pinterest.

## Privacy

See [PRIVACY.md](./PRIVACY.md). All media processing happens locally in the browser.
