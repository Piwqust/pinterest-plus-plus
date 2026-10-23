import type { MediaKind } from './messages';

const PINIMG_SIZE_SEGMENT = /\/(?:\d+x(?:\d+)?|\d+x)\//i;
const SAFE_MEDIA_HOST = /(^|\.)(?:pinimg\.com|pinterest\.com)$/i;
const MEDIA_EXTENSION = /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)$/i;
const VIDEO_FILE_EXTENSION = /\.(?:mp4|webm|mov|m4v)$/i;
const VIDEO_MANIFEST_EXTENSION = /\.(?:m3u8|mpd|xml)$/i;
const PINTEREST_VIDEO_HOST = /^v\d*\.pinimg\.com$/i;
const PINTEREST_VIDEO_PATH = /^\/videos\//i;
/** Pinterest groups its encodings under a tier segment, currently `mc` or `iht`. */
const PINTEREST_STREAM_PATH = /\/videos\/[^/]+\/(?:hls|h265)\//i;
const PINTEREST_THUMBNAIL_PATH = /^\/videos\/thumbnails\//i;
const MEDIA_HASH = /^[a-f\d]{32}$/i;
const VIDEO_TIERS = ['iht', 'mc'] as const;
/**
 * Pinterest does not publish every rung for every video: a clip served at 720p
 * answers 403 on its 1080p route, and vice versa. Every rung is offered,
 * highest first, and the service worker keeps the first one that resolves.
 */
const VIDEO_QUALITIES = ['1080p', '720p', '480p', '360p'] as const;
const VIDEO_QUALITY_SEGMENT = /\/(2160|1440|1080|720|540|480|360)p\//i;
/** The newer encoder names a rung by its width instead: `expMp4/<id>_720w.mp4`. */
const VIDEO_WIDTH_SUFFIX = /_(\d{3,4})w\.mp4$/i;
/** Experimental rungs, `expMp4/<id>_t1.mp4` to `_t4.mp4`, all below 720p. */
const VIDEO_TIER_SUFFIX = /_t(\d)\.mp4$/i;
/** HEVC needs a codec Windows does not ship, so it only wins when it is all there is. */
const HEVC_PATH = /\/hevc/i;
const HEVC_PENALTY = 100_000;
const VIDEO_ORIGINALS_SEGMENT = /\/originals?\//i;
/** A rendition or audio playlist, whose master sits beside it under the bare id. */
const RENDITION_PLAYLIST = /^([a-f\d]{32})_(?:\d+w|audio)\.m3u8$/i;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MEDIA_CONTENT_TYPE: Record<MediaKind, string> = { image: 'image/', video: 'video/' };
/** A byte stream the CDN declines to type is still the file that was asked for. */
const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

export interface MediaDescriptor {
  kind: MediaKind;
  candidates: string[];
  /**
   * HLS playlists for a video. Every video Pinterest plays has one, so it is
   * both the map to the progressive files and the source of last resort.
   */
  streams: string[];
  posterCandidates: string[];
  suggestedName: string;
}

export interface PinMediaOption extends MediaDescriptor {
  /** A currently-rendered, safe preview source for the action picker. */
  previewUrl: string;
}

function absoluteUrl(value: string | null | undefined): string | null {
  if (!value || value.startsWith('blob:') || value.startsWith('data:')) return null;
  try {
    return new URL(value, location.href).href;
  } catch {
    return null;
  }
}

export function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SAFE_MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** A video download must be a media file, never a Pinterest page or stream manifest. */
export function isDownloadableVideoUrl(value: string): boolean {
  if (!isAllowedMediaUrl(value)) return false;
  try {
    const url = new URL(value);
    if (VIDEO_FILE_EXTENSION.test(url.pathname)) return true;

    // Pinterest's progressive CDN endpoints do not always include a file
    // extension. Restrict this exception to its video CDN and exclude the
    // HLS/DASH routes, which are playlists rather than downloadable files.
    return PINTEREST_VIDEO_HOST.test(url.hostname) &&
      PINTEREST_VIDEO_PATH.test(url.pathname) &&
      !PINTEREST_STREAM_PATH.test(url.pathname) &&
      !VIDEO_MANIFEST_EXTENSION.test(url.pathname);
  } catch {
    return false;
  }
}

