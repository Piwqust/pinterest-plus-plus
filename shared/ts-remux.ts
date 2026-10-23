import { Transmuxer } from 'mux.js/cjs/mp4/transmuxer.js';

/**
 * Rewraps an MPEG-TS stream as an MP4. Pinterest's oldest videos exist only as
 * TS segments; a `.ts` file plays in fewer places than an `.mp4` and is not
 * what anyone asked to download. The samples are moved, not re-encoded.
 */
export function remuxTransportStream(stream: Uint8Array): Uint8Array {
  const transmuxer = new Transmuxer({ remux: true });
  const parts: Uint8Array[] = [];
  transmuxer.on('data', (segment) => {
    if (parts.length === 0) parts.push(segment.initSegment);
    parts.push(segment.data);
  });
  transmuxer.push(stream);
  transmuxer.flush();
  if (parts.length === 0) throw new Error('The stream held no playable samples');

  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
