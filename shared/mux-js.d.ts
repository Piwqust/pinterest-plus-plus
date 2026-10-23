declare module 'mux.js/cjs/mp4/transmuxer.js' {
  interface TransmuxedSegment {
    initSegment: Uint8Array;
    data: Uint8Array;
  }

  export class Transmuxer {
    constructor(options?: { remux?: boolean; keepOriginalTimestamps?: boolean });
    on(event: 'data', listener: (segment: TransmuxedSegment) => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
}
