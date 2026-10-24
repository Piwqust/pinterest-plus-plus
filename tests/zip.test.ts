import { describe, expect, it } from 'vitest';
import { crc32, zipParts } from '../shared/zip';

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
}

/** Reads an archive back the way an unzip tool does: from the central directory. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries: ReadEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    expect(view.getUint16(cursor + 8, true) & 0x0800).toBe(0x0800);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength;
    entries.push({ name, crc, data: bytes.subarray(dataStart, dataStart + size) });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zip writer', () => {
  it('stores every file so it reads back byte for byte', () => {
    const files = [
      { name: 'Moodboard/Синий-кухня.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) },
      { name: 'sources.csv', data: new TextEncoder().encode('file,title,pin\r\n') },
    ];
    const entries = readZip(concat(zipParts(files)));
    expect(entries.map(({ name }) => name)).toEqual(files.map(({ name }) => name));
    entries.forEach((entry, index) => {
      expect([...entry.data]).toEqual([...files[index]!.data]);
      expect(entry.crc).toBe(crc32(files[index]!.data));
    });
  });

  it('keeps names inside the archive', () => {
    const [entry] = readZip(concat(zipParts([{ name: '\\\\evil\\a.jpg', data: new Uint8Array([1]) }])));
    expect(entry!.name).toBe('evil/a.jpg');
  });

  it('writes a valid empty archive', () => {
    expect(readZip(concat(zipParts([])))).toEqual([]);
  });
});
