/**
 * Joins the separately packaged tracks of a CMAF stream into one MP4.
 *
 * Pinterest's newer streams carry picture and sound as two fragmented MP4s, so
 * a video with sound has to be put back together before it is a file a player
 * can open. Nothing is re-encoded: the samples are copied untouched, and only
 * the bookkeeping that names tracks and orders fragments is rewritten.
 */

interface Box {
  type: string;
  start: number;
  end: number;
  /** Where the payload begins, after the size and type (and a 64-bit size). */
  body: number;
}

interface Track {
  id: number;
  timescale: number;
}

interface Fragment {
  bytes: Uint8Array;
  /** Decode time of the fragment's first sample, in seconds. */
  time: number;
  isVideo: boolean;
  /** Where the fragment began in its source file. */
  sourceStart: number;
}

interface TrackFile {
  bytes: Uint8Array;
  ftyp: Box;
  movieTimescale: number;
  moovChildren: Box[];
  tracks: Track[];
  fragments: Fragment[];
}

/**
 * Boxes that open a segment or index a file by absolute byte offset. A merge
 * invalidates the indexes, and none of them belongs to the fragment before it.
 */
const SEGMENT_BOUNDARY_BOXES = new Set(['sidx', 'ssix', 'mfra', 'styp']);
/** tfhd flag: the fragment's data offsets count from an absolute base. */
const BASE_DATA_OFFSET_PRESENT = 0x000001;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const data = view(bytes);
  const boxes: Box[] = [];
  let position = start;
  while (position + 8 <= end) {
    let size = data.getUint32(position);
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
    let body = position + 8;
    if (size === 1) {
      size = Number(data.getBigUint64(position + 8));
      body += 8;
    } else if (size === 0) {
      size = end - position;
    }
    if (size < body - position || position + size > end) throw new Error(`Malformed ${type} box`);
    boxes.push({ type, start: position, end: position + size, body });
    position += size;
  }
  return boxes;
}

