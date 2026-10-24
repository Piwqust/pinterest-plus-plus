import { SequentialTaskQueue, firstSuccessfulCandidate } from '../../shared/candidate-processing';
import { withTimeout } from '../../shared/async';
import { assembleStream } from '../../shared/hls-assembly';
import { creditsCsv, type CreditRow } from '../../shared/collection';
import { isDownloadableVideoUrl, isMediaResponse, mediaFileExtension } from '../../shared/media';
import { zipParts, type ZipEntry } from '../../shared/zip';
import type {
  ActionResponse,
  ArchiveBuiltResponse,
  ArchiveItem,
  ArchiveProgressMessage,
  AssembledVideoResponse,
  OffscreenArchiveMessage,
  OffscreenAssembleMessage,
  OffscreenCopyMessage,
  OffscreenMessage,
} from '../../shared/messages';

const canvasElement = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvasElement) throw new Error('Offscreen canvas is missing');
const canvas: HTMLCanvasElement = canvasElement;
const copyQueue = new SequentialTaskQueue();
const FETCH_TIMEOUT_MS = 5_000;
const PROCESS_TIMEOUT_MS = 5_000;
const MAX_COPY_CANDIDATES = 3;
/** One stream file; a long video's track can run to tens of megabytes. */
const STREAM_FETCH_TIMEOUT_MS = 60_000;
/**
 * The service worker releases an assembled file once Chrome has finished
 * saving it. A worker that was shut down in the meantime never will, so the
 * file is let go regardless after a while.
 */
const ASSEMBLED_LIFETIME_MS = 10 * 60_000;
const assembledUrls = new Map<string, ReturnType<typeof setTimeout>>();
/** One original; a full-size PNG can run to tens of megabytes. */
const ARCHIVE_FETCH_TIMEOUT_MS = 45_000;
/** Enough to keep the network busy without a burst Pinimg would throttle. */
const ARCHIVE_CONCURRENCY = 4;
const PROGRESS_INTERVAL_MS = 200;

async function fetchSource(candidate: string): Promise<Blob> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(candidate, {
      credentials: 'omit',
      cache: 'force-cache',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function canvasToPng(): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error('PNG encoding timed out')), PROCESS_TIMEOUT_MS);
    canvas.toBlob((blob) => {
      globalThis.clearTimeout(timeout);
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}

async function imageBlobToPng(source: Blob): Promise<Blob> {
  const bitmap = await withTimeout(createImageBitmap(source), PROCESS_TIMEOUT_MS, 'Image decoding timed out');
  try {
    if (bitmap.width === 0 || bitmap.height === 0) throw new Error('Image has no drawable pixels');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas is unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await canvasToPng();
  } finally {
    bitmap.close();
  }
}

async function videoBlobToPng(source: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (callback: () => void) => {
        globalThis.clearTimeout(timeout);
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('error', failed);
        callback();
      };
      const loaded = () => finish(resolve);
      const failed = () => finish(() => reject(new Error('Video frame could not be decoded')));
      const timeout = globalThis.setTimeout(() => finish(() => reject(new Error('Video decoding timed out'))), PROCESS_TIMEOUT_MS);
      video.addEventListener('loadeddata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.load();
    });
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Video has no decoded frame');
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToPng();
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function imageToPng(candidates: string[]): Promise<Blob> {
  return await firstSuccessfulCandidate(
    candidates.slice(0, MAX_COPY_CANDIDATES),
    async (candidate) => imageBlobToPng(await fetchSource(candidate)),
    'No usable image source was available',
  );
}

async function videoFirstFrameToPng(candidates: string[]): Promise<Blob> {
  return await firstSuccessfulCandidate(
    candidates.slice(0, MAX_COPY_CANDIDATES),
    async (candidate) => videoBlobToPng(await fetchSource(candidate)),
    'No usable video source was available',
  );
}

async function writePngToClipboard(png: Blob): Promise<void> {
  // ClipboardItem is the preferred API, but some Chrome builds reject it in an
  // unfocused offscreen page even with clipboardWrite. Fall back to Chrome's
  // supported offscreen selection-and-copy pattern in that case.
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await withTimeout(
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
        PROCESS_TIMEOUT_MS,
        'Clipboard write timed out',
      );
      return;
    } catch {
      // Continue with document.execCommand below.
    }
  }

  const objectUrl = URL.createObjectURL(png);
  const copyHost = document.createElement('div');
  const image = document.createElement('img');
  copyHost.contentEditable = 'true';
  copyHost.tabIndex = -1;
  copyHost.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  image.src = objectUrl;
  copyHost.append(image);
  document.body.append(copyHost);

  try {
    await withTimeout(image.decode(), PROCESS_TIMEOUT_MS, 'Clipboard image preparation timed out');
    const selection = window.getSelection();
    if (!selection) throw new Error('Selection is unavailable');
    const range = document.createRange();
    range.selectNode(image);
    selection.removeAllRanges();
    selection.addRange(range);
    copyHost.focus();
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected');
    selection.removeAllRanges();
  } finally {
    copyHost.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

async function copy(message: OffscreenCopyMessage): Promise<ActionResponse> {
  let png: Blob;
  try {
    if (message.kind === 'video') {
      try {
        png = await videoFirstFrameToPng(message.candidates);
      } catch {
        png = await imageToPng(message.posterCandidates);
      }
    } else {
      png = await imageToPng(message.candidates);
    }
  } catch {
    return {
      ok: false,
      message: message.kind === 'video'
        ? 'Could not decode a video frame or poster'
        : 'Could not decode a Pinterest image',
    };
  }

  try {
    await writePngToClipboard(png);
  } catch {
    return { ok: false, message: 'Could not write the image to the clipboard' };
  }

  return {
    ok: true,
    message: message.kind === 'video' ? 'First frame copied' : 'Image copied',
  };
}

async function loadStreamFile(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), STREAM_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function release(url: string): void {
  const timer = assembledUrls.get(url);
  if (timer === undefined) return;
  globalThis.clearTimeout(timer);
  assembledUrls.delete(url);
  URL.revokeObjectURL(url);
}

/**
 * Builds the video in this document because a service worker cannot mint the
 * `blob:` URL Chrome's download manager needs to save a file that never
 * existed on a server.
 */
async function assemble(message: OffscreenAssembleMessage): Promise<AssembledVideoResponse> {
  try {
    const bytes = await assembleStream(message.stream, loadStreamFile);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }));
    assembledUrls.set(url, globalThis.setTimeout(() => release(url), ASSEMBLED_LIFETIME_MS));
    return { ok: true, message: 'Video assembled', url };
  } catch {
    return { ok: false, message: 'Could not assemble the video from its stream' };
  }
}