export function isVideoStreamUrl(value: string): boolean {
  if (!isAllowedMediaUrl(value)) return false;
  try {
    const url = new URL(value);
    return PINTEREST_VIDEO_HOST.test(url.hostname) && /\.m3u8$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * A stream URL the player requested, rewritten to its master playlist where it
 * named one rendition: only the master lists the audio a CMAF video keeps apart.
 */
function masterStreamFor(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/');
    const match = segments.at(-1)?.match(RENDITION_PLAYLIST);
    if (!match?.[1]) return value;
    segments[segments.length - 1] = `${match[1]}.m3u8`;
    url.pathname = segments.join('/');
    return url.href;
  } catch {
    return value;
  }
}

/**
 * Whether a CDN response carries the media file itself. Pinterest answers a
 * route it never published with 403 and an XML error body, and Chrome's
 * download manager saves that body as a file, so the status and the declared
 * type both have to agree before a candidate reaches Downloads.
 */
export function isMediaResponse(status: number, contentType: string | null | undefined, kind: MediaKind): boolean {
  if (status < 200 || status >= 300) return false;
  const type = (contentType ?? '').trim().toLowerCase();
  return type.startsWith(MEDIA_CONTENT_TYPE[kind]) || type.startsWith(OPAQUE_CONTENT_TYPE);
}

function progressiveVideoCandidates(value: string): string[] {
  if (isDownloadableVideoUrl(value)) return [value];

  try {
    const url = new URL(value);
    if (!PINTEREST_VIDEO_HOST.test(url.hostname) ||
      !PINTEREST_STREAM_PATH.test(url.pathname) ||
      !VIDEO_MANIFEST_EXTENSION.test(url.pathname)) {
      return [];
    }

    // Pinterest publishes downloadable MP4 renditions beside the HLS/DASH
    // manifest under the same tier and media id. The video element commonly
    // exposes only the manifest, so resolve it before sending candidates to
    // Downloads. Which rungs exist varies per video, so all of them are
    // offered rather than betting the whole download on a single guess.
    return VIDEO_QUALITIES.map((quality) => {
      const rendition = new URL(url.href);
      rendition.pathname = url.pathname
        .replace(/(\/videos\/[^/]+)\/(?:hls|h265)\//i, `$1/${quality}/`)
        .replace(VIDEO_MANIFEST_EXTENSION, '.mp4');
      return rendition.href;
    });
  } catch {
    return [];
  }
}

function pinimgMediaHash(value: string): string | null {
  try {
    const url = new URL(value);
    const hash = decodeURIComponent(url.pathname.split('/').pop() ?? '').split('.')[0] ?? '';
    return MEDIA_HASH.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** The media id Pinterest shares between a video and its generated frames. */
function videoThumbnailHash(value: string): string | null {
  try {
    return PINTEREST_THUMBNAIL_PATH.test(new URL(value).pathname) ? pinimgMediaHash(value) : null;
  } catch {
    return null;
  }
}

/**
 * The sources Pinterest's own player already requested for this media id. A
 * feed video streams from a `blob:` URL, but the manifest behind it stays in
 * the document's resource timeline, which names the exact CDN route.
 */
export function videoCandidatesFromTimeline(hash: string, timeline: readonly string[]): string[] {
  if (!MEDIA_HASH.test(hash)) return [];
  return timeline
    .filter((entry) => entry.includes(hash))
    .flatMap(progressiveVideoCandidates);
}

function requestedMediaUrls(): string[] {
  if (typeof performance?.getEntriesByType !== 'function') return [];
  try {
    return performance.getEntriesByType('resource').map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Pinterest derives a video's CDN path from its media hash and publishes the
 * first frame under that same hash, so the poster is a usable handle on the
 * source file when nothing else names it. The encoding tier and quality are not
 * derivable, so every plausible route is offered; the service worker checks each
 * one before handing it to Chrome's download manager.
 */
export function videoCandidatesForHash(hash: string): string[] {
  if (!MEDIA_HASH.test(hash)) return [];
  const shard = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}`;
  return VIDEO_QUALITIES.flatMap((quality) => VIDEO_TIERS.map(
    (tier) => `https://v1.pinimg.com/videos/${tier}/${quality}/${shard}/${hash}.mp4`,
  ));
}

/** The master playlists a media id can live under; the one that answers is kept. */
export function videoStreamsForHash(hash: string): string[] {
  if (!MEDIA_HASH.test(hash)) return [];
  const shard = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}`;
  return VIDEO_TIERS.map((tier) => `https://v1.pinimg.com/videos/${tier}/hls/${shard}/${hash}.m3u8`);
}

/**
 * Images rendered for the slide the video belongs to. Pinterest often renders
 * the frame as a sibling image instead of a `poster` attribute, so nearby images
 * count — but only while the scope still describes a single carousel slide.
 */
function slideImages(video: HTMLVideoElement, identify: (value: string) => string | null): string[] {
  const poster = absoluteUrl(video.poster);
  if (poster && identify(poster)) return [poster];

  let scope = video.parentElement;
  for (let depth = 0; scope && depth < 3; depth += 1, scope = scope.parentElement) {
    const images = uniqueAllowed(Array.from(scope.querySelectorAll<HTMLImageElement>('img'))
      .flatMap((image) => [absoluteUrl(image.currentSrc), absoluteUrl(image.src)]))
      .filter((candidate) => identify(candidate));
    const hashes = new Set(images.map(identify));
    if (hashes.size === 1) return images;
    if (hashes.size > 1) return [];
  }
  return [];
}

/** Poster frames Pinterest generated for this video. */
function slideThumbnails(video: HTMLVideoElement): string[] {
  return slideImages(video, videoThumbnailHash);
}

/**
 * Media ids that can name this slide's video file. A generated video frame is
 * the reliable one; an Idea Pin slide instead renders a cover image, whose id is
 * still worth trying because a wrong guess only costs one rejected HEAD request.
 */
function slideMediaHashes(video: HTMLVideoElement): string[] {
  const generated = slideThumbnails(video).map(videoThumbnailHash);
  const hashes = generated.length > 0 ? generated : slideImages(video, pinimgMediaHash).map(pinimgMediaHash);
  return [...new Set(hashes)].filter((hash): hash is string => Boolean(hash));
}

/** Video files for a slide whose player exposes nothing but a `blob:` source. */
function recoveredVideoCandidates(video: HTMLVideoElement): string[] {
  const hashes = slideMediaHashes(video);
  if (hashes.length === 0) return [];

  const timeline = requestedMediaUrls();
  const requested = uniqueAllowed(hashes.flatMap((hash) => videoCandidatesFromTimeline(hash, timeline)))
    .filter(isDownloadableVideoUrl);
  const derived = uniqueAllowed(hashes.flatMap(videoCandidatesForHash))
    .filter(isDownloadableVideoUrl)
    .sort((a, b) => rankVideoUrl(b) - rankVideoUrl(a));
  // A route the player actually used is known to exist, so it leads even when a
  // higher-quality route might also be published.
  return [...new Set([...requested, ...derived])];
}

/** Playlists for a slide whose player exposes nothing but a `blob:` source. */
function recoveredVideoStreams(video: HTMLVideoElement): string[] {
  const hashes = slideMediaHashes(video);
  if (hashes.length === 0) return [];
  const requested = requestedMediaUrls()
    .filter((entry) => isVideoStreamUrl(entry) && hashes.some((hash) => entry.includes(hash)))
    .map(masterStreamFor);
  return uniqueAllowed([...requested, ...hashes.flatMap(videoStreamsForHash)]);
}

export function parseSrcset(srcset: string | null | undefined): string[] {
  if (!srcset) return [];

  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .map(([url, descriptor]) => ({
      url: absoluteUrl(url),
      score: Number.parseFloat(descriptor ?? '0') || 0,
    }))
    .filter((candidate): candidate is { url: string; score: number } => Boolean(candidate.url))
    .sort((a, b) => b.score - a.score)
    .map(({ url }) => url);
}

export function toOriginalPinimgUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/(^|\.)pinimg\.com$/i.test(url.hostname)) return null;
    const rewritten = url.pathname.replace(PINIMG_SIZE_SEGMENT, '/originals/');
    if (rewritten === url.pathname) return null;
    url.pathname = rewritten;
    return url.href;
  } catch {
    return null;
  }
}

