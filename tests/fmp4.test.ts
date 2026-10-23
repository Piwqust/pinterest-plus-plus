import { describe, expect, it } from 'vitest';
import { mergeFragmentedTracks } from '../shared/fmp4';
import { find, readBoxes, readU32, readU64, trackFile } from './fixtures/fmp4';

function tfhdTrackIds(bytes: Uint8Array): number[] {
  return find(readBoxes(bytes), 'moof', 'traf')
    .map((traf) => find(traf.children, 'tfhd')[0]!)
    .map((tfhd) => readU32(bytes, tfhd.start + 12));
}

function mdatPayloads(bytes: Uint8Array): number[][] {
  return find(readBoxes(bytes), 'mdat').map((mdat) => Array.from(bytes.subarray(mdat.start + 8, mdat.end)));
}

describe('CMAF track merging', () => {
  const video = trackFile({
    trackId: 1,
    timescale: 16_000,
    fragments: [
      { time: 0, payload: [1, 1] },
      { time: 32_000, payload: [1, 2] },
    ],
  });
  const audio = trackFile({
    trackId: 2,
    timescale: 44_100,
    fragments: [
      { time: 0, payload: [2, 1] },
      { time: 44_100, payload: [2, 2] },
      { time: 88_200, payload: [2, 3] },
    ],
  });

  it('declares both tracks in one movie and leaves the next free id after them', () => {
    const merged = mergeFragmentedTracks(video, audio);
    const top = readBoxes(merged);

    expect(top.map((entry) => entry.type)).toEqual(['ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat', 'moof', 'mdat', 'moof', 'mdat', 'moof', 'mdat']);
    const tkhds = find(top, 'moov', 'trak', 'tkhd');
    expect(tkhds.map((tkhd) => readU32(merged, tkhd.start + 20))).toEqual([1, 2]);
    expect(find(top, 'moov', 'mvex', 'trex').map((trex) => readU32(merged, trex.start + 12))).toEqual([1, 2]);
    const mvhd = find(top, 'moov', 'mvhd')[0]!;
    expect(readU32(merged, mvhd.end - 4)).toBe(3);
  });

  it('interleaves fragments by time and renumbers their sequence', () => {
    const merged = mergeFragmentedTracks(video, audio);

    // Video at 0s and 2s, audio at 0s, 1s and 2s: the picture leads each tie.
    expect(mdatPayloads(merged)).toEqual([[1, 1], [2, 1], [2, 2], [1, 2], [2, 3]]);
    expect(tfhdTrackIds(merged)).toEqual([1, 2, 2, 1, 2]);
    const sequences = find(readBoxes(merged), 'moof', 'mfhd').map((mfhd) => readU32(merged, mfhd.start + 12));
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops the source files\' segment indexes, which no longer describe the bytes', () => {
    const merged = mergeFragmentedTracks(video, audio);
    expect(find(readBoxes(merged), 'sidx')).toEqual([]);
  });

  it('renumbers an audio track that reuses the video track id', () => {
    const clashing = trackFile({ trackId: 1, timescale: 48_000, fragments: [{ time: 0, payload: [9] }] });
    const merged = mergeFragmentedTracks(video, clashing);
    const top = readBoxes(merged);

    expect(find(top, 'moov', 'trak', 'tkhd').map((tkhd) => readU32(merged, tkhd.start + 20))).toEqual([1, 2]);
    expect(find(top, 'moov', 'mvex', 'trex').map((trex) => readU32(merged, trex.start + 12))).toEqual([1, 2]);
    expect(tfhdTrackIds(merged)).toEqual([1, 2, 1]);
    expect(readU32(merged, find(top, 'moov', 'mvhd')[0]!.end - 4)).toBe(3);
  });

  it('moves an absolute base offset along with its fragment', () => {
    const absolute = trackFile({
      trackId: 2,
      timescale: 1000,
      fragments: [{ time: 500, payload: [7, 7], absoluteBase: true }],
    });
    const merged = mergeFragmentedTracks(video, absolute);
    const top = readBoxes(merged);
    const moofs = find(top, 'moof');
    const audioMoof = moofs.find((moof) => readU32(merged, find(moof.children, 'traf', 'tfhd')[0]!.start + 12) === 2)!;
    const tfhd = find(audioMoof.children, 'traf', 'tfhd')[0]!;

    expect(readU64(merged, tfhd.start + 16)).toBe(audioMoof.start);
  });

  it('restates an audio track\'s movie durations in the video\'s movie timescale', () => {
    const scaled = trackFile({
      trackId: 2,
      timescale: 44_100,
      movieTimescale: 600,
      movieDuration: 1200,
      fragments: [{ time: 0, payload: [3] }],
    });
    const merged = mergeFragmentedTracks(video, scaled);
    const audioTrak = find(readBoxes(merged), 'moov', 'trak')[1]!;
    const tkhd = find(audioTrak.children, 'tkhd')[0]!;
    const elst = find(audioTrak.children, 'edts', 'elst')[0]!;

    expect(readU32(merged, tkhd.start + 28)).toBe(2000);
    expect(readU32(merged, elst.start + 16)).toBe(2000);
  });

  it('rejects a file that is not a fragmented MP4', () => {
    expect(() => mergeFragmentedTracks(new Uint8Array(16), audio)).toThrow();
  });
});