function child(bytes: Uint8Array, parent: Box, path: readonly string[]): Box | null {
  let current: Box | undefined = parent;
  for (const type of path) {
    current = readBoxes(bytes, current.body, current.end).find((box) => box.type === type);
    if (!current) return null;
  }
  return current;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

/** A full box's version byte. */
function version(bytes: Uint8Array, box: Box): number {
  return bytes[box.body] ?? 0;
}

function tkhdTrackIdOffset(bytes: Uint8Array, tkhd: Box): number {
  return tkhd.body + 4 + (version(bytes, tkhd) === 1 ? 16 : 8);
}

function readTimescale(bytes: Uint8Array, box: Box): number {
  // mvhd and mdhd share their layout up to the timescale.
  return view(bytes).getUint32(box.body + 4 + (version(bytes, box) === 1 ? 16 : 8));
}

function readTrack(bytes: Uint8Array, trak: Box): Track {
  const tkhd = required(child(bytes, trak, ['tkhd']), 'tkhd');
  const mdhd = required(child(bytes, trak, ['mdia', 'mdhd']), 'mdhd');
  return {
    id: view(bytes).getUint32(tkhdTrackIdOffset(bytes, tkhd)),
    timescale: readTimescale(bytes, mdhd),
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function box(type: string, parts: readonly Uint8Array[]): Uint8Array {
  const payload = concat(parts);
  const output = new Uint8Array(8 + payload.byteLength);
  view(output).setUint32(0, output.byteLength);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(payload, 8);
  return output;
}

function fragmentTime(bytes: Uint8Array, moof: Box, tracks: readonly Track[]): number {
  const traf = required(child(bytes, moof, ['traf']), 'traf');
  const tfhd = required(child(bytes, traf, ['tfhd']), 'tfhd');
  const tfdt = child(bytes, traf, ['tfdt']);
  const id = view(bytes).getUint32(tfhd.body + 4);
  const timescale = tracks.find((track) => track.id === id)?.timescale ?? 1;
  if (!tfdt) return 0;
  const base = version(bytes, tfdt) === 1
    ? Number(view(bytes).getBigUint64(tfdt.body + 4))
    : view(bytes).getUint32(tfdt.body + 4);
  return base / timescale;
}

function parseTrackFile(bytes: Uint8Array, isVideo: boolean): TrackFile {
  const top = readBoxes(bytes, 0, bytes.byteLength);
  const ftyp = required(top.find((entry) => entry.type === 'ftyp'), 'ftyp');
  const moov = required(top.find((entry) => entry.type === 'moov'), 'moov');
  const moovChildren = readBoxes(bytes, moov.body, moov.end);
  const mvhd = required(moovChildren.find((entry) => entry.type === 'mvhd'), 'mvhd');
  const tracks = moovChildren.filter((entry) => entry.type === 'trak').map((trak) => readTrack(bytes, trak));
  if (tracks.length === 0) throw new Error('Missing trak');

  // A fragment is its moof and the boxes after it up to the next segment. Its
  // data offsets count from the moof's first byte, so the run is copied whole
  // and moved as a unit; dropping so much as a `free` inside it would misalign
  // every sample.
  const fragments: Fragment[] = [];
  let current: { moof: Box; end: number } | null = null;
  const close = () => {
    if (!current) return;
    fragments.push({
      bytes: bytes.slice(current.moof.start, current.end),
      time: fragmentTime(bytes, current.moof, tracks),
      isVideo,
      sourceStart: current.moof.start,
    });
    current = null;
  };
  for (const entry of top) {
    if (entry.type === 'moof') {
      close();
      current = { moof: entry, end: entry.end };
    } else if (SEGMENT_BOUNDARY_BOXES.has(entry.type)) {
      close();
    } else if (current) {
      current.end = entry.end;
    }
  }
  close();
  if (fragments.length === 0) throw new Error('Missing moof');

  return { bytes, ftyp, movieTimescale: readTimescale(bytes, mvhd), moovChildren, tracks, fragments };
}

/** Rewrites every track_ID a fragment names, and moves an absolute base offset. */
function patchFragment(fragment: Uint8Array, sequence: number, ids: ReadonlyMap<number, number>, shift: number): void {
  const data = view(fragment);
  const moof = required(readBoxes(fragment, 0, fragment.byteLength)[0], 'moof');
  for (const entry of readBoxes(fragment, moof.body, moof.end)) {
    if (entry.type === 'mfhd') data.setUint32(entry.body + 4, sequence);
    if (entry.type !== 'traf') continue;
    const tfhd = child(fragment, entry, ['tfhd']);
    if (!tfhd) continue;
    const id = data.getUint32(tfhd.body + 4);
    const mapped = ids.get(id);
    if (mapped !== undefined) data.setUint32(tfhd.body + 4, mapped);
    const flags = data.getUint32(tfhd.body) & 0xffffff;
    if (flags & BASE_DATA_OFFSET_PRESENT) {
      data.setBigUint64(tfhd.body + 8, data.getBigUint64(tfhd.body + 8) + BigInt(shift));
    }
  }
}

/** Copies a trak, renumbering it and restating its movie-timescale durations. */
function adoptTrak(bytes: Uint8Array, trak: Box, ids: ReadonlyMap<number, number>, scale: number): Uint8Array {
  const copy = bytes.slice(trak.start, trak.end);
  const data = view(copy);
  const local: Box = { ...trak, start: 0, end: copy.byteLength, body: trak.body - trak.start };
  const tkhd = required(child(copy, local, ['tkhd']), 'tkhd');
  const wide = version(copy, tkhd) === 1;
  const idOffset = tkhdTrackIdOffset(copy, tkhd);
  const mapped = ids.get(data.getUint32(idOffset));
  if (mapped !== undefined) data.setUint32(idOffset, mapped);
  if (scale === 1) return copy;

  const durationOffset = idOffset + 8;
  if (wide) data.setBigUint64(durationOffset, BigInt(Math.round(Number(data.getBigUint64(durationOffset)) * scale)));
  else data.setUint32(durationOffset, Math.round(data.getUint32(durationOffset) * scale));

  const elst = child(copy, local, ['edts', 'elst']);
  if (elst) {
    const elstWide = version(copy, elst) === 1;
    const count = data.getUint32(elst.body + 4);
    const entrySize = elstWide ? 20 : 12;
    for (let index = 0; index < count; index += 1) {
      const offset = elst.body + 8 + index * entrySize;
      if (elstWide) data.setBigUint64(offset, BigInt(Math.round(Number(data.getBigUint64(offset)) * scale)));
      else data.setUint32(offset, Math.round(data.getUint32(offset) * scale));
    }
  }
  return copy;
}

function renumberTrex(bytes: Uint8Array, trex: Box, ids: ReadonlyMap<number, number>): Uint8Array {
  const copy = bytes.slice(trex.start, trex.end);
  const data = view(copy);
  const offset = trex.body - trex.start + 4;
  const mapped = ids.get(data.getUint32(offset));
  if (mapped !== undefined) data.setUint32(offset, mapped);
  return copy;
}

export function mergeFragmentedTracks(videoBytes: Uint8Array, audioBytes: Uint8Array): Uint8Array {
  const video = parseTrackFile(videoBytes, true);
  const audio = parseTrackFile(audioBytes, false);

  // Pinterest already numbers its audio track apart from its video, but a
  // collision is renumbered rather than trusted to never happen.
  const taken = new Set(video.tracks.map((track) => track.id));
  let nextId = Math.max(...video.tracks.map((track) => track.id), ...audio.tracks.map((track) => track.id)) + 1;
  const audioIds = new Map<number, number>();
  for (const track of audio.tracks) {
    if (!taken.has(track.id)) {
      taken.add(track.id);
      continue;
    }
    audioIds.set(track.id, nextId);
    taken.add(nextId);
    nextId += 1;
  }

  const moovParts: Uint8Array[] = [];
  const mvhd = required(video.moovChildren.find((entry) => entry.type === 'mvhd'), 'mvhd');
  const mvhdCopy = videoBytes.slice(mvhd.start, mvhd.end);
  view(mvhdCopy).setUint32(mvhdCopy.byteLength - 4, nextId);
  moovParts.push(mvhdCopy);
  for (const entry of video.moovChildren) {
    if (entry.type !== 'mvhd' && entry.type !== 'mvex') moovParts.push(videoBytes.slice(entry.start, entry.end));
  }
  const scale = video.movieTimescale / audio.movieTimescale;
  for (const entry of audio.moovChildren) {
    if (entry.type === 'trak') moovParts.push(adoptTrak(audioBytes, entry, audioIds, scale));
  }

  const mvexParts: Uint8Array[] = [];
  const videoMvex = video.moovChildren.find((entry) => entry.type === 'mvex');
  const audioMvex = audio.moovChildren.find((entry) => entry.type === 'mvex');
  if (videoMvex) {
    for (const entry of readBoxes(videoBytes, videoMvex.body, videoMvex.end)) {
      mvexParts.push(videoBytes.slice(entry.start, entry.end));
    }
  }
  if (audioMvex) {
    for (const entry of readBoxes(audioBytes, audioMvex.body, audioMvex.end)) {
      if (entry.type === 'trex') mvexParts.push(renumberTrex(audioBytes, entry, audioIds));
    }
  }
  moovParts.push(box('mvex', mvexParts));

  const ftyp = videoBytes.slice(video.ftyp.start, video.ftyp.end);
  const moov = box('moov', moovParts);
  // Interleaved by time, so a player reading front to back meets picture and
  // sound together instead of buffering one whole track to reach the other.
  const fragments = [...video.fragments, ...audio.fragments]
    .sort((a, b) => a.time - b.time || Number(b.isVideo) - Number(a.isVideo));

  let position = ftyp.byteLength + moov.byteLength;
  const noRenumbering = new Map<number, number>();
  fragments.forEach((fragment, index) => {
    // An absolute base offset pointed into the source file; it has to point at
    // the same bytes where the fragment now sits.
    patchFragment(
      fragment.bytes,
      index + 1,
      fragment.isVideo ? noRenumbering : audioIds,
      position - fragment.sourceStart,
    );
    position += fragment.bytes.byteLength;
  });
  return concat([ftyp, moov, ...fragments.map((fragment) => fragment.bytes)]);
}