function uniqueAllowed(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && isAllowedMediaUrl(value))))];
}

function qualityRank(pathname: string): number {
  const quality = pathname.match(VIDEO_QUALITY_SEGMENT)?.[1] ?? pathname.match(VIDEO_WIDTH_SUFFIX)?.[1];
  if (quality) return Number(quality);
  const tier = pathname.match(VIDEO_TIER_SUFFIX)?.[1];
  if (tier) return Number(tier) * 100;
  if (VIDEO_ORIGINALS_SEGMENT.test(pathname)) return 10_000;
  return 0;
}

/**
 * Ranks by the quality Pinterest writes into the path or the file suffix only.
 * Pinterest names a video file with a 32-character hex media id, and a hex id
 * can contain a bare `1080` or `720`, so scanning the whole URL for digits can
 * rank a low rung above a high one.
 */
export function rankVideoUrl(value: string): number {
  try {
    const { pathname } = new URL(value);
    return qualityRank(pathname) - (HEVC_PATH.test(pathname) ? HEVC_PENALTY : 0);
  } catch {
    // An unparseable URL simply ranks last.
  }
  return Number.MIN_SAFE_INTEGER;
}

function urlsFromMediaAttribute(value: string): string[] {
  const decoded = value
    .replace(/\\u([\da-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, '/');
  return [...decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/g)]
    .map((match) => absoluteUrl(match[0]))
    .filter((url): url is string => Boolean(url));
}

function lazyVideoCandidates(video: HTMLVideoElement): string[] {
  const attributeNodes: Element[] = [video, ...Array.from(video.querySelectorAll('source'))];
  let ancestor = video.parentElement;
  for (let depth = 0; ancestor && depth < 2; depth += 1, ancestor = ancestor.parentElement) {
    attributeNodes.push(ancestor);
  }

  return attributeNodes.flatMap((node) => Array.from(node.attributes)
    .filter((attribute) => /^(?:src|data-[\w-]*(?:video|media|src|url|source|stream)[\w-]*)$/i.test(attribute.name))
    .flatMap((attribute) => urlsFromMediaAttribute(attribute.value)));
}

export function imageCandidates(image: HTMLImageElement): string[] {
  const pictureSources = Array.from(image.closest('picture')?.querySelectorAll('source') ?? [])
    .flatMap((source) => parseSrcset(source.srcset));
  const base = [
    ...pictureSources,
    ...parseSrcset(image.srcset),
    absoluteUrl(image.currentSrc),
    absoluteUrl(image.src),
  ].filter((value): value is string => Boolean(value));
  const originals = base.map(toOriginalPinimgUrl).filter((value): value is string => Boolean(value));
  return uniqueAllowed([...originals, ...base]);
}

export function videoCandidates(video: HTMLVideoElement): string[] {
  const sources = Array.from(video.querySelectorAll('source'))
    .map((source) => absoluteUrl(source.src))
    .filter((value): value is string => Boolean(value));
  const values = uniqueAllowed([
    ...sources,
    absoluteUrl(video.currentSrc),
    absoluteUrl(video.src),
    ...lazyVideoCandidates(video),
  ]).flatMap(progressiveVideoCandidates);
  const exposed = uniqueAllowed(values)
    .filter(isDownloadableVideoUrl)
    .sort((a, b) => rankVideoUrl(b) - rankVideoUrl(a));
  // A route the page named leads, but naming one is not proof it resolves: an
  // exposed manifest can rewrite to a rendition Pinterest never published, and
  // its extension-less progressive routes 403. The media-id routes stay behind
  // it as fallbacks instead of being dropped whenever the DOM named anything.
  return [...new Set([...exposed, ...recoveredVideoCandidates(video)])];
}

export function videoStreams(video: HTMLVideoElement): string[] {
  const exposed = [
    ...Array.from(video.querySelectorAll('source')).map((source) => absoluteUrl(source.src)),
    absoluteUrl(video.currentSrc),
    absoluteUrl(video.src),
    ...lazyVideoCandidates(video),
  ].filter((value): value is string => Boolean(value && isVideoStreamUrl(value)))
    .map(masterStreamFor);
  return uniqueAllowed([...exposed, ...recoveredVideoStreams(video)]);
}

export function posterCandidates(video: HTMLVideoElement): string[] {
  const poster = absoluteUrl(video.poster);
  const thumbnails = slideThumbnails(video).flatMap((thumbnail) => [toOriginalPinimgUrl(thumbnail), thumbnail]);
  return uniqueAllowed([poster ? toOriginalPinimgUrl(poster) : null, poster, ...thumbnails]);
}

export function mediaFileExtension(raw: string, kind: MediaKind): string {
  const fallbackExtension = kind === 'video' ? 'mp4' : 'jpg';
  try {
    const basename = decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? '');
    const extension = basename.match(MEDIA_EXTENSION)?.[1]?.toLowerCase();
    if (extension) return extension;
  } catch {
    // A safe fallback extension is more useful than a failed download name.
  }
  return fallbackExtension;
}

