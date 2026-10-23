/**
 * The HLS playlists Pinterest's player streams every video from. A pin's data
 * does not always name a progressive MP4, but the player cannot play a video
 * without its playlist, so the playlist is the one source that always exists.
 */

export interface ByteRange {
  offset: number;
  length: number;
}

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  width: number;
  height: number;
  audioGroup: string | null;
}

export interface HlsAudioRendition {
  groupId: string;
  uri: string;
  isDefault: boolean;
}

export interface HlsMaster {
  variants: HlsVariant[];
  audio: HlsAudioRendition[];
}

export interface HlsSegment {
  uri: string;
  range: ByteRange | null;
}

export interface HlsMediaPlaylist {
  /** The fMP4 initialization section; absent for MPEG-TS segments. */
  init: HlsSegment | null;
  segments: HlsSegment[];
  encrypted: boolean;
}

const ATTRIBUTE = /([A-Z\d-]+)=("[^"]*"|[^,]*)/g;
/** Pinterest names a rendition `<media id>_<width>w.m3u8`, and its MP4 the same way. */
const RENDITION_NAME = /^([^/]+)_(\d+)w\.m3u8$/i;
const STREAM_SEGMENT = /\/(?:hls|h265)\//i;
const LEGACY_QUALITIES = ['1080p', '720p', '480p', '360p'] as const;

function attributes(line: string): Map<string, string> {
  const list = line.slice(line.indexOf(':') + 1);
  const values = new Map<string, string>();
  for (const [, key, raw] of list.matchAll(ATTRIBUTE)) {
    if (!key || raw === undefined) continue;
    values.set(key, raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return values;
}

function resolve(uri: string, base: string): string | null {
  try {
    return new URL(uri, base).href;
  } catch {
    return null;
  }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes('#EXT-X-STREAM-INF');
}

export function parseMasterPlaylist(text: string, baseUrl: string): HlsMaster {
  const variants: HlsVariant[] = [];
  const audio: HlsAudioRendition[] = [];
  let pending: Map<string, string> | null = null;

  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = attributes(line);
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const media = attributes(line);
      const uri = media.get('URI');
      const resolved = uri ? resolve(uri, baseUrl) : null;
      if (media.get('TYPE') === 'AUDIO' && resolved) {
        audio.push({
          groupId: media.get('GROUP-ID') ?? '',
          uri: resolved,
          isDefault: media.get('DEFAULT') === 'YES',
        });
      }
      continue;
    }
    if (line.startsWith('#') || !pending) continue;

    const uri = resolve(line, baseUrl);
    const [width, height] = (pending.get('RESOLUTION') ?? '').split('x').map(Number);
    if (uri) {
      variants.push({
        uri,
        bandwidth: Number(pending.get('BANDWIDTH')) || 0,
        width: width || 0,
        height: height || 0,
        audioGroup: pending.get('AUDIO') ?? null,
      });
    }
    pending = null;
  }
  return { variants, audio };
}

function parseByteRange(value: string, previousEnd: number): ByteRange | null {
  const [length, offset] = value.split('@').map(Number);
  if (!length || !Number.isFinite(length)) return null;
  return { length, offset: offset !== undefined && Number.isFinite(offset) ? offset : previousEnd };
}

export function parseMediaPlaylist(text: string, baseUrl: string): HlsMediaPlaylist {
  const segments: HlsSegment[] = [];
  let init: HlsSegment | null = null;
  let encrypted = false;
  let range: ByteRange | null = null;
  // An EXT-X-BYTERANGE without an offset continues from the previous one.
  let previousEnd = 0;

  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-KEY:')) {
      const method = attributes(line).get('METHOD');
      if (method && method !== 'NONE') encrypted = true;
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const map = attributes(line);
      const uri = map.get('URI');
      const resolved = uri ? resolve(uri, baseUrl) : null;
      const mapRange = map.get('BYTERANGE');
      if (resolved) init = { uri: resolved, range: mapRange ? parseByteRange(mapRange, 0) : null };
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      range = parseByteRange(line.slice('#EXT-X-BYTERANGE:'.length), previousEnd);
      continue;
    }
    if (line.startsWith('#')) continue;

    const uri = resolve(line, baseUrl);
    if (uri) segments.push({ uri, range });
    if (range) previousEnd = range.offset + range.length;
    range = null;
  }
  return { init, segments, encrypted };
}

/** The variant with the most picture, which is also the one with the most bits. */
export function bestVariant(master: HlsMaster): HlsVariant | null {
  return master.variants.reduce<HlsVariant | null>((best, variant) => {
    if (!best) return variant;
    const area = variant.width * variant.height;
    const bestArea = best.width * best.height;
    if (area !== bestArea) return area > bestArea ? variant : best;
    return variant.bandwidth > best.bandwidth ? variant : best;
  }, null);
}

export function audioFor(master: HlsMaster, variant: HlsVariant): HlsAudioRendition | null {
  if (!variant.audioGroup) return null;
  const group = master.audio.filter((rendition) => rendition.groupId === variant.audioGroup);
  return group.find((rendition) => rendition.isDefault) ?? group[0] ?? null;
}

/**
 * The progressive MP4s Pinterest publishes beside a stream. Its newer encoder
 * writes `expMp4/<id>_<width>w.mp4` for each rung the playlist lists; its older
 * one wrote `<quality>p/<id>.mp4`. Which family a video belongs to is not
 * knowable from its URL, so both are offered and the caller keeps what resolves.
 */
export function progressiveRoutes(streamUrl: string, master: HlsMaster | null): string[] {
  let stream: URL;
  try {
    stream = new URL(streamUrl);
  } catch {
    return [];
  }
  if (!STREAM_SEGMENT.test(stream.pathname)) return [];

  const routeFor = (folder: string, basename: string): string => {
    const route = new URL(stream.href);
    route.search = '';
    const directory = stream.pathname.slice(0, stream.pathname.lastIndexOf('/') + 1);
    route.pathname = `${directory.replace(STREAM_SEGMENT, `/${folder}/`)}${basename}`;
    return route.href;
  };

  const widths = new Map<number, string>();
  for (const variant of master?.variants ?? []) {
    const name = decodeURIComponent(new URL(variant.uri).pathname.split('/').pop() ?? '');
    const match = name.match(RENDITION_NAME);
    if (match?.[1] && match[2]) widths.set(Number(match[2]), match[1]);
  }
  const expRoutes = [...widths.entries()]
    .sort(([a], [b]) => b - a)
    .map(([width, id]) => routeFor('expMp4', `${id}_${width}w.mp4`));

  const id = decodeURIComponent(stream.pathname.split('/').pop() ?? '').replace(/\.m3u8$/i, '');
  const legacyRoutes = /^[a-f\d]{32}$/i.test(id)
    ? LEGACY_QUALITIES.map((quality) => routeFor(quality, `${id}.mp4`))
    : [];
  return [...expRoutes, ...legacyRoutes];
}
