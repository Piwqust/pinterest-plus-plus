import type { ActionResponse } from './messages';
import { withTimeout } from './async';
import { firstSuccessfulCandidate } from './candidate-processing';
import type { PinMediaOption } from './media';

const DIRECT_COPY_TIMEOUT_MS = 12_000;
const MAX_DIRECT_COPY_CANDIDATES = 3;

async function fetchCopySource(candidate: string): Promise<Blob> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DIRECT_COPY_TIMEOUT_MS);
  try {
    const response = await fetch(candidate, { credentials: 'omit', cache: 'force-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return await withTimeout(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  }), DIRECT_COPY_TIMEOUT_MS, 'Copy timed out while preparing the image');
}

async function imageBlobToPng(source: Blob): Promise<Blob> {
  const bitmap = await withTimeout(createImageBitmap(source), DIRECT_COPY_TIMEOUT_MS, 'Copy timed out while decoding the image');
  try {
    if (bitmap.width === 0 || bitmap.height === 0) throw new Error('Image has no drawable pixels');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0);
    return await canvasToPng(canvas);
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
    await withTimeout(new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Video frame could not be decoded')), { once: true });
      video.load();
    }), DIRECT_COPY_TIMEOUT_MS, 'Copy timed out while decoding the video');
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Video has no decoded frame');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToPng(canvas);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function pngFromCandidates(
  candidates: string[],
  render: (source: Blob) => Promise<Blob>,
  failureMessage: string,
): Promise<Blob> {
  return await firstSuccessfulCandidate(
    candidates.slice(0, MAX_DIRECT_COPY_CANDIDATES),
    async (candidate) => render(await fetchCopySource(candidate)),
    failureMessage,
  );
}

/**
 * Starts ClipboardItem.write while the originating button click is still
 * active. ClipboardItem accepts a Blob promise, so decoding can complete after
 * the browser has accepted the user-gesture-gated copy request.
 */
export function beginDirectCopy(media: PinMediaOption): Promise<ActionResponse> | null {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return null;

  const png = media.kind === 'video'
    ? pngFromCandidates(media.candidates, videoBlobToPng, 'Could not decode a video frame')
      .catch(() => pngFromCandidates(media.posterCandidates, imageBlobToPng, 'Could not decode a video poster'))
    : pngFromCandidates(media.candidates, imageBlobToPng, 'Could not decode a Pinterest image');
  const item = new ClipboardItem({ 'image/png': png });
  return withTimeout(
    navigator.clipboard.write([item]),
    DIRECT_COPY_TIMEOUT_MS,
    'Copy timed out. Please try again.',
  ).then(
    () => ({ ok: true, message: media.kind === 'video' ? 'First frame copied' : 'Image copied' }),
    (error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : 'Could not copy this media',
    }),
  );
}