function filenameStem(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F<>:"/\\|?*]/g, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .replace(/[\s._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!normalized || WINDOWS_RESERVED_NAME.test(normalized)) return '';
  return normalized;
}

function sourceStem(raw: string, kind: MediaKind): string {
  try {
    const basename = decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? '');
    const withoutExtension = basename.replace(MEDIA_EXTENSION, '');
    const normalized = filenameStem(withoutExtension);
    if (normalized && !/^[a-f\d]{12,}$/i.test(normalized)) return normalized;
    if (normalized) return `${kind}-${normalized.slice(0, 8)}`;
  } catch {
    // Use the stable media fallback below.
  }
  return kind;
}

function readableMediaTitle(element: HTMLImageElement | HTMLVideoElement): string {
  const link = element.closest('a');
  const candidates = [
    element instanceof HTMLImageElement ? element.alt : '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
    link?.getAttribute('aria-label') ?? '',
    link?.getAttribute('title') ?? '',
  ];
  return candidates.find((value) => {
    const stem = filenameStem(value);
    return Boolean(stem && !/^(?:pin|image|video|pinterest)$/i.test(stem));
  }) ?? '';
}

/**
 * Builds a readable Downloads path. Carousel items use a small, ordered suffix
 * so a single pin's assets remain grouped without relying on Chrome's `(1)`
 * conflict suffixes or opaque CDN ids.
 */