async function fetchMediaBytes(url: string, kind: ArchiveItem['kind']): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), ARCHIVE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: controller.signal });
    // An unpublished route answers with an XML error body, which must not be packed as a picture.
    if (!isMediaResponse(response.status, response.headers.get('content-type'), kind)) {
      await response.body?.cancel();
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** The first source of a pin that answers with a real file, and the extension it earns. */
async function archiveFile(item: ArchiveItem): Promise<{ bytes: Uint8Array; extension: string } | null> {
  const candidates = item.kind === 'video' ? item.candidates.filter(isDownloadableVideoUrl) : item.candidates;
  for (const candidate of candidates) {
    const bytes = await fetchMediaBytes(candidate, item.kind);
    if (bytes && bytes.length > 0) return { bytes, extension: mediaFileExtension(candidate, item.kind) };
  }
  for (const stream of item.streams) {
    try {
      return { bytes: await assembleStream(stream, loadStreamFile), extension: 'mp4' };
    } catch {
      // Another rendition may still assemble.
    }
  }
  return null;
}

function uniquePath(stem: string, extension: string, used: Set<string>): string {
  let path = `${stem}.${extension}`;
  for (let index = 2; used.has(path.toLowerCase()); index += 1) path = `${stem}-${index}.${extension}`;
  used.add(path.toLowerCase());
  return path;
}

/**
 * Fetches every pin of the batch and packs them into one ZIP. A pin whose
 * sources all fail is left out and counted, rather than failing the batch.
 */
async function buildArchive(message: OffscreenArchiveMessage): Promise<ArchiveBuiltResponse> {
  const { items } = message;
  const files: Array<{ bytes: Uint8Array; extension: string } | null> = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  let lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    const progress: ArchiveProgressMessage = {
      type: 'ARCHIVE_PROGRESS',
      target: 'background',
      jobId: message.jobId,
      done,
      total: items.length,
    };
    chrome.runtime.sendMessage(progress).catch(() => undefined);
  };
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      files[index] = await archiveFile(items[index]!);
      done += 1;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(ARCHIVE_CONCURRENCY, items.length) }, worker));
  report(true);

  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  const credits: CreditRow[] = [];
  const modified = new Date();
  items.forEach((item, index) => {
    const file = files[index];
    if (!file) return;
    const path = uniquePath(item.stem, file.extension, used);
    entries.push({ name: path, data: file.bytes, modified });
    credits.push({ file: path, title: item.title, pinUrl: item.pinUrl });
  });
  const failed = items.length - entries.length;
  if (entries.length === 0) {
    return { ok: false, message: 'Pinterest did not serve any of these files', included: 0, failed };
  }
  if (message.includeCredits) {
    entries.push({ name: 'sources.csv', data: new TextEncoder().encode(creditsCsv(credits)), modified });
  }

  try {
    const blob = new Blob(zipParts(entries) as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    assembledUrls.set(url, globalThis.setTimeout(() => release(url), ASSEMBLED_LIFETIME_MS));
    const included = credits.length;
    return {
      ok: true,
      message: failed > 0
        ? `Saved ${included} of ${items.length}. Pinterest did not serve ${failed}.`
        : `Saved ${included} ${included === 1 ? 'file' : 'files'} as a ZIP`,
      url,
      included,
      failed,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not pack the archive',
      included: 0,
      failed: items.length,
    };
  }
}

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'OFFSCREEN_BUILD_ARCHIVE') {
    buildArchive(message).then(sendResponse, () => {
      sendResponse({ ok: false, message: 'Could not pack the archive', included: 0, failed: message.items.length } satisfies ArchiveBuiltResponse);
    });
    return true;
  }
  if (message.type === 'OFFSCREEN_RELEASE') {
    release(message.url);
    return false;
  }
  if (message.type === 'OFFSCREEN_ASSEMBLE_VIDEO') {
    assemble(message).then(sendResponse);
    return true;
  }
  if (message.type !== 'OFFSCREEN_COPY') return false;
  copyQueue.run(() => copy(message)).then(sendResponse, () => {
    sendResponse({ ok: false, message: 'Could not process this media' } satisfies ActionResponse);
  });
  return true;
});
