/** Builds and reads just enough of an MP4 to exercise the track merger. */

export function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

export function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
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

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(parts);
  return concat([u32(8 + payload.byteLength), new TextEncoder().encode(type), payload]);
}

export function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u32((version << 24) | flags), ...parts);
}

const zeros = (length: number) => new Uint8Array(length);

export interface FragmentSpec {
  /** Decode time in the track's own timescale. */
  time: number;
  payload: number[];
  /** Write an absolute tfhd base_data_offset instead of counting from the moof. */
  absoluteBase?: boolean;
}

export interface TrackSpec {
  trackId: number;
  timescale: number;
  movieTimescale?: number;
  movieDuration?: number;
  fragments: FragmentSpec[];
}

/** A one-track fragmented MP4 laid out the way Pinterest's CMAF files are. */
export function trackFile(spec: TrackSpec): Uint8Array {
  const movieTimescale = spec.movieTimescale ?? 1000;
  const movieDuration = spec.movieDuration ?? 0;
  const mvhd = fullBox('mvhd', 0, 0, zeros(8), u32(movieTimescale), u32(movieDuration), zeros(76), u32(spec.trackId + 1));
  const tkhd = fullBox('tkhd', 0, 7, zeros(8), u32(spec.trackId), zeros(4), u32(movieDuration), zeros(60));
  const elst = fullBox('elst', 0, 0, u32(1), u32(movieDuration), u32(0), u32(0x00010000));
  const mdhd = fullBox('mdhd', 0, 0, zeros(8), u32(spec.timescale), zeros(8));
  const trak = box('trak', tkhd, box('edts', elst), box('mdia', mdhd));
  const trex = fullBox('trex', 0, 0, u32(spec.trackId), u32(1), zeros(12));
  const head = concat([
    box('ftyp', new TextEncoder().encode('cmfc'), zeros(4)),
    box('free', zeros(4)),
    box('moov', mvhd, trak, box('mvex', trex)),
    box('sidx', zeros(12)),
  ]);

  const fragments: Uint8Array[] = [];
  let position = head.byteLength;
  for (const fragment of spec.fragments) {
    const mdat = box('mdat', new Uint8Array(fragment.payload));
    // moof(8) + mfhd(16) + traf(8) + tfhd(16 or 24) + tfdt(20) + trun(20), then mdat's header.
    const tfhdSize = fragment.absoluteBase ? 24 : 16;
    const moofSize = 8 + 16 + 8 + tfhdSize + 20 + 20;
    const tfhd = fragment.absoluteBase
      ? fullBox('tfhd', 0, 0x000001, u32(spec.trackId), u64(position))
      : fullBox('tfhd', 0, 0x020000, u32(spec.trackId));
    const moof = box(
      'moof',
      fullBox('mfhd', 0, 0, u32(fragments.length + 1)),
      box(
        'traf',
        tfhd,
        fullBox('tfdt', 1, 0, u64(fragment.time)),
        fullBox('trun', 0, 0x000001, u32(fragment.payload.length), u32(moofSize + 8)),
      ),
    );
    fragments.push(moof, mdat);
    position += moof.byteLength + mdat.byteLength;
  }
  return concat([head, ...fragments]);
}

export interface ReadBox {
  type: string;
  start: number;
  end: number;
  children: ReadBox[];
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'mvex', 'moof', 'traf', 'edts']);

export function readBoxes(bytes: Uint8Array, start = 0, end = bytes.byteLength): ReadBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: ReadBox[] = [];
  for (let position = start; position + 8 <= end;) {
    const size = view.getUint32(position);
    const type = new TextDecoder().decode(bytes.subarray(position + 4, position + 8));
    boxes.push({
      type,
      start: position,
      end: position + size,
      children: CONTAINERS.has(type) ? readBoxes(bytes, position + 8, position + size) : [],
    });
    position += size;
  }
  return boxes;
}

export function find(boxes: readonly ReadBox[], ...path: string[]): ReadBox[] {
  const [type, ...rest] = path;
  const matches = boxes.filter((entry) => entry.type === type);
  return rest.length === 0 ? matches : matches.flatMap((entry) => find(entry.children, ...rest));
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

export function readU64(bytes: Uint8Array, offset: number): number {
  return Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset));
}
