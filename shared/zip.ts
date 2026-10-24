/**
 * A minimal ZIP writer. Entries are stored, not deflated: JPEGs, PNGs, WebPs
 * and MP4s are already compressed, so deflate would spend seconds of CPU to
 * save a percent or two, and storing keeps the writer small enough to read.
 */

export interface ZipEntry {
  /** A forward-slash path inside the archive. */
  name: string;
  data: Uint8Array;
  modified?: Date;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Bit 11: the name is UTF-8, so Cyrillic and emoji titles survive unpacking. */
const UTF8_FLAG = 0x0800;
const VERSION = 20;
/** The classic format's limits; past them an archive needs ZIP64. */
export const MAX_ZIP_ENTRIES = 0xffff;
export const MAX_ZIP_BYTES = 0xffffffff;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(data: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = lookup[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * The archive as a list of byte chunks, ready for `new Blob(parts)`. Large
 * files are not copied into one buffer, which matters for a batch of videos.
 */
export function zipParts(entries: readonly ZipEntry[]): Uint8Array[] {
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('Too many files for one archive');
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, '/').replace(/^\/+/, ''));
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { time, day } = dosTime(entry.modified ?? new Date());
    if (offset + 30 + name.length + size > MAX_ZIP_BYTES) throw new Error('The archive would exceed 4 GB');

    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, LOCAL_HEADER, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, CENTRAL_HEADER, true);
    headerView.setUint16(4, VERSION, true);
    headerView.setUint16(6, VERSION, true);
    headerView.setUint16(8, UTF8_FLAG, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, time, true);
    headerView.setUint16(14, day, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, size, true);
    headerView.setUint32(24, size, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return [...parts, ...central, end];
}
