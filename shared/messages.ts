export type MediaKind = 'image' | 'video';

export interface CopyMediaMessage {
  type: 'COPY_MEDIA';
  kind: MediaKind;
  candidates: string[];
  posterCandidates: string[];
}

export interface DownloadMediaMessage {
  type: 'DOWNLOAD_MEDIA';
  kind: MediaKind;
  candidates: string[];
  /** HLS playlists for a video, used to find or assemble its file. */
  streams: string[];
  suggestedName: string;
}

export interface OffscreenCopyMessage {
  type: 'OFFSCREEN_COPY';
  target: 'offscreen';
  kind: MediaKind;
  candidates: string[];
  posterCandidates: string[];
}

/** Builds an MP4 from a stream and hands back a `blob:` URL to download. */
export interface OffscreenAssembleMessage {
  type: 'OFFSCREEN_ASSEMBLE_VIDEO';
  target: 'offscreen';
  stream: string;
}

export interface OffscreenReleaseMessage {
  type: 'OFFSCREEN_RELEASE';
  target: 'offscreen';
  url: string;
}

export type OffscreenMessage = OffscreenCopyMessage | OffscreenAssembleMessage | OffscreenReleaseMessage;

export type ExtensionMessage = CopyMediaMessage | DownloadMediaMessage | OffscreenMessage;

export interface ActionResponse {
  ok: boolean;
  message: string;
}

export interface AssembledVideoResponse extends ActionResponse {
  url?: string;
}

export function isActionResponse(value: unknown): value is ActionResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'ok' in value &&
      typeof (value as ActionResponse).ok === 'boolean' &&
      'message' in value &&
      typeof (value as ActionResponse).message === 'string',
  );
}
