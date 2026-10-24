import {
  ARCHIVE_PORT,
  type ActionResponse,
  type ArchiveBuiltResponse,
  type ArchiveEvent,
  type ArchiveItem,
  type ArchiveRequest,
  type AssembledVideoResponse,
  type ExtensionMessage,
  type MediaKind,
  type OffscreenArchiveMessage,
  type OffscreenAssembleMessage,
  type OffscreenCopyMessage,
  type OffscreenReleaseMessage,
} from '../shared/messages';
import { withTimeout } from '../shared/async';
import { isMasterPlaylist, parseMasterPlaylist, progressiveRoutes } from '../shared/hls';
import {
  filenameStem,
  isAllowedMediaUrl,
  isDownloadableVideoUrl,
  isMediaResponse,
  isVideoStreamUrl,
  safeFilename,
} from '../shared/media';

const OFFSCREEN_PATH = 'offscreen.html';
/** Candidates are checked in parallel, so the list can afford every route a stream implies. */
const MAX_CANDIDATES = 32;
const MAX_STREAMS = 6;
const VERIFY_TIMEOUT_MS = 5_000;
/**
 * A ceiling on finding a published file. Past it the stream is assembled
 * instead, which still has to fit inside the content script's wait.
 */
const VERIFY_BUDGET_MS = 15_000;
const PLAYLIST_TIMEOUT_MS = 5_000;
/** Must stay below the content script's download wait, `DOWNLOAD_TIMEOUT_MS`. */
const ASSEMBLY_TIMEOUT_MS = 150_000;
/** Big enough for a board, small enough that the archive fits in memory. */
const MAX_ARCHIVE_ITEMS = 500;
/** An archive of a few hundred originals, videos among them, takes minutes. */
const ARCHIVE_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_DIRECTORY = 'Pinterest';
/** Ports waiting on an archive, by job, so progress from the offscreen document reaches its tab. */
const archivePorts = new Map<string, chrome.runtime.Port>();
let creatingOffscreen: Promise<void> | null = null;

interface LoadedStream {
  url: string;
  routes: string[];
}

async function hasOffscreenDocument(documentUrl: string): Promise<boolean> {
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [documentUrl],
    });
    return contexts.length > 0;
  }

  // chrome.runtime.getContexts arrived in Chrome 116, after the extension's
  // Chrome 111 minimum. Service-worker clients provide the equivalent check there.
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
        justification: 'Convert Pinterest media to PNG for the clipboard, and assemble streamed videos and collection archives into files.',
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

function cleanCandidates(values: unknown, limit = MAX_CANDIDATES): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && isAllowedMediaUrl(value)))].slice(0, limit);
}

/**
 * Reads a stream's playlist for the MP4s published beside it. A playlist that
 * does not answer is dropped here, which is also how a guessed one is ruled out.
 */
async function loadStream(url: string): Promise<LoadedStream | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trimStart().startsWith('#EXTM3U')) return null;
    return { url, routes: progressiveRoutes(url, isMasterPlaylist(text) ? parseMasterPlaylist(text, url) : null) };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/**
 * A Downloads subfolder named by the page. It is rebuilt from safe parts here
 * rather than trusted, since a path is how a download would escape its folder.
 */
function cleanDirectory(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DIRECTORY;
  const parts = value.split('/').map(filenameStem).filter(Boolean).slice(0, 2);
  return parts.length > 0 ? parts.join('/') : DEFAULT_DIRECTORY;
}

