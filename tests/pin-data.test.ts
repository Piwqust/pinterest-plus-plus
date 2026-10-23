import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPinData, findPinId, pinIdFromUrl, pinMediaFromData, resolvePinMedia } from '../shared/pin-data';

const images = (shard: string, hash: string) => Object.fromEntries(
  ['60x60', '136x136', '236x', '474x', '564x', '600x315', '736x'].map((size) => [
    size,
    { url: `https://i.pinimg.com/${size}/${shard}/${hash}.jpg` },
  ]),
);

/** How Pinterest describes a CMAF video: one progressive rung beside the stream. */
const cmafVideo = (shard: string, hash: string) => ({
  video_list: {
    V_720P: {
      url: `https://v1.pinimg.com/videos/iht/expMp4/${shard}/${hash}_720w.mp4`,
      thumbnail: `https://i.pinimg.com/videos/thumbnails/originals/${shard}/${hash}.0000000.jpg`,
    },
    V_HLSV4: { url: `https://v1.pinimg.com/videos/iht/hls/${shard}/${hash}.m3u8` },
    V_HLSV3_MOBILE: { url: `https://v1.pinimg.com/videos/iht/hls/${shard}/${hash}.m3u8` },
  },
});

/** Pin 369365606970496121: a carousel whose four slides are all videos. */
const CAROUSEL_OF_VIDEOS = {
  id: '369365606970496121',
  title: '',
  grid_title: '',
  description: 'A few experiments from R&D for Polsia. \nJumping into a new style is always intimidating, especially when it involves learning new software.',
  images: { orig: { url: 'https://i.pinimg.com/originals/c4/2d/d4/c42dd4f4969f4d587de2f1c08f9f7d59.jpg' } },
  videos: null,
  story_pin_data: null,
  carousel_data: {
    carousel_slots: [
      ['2c/31/61', '2c31612eb2b0753d18753dcbb6bc5552', 'c4/2d/d4', 'c42dd4f4969f4d587de2f1c08f9f7d59'],
      ['cc/d6/50', 'ccd65004b7aa0bbccee4fb6b1ddcfbfd', '6a/25/04', '6a2504c8928b46806ec7ce8b789dbf04'],
      ['89/70/4f', '89704ffdf9b79edad8277df7b625c4d5', '6c/56/75', '6c56753354d0313157e8c802eb0462b3'],
      ['73/44/1a', '73441abbaf9d362de46f17da314509e2', '55/04/58', '5504581a86bdc21c5df7eb4f6882e7d2'],
    ].map(([videoShard, videoHash, imageShard, imageHash]) => ({
      images: images(imageShard!, imageHash!),
      videos: cmafVideo(videoShard!, videoHash!),
    })),
  },
};

describe('pin ids', () => {
  it('reads the id from a permalink on any locale subdomain', () => {
    expect(pinIdFromUrl('https://fi.pinterest.com/pin/369365606970496121/')).toBe('369365606970496121');
    expect(pinIdFromUrl('/pin/369365606970496121/?mt=login')).toBe('369365606970496121');
  });

  it('ignores routes that live under /pin/ but are not pins', () => {
    expect(pinIdFromUrl('/pin/create/button/')).toBeNull();
    expect(pinIdFromUrl('/ideas/')).toBeNull();
  });

  it('finds the pin a grid tile links to', () => {
    const tile = document.createElement('div');
    tile.innerHTML = '<a href="/someone/"></a><a href="/pin/123456789/"><img></a>';
    expect(findPinId(tile)).toBe('123456789');
  });
});

