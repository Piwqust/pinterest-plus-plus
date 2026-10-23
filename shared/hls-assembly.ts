import { mergeFragmentedTracks } from './fmp4';
import {
  audioFor,
  bestVariant,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  type HlsMediaPlaylist,
  type HlsSegment,
} from './hls';
import { remuxTransportStream } from './ts-remux';

export type LoadBytes = (url: string) => Promise<Uint8Array>;

/** Parallel fetches per track; a long TS video lists dozens of segments. */
const MAX_PARALLEL_LOADS = 6;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The bytes of one track, in playback order. Pinterest's CMAF tracks are each a
 * single complete MP4 that the playlist addresses by byte range; such a file is
 * taken whole rather than stitched from ranges, so the boxes between ranges
 * (and the alignment of the ranges themselves) never matter.
 */
async function loadTrack(playlist: HlsMediaPlaylist, load: LoadBytes): Promise<Uint8Array> {
  if (playlist.encrypted) throw new Error('The stream is encrypted');
  if (playlist.segments.length === 0) throw new Error('The stream lists no segments');

  const pieces: HlsSegment[] = playlist.init ? [playlist.init, ...playlist.segments] : [...playlist.segments];
  const files = [...new Set(pieces.map((piece) => piece.uri))];
  const loaded = new Map(files.map((uri, index) => [uri, index]));
  const bytes = await mapLimited(files, MAX_PARALLEL_LOADS, load);
  if (files.length === 1) return bytes[0]!;

  return concat(pieces.map((piece) => {
    const file = bytes[loaded.get(piece.uri)!]!;
    if (!piece.range) return file;
    const end = piece.range.offset + piece.range.length;
    if (end > file.byteLength) throw new Error('A segment lies outside its file');
    return file.subarray(piece.range.offset, end);
  }));
}

/**
 * Builds a single MP4 from a video's HLS stream, at the best rendition it
 * lists. The newer streams keep picture and sound in separate fragmented MP4s
 * and are merged; the older ones are MPEG-TS and are rewrapped. Neither path
 * re-encodes anything.
 */
export async function assembleStream(streamUrl: string, load: LoadBytes): Promise<Uint8Array> {
  const decoder = new TextDecoder();
  const playlistText = async (url: string) => decoder.decode(await load(url));

  let mediaUrl = streamUrl;
  let mediaText = await playlistText(streamUrl);
  let audioUrl: string | null = null;
  if (isMasterPlaylist(mediaText)) {
    const master = parseMasterPlaylist(mediaText, streamUrl);
    const variant = bestVariant(master);
    if (!variant) throw new Error('The stream lists no renditions');
    mediaUrl = variant.uri;
    mediaText = await playlistText(mediaUrl);
    audioUrl = audioFor(master, variant)?.uri ?? null;
  }

  const video = parseMediaPlaylist(mediaText, mediaUrl);
  const videoBytes = await loadTrack(video, load);
  if (!video.init) return remuxTransportStream(videoBytes);
  if (!audioUrl) return videoBytes;

  const audio = parseMediaPlaylist(await playlistText(audioUrl), audioUrl);
  // Sound in another container than the picture is not something Pinterest
  // serves; the picture alone is still the video the user asked for.
  if (!audio.init) return videoBytes;
  return mergeFragmentedTracks(videoBytes, await loadTrack(audio, load));
}
