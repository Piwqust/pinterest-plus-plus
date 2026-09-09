import { describe, expect, it } from 'vitest';
import { collectPinMedia, describeMedia, imageCandidates, isAllowedMediaUrl, isDownloadableVideoUrl, isMediaResponse, mediaFileExtension, parseSrcset, posterCandidates, safeFilename, toOriginalPinimgUrl, videoCandidates, videoCandidatesFromTimeline } from '../shared/media';

describe('Pinterest media resolution', () => {
  it('sorts srcset candidates from largest to smallest', () => {
    expect(parseSrcset('https://i.pinimg.com/236x/a.jpg 236w, https://i.pinimg.com/736x/a.jpg 736w')).toEqual([
      'https://i.pinimg.com/736x/a.jpg',
      'https://i.pinimg.com/236x/a.jpg',
    ]);
  });

  it('promotes Pinterest CDN thumbnails to the originals path', () => {
    expect(toOriginalPinimgUrl('https://i.pinimg.com/736x/aa/bb/pin.jpg')).toBe('https://i.pinimg.com/originals/aa/bb/pin.jpg');
  });

  it('puts original-quality image candidates first and removes duplicates', () => {
    const image = document.createElement('img');
    image.src = 'https://i.pinimg.com/236x/aa/bb/pin.jpg';
    image.srcset = 'https://i.pinimg.com/236x/aa/bb/pin.jpg 236w, https://i.pinimg.com/736x/aa/bb/pin.jpg 736w';
    expect(imageCandidates(image)).toEqual([
      'https://i.pinimg.com/originals/aa/bb/pin.jpg',
      'https://i.pinimg.com/736x/aa/bb/pin.jpg',
      'https://i.pinimg.com/236x/aa/bb/pin.jpg',
    ]);
  });

  it('ranks higher resolution video sources first', () => {
    const video = document.createElement('video');
    video.innerHTML = '<source src="https://v1.pinimg.com/videos/360p/clip.mp4"><source src="https://v1.pinimg.com/videos/1080p/clip.mp4">';
    expect(videoCandidates(video)[0]).toContain('1080p');
  });

  it('discovers Pinterest video URLs kept in lazy-load attributes', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.setAttribute('data-video-url', 'https://v1.pinimg.com/videos/720p/clip.mp4');
    wrapper.append(video);

    expect(videoCandidates(video)).toEqual(['https://v1.pinimg.com/videos/720p/clip.mp4']);
  });

  it('resolves Pinterest HLS sources to every downloadable MP4 rung, highest first', () => {
    const video = document.createElement('video');
    video.src = 'https://v1.pinimg.com/videos/mc/hls/ab/cd/clip.m3u8';

    expect(videoCandidates(video)).toEqual([
      'https://v1.pinimg.com/videos/mc/1080p/ab/cd/clip.mp4',
      'https://v1.pinimg.com/videos/mc/720p/ab/cd/clip.mp4',
      'https://v1.pinimg.com/videos/mc/480p/ab/cd/clip.mp4',
      'https://v1.pinimg.com/videos/mc/360p/ab/cd/clip.mp4',
    ]);
  });

  it('keeps the media-id routes behind a source the page exposed', () => {
    // Pinterest 403s an extension-less progressive route, so it must not be the
    // only candidate when the slide's media id can still name a real file.
    const hash = '662168ac2e56f1545e2929aacd0fd41b';
    const slide = document.createElement('div');
    slide.innerHTML = `<img src="https://i.pinimg.com/videos/thumbnails/originals/66/21/68/${hash}.0000000.jpg">`;
    const video = document.createElement('video');
    video.setAttribute('data-video-url', 'https://v1.pinimg.com/videos/mc/720p/66/21/68/clip');
    slide.append(video);

    const candidates = videoCandidates(video);
    expect(candidates[0]).toBe('https://v1.pinimg.com/videos/mc/720p/66/21/68/clip');
    expect(candidates).toContain(`https://v1.pinimg.com/videos/iht/1080p/66/21/68/${hash}.mp4`);
    expect(candidates).toContain(`https://v1.pinimg.com/videos/mc/720p/66/21/68/${hash}.mp4`);
  });

  it('ranks on the quality segment so a hex media id cannot fake a resolution', () => {
    const video = document.createElement('video');
    // The 360p file's media id contains a bare "1080"; the 720p route must win.
    video.innerHTML = '<source src="https://v1.pinimg.com/videos/mc/360p/ab/cd/ef1080ab9c2d4e6f8a0b1c2d3e4f5a6b.mp4">' +
      '<source src="https://v1.pinimg.com/videos/mc/720p/ab/cd/clip.mp4">';

    expect(videoCandidates(video)[0]).toBe('https://v1.pinimg.com/videos/mc/720p/ab/cd/clip.mp4');
  });

  it('accepts Pinterest progressive video endpoints without a file extension', () => {
    const source = 'https://v1.pinimg.com/videos/mc/720p/ab/cd/clip';

    expect(isDownloadableVideoUrl(source)).toBe(true);
    const video = document.createElement('video');
    video.src = source;
    expect(videoCandidates(video)).toEqual([source]);
  });

  it('resolves a blob-backed feed video from its poster frame', () => {
    const hash = '662168ac2e56f1545e2929aacd0fd41b';
    const video = document.createElement('video');
    video.setAttribute('src', 'blob:https://www.pinterest.com/6f6f-4c0d');
    video.poster = `https://i.pinimg.com/videos/thumbnails/originals/66/21/68/${hash}.0000000.jpg`;

    expect(videoCandidates(video)).toEqual([
      `https://v1.pinimg.com/videos/iht/1080p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/mc/1080p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/720p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/mc/720p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/480p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/mc/480p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/360p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/mc/360p/66/21/68/${hash}.mp4`,
    ]);
  });

  it('uses the slide thumbnail rendered beside a video without a poster', () => {
    const hash = 'e5d7adffa099768aa89b505489478f9c';
    const slide = document.createElement('div');
    slide.innerHTML = `<img src="https://i.pinimg.com/videos/thumbnails/236x/e5/d7/ad/${hash}.0000000.jpg">`;
    const video = document.createElement('video');
    slide.append(video);

    expect(videoCandidates(video)[0]).toBe(`https://v1.pinimg.com/videos/iht/1080p/e5/d7/ad/${hash}.mp4`);
    expect(posterCandidates(video)[0]).toBe(`https://i.pinimg.com/videos/thumbnails/originals/e5/d7/ad/${hash}.0000000.jpg`);
  });

  it('prefers the route Pinterest\'s player already requested for the media id', () => {
    const hash = '662168ac2e56f1545e2929aacd0fd41b';
    const timeline = [
      'https://i.pinimg.com/236x/aa/bb/other.jpg',
      `https://v1.pinimg.com/videos/iht/hls/66/21/68/${hash}.m3u8`,
      `https://v1.pinimg.com/videos/iht/hls/66/21/68/${hash}_00001.ts`,
    ];

    expect(videoCandidatesFromTimeline(hash, timeline)).toEqual([
      `https://v1.pinimg.com/videos/iht/1080p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/720p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/480p/66/21/68/${hash}.mp4`,
      `https://v1.pinimg.com/videos/iht/360p/66/21/68/${hash}.mp4`,
    ]);
    expect(videoCandidatesFromTimeline(hash, ['https://v1.pinimg.com/videos/iht/hls/aa/bb/cc/other.m3u8'])).toEqual([]);
  });

  it('falls back to an Idea Pin slide cover image when no video frame is published', () => {
    const hash = '2c4d9f1b7e5a4038b9c1d6e2f70a4b85';
    const slide = document.createElement('div');
    slide.innerHTML = `<img src="https://i.pinimg.com/originals/2c/4d/9f/${hash}.jpg">`;
    const video = document.createElement('video');
    video.setAttribute('src', 'blob:https://www.pinterest.com/8a1c-42ef');
    slide.append(video);

    expect(videoCandidates(video)[0]).toBe(`https://v1.pinimg.com/videos/iht/1080p/2c/4d/9f/${hash}.mp4`);
  });

  it('never guesses a video file when the scope holds several carousel slides', () => {
    const carousel = document.createElement('div');
    carousel.innerHTML = `
      <img src="https://i.pinimg.com/videos/thumbnails/originals/66/21/68/662168ac2e56f1545e2929aacd0fd41b.0000000.jpg">
      <img src="https://i.pinimg.com/videos/thumbnails/originals/e5/d7/ad/e5d7adffa099768aa89b505489478f9c.0000000.jpg">
    `;
    const video = document.createElement('video');
    carousel.append(video);

    expect(videoCandidates(video)).toEqual([]);
  });

  it('keeps the current HLS tier when resolving its downloadable MP4 routes', () => {
    const video = document.createElement('video');
    video.src = 'https://v1.pinimg.com/videos/iht/hls/ab/cd/ef/clip.m3u8';

    expect(videoCandidates(video)).toEqual([
      'https://v1.pinimg.com/videos/iht/1080p/ab/cd/ef/clip.mp4',
      'https://v1.pinimg.com/videos/iht/720p/ab/cd/ef/clip.mp4',
      'https://v1.pinimg.com/videos/iht/480p/ab/cd/ef/clip.mp4',
      'https://v1.pinimg.com/videos/iht/360p/ab/cd/ef/clip.mp4',
    ]);
  });

  it('never treats a Pinterest HTML page as a video file', () => {
    const video = document.createElement('video');
    video.setAttribute('data-video-url', 'https://www.pinterest.com/d16f6730-fc7d-40e6-990b-62725240f2fe/');

    expect(videoCandidates(video)).toEqual([]);
    expect(isDownloadableVideoUrl('https://www.pinterest.com/d16f6730-fc7d-40e6-990b-62725240f2fe/')).toBe(false);
  });

  it('rejects non-Pinterest hosts and unsafe protocols', () => {
    expect(isAllowedMediaUrl('https://i.pinimg.com/originals/pin.jpg')).toBe(true);
    expect(isAllowedMediaUrl('https://pinimg.com.attacker.example/pin.jpg')).toBe(false);
    expect(isAllowedMediaUrl('javascript:alert(1)')).toBe(false);
  });

  it('creates a readable, safe download path', () => {
    expect(safeFilename('https://i.pinimg.com/originals/aa/My%20Pin.jpg?x=1', 'image')).toBe('Pinterest/My-Pin.jpg');
    expect(safeFilename('https://i.pinimg.com/originals/aa/1234567890abcdef.jpg', 'image', 'My visual / reference: #1')).toBe('Pinterest/My-visual-reference-1.jpg');
    expect(safeFilename('https://i.pinimg.com/originals/aa/image.webp', 'image', 'Мой референс')).toBe('Pinterest/Мой-референс.webp');
    expect(safeFilename('https://v1.pinimg.com/videos/clip', 'video', 'CON')).toBe('Pinterest/clip.mp4');
  });

  it('uses the rendered Pinterest title and the downloaded source extension', () => {
    const image = document.createElement('img');
    image.src = 'https://i.pinimg.com/236x/aa/bb/1234567890abcdef.jpg';
    image.alt = 'Blue sky reference';

    expect(describeMedia(image).suggestedName).toBe('Pinterest/Blue-sky-reference.jpg');
    expect(mediaFileExtension('https://i.pinimg.com/originals/aa/bb/image.avif', 'image')).toBe('avif');
  });

  it('collects distinct pin media in carousel order', () => {
    const pin = document.createElement('div');
    pin.innerHTML = `
      <img src="https://i.pinimg.com/236x/aa/one.jpg">
      <img src="https://i.pinimg.com/736x/aa/one.jpg">
      <img src="https://i.pinimg.com/236x/aa/two.jpg">
      <video poster="https://i.pinimg.com/236x/aa/video.jpg"><source src="https://v1.pinimg.com/videos/720p/clip.mp4"></video>
    `;

    const options = collectPinMedia(pin);
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.kind)).toEqual(['image', 'image', 'video']);
    expect(options.map((option) => option.suggestedName)).toEqual([
      'Pinterest/one-01.jpg',
      'Pinterest/two-02.jpg',
      'Pinterest/clip-03.mp4',
    ]);
    expect(options[0]?.previewUrl).toContain('/236x/aa/one.jpg');
    expect(options[2]?.posterCandidates[0]).toContain('/originals/aa/video.jpg');
  });

  it('accepts a CDN response that carries the media file itself', () => {
    expect(isMediaResponse(200, 'image/jpeg', 'image')).toBe(true);
    expect(isMediaResponse(206, 'image/webp', 'image')).toBe(true);
    expect(isMediaResponse(200, 'IMAGE/PNG; charset=binary', 'image')).toBe(true);
    expect(isMediaResponse(206, 'video/mp4', 'video')).toBe(true);
    expect(isMediaResponse(200, 'application/octet-stream', 'video')).toBe(true);
  });

  it('rejects the XML error body Pinterest serves for an unpublished route', () => {
    expect(isMediaResponse(403, 'application/xml', 'image')).toBe(false);
    expect(isMediaResponse(200, 'application/xml', 'image')).toBe(false);
    expect(isMediaResponse(200, 'text/xml', 'video')).toBe(false);
    expect(isMediaResponse(200, 'text/html', 'image')).toBe(false);
    expect(isMediaResponse(200, null, 'image')).toBe(false);
  });

  it('does not accept an image response as a video file, or the reverse', () => {
    expect(isMediaResponse(200, 'image/jpeg', 'video')).toBe(false);
    expect(isMediaResponse(200, 'video/mp4', 'image')).toBe(false);
  });
});
