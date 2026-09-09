# Privacy Policy

**Product:** Pinterest Plus Plus  
**Effective date:** 9 September 2026

Pinterest Plus Plus is a Chrome extension that adds Copy, Download, and grid-size controls to Pinterest pages. This policy describes how the extension handles information. It is written to meet the Chrome Web Store User Data Policy, including the Limited Use requirements.

Pinterest Plus Plus is an independent project and is not affiliated with, endorsed by, or sponsored by Pinterest, Inc.

## What the extension handles

The extension runs only on `pinterest.com` pages. It does not run on other websites.

### Website content, on your action

When you click **Copy** or **Download** on a pin, the extension reads that pin’s media addresses from the current page and fetches the file from Pinterest’s own hosts (`pinterest.com` and `pinimg.com`) over HTTPS. It does this only for the pin you clicked, and only after you click.

Copy converts the image (or a video’s first decoded frame, or its poster) to PNG inside Chrome and writes it to your clipboard. Download saves the verified media file through Chrome’s download manager to your device.

Grid resizing reads the page’s masonry layout in the browser so columns can be reflowed at the width you choose. That layout data is not stored and is not sent anywhere.

### Settings stored in Chrome

The only setting the extension stores is your preferred grid tile width, as a number, using `chrome.storage.sync`. If Chrome Sync is enabled on the profile, Chrome may copy that number to your other signed-in Chrome profiles. The extension does not store pin contents, URLs, names, or accounts.

Removing the extension removes its locally stored settings. Synced copies of that number are governed by your Chrome Sync settings.

## What the extension does not collect

Pinterest Plus Plus does not:

- collect names, email addresses, account identifiers, or other personal information
- use analytics, advertising, tracking pixels, or crash telemetry
- create accounts or talk to a developer-operated server
- load remote code or remote configuration
- sell, rent, or share data with third parties
- access cookies, browsing history, or sites other than Pinterest and Pinimg

The developer never receives the media you copy or download, the pins you view, or your tile-width preference.

## How information is used (Limited Use)

Information the extension handles is used only to provide its user-facing features:

- pin media URLs, to copy or download the item you selected
- the page’s masonry layout, to resize the grid you are looking at
- the stored tile width, to remember your grid size

It is not used for advertising, profiling, creditworthiness, or any purpose unrelated to those features. Nothing is transferred to the developer or to third parties except:

- Chrome itself, when it writes the clipboard, runs a download, or syncs the tile-width number
- Pinterest’s CDN, when Chrome fetches the media file you asked to copy or download

Those transfers use HTTPS.

## Retention

Pin media is not retained by the extension. Copied images live in your clipboard until you replace them. Downloaded files live on your device under your control. The tile-width number remains until you reset it, change it, or remove the extension.

## Security

Media requests use HTTPS. Candidate URLs are allowlisted to `pinterest.com` and `pinimg.com` before fetch or download. There is no developer backend to breach.

## Children

The extension is a utility for Pinterest and is not directed at children. It does not knowingly collect personal information from children.

## Changes

If the extension’s data practices change, this policy will be updated and the effective date changed. Material changes will be reflected in the Chrome Web Store listing as well.

## Contact

Use the support form on the Chrome Web Store listing for Pinterest Plus Plus. There is no separate developer server or mailing list.

Pinterest is a trademark of Pinterest, Inc.