export function safeFilename(raw: string, kind: MediaKind, title = '', sequence?: number): string {
  const readableTitle = filenameStem(title);
  const stem = readableTitle || sourceStem(raw, kind);
  const numberedStem = sequence && sequence > 0
    ? `${stem}-${String(sequence).padStart(2, '0')}`
    : stem;
  return `Pinterest/${numberedStem}.${mediaFileExtension(raw, kind)}`;
}

export function describeMedia(element: HTMLImageElement | HTMLVideoElement): MediaDescriptor {
  const kind: MediaKind = element instanceof HTMLVideoElement ? 'video' : 'image';
  const candidates = kind === 'video' ? videoCandidates(element as HTMLVideoElement) : imageCandidates(element as HTMLImageElement);
  const posters = kind === 'video' ? posterCandidates(element as HTMLVideoElement) : [];
  return {
    kind,
    candidates,
    streams: kind === 'video' ? videoStreams(element as HTMLVideoElement) : [],
    posterCandidates: posters,
    suggestedName: safeFilename(candidates[0] ?? posters[0] ?? '', kind, readableMediaTitle(element)),
  };
}

function previewUrlFor(element: HTMLImageElement | HTMLVideoElement, descriptor: MediaDescriptor): string {
  if (element instanceof HTMLVideoElement) {
    const poster = absoluteUrl(element.poster);
    if (poster && isAllowedMediaUrl(poster)) return poster;
    return descriptor.posterCandidates.at(-1) ?? '';
  }

  const rendered = absoluteUrl(element.currentSrc) ?? absoluteUrl(element.src);
  if (rendered && isAllowedMediaUrl(rendered)) return rendered;
  return descriptor.candidates.at(-1) ?? '';
}

/**
 * Returns each distinct Pinterest media item among the given elements, in the
 * order supplied. Several elements can represent the same carousel slide at
 * different sizes; the highest-quality candidate is a stable identity for that
 * slide.
 */
export function collectMediaOptions(
  media: ReadonlyArray<HTMLImageElement | HTMLVideoElement>,
): PinMediaOption[] {
  const seen = new Set<string>();
  const distinct = media.flatMap((element) => {
    const descriptor = describeMedia(element);
    const identity = descriptor.candidates[0] ?? descriptor.posterCandidates[0];
    if (!identity || seen.has(`${descriptor.kind}:${identity}`)) return [];

    seen.add(`${descriptor.kind}:${identity}`);
    return [{ element, descriptor }];
  });

  return distinct.map(({ element, descriptor }, index) => ({
    ...descriptor,
    suggestedName: safeFilename(
      descriptor.candidates[0] ?? descriptor.posterCandidates[0] ?? '',
      descriptor.kind,
      readableMediaTitle(element),
      distinct.length > 1 ? index + 1 : undefined,
    ),
    previewUrl: previewUrlFor(element, descriptor),
  }));
}

/** Every distinct Pinterest media item rendered inside a pin, in DOM order. */
export function collectPinMedia(pin: ParentNode): PinMediaOption[] {
  return collectMediaOptions(
    Array.from(pin.querySelectorAll<HTMLImageElement | HTMLVideoElement>('video, img')),
  );
}
