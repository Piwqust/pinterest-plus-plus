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
  /** A folder under Downloads, in place of the default `Pinterest`. */
  directory?: string;
}

/** One pin of an archive. The extension is chosen once a source answers. */
export interface ArchiveItem {
  kind: MediaKind;
  candidates: string[];
  streams: string[];
  /** The path inside the archive, without the extension. */
  stem: string;
  title: string;
  pinUrl: string;
}

/**
 * Sent over a `ARCHIVE_PORT` connection rather than as a one-off message, so
 * the service worker can report progress while the archive is built and the
 * open port keeps it alive for as long as that takes.
 */
export interface ArchiveRequest {
  type: 'BUILD_ARCHIVE';
  items: ArchiveItem[];
  /** The archive's file name under Downloads, without `.zip`. */
  archiveName: string;
  includeCredits: boolean;
}

export const ARCHIVE_PORT = 'ppp-archive';

export type ArchiveEvent =
  | { type: 'ARCHIVE_PROGRESS'; done: number; total: number }
  | { type: 'ARCHIVE_DONE'; ok: boolean; message: string; included: number; failed: number };

export interface OffscreenArchiveMessage {
  type: 'OFFSCREEN_BUILD_ARCHIVE';
  target: 'offscreen';
  jobId: string;
  items: ArchiveItem[];
  includeCredits: boolean;
}

/** From the offscreen document back to the service worker, while an archive is built. */
export interface ArchiveProgressMessage {
  type: 'ARCHIVE_PROGRESS';
  target: 'background';
  jobId: string;
  done: number;
  total: number;
}

export interface ArchiveBuiltResponse extends ActionResponse {
  url?: string;
  included: number;
  failed: number;
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

export type OffscreenMessage =
  | OffscreenCopyMessage
  | OffscreenAssembleMessage
  | OffscreenReleaseMessage
  | OffscreenArchiveMessage;

export type ExtensionMessage = CopyMediaMessage | DownloadMediaMessage | OffscreenMessage | ArchiveProgressMessage;

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