function inDirectory(filename: string, directory: string): string {
  return filename.replace(/^Pinterest\//, `${directory}/`);
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

/**
 * Downloads the first candidate, in the given order, that turns out to be a
 * real media file. Every candidate is checked at once, so a long list of
 * routes costs one round trip rather than one per route.
 */
async function downloadFirstVerified(
  candidates: string[],
  kind: MediaKind,
  title: string,
  directory = DEFAULT_DIRECTORY,
): Promise<boolean> {
  const deadline = Date.now() + VERIFY_BUDGET_MS;
  const checks = candidates.map((candidate) => isVerifiedMediaFile(candidate, kind, deadline));
  for (const [index, candidate] of candidates.entries()) {
    try {
      // A route Pinterest never published answers with an error body rather
      // than a file, and Chrome's download manager would save that body as an
      // .xml file next to the user's images, so a candidate must be media first.
      if (!(await checks[index])) continue;
      const filename = inDirectory(safeFilename(candidate, kind, title), directory);
      await chrome.downloads.download({ url: candidate, filename, conflictAction: 'uniquify', saveAs: false });
      return true;
    } catch {
      // A source may be fetchable but refused by Chrome's download manager.
    }
  }
  return false;
}

function releaseWhenSaved(downloadId: number, url: string): void {
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state !== 'complete' && state !== 'interrupted') return;
    chrome.downloads.onChanged.removeListener(listener);
    const release: OffscreenReleaseMessage = { type: 'OFFSCREEN_RELEASE', target: 'offscreen', url };
    chrome.runtime.sendMessage(release).catch(() => undefined);
  };
  chrome.downloads.onChanged.addListener(listener);
}

/** The last resort: build the file from the stream Pinterest's player plays. */
async function downloadAssembled(streams: LoadedStream[], title: string, directory = DEFAULT_DIRECTORY): Promise<boolean> {
  if (streams.length === 0) return false;
  await ensureOffscreenDocument();
  for (const stream of streams) {
    const request: OffscreenAssembleMessage = { type: 'OFFSCREEN_ASSEMBLE_VIDEO', target: 'offscreen', stream: stream.url };
    try {
      const assembled = await withTimeout(
        chrome.runtime.sendMessage<OffscreenAssembleMessage, AssembledVideoResponse>(request),
        ASSEMBLY_TIMEOUT_MS,
        'Video assembly timed out',
      );
      if (!assembled?.ok || !assembled.url) continue;
      const downloadId = await chrome.downloads.download({
        url: assembled.url,
        filename: inDirectory(safeFilename(stream.url, 'video', title), directory),
        conflictAction: 'uniquify',
        saveAs: false,
      });
      releaseWhenSaved(downloadId, assembled.url);
      return true;
    } catch {
      // Another stream for the same video may still assemble.
    }
  }
  return false;
}

async function downloadMedia(message: Extract<ExtensionMessage, { type: 'DOWNLOAD_MEDIA' }>): Promise<ActionResponse> {
  const title = requestedTitle(message.suggestedName);
  const directory = cleanDirectory(message.directory);
  if (message.kind === 'image') {
    const candidates = cleanCandidates(message.candidates);
    if (candidates.length === 0) return { ok: false, message: 'No downloadable media found' };
    return await downloadFirstVerified(candidates, 'image', title, directory)
      ? { ok: true, message: 'Download started' }
      : { ok: false, message: 'Pinterest did not serve a downloadable image file for this item' };
  }

  const streamUrls = cleanCandidates(message.streams, MAX_STREAMS).filter(isVideoStreamUrl);
  const exact = cleanCandidates(message.candidates).filter(isDownloadableVideoUrl);
  if (exact.length === 0 && streamUrls.length === 0) return { ok: false, message: 'No downloadable video found' };

  const streams = (await Promise.all(streamUrls.map(loadStream)))
    .filter((stream): stream is LoadedStream => Boolean(stream));
  // The files a pin names come first; the routes its playlists imply follow,
  // since they are only worth a request when the named files are not served.
  const candidates = [...new Set([...exact, ...streams.flatMap((stream) => stream.routes)])]
    .filter(isDownloadableVideoUrl)
    .slice(0, MAX_CANDIDATES);
  if (await downloadFirstVerified(candidates, 'video', title, directory)) return { ok: true, message: 'Download started' };
  if (await downloadAssembled(streams, title, directory)) return { ok: true, message: 'Download started' };
  return { ok: false, message: 'Pinterest did not serve this video' };
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

function cleanArchiveItems(values: unknown): ArchiveItem[] {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_ARCHIVE_ITEMS).flatMap((value): ArchiveItem[] => {
    const item = value as Partial<ArchiveItem> | null;
    if (!item || typeof item !== 'object') return [];
    const kind: MediaKind = item.kind === 'video' ? 'video' : 'image';
    const candidates = cleanCandidates(item.candidates, 8);
    const streams = kind === 'video' ? cleanCandidates(item.streams, MAX_STREAMS).filter(isVideoStreamUrl) : [];
    const stem = typeof item.stem === 'string' ? item.stem.split('/').map(filenameStem).filter(Boolean).join('/') : '';
    if (!stem || (candidates.length === 0 && streams.length === 0)) return [];
    return [{
      kind,
      candidates,
      streams,
      stem,
      title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
      pinUrl: typeof item.pinUrl === 'string' && item.pinUrl.startsWith('https://www.pinterest.com/pin/') ? item.pinUrl : '',
    }];
  });
}

