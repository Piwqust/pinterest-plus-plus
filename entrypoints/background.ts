import type { ActionResponse, ExtensionMessage, MediaKind, OffscreenCopyMessage } from '../shared/messages';
import { withTimeout } from '../shared/async';
import { isAllowedMediaUrl, isDownloadableVideoUrl, isMediaResponse, safeFilename } from '../shared/media';

const OFFSCREEN_PATH = 'offscreen.html';
const MAX_CANDIDATES = 16;
const VERIFY_TIMEOUT_MS = 5_000;
/**
 * A ceiling on verification for the whole candidate list. The content script
 * gives up on this request at 25s, so a slow CDN must not turn a long list into
 * a timeout when a later candidate would still have downloaded.
 */
const VERIFY_BUDGET_MS = 15_000;
let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreenDocument(documentUrl: string): Promise<boolean> {
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [documentUrl],
    });
    return contexts.length > 0;
  }

  // chrome.runtime.getContexts was added after the extension's stated Chrome
  // 109 minimum. Service-worker clients provide the equivalent check there.
  const serviceWorkerClients = (globalThis as typeof globalThis & {
    clients?: { matchAll: () => Promise<Array<{ url: string }>> };
  }).clients;
  if (!serviceWorkerClients) return false;
  const matchedClients = await serviceWorkerClients.matchAll();
  return matchedClients.some((client) => client.url === documentUrl);
}

async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (await hasOffscreenDocument(documentUrl)) return;

  creatingOffscreen ??= (async () => {
    if (await hasOffscreenDocument(documentUrl)) return;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.BLOBS],
        justification: 'Convert Pinterest media to PNG and write it to the clipboard.',
      });
    } catch (error) {
      // A concurrent service-worker instance may have created it first.
      if (!(await hasOffscreenDocument(documentUrl))) throw error;
    }
  })().finally(() => {
    creatingOffscreen = null;
  });
  await creatingOffscreen;
}

function cleanCandidates(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && isAllowedMediaUrl(value)))].slice(0, MAX_CANDIDATES);
}

function requestedTitle(suggestedName: string): string {
  const basename = suggestedName.split('/').at(-1) ?? '';
  return basename.replace(/\.[^.]+$/, '');
}

async function isVerifiedMediaFile(candidate: string, kind: MediaKind, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.min(VERIFY_TIMEOUT_MS, remaining));
  try {
    const response = await fetch(candidate, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    await response.body?.cancel();
    return isMediaResponse(response.status, response.headers.get('content-type'), kind);
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function downloadMedia(message: Extract<ExtensionMessage, { type: 'DOWNLOAD_MEDIA' }>): Promise<ActionResponse> {
  const candidates = cleanCandidates(message.candidates)
    .filter((candidate) => message.kind !== 'video' || isDownloadableVideoUrl(candidate));
  if (candidates.length === 0) return { ok: false, message: 'No downloadable media found' };

  const deadline = Date.now() + VERIFY_BUDGET_MS;
  for (const candidate of candidates) {
    try {
      // Candidate order remains highest quality first. A route Pinterest never
      // published answers with an error body rather than a file, and Chrome's
      // download manager would save that body as an .xml file next to the
      // user's images, so every candidate is confirmed to be media first.
      if (!(await isVerifiedMediaFile(candidate, message.kind, deadline))) continue;
      const filename = safeFilename(candidate, message.kind, requestedTitle(message.suggestedName));
      await chrome.downloads.download({ url: candidate, filename, conflictAction: 'uniquify', saveAs: false });
      return { ok: true, message: 'Download started' };
    } catch {
      // A source may be fetchable but refused by Chrome's download manager.
    }
  }
  return {
    ok: false,
    message: message.kind === 'video'
      ? 'Pinterest did not provide a direct video file for this item'
      : 'Pinterest did not serve a downloadable image file for this item',
  };
}

async function copyMedia(message: Extract<ExtensionMessage, { type: 'COPY_MEDIA' }>): Promise<ActionResponse> {
  const candidates = cleanCandidates(message.candidates);
  const posterCandidates = cleanCandidates(message.posterCandidates);
  if (candidates.length === 0 && posterCandidates.length === 0) {
    return { ok: false, message: 'No copyable media found' };
  }

  await ensureOffscreenDocument();
  const offscreenMessage: OffscreenCopyMessage = {
    type: 'OFFSCREEN_COPY',
    target: 'offscreen',
    kind: message.kind,
    candidates,
    posterCandidates,
  };
  const response = await withTimeout(
    chrome.runtime.sendMessage<OffscreenCopyMessage, ActionResponse>(offscreenMessage),
    20_000,
    'Copy timed out while processing the media',
  );
  return response ?? { ok: false, message: 'Clipboard did not respond' };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type !== 'DOWNLOAD_MEDIA' && message.type !== 'COPY_MEDIA') return false;

    const action = message.type === 'DOWNLOAD_MEDIA' ? downloadMedia(message) : copyMedia(message);
    action
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, message: 'Unexpected extension error' } satisfies ActionResponse));
    return true;
  });
});
