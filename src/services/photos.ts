import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { PhotoEvidenceData } from '@/types/memory';
import { generateId } from '@/utils/ids';

/** A photo the user picked but hasn't saved yet. `uri` may be a temporary picker/cache file. */
export interface PendingPhoto {
  uri: string;
  width: number | null;
  height: number | null;
  source: PhotoEvidenceData['source'];
  /** ISO 8601 time the photo was chosen or taken in Memora. */
  capturedAt: string;
}

export type PhotoPickResult =
  | { status: 'success'; photo: PendingPhoto }
  | { status: 'canceled' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; reason: string };

const PHOTO_DIRECTORY_NAME = 'memory-photos';
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.8,
  exif: false,
};

function photoDirectory(): Directory {
  return new Directory(Paths.document, PHOTO_DIRECTORY_NAME);
}

function toPending(
  result: ImagePicker.ImagePickerResult,
  source: PendingPhoto['source'],
): PhotoPickResult {
  if (result.canceled || result.assets.length === 0) return { status: 'canceled' };

  const asset = result.assets[0];
  return {
    status: 'success',
    photo: {
      uri: asset.uri,
      width: asset.width || null,
      height: asset.height || null,
      source,
      capturedAt: new Date().toISOString(),
    },
  };
}

/**
 * Opens the system photo picker. On Android this uses the system picker, which
 * grants access to the chosen image only and needs no storage permission.
 */
export async function pickFromLibrary(): Promise<PhotoPickResult> {
  try {
    return toPending(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS), 'library');
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Asks for camera permission (only now, because the user chose to take a photo) and opens the camera. */
export async function takePhoto(): Promise<PhotoPickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }
    return toPending(await ImagePicker.launchCameraAsync(PICKER_OPTIONS), 'camera');
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function extensionOf(uri: string): string {
  const match = /\.([a-zA-Z0-9]{2,5})(?:\?.*)?$/.exec(uri);
  return match ? match[1].toLowerCase() : 'jpg';
}

/** Copies a picked photo into app-private document storage and returns its durable URI. */
export async function persistPhoto(photo: PendingPhoto): Promise<PhotoEvidenceData> {
  const directory = photoDirectory();
  directory.create({ intermediates: true, idempotent: true });

  const source = new File(photo.uri);
  const destination = new File(directory, `${generateId()}.${extensionOf(photo.uri)}`);
  await source.copy(destination);

  return {
    uri: destination.uri,
    width: photo.width,
    height: photo.height,
    source: photo.source,
  };
}

/** Writes photo bytes (e.g. from a backup) into app-private storage; returns the new URI. */
export async function savePhotoBytes(bytes: Uint8Array, extension: string): Promise<string> {
  const directory = photoDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const safeExtension = /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : 'jpg';
  const file = new File(directory, `${generateId()}.${safeExtension}`);
  file.create();
  await file.write(bytes);
  return file.uri;
}

/** Reads a stored photo's bytes, or null if the file is missing/unreadable. */
export async function readPhotoBytes(uri: string): Promise<Uint8Array | null> {
  try {
    const file = new File(uri);
    return file.exists ? await file.bytes() : null;
  } catch {
    return null;
  }
}

/** Where the earlier prototype stored photos; migrated memories may still point here. */
const LEGACY_PHOTO_DIRECTORY_NAME = 'photos';

/** True only for files inside Memora's own photo directories. */
function isOwnedPhoto(uri: string): boolean {
  return [PHOTO_DIRECTORY_NAME, LEGACY_PHOTO_DIRECTORY_NAME].some((name) =>
    uri.startsWith(new Directory(Paths.document, name).uri),
  );
}

export function photoExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Best-effort removal of a stored photo. Never touches files outside Memora's photo directory. */
export function deletePhoto(uri: string): void {
  if (!isOwnedPhoto(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    console.warn('Could not delete a stored photo file.');
  }
}

/** Removes every photo Memora stored. Used by "Delete all memories". */
export function deleteAllPhotos(): void {
  for (const name of [PHOTO_DIRECTORY_NAME, LEGACY_PHOTO_DIRECTORY_NAME]) {
    try {
      const directory = new Directory(Paths.document, name);
      if (directory.exists) directory.delete();
    } catch {
      console.warn('Could not clear a photo directory.');
    }
  }
}
