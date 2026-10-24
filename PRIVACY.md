# Privacy Policy

**Product:** Pinterest Plus Plus  
**Effective date:** 24 October 2026

Pinterest Plus Plus is a Chrome extension that adds Copy, Download, a collection of saved pins, and grid-size controls to Pinterest pages. This policy describes how the extension handles information. It is written to meet the Chrome Web Store User Data Policy, including the Limited Use requirements.

Pinterest Plus Plus is an independent project and is not affiliated with, endorsed by, or sponsored by Pinterest, Inc.

## What the extension handles

The extension’s content scripts run only on `pinterest.com` pages. They do not run on other websites. The toolbar popup is a page inside the extension itself; it reads and writes the settings described below and shows how many pins your collection holds.

## Website content, on your action

When you click **Copy** or **Download** on a pin, the extension reads that pin’s media addresses and fetches the file from Pinterest’s own hosts (`pinterest.com` and `pinimg.com`) over HTTPS. For Download it first asks `pinterest.com` for that pin’s list of media files — the same request Pinterest’s own page makes when it opens a pin — and falls back to the addresses on the current page. It does this only for the pin you clicked, and only after you click.

Copy converts the image (or a video’s first decoded frame, or its poster) to PNG inside Chrome and writes it to your clipboard. Download saves the verified media file through Chrome’s download manager to your device. When Pinterest publishes a video only as a stream, Download joins the stream’s pieces into one MP4 inside Chrome before saving it.

## Your collection, on your action

When you click the bookmark button on a pin, or **Scan** in the collection panel, the extension reads the pins shown on the page: each pin’s id, its title as Pinterest renders it, its media addresses on `pinimg.com`, its shape, and whether Pinterest labels it as promoted. Scan does this by scrolling the page you are on, and stops at the number of pins you chose. To sort pins by colour, the extension fetches each pin’s small preview from `pinimg.com` again and reads its colours inside Chrome.

When you click **Download** in the panel, the extension fetches the pins you chose from `pinimg.com` and either saves each one through Chrome’s download manager or joins them into one ZIP archive inside Chrome and saves that. If you ask for it, the archive includes a `sources.csv` file listing each pin’s title and its Pinterest address.

Grid resizing reads the page’s masonry layout in the browser so columns can be reflowed at the width you choose. That layout data is not stored and is not sent anywhere.

## What is stored in Chrome

**Settings**, using `chrome.storage.sync`: your preferred grid tile width, where the pin buttons sit (on the image, or next to the ⋯ menu), and the collection’s options (skip ads, skip repeats, ZIP or separate files, whether to add `sources.csv`). If Chrome Sync is enabled on the profile, Chrome may copy these settings to your other signed-in Chrome profiles.

**Your collection**, using `chrome.storage.local`, on this device only: for each pin you collect, its Pinterest id, title, media and preview addresses, shape, a short summary of its colours, the folder you put it in, and when it was added; the names of your folders; and the ids of pins collected before, so a scan can skip repeats. The collection is not synced and never leaves your device. It holds up to 2,000 pins.

The extension does not store the media files themselves, your Pinterest account, or anything from other websites. Removing the extension removes everything it stored locally. Synced copies of the settings are governed by your Chrome Sync settings.

## What the extension does not collect

Pinterest Plus Plus does not:

- collect names, email addresses, account identifiers, or other personal information
- use analytics, advertising, tracking pixels, or crash telemetry
- create accounts or talk to a developer-operated server
- load remote code or remote configuration
- sell, rent, or share data with third parties
- access cookies, browsing history, or sites other than Pinterest and Pinimg

The developer never receives the media you copy or download, the pins you view, or your settings.

## How information is used (Limited Use)

Information the extension handles is used only to provide its user-facing features:

- pin media URLs, to copy or download the item you selected
- the page’s masonry layout, to resize the grid you are looking at
- the collection, to show, filter, sort and save the pins you gathered
- the stored settings, to remember your grid size, where the buttons sit, and how the collection gathers and saves pins

It is not used for advertising, profiling, creditworthiness, or any purpose unrelated to those features. Nothing is transferred to the developer or to third parties except:

- Chrome itself, when it writes the clipboard, runs a download, or syncs the settings
- Pinterest’s CDN, when Chrome fetches media you asked to copy, download or collect, or a preview whose colours it reads

Those transfers use HTTPS.

## Retention

Pin media is not retained by the extension. Copied images live in your clipboard until you replace them. Downloaded files and archives live on your device under your control. The collection remains until you remove pins from it or remove the extension; “Forget” clears the record of pins collected before. The settings remain until you change them or remove the extension.

## Security

Media requests use HTTPS. Candidate URLs are allowlisted to `pinterest.com` and `pinimg.com` before fetch or download. There is no developer backend to breach.

## Children

The extension is a utility for Pinterest and is not directed at children. It does not knowingly collect personal information from children.

## Changes

If the extension’s data practices change, this policy will be updated and the effective date changed. Material changes will be reflected in the Chrome Web Store listing as well.

## Contact

Use the support form on the Chrome Web Store listing for Pinterest Plus Plus. There is no separate developer server or mailing list.

Pinterest is a trademark of Pinterest, Inc.
