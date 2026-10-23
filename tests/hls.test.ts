import { describe, expect, it } from 'vitest';
import {
  audioFor,
  bestVariant,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  progressiveRoutes,
} from '../shared/hls';

const HASH = 'a4f4a43366cabe30ad947f172fb2e3ea';
const CMAF_MASTER_URL = `https://v1.pinimg.com/videos/iht/hls/v2/a4/f4/a4/${HASH}.m3u8`;
/** Pinterest's CMAF master: one audio group, rungs named by width. */
const CMAF_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="1",AUTOSELECT=YES,URI="${HASH}_audio.m3u8",CHANNELS="2"
#EXT-X-STREAM-INF:BANDWIDTH=197000,AVERAGE-BANDWIDTH=250093,CODECS="avc1.64080C,mp4a.40.29",RESOLUTION=256x144,FRAME-RATE=30.3,AUDIO="audio",CLOSED-CAPTIONS=NONE
${HASH}_240w.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=592920,AVERAGE-BANDWIDTH=624403,CODECS="avc1.64081E,mp4a.40.29",RESOLUTION=736x414,FRAME-RATE=30.3,AUDIO="audio",CLOSED-CAPTIONS=NONE
${HASH}_720w.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=388664,AVERAGE-BANDWIDTH=434478,CODECS="avc1.64081E,mp4a.40.29",RESOLUTION=544x306,FRAME-RATE=30.3,AUDIO="audio",CLOSED-CAPTIONS=NONE
${HASH}_540w.m3u8
`;

describe('HLS playlists', () => {
  it('reads every rendition of a master playlist with its audio group', () => {
    expect(isMasterPlaylist(CMAF_MASTER)).toBe(true);
    const master = parseMasterPlaylist(CMAF_MASTER, CMAF_MASTER_URL);

    expect(master.variants.map((variant) => [variant.width, variant.height, variant.audioGroup])).toEqual([
      [256, 144, 'audio'],
      [736, 414, 'audio'],
      [544, 306, 'audio'],
    ]);
    expect(master.variants[1]!.uri).toBe(`https://v1.pinimg.com/videos/iht/hls/v2/a4/f4/a4/${HASH}_720w.m3u8`);
    expect(master.audio).toEqual([{
      groupId: 'audio',
      uri: `https://v1.pinimg.com/videos/iht/hls/v2/a4/f4/a4/${HASH}_audio.m3u8`,
      isDefault: false,
    }]);
  });

  it('picks the largest picture, and the sound that belongs to it', () => {
    const master = parseMasterPlaylist(CMAF_MASTER, CMAF_MASTER_URL);
    const best = bestVariant(master)!;

    expect(best.uri).toContain('_720w.m3u8');
    expect(audioFor(master, best)?.uri).toContain('_audio.m3u8');
  });

  it('breaks a tie in picture size on bandwidth', () => {
    const master = parseMasterPlaylist(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=640x432
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=300,RESOLUTION=640x432
high.m3u8`, 'https://v1.pinimg.com/videos/v2/hls/a/b.m3u8');

    expect(bestVariant(master)?.uri).toBe('https://v1.pinimg.com/videos/v2/hls/a/high.m3u8');
  });

  it('reads a CMAF rendition addressed by byte ranges into one file', () => {
    const playlist = parseMediaPlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MAP:URI="${HASH}_720w.cmfv",BYTERANGE="958@0"
#EXTINF:2
#EXT-X-BYTERANGE:98264@1046
${HASH}_720w.cmfv
#EXTINF:2
#EXT-X-BYTERANGE:213704
${HASH}_720w.cmfv
#EXT-X-ENDLIST`, `https://v1.pinimg.com/videos/iht/hls/2c/${HASH}_720w.m3u8`);

    const file = `https://v1.pinimg.com/videos/iht/hls/2c/${HASH}_720w.cmfv`;
    expect(playlist.init).toEqual({ uri: file, range: { offset: 0, length: 958 } });
    expect(playlist.segments).toEqual([
      { uri: file, range: { offset: 1046, length: 98264 } },
      // A range without an offset continues where the last one ended.
      { uri: file, range: { offset: 99310, length: 213704 } },
    ]);
    expect(playlist.encrypted).toBe(false);
  });

  it('reads a transport-stream rendition as plain segments', () => {
    const playlist = parseMediaPlaylist(`#EXTM3U
#EXTINF:4,
clip_720w_00001.ts
#EXTINF:3,
clip_720w_00002.ts
#EXT-X-ENDLIST`, 'https://v1.pinimg.com/videos/mc/hls/bb/clip_720w.m3u8');

    expect(playlist.init).toBeNull();
    expect(playlist.segments.map((segment) => segment.uri)).toEqual([
      'https://v1.pinimg.com/videos/mc/hls/bb/clip_720w_00001.ts',
      'https://v1.pinimg.com/videos/mc/hls/bb/clip_720w_00002.ts',
    ]);
  });

  it('notices an encrypted stream', () => {
    const playlist = parseMediaPlaylist(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
a.ts`, 'https://v1.pinimg.com/videos/mc/hls/a.m3u8');

    expect(playlist.encrypted).toBe(true);
  });
});

describe('progressive routes beside a stream', () => {
  it('names an expMp4 file for every rung the playlist lists, widest first, then the legacy routes', () => {
    const master = parseMasterPlaylist(CMAF_MASTER, CMAF_MASTER_URL);

    expect(progressiveRoutes(CMAF_MASTER_URL, master)).toEqual([
      `https://v1.pinimg.com/videos/iht/expMp4/v2/a4/f4/a4/${HASH}_720w.mp4`,
      `https://v1.pinimg.com/videos/iht/expMp4/v2/a4/f4/a4/${HASH}_540w.mp4`,
      `https://v1.pinimg.com/videos/iht/expMp4/v2/a4/f4/a4/${HASH}_240w.mp4`,
      `https://v1.pinimg.com/videos/iht/1080p/v2/a4/f4/a4/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/iht/720p/v2/a4/f4/a4/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/iht/480p/v2/a4/f4/a4/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/iht/360p/v2/a4/f4/a4/${HASH}.mp4`,
    ]);
  });

  it('still offers the legacy routes when the playlist could not be read', () => {
    expect(progressiveRoutes(`https://v1.pinimg.com/videos/mc/hls/bb/7f/48/${HASH}.m3u8`, null)).toEqual([
      `https://v1.pinimg.com/videos/mc/1080p/bb/7f/48/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/mc/720p/bb/7f/48/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/mc/480p/bb/7f/48/${HASH}.mp4`,
      `https://v1.pinimg.com/videos/mc/360p/bb/7f/48/${HASH}.mp4`,
    ]);
  });

  it('offers nothing for the oldest streams, which were only ever published as segments', () => {
    const url = `https://v1.pinimg.com/videos/v2/hls/03/f1/51/${HASH}_mobile.m3u8`;
    const master = parseMasterPlaylist(`#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=239000,RESOLUTION=640x432,CODECS="avc1.4d001f,mp4a.40.29"
${HASH}_hls640w.m3u8`, url);

    expect(progressiveRoutes(url, master)).toEqual([]);
  });
});
