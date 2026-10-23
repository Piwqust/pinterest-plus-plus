import { describe, expect, it, vi } from 'vitest';
import { assembleStream } from '../shared/hls-assembly';
import { find, readBoxes, trackFile } from './fixtures/fmp4';

vi.mock('../shared/ts-remux', () => ({
  // The transport-stream path is mux.js's to get right; what matters here is
  // that it receives every segment, in order.
  remuxTransportStream: (stream: Uint8Array) => new Uint8Array([0xee, ...stream]),
}));

const BASE = 'https://v1.pinimg.com/videos/iht/hls/2c/31/61';
const HASH = '2c31612eb2b0753d18753dcbb6bc5552';

function loader(files: Record<string, string | Uint8Array>) {
  const load = vi.fn(async (url: string) => {
    const file = files[url];
    if (file === undefined) throw new Error(`404 ${url}`);
    return typeof file === 'string' ? new TextEncoder().encode(file) : file;
  });
  return load;
}

const masterWithAudio = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="1",URI="${HASH}_audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=256x144,AUDIO="audio"
${HASH}_240w.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=600,RESOLUTION=736x414,AUDIO="audio"
${HASH}_720w.m3u8`;

const rendition = (file: string, firstLength: number) => `#EXTM3U
#EXT-X-MAP:URI="${file}",BYTERANGE="100@0"
#EXTINF:2
#EXT-X-BYTERANGE:${firstLength}@150
${file}
#EXT-X-ENDLIST`;

describe('assembling a video from its stream', () => {
  it('merges the best rendition with its separate sound, loading each track file once', async () => {
    const video = trackFile({ trackId: 1, timescale: 16_000, fragments: [{ time: 0, payload: [1] }, { time: 32_000, payload: [1] }] });
    const audio = trackFile({ trackId: 2, timescale: 44_100, fragments: [{ time: 0, payload: [2] }] });
    const load = loader({
      [`${BASE}/${HASH}.m3u8`]: masterWithAudio,
      [`${BASE}/${HASH}_720w.m3u8`]: rendition(`${HASH}_720w.cmfv`, 10),
      [`${BASE}/${HASH}_720w.cmfv`]: video,
      [`${BASE}/${HASH}_audio.m3u8`]: rendition(`${HASH}_audio.cmfa`, 10),
      [`${BASE}/${HASH}_audio.cmfa`]: audio,
    });

    const output = await assembleStream(`${BASE}/${HASH}.m3u8`, load);

    expect(find(readBoxes(output), 'moov', 'trak')).toHaveLength(2);
    expect(find(readBoxes(output), 'moof')).toHaveLength(3);
    expect(load).not.toHaveBeenCalledWith(`${BASE}/${HASH}_240w.m3u8`);
    expect(load.mock.calls.filter(([url]) => url.endsWith('.cmfv'))).toHaveLength(1);
  });

  it('returns a silent CMAF rendition as the file it already is', async () => {
    const video = trackFile({ trackId: 1, timescale: 16_000, fragments: [{ time: 0, payload: [1] }] });
    const load = loader({
      [`${BASE}/${HASH}.m3u8`]: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=600,RESOLUTION=702x396
${HASH}_720w.m3u8`,
      [`${BASE}/${HASH}_720w.m3u8`]: rendition(`${HASH}_720w.cmfv`, 10),
      [`${BASE}/${HASH}_720w.cmfv`]: video,
    });

    await expect(assembleStream(`${BASE}/${HASH}.m3u8`, load)).resolves.toBe(video);
  });

  it('joins transport-stream segments in order before rewrapping them', async () => {
    const base = 'https://v1.pinimg.com/videos/v2/hls/03/f1/51';
    const load = loader({
      [`${base}/clip_mobile.m3u8`]: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=239000,RESOLUTION=640x432
clip_hls640w.m3u8`,
      [`${base}/clip_hls640w.m3u8`]: `#EXTM3U
#EXTINF:6,
clip_hls640w00000.ts
#EXTINF:6,
clip_hls640w00001.ts
#EXT-X-ENDLIST`,
      [`${base}/clip_hls640w00000.ts`]: new Uint8Array([1, 2]),
      [`${base}/clip_hls640w00001.ts`]: new Uint8Array([3]),
    });

    await expect(assembleStream(`${base}/clip_mobile.m3u8`, load)).resolves.toEqual(new Uint8Array([0xee, 1, 2, 3]));
  });

  it('assembles a rendition playlist handed over directly', async () => {
    const load = loader({
      [`${BASE}/${HASH}_720w.m3u8`]: `#EXTM3U
#EXTINF:4,
a.ts
#EXT-X-ENDLIST`,
      [`${BASE}/a.ts`]: new Uint8Array([5]),
    });

    await expect(assembleStream(`${BASE}/${HASH}_720w.m3u8`, load)).resolves.toEqual(new Uint8Array([0xee, 5]));
  });

  it('refuses an encrypted stream rather than saving noise', async () => {
    const load = loader({
      [`${BASE}/x.m3u8`]: `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key"
#EXTINF:4,
a.ts`,
      [`${BASE}/a.ts`]: new Uint8Array([5]),
    });

    await expect(assembleStream(`${BASE}/x.m3u8`, load)).rejects.toThrow('encrypted');
  });

  it('fails when a segment cannot be fetched', async () => {
    const load = loader({
      [`${BASE}/x.m3u8`]: `#EXTM3U
#EXTINF:4,
missing.ts`,
    });

    await expect(assembleStream(`${BASE}/x.m3u8`, load)).rejects.toThrow('404');
  });
});
