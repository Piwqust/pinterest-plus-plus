# Chrome Web Store listing copy

Paste these fields into [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Primary language is English because the product UI is English. Russian copy is optional.

Manifest `name` and `description` must stay in sync with the short fields below. They already match `wxt.config.ts`.

---

## Product details (English)

**Item name** (must match manifest)

```
Pinterest Plus Plus
```

**Summary** (manifest `description`, 82 / 132 characters)

```
Copy and download Pinterest media in full quality, and resize the responsive grid.
```

**Detailed description**

```
Pinterest Plus Plus adds Copy, Download, and a resizable grid to Pinterest. The controls follow Pinterest’s own layout instead of covering it.

Copy any image to the clipboard as a full-resolution PNG. Download the highest-quality image or video Pinterest actually serves. Point at any pin — on the home feed, a board, a profile or in search — and Copy and Download appear in its lower-left corner, stepping aside for Pinterest’s own “Visit site” button. Or set them in the popup to sit under every pin, beside its ⋯ menu, always in view. On a pin close-up they sit in Pinterest’s action bar at its size and act on the pin you are viewing, not the related grid around it.

If a pin is a carousel, you choose the slide. Videos copy the first decoded frame, or the poster if Pinterest blocks decoding.

The toolbar button opens a small panel with the same tile-width control, so you can set the grid before you open Pinterest. Changing it there reflows every Pinterest tab you already have open.

A compact slider in the corner resizes the masonry. Release it and Pinterest’s own engine reflows exact-width centered columns. Step whole columns at a time and read the live tile width and column count from the grid. The upper limit follows the real grid width, so you always keep at least two columns. Chrome Sync can keep that preference across your profiles.

The extension does not collect accounts, analytics, or browsing history. Media is fetched only from Pinterest and Pinimg when you click Copy or Download, and is processed locally in Chrome.

Requires Chrome 111 or newer.

Pinterest is a trademark of Pinterest, Inc. This independent extension is not affiliated with or endorsed by Pinterest.
```

**Category:** Productivity  
**Language:** English  
**Mature content:** No

---

## Product details (Russian, optional extra locale)

Use only if you add a Russian listing locale. Do not replace the English summary in the manifest.

**Название**

```
Pinterest Plus Plus
```

**Краткое описание** (≤132 characters; 82)

```
Копируйте и скачивайте медиа с Pinterest в полном качестве и меняйте размер сетки.
```

**Подробное описание**

```
Pinterest Plus Plus добавляет на Pinterest кнопки Copy и Download и регулятор размера сетки. Элементы следуют собственной вёрстке Pinterest, а не перекрывают её.

Копируйте любое изображение в буфер как PNG в полном разрешении. Скачивайте изображение или видео с того источника CDN, который Pinterest реально отдаёт. Наведите курсор на любой пин — в ленте, на доске, в профиле или в поиске — и в его левом нижнем углу появятся Copy и Download; кнопка Pinterest «Visit site» их не перекрывает. А можно включить в попапе, чтобы они всегда стояли под каждым пином рядом с меню ⋯. В крупном просмотре они стоят в панели действий Pinterest, совпадают с ней по размеру и действуют на открытый пин, а не на соседнюю сетку.

Если у пина несколько слайдов, вы выбираете нужный. Для видео копируется первый декодированный кадр, а если Pinterest блокирует декодирование — постер.

Кнопка на панели открывает небольшое окно с тем же регулятором ширины плитки, поэтому сетку можно настроить до открытия Pinterest. Изменение сразу перестраивает все уже открытые вкладки Pinterest.

Компактный ползунок в углу меняет ширину плиток. После отпускания собственный движок Pinterest перестраивает колонки точной ширины. Можно шагать целыми колонками и читать живую ширину плитки и число колонок. Верхний предел следует реальной ширине сетки, поэтому всегда остаются минимум две колонки. Chrome Sync может хранить эту настройку между профилями.

Расширение не собирает аккаунты, аналитику и историю просмотра. Медиа запрашивается только с Pinterest и Pinimg после нажатия Copy или Download и обрабатывается локально в Chrome.

Нужен Chrome 111 или новее.

Pinterest — товарный знак Pinterest, Inc. Это независимое расширение не связано с Pinterest и не одобрено им.
```

---

## Graphic assets

Upload from `store/assets/`. PNG at the exact pixel sizes below. The promo tiles and screenshots are flattened to RGB; the 128×128 store icon keeps its alpha channel, which the store accepts.

| Dashboard field | File | Size |
|---|---|---|
| Store icon | `icon-128.png` | 128×128 |
| Screenshot 1 | `screenshot-1-copy-download.png` | 1280×800 |
| Screenshot 2 | `screenshot-2-videos.png` | 1280×800 |
| Screenshot 3 | `screenshot-3-placement.png` | 1280×800 |
| Screenshot 4 | `screenshot-4-grid-slider.png` | 1280×800 |
| Screenshot 5 | `screenshot-5-copy.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |
| YouTube video | skip | optional |

Screenshots are mock Pinterest-like pages that use the extension’s real control CSS, popup CSS and icons, set on a dark monochrome backdrop with the keycap brand mark. The mark’s 48 and 128 px icons are cut from `store/brand/keycap-master.png`; 16 and 32 px are drawn on the pixel grid by `npm run icons`. The pin pictures were generated for this listing (`store/scenes/media/`); they are not captures of pinterest.com, not other people’s pins, and no Pinterest logo or brand red appears. Regenerate everything with `npm run store:assets` (needs Chrome and a network connection for the Inter web font).

---

## Privacy practices

**Single purpose**

```
Add copy, download, and grid-size controls to Pinterest pages so the user can save pin media and resize the feed. The toolbar popup exposes the same grid-size setting and where the buttons sit.
```

**Remote code:** No, I am not using remote code.

### Permission justifications

**clipboardWrite**

```
Used when the user clicks Copy. The selected pin image (or a video frame/poster) is converted to PNG inside the extension and written to the clipboard so it can be pasted elsewhere.
```

**downloads**

```
Used when the user clicks Download. Chrome’s download manager saves the verified media file from Pinterest’s CDN to the user’s Downloads folder, or, for a video Pinterest publishes only as an HLS stream, the MP4 the extension assembled from that stream locally. The extension does not download anything until that click.
```

**offscreen**

```
Manifest V3 service workers cannot draw to a canvas, write the clipboard, or create blob: URLs. An offscreen document converts the selected Pinterest media to PNG and writes it to the clipboard, and joins a video that Pinterest publishes only as an HLS stream into one MP4 whose blob: URL the download manager saves. Declared reason: CLIPBOARD and BLOBS. Justification in the extension: “Convert Pinterest media to PNG for the clipboard, and assemble streamed videos into files.”
```

**storage**

```
Stores two settings via chrome.storage.sync, so they can follow Chrome Sync across the user’s profiles: tileWidth, the preferred grid tile width as a number, and buttonPlacement, whether Copy and Download sit on the pin image or beside its ⋯ menu. The toolbar popup reads and writes those same keys, which is how it updates already-open Pinterest tabs without any tab access. No other keys are written.
```

**Host permission `https://*.pinterest.com/*`**

```
Content scripts run only on Pinterest pages. They attach the Copy and Download buttons and the grid slider, and they read the media URL of the pin the user clicked. On Download they ask pinterest.com for that pin’s media list, the same same-origin request Pinterest’s own page makes, so every carousel slide resolves to its real file. The extension does not run on other sites.
```

**Host permission `https://*.pinimg.com/*`**

```
When the user clicks Copy or Download, Chrome fetches that pin’s media from Pinterest’s CDN (pinimg.com). URLs are allowlisted to pinterest.com and pinimg.com before any fetch or download.
```

### Data use disclosure

Check **only**:

- [x] Website content

Leave unchecked: personally identifiable information, health, financial and payment, authentication, personal communications, location, web history, user activity.

Website content is handled only to provide Copy, Download, and grid resizing on the current Pinterest page. It is not sent to the developer.

**Certify** all Limited Use statements (no sale of data; no use unrelated to the single purpose; no use for creditworthiness; compliance with the User Data Policy).

**Privacy policy URL:**

```
https://piwqust.github.io/pinterest-plus-plus/
```

---

## Distribution

- Visibility: **Public**
- Pricing: **Free**
- Regions: **All regions**
- Listing language: **English**
- Homepage URL: `https://github.com/Piwqust/pinterest-plus-plus`

---

## Content rating / IARC

Answer for the extension itself, not for Pinterest’s catalogue:

- Violence, sexual content, strong language, drugs, gambling: **No**
- User-generated content hosted by this item: **No**
- Shares user location: **No**
- Digital purchases / ads inside the item: **No**
- Mature content: **No**
- Age: **Everyone** / suitable for all ages

---

## Reviewer notes (optional “test instructions”)

```
Load on https://www.pinterest.com (any account, including logged out on public pins). Point at any pin in a grid: Copy and Download appear in the lower-left corner of its image. With “Pin buttons: Next to ⋯” chosen in the popup they instead sit in every card’s footer, beside Pinterest’s three-dot menu (signed-in grids; the simplified cards shown to logged-out visitors have no footer and keep the hover panel). On a pin close-up (/pin/…) they sit in the action bar beside the three-dot menu. The tile-size slider is in the lower-right corner. A MAIN-world content script talks to Pinterest’s masonry so resizing uses Pinterest’s own layout engine rather than CSS scaling. The toolbar button opens a popup carrying the tile-width and button-placement settings; it writes chrome.storage.sync, which the content script already observes, so no tabs permission is needed. No account, analytics, or remote configuration.
```
