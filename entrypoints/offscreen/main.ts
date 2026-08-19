import { SequentialTaskQueue, firstSuccessfulCandidate } from '../../shared/candidate-processing';
import { withTimeout } from '../../shared/async';
import type { ActionResponse, OffscreenCopyMessage } from '../../shared/messages';

const canvasElement = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvasElement) throw new Error('Offscreen canvas is missing');
const canvas: HTMLCanvasElement = canvasElement;
const copyQueue = new SequentialTaskQueue();
const FETCH_TIMEOUT_MS = 5_000;
const PROCESS_TIMEOUT_MS = 5_000;
const MAX_COPY_CANDIDATES = 3;

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

chrome.runtime.onMessage.addListener((message: OffscreenCopyMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'OFFSCREEN_COPY') return false;
  copyQueue.run(() => copy(message)).then(sendResponse, () => {
    sendResponse({ ok: false, message: 'Could not process this media' } satisfies ActionResponse);
  });
  return true;
});
