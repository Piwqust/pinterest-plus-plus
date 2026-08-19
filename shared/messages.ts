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
  suggestedName: string;
}

export interface OffscreenCopyMessage {
  type: 'OFFSCREEN_COPY';
  target: 'offscreen';
  kind: MediaKind;
  candidates: string[];
  posterCandidates: string[];
}

export type ExtensionMessage = CopyMediaMessage | DownloadMediaMessage | OffscreenCopyMessage;

export interface ActionResponse {
  ok: boolean;
  message: string;
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