describe('pin records', () => {
  it('lists every carousel slide as the video it is, with its exact file and stream', () => {
    const media = pinMediaFromData(CAROUSEL_OF_VIDEOS);

    expect(media.map((option) => option.kind)).toEqual(['video', 'video', 'video', 'video']);
    expect(media[0]!.candidates).toEqual([
      'https://v1.pinimg.com/videos/iht/expMp4/2c/31/61/2c31612eb2b0753d18753dcbb6bc5552_720w.mp4',
    ]);
    expect(media[0]!.streams).toEqual([
      'https://v1.pinimg.com/videos/iht/hls/2c/31/61/2c31612eb2b0753d18753dcbb6bc5552.m3u8',
    ]);
    expect(media[0]!.posterCandidates[0]).toBe(
      'https://i.pinimg.com/videos/thumbnails/originals/2c/31/61/2c31612eb2b0753d18753dcbb6bc5552.0000000.jpg',
    );
    expect(media[3]!.previewUrl).toBe('https://i.pinimg.com/236x/55/04/58/5504581a86bdc21c5df7eb4f6882e7d2.jpg');
  });

  it('names carousel files after the first sentence of the pin, numbered in slide order', () => {
    const media = pinMediaFromData(CAROUSEL_OF_VIDEOS);

    expect(media.map((option) => option.suggestedName)).toEqual([
      'Pinterest/A-few-experiments-from-R-D-for-Polsia-01.mp4',
      'Pinterest/A-few-experiments-from-R-D-for-Polsia-02.mp4',
      'Pinterest/A-few-experiments-from-R-D-for-Polsia-03.mp4',
      'Pinterest/A-few-experiments-from-R-D-for-Polsia-04.mp4',
    ]);
  });

  it('ranks a pin\'s progressive files by quality and keeps HEVC for last', () => {
    const [video] = pinMediaFromData({
      title: 'Clip',
      videos: {
        video_list: {
          V_HLSV3_MOBILE: { url: 'https://v1.pinimg.com/videos/mc/hls/91/c6/e4/91c6e4ff52c7c82da42400581a31618b.m3u8' },
          V_EXP3: { url: 'https://v1.pinimg.com/videos/mc/expMp4/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_t1.mp4' },
          V_HEVC_MP4_T5_V2: { url: 'https://v1.pinimg.com/videos/iht/hevcMp4V3/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_720w.mp4' },
          V_EXP7: { url: 'https://v1.pinimg.com/videos/mc/720p/91/c6/e4/91c6e4ff52c7c82da42400581a31618b.mp4' },
          V_EXP6: { url: 'https://v1.pinimg.com/videos/mc/expMp4/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_t4.mp4' },
          V_HLSV4: { url: 'https://v1.pinimg.com/videos/mc/hls/91/c6/e4/91c6e4ff52c7c82da42400581a31618b.m3u8' },
        },
      },
    });

    expect(video!.candidates.map((url) => url.split('/videos/')[1])).toEqual([
      'mc/720p/91/c6/e4/91c6e4ff52c7c82da42400581a31618b.mp4',
      'mc/expMp4/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_t4.mp4',
      'mc/expMp4/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_t1.mp4',
      'iht/hevcMp4V3/91/c6/e4/91c6e4ff52c7c82da42400581a31618b_720w.mp4',
    ]);
    expect(video!.streams).toEqual(['https://v1.pinimg.com/videos/mc/hls/91/c6/e4/91c6e4ff52c7c82da42400581a31618b.m3u8']);
  });

  it('keeps a video that Pinterest publishes only as a stream', () => {
    const [video] = pinMediaFromData({
      videos: { video_list: { V_HLSV4: { url: 'https://v1.pinimg.com/videos/v2/hls/03/f1/51/03f151fb55438a5a82cbed5825d89655_mobile.m3u8' } } },
    });

    expect(video).toMatchObject({ kind: 'video', candidates: [] });
    expect(video!.streams).toHaveLength(1);
  });

  it('offers an image pin at its original size first, never a crop', () => {
    const [image] = pinMediaFromData({
      title: 'Poster',
      images: {
        '236x': { url: 'https://i.pinimg.com/236x/aa/bb/cc/poster.jpg' },
        '600x315': { url: 'https://i.pinimg.com/600x315/aa/bb/cc/poster.jpg' },
        orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc/poster.jpg' },
        '736x': { url: 'https://i.pinimg.com/736x/aa/bb/cc/poster.jpg' },
      },
    });

    expect(image).toMatchObject({ kind: 'image', streams: [], suggestedName: 'Pinterest/Poster.jpg' });
    expect(image!.candidates).toEqual([
      'https://i.pinimg.com/originals/aa/bb/cc/poster.jpg',
      'https://i.pinimg.com/736x/aa/bb/cc/poster.jpg',
      'https://i.pinimg.com/236x/aa/bb/cc/poster.jpg',
    ]);
  });

  it('reads an Idea Pin page by page, skipping blocks with no media', () => {
    const media = pinMediaFromData({
      images: { orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc/cover.jpg' } },
      story_pin_data: {
        pages: [
          { blocks: [{ block_type: 1, text: 'Intro' }, { block_type: 3, video: cmafVideo('2c/31/61', '2c31612eb2b0753d18753dcbb6bc5552') }] },
          { blocks: [{ block_type: 2, image: { images: { originals: { url: 'https://i.pinimg.com/originals/dd/ee/ff/page.jpg' } } } }] },
        ],
      },
    });

    expect(media.map((option) => option.kind)).toEqual(['video', 'image']);
    expect(media[1]!.candidates).toEqual(['https://i.pinimg.com/originals/dd/ee/ff/page.jpg']);
  });

  it('describes nothing for a record that is not a pin', () => {
    expect(pinMediaFromData(null)).toEqual([]);
    expect(pinMediaFromData({ images: {} })).toEqual([]);
  });
});

describe('reading a pin from Pinterest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the way Pinterest\'s web client does, with the session', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resource_response: { data: CAROUSEL_OF_VIDEOS } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPinData('369365606970496121')).resolves.toEqual(CAROUSEL_OF_VIDEOS);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = new URL(url);
    expect(request.origin).toBe(location.origin);
    expect(request.pathname).toBe('/resource/PinResource/get/');
    expect(JSON.parse(request.searchParams.get('data')!)).toMatchObject({
      options: { id: '369365606970496121', field_set_key: 'detailed' },
    });
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({ 'X-Pinterest-PWS-Handler': 'www/pin/[id].js' });
  });

  it('remembers a pin it has read', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resource_response: { data: CAROUSEL_OF_VIDEOS } })));
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolvePinMedia('111');
    const second = await resolvePinMedia('111');
    expect(first).toHaveLength(4);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly, and tries again next time, when Pinterest refuses', async () => {
    const fetchMock = vi.fn(async () => new Response('Invalid Resource Request', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePinMedia('222')).resolves.toEqual([]);
    await expect(resolvePinMedia('222')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not ask about a tile it could not identify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePinMedia(null)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