/**
 * Packs the collected pins into one archive. The offscreen document fetches
 * and joins the files, since only a document can hand Chrome's download
 * manager a `blob:` URL for something that never existed on a server.
 */
async function buildArchive(request: ArchiveRequest, port: chrome.runtime.Port): Promise<void> {
  const post = (event: ArchiveEvent) => {
    try {
      port.postMessage(event);
    } catch {
      // The tab went away; the archive is still saved.
    }
  };
  const items = cleanArchiveItems(request.items);
  if (items.length === 0) {
    post({ type: 'ARCHIVE_DONE', ok: false, message: 'Nothing to save', included: 0, failed: 0 });
    return;
  }
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  archivePorts.set(jobId, port);
  try {
    await ensureOffscreenDocument();
    const message: OffscreenArchiveMessage = {
      type: 'OFFSCREEN_BUILD_ARCHIVE',
      target: 'offscreen',
      jobId,
      items,
      includeCredits: request.includeCredits === true,
    };
    const built = await withTimeout(
      chrome.runtime.sendMessage<OffscreenArchiveMessage, ArchiveBuiltResponse>(message),
      ARCHIVE_TIMEOUT_MS,
      'Packing the archive timed out',
    );
    if (!built?.ok || !built.url) {
      post({
        type: 'ARCHIVE_DONE',
        ok: false,
        message: built?.message ?? 'Could not build the archive',
        included: 0,
        failed: built?.failed ?? items.length,
      });
      return;
    }
    const name = filenameStem(typeof request.archiveName === 'string' ? request.archiveName : '') || 'Pinterest-collection';
    const downloadId = await chrome.downloads.download({
      url: built.url,
      filename: `${DEFAULT_DIRECTORY}/${name}.zip`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    releaseWhenSaved(downloadId, built.url);
    post({ type: 'ARCHIVE_DONE', ok: true, message: built.message, included: built.included, failed: built.failed });
  } catch (error) {
    post({
      type: 'ARCHIVE_DONE',
      ok: false,
      message: error instanceof Error ? error.message : 'Could not build the archive',
      included: 0,
      failed: items.length,
    });
  } finally {
    archivePorts.delete(jobId);
  }
}

export default defineBackground(() => {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== ARCHIVE_PORT) return;
    port.onMessage.addListener((request: ArchiveRequest) => {
      if (request?.type === 'BUILD_ARCHIVE') void buildArchive(request, port);
    });
  });

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'ARCHIVE_PROGRESS' && message.target === 'background') {
      const port = archivePorts.get(message.jobId);
      try {
        port?.postMessage({ type: 'ARCHIVE_PROGRESS', done: message.done, total: message.total } satisfies ArchiveEvent);
      } catch {
        // The tab went away mid-archive.
      }
      return false;
    }
    if (message.type !== 'DOWNLOAD_MEDIA' && message.type !== 'COPY_MEDIA') return false;

    const action = message.type === 'DOWNLOAD_MEDIA' ? downloadMedia(message) : copyMedia(message);
    action
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, message: 'Unexpected extension error' } satisfies ActionResponse));
    return true;
  });
});
