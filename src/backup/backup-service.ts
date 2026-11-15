/**
 * Builds and restores encrypted backups of everything Memora stores: memories,
 * their evidence (including photo files), and the location log. Restoring merges:
 * memories already on the device are kept as they are, never overwritten.
 */
import type { DayNote } from '@/repositories/day-note-repository';
import type { LocationObservation } from '@/repositories/location-log-repository';
import type { MemoryRepository } from '@/repositories/memory-repository';
import { MemoryEvent } from '@/types/memory';

import {
  BackupFormatError,
  BackupReader,
  BackupWriter,
  ByteReader,
  ByteWriter,
  MIN_PASSWORD_LENGTH,
  RandomBytes,
} from './format';

export const MANIFEST_SCHEMA = 1;
const PHOTO_REF_PREFIX = 'backup-photo:';

/** Where photo files come from on export and go to on restore. */
export interface PhotoStore {
  /** File contents, or null if the file is missing. */
  read(uri: string): Promise<Uint8Array | null>;
  /** Saves bytes as a new app-owned photo; returns its URI. */
  save(bytes: Uint8Array, extension: string): Promise<string>;
  remove(uri: string): void;
}

export interface LocationLogStore {
  listAll(): Promise<LocationObservation[]>;
  /** Inserts readings whose ids aren't present yet; returns how many were added. */
  importMissing(observations: LocationObservation[]): Promise<number>;
}

/** Auto-camera photos: optional in a backup because they can be very large. */
export interface AutoCaptureStore {
  listAll(): Promise<{ id: string; capturedAt: string; uri: string }[]>;
  read(uri: string): Promise<Uint8Array | null>;
  /** Writes a photo under its original id; false if one with that id is already present (or the id is invalid). */
  restore(id: string, bytes: Uint8Array): Promise<boolean>;
  remove(id: string): void;
}

export interface DayNoteStore {
  listAll(): Promise<DayNote[]>;
  importMissing(notes: DayNote[]): Promise<number>;
}

interface ManifestPhoto {
  ref: string;
  extension: string;
}

interface BackupManifest {
  app: 'Memora';
  schema: number;
  memories: MemoryEvent[];
  locationObservations: LocationObservation[];
  /** Optional so backups made before day notes existed still restore. */
  dayNotes?: DayNote[];
  photos: ManifestPhoto[];
  /** Present when the user chose to include auto-camera photos; one record each, after the memory photos. */
  autoCaptures?: { id: string; capturedAt: string }[];
}

interface EndMarker {
  end: true;
  photos: number;
  autoPhotos?: number;
}

export interface BackupStats {
  memories: number;
  photos: number;
  missingPhotos: number;
  locationReadings: number;
  dayNotes: number;
  autoPhotos: number;
}

export interface ExportOptions {
  includeAutoCaptures?: boolean;
}

export interface RestoreStats {
  memoriesAdded: number;
  memoriesAlreadyPresent: number;
  memoriesFailed: number;
  photosRestored: number;
  locationReadingsAdded: number;
  dayNotesAdded: number;
  autoPhotosRestored: number;
  backupCreatedAt: string;
}

export type Progress = (
  stage: 'preparing' | 'photos' | 'auto-photos' | 'saving',
  done: number,
  total: number,
) => void;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

function extensionOf(uri: string): string {
  const match = /\.([a-zA-Z0-9]{2,5})(?:\?.*)?$/.exec(uri);
  return match ? match[1].toLowerCase() : 'jpg';
}

export function createBackupService(deps: {
  memories: MemoryRepository;
  locationLog: LocationLogStore;
  dayNotes?: DayNoteStore;
  autoCaptures?: AutoCaptureStore;
  photos: PhotoStore;
  random: RandomBytes;
  iterations?: number;
}) {
  return {
    async exportTo(
      out: ByteWriter,
      password: string,
      onProgress?: Progress,
      options: ExportOptions = {},
    ): Promise<BackupStats> {
      const problem = validatePassword(password);
      if (problem) throw new BackupFormatError(problem);

      onProgress?.('preparing', 0, 1);
      const memories = await deps.memories.getAll();
      const locationObservations = await deps.locationLog.listAll();
      const dayNotes = deps.dayNotes ? await deps.dayNotes.listAll() : [];
      const autoCaptures =
        options.includeAutoCaptures && deps.autoCaptures ? await deps.autoCaptures.listAll() : null;

      // Swap each photo's device path for a reference to its record in this file.
      const photoSources: string[] = [];
      const photos: ManifestPhoto[] = [];
      let missingPhotos = 0;
      const portable = memories.map((memory) => ({
        ...memory,
        evidence: memory.evidence.map((evidence) => {
          const uri = evidence.type === 'PHOTO' ? evidence.data.uri : undefined;
          if (typeof uri !== 'string') return evidence;
          const ref = `${PHOTO_REF_PREFIX}${photos.length}`;
          photos.push({ ref, extension: extensionOf(uri) });
          photoSources.push(uri);
          return { ...evidence, data: { ...evidence.data, uri: ref } };
        }),
      }));

      const writer = await BackupWriter.start(out, password, deps.random, { iterations: deps.iterations });
      const manifest: BackupManifest = {
        app: 'Memora',
        schema: MANIFEST_SCHEMA,
        memories: portable,
        locationObservations,
        dayNotes,
        photos,
        ...(autoCaptures ? { autoCaptures: autoCaptures.map(({ id, capturedAt }) => ({ id, capturedAt })) } : {}),
      };
      await writer.writeJson(manifest);

      // One record per photo, streamed so large libraries don't need to fit in memory.
      for (let i = 0; i < photoSources.length; i++) {
        onProgress?.('photos', i, photoSources.length);
        const bytes = await deps.photos.read(photoSources[i]);
        if (!bytes) missingPhotos++;
        await writer.writeRecord(bytes ?? new Uint8Array(0));
      }
      onProgress?.('photos', photoSources.length, photoSources.length);

      let autoPhotos = 0;
      if (autoCaptures && deps.autoCaptures) {
        for (let i = 0; i < autoCaptures.length; i++) {
          onProgress?.('auto-photos', i, autoCaptures.length);
          const bytes = await deps.autoCaptures.read(autoCaptures[i].uri);
          if (bytes) autoPhotos++;
          else missingPhotos++;
          await writer.writeRecord(bytes ?? new Uint8Array(0));
        }
      }

      const end: EndMarker = { end: true, photos: photos.length, autoPhotos: autoCaptures?.length ?? 0 };
      await writer.writeJson(end);

      return {
        memories: memories.length,
        photos: photos.length - missingPhotos,
        missingPhotos,
        locationReadings: locationObservations.length,
        dayNotes: dayNotes.length,
        autoPhotos,
      };
    },

    async importFrom(input: ByteReader, password: string, onProgress?: Progress): Promise<RestoreStats> {
      onProgress?.('preparing', 0, 1);
      const reader = await BackupReader.open(input, password);
      const manifest = await reader.readJson<BackupManifest>();
      if (manifest.app !== 'Memora' || !Array.isArray(manifest.memories) || !Array.isArray(manifest.photos)) {
        throw new BackupFormatError('The backup contents are damaged.');
      }

      // Only memories not already on this device are imported; their photos are the only ones we keep.
      const toImport: MemoryEvent[] = [];
      let alreadyPresent = 0;
      for (const memory of manifest.memories) {
        if (await deps.memories.getById(memory.id)) alreadyPresent++;
        else toImport.push(memory);
      }
      const neededRefs = new Set(
        toImport.flatMap((memory) =>
          memory.evidence.filter((e) => e.type === 'PHOTO').map((e) => e.data.uri),
        ),
      );

      const restoredUris = new Map<string, string>();
      const restoredAuto: string[] = [];
      const autoList = Array.isArray(manifest.autoCaptures) ? manifest.autoCaptures : [];
      try {
        for (let i = 0; i < manifest.photos.length; i++) {
          onProgress?.('photos', i, manifest.photos.length);
          const bytes = await reader.readRecord();
          if (bytes === null) throw new BackupFormatError('The backup file is incomplete.');
          const photo = manifest.photos[i];
          if (bytes.length > 0 && neededRefs.has(photo.ref)) {
            restoredUris.set(photo.ref, await deps.photos.save(bytes, photo.extension));
          }
        }
        for (let i = 0; i < autoList.length; i++) {
          onProgress?.('auto-photos', i, autoList.length);
          const bytes = await reader.readRecord();
          if (bytes === null) throw new BackupFormatError('The backup file is incomplete.');
          const id = autoList[i]?.id;
          if (bytes.length > 0 && typeof id === 'string' && deps.autoCaptures && (await deps.autoCaptures.restore(id, bytes))) {
            restoredAuto.push(id);
          }
        }
        const end = await reader.readJson<EndMarker>();
        if (end.end !== true || end.photos !== manifest.photos.length || (end.autoPhotos ?? 0) !== autoList.length) {
          throw new BackupFormatError('The backup file is incomplete.');
        }
      } catch (error) {
        // Nothing was imported yet; don't leave orphaned photo files behind.
        restoredUris.forEach((uri) => deps.photos.remove(uri));
        restoredAuto.forEach((id) => deps.autoCaptures?.remove(id));
        throw error;
      }

      onProgress?.('saving', 0, toImport.length);
      let added = 0;
      let failed = 0;
      for (const memory of toImport) {
        const restored: MemoryEvent = {
          ...memory,
          evidence: memory.evidence.flatMap((evidence) => {
            const ref = evidence.data.uri;
            if (evidence.type !== 'PHOTO' || typeof ref !== 'string' || !ref.startsWith(PHOTO_REF_PREFIX)) {
              return [evidence];
            }
            const uri = restoredUris.get(ref);
            // A photo that was already missing when backed up stays a note-free gap, not a broken link.
            return uri ? [{ ...evidence, data: { ...evidence.data, uri } }] : [];
          }),
        };
        try {
          await deps.memories.create(restored);
          added++;
        } catch {
          failed++;
          restored.evidence
            .filter((e) => e.type === 'PHOTO' && typeof e.data.uri === 'string')
            .forEach((e) => deps.photos.remove(e.data.uri as string));
        }
        onProgress?.('saving', added + failed, toImport.length);
      }

      const locationReadingsAdded = await deps.locationLog.importMissing(
        Array.isArray(manifest.locationObservations) ? manifest.locationObservations : [],
      );

      const dayNotesAdded =
        deps.dayNotes && Array.isArray(manifest.dayNotes) ? await deps.dayNotes.importMissing(manifest.dayNotes) : 0;

      return {
        memoriesAdded: added,
        memoriesAlreadyPresent: alreadyPresent,
        memoriesFailed: failed,
        photosRestored: restoredUris.size,
        locationReadingsAdded,
        dayNotesAdded,
        autoPhotosRestored: restoredAuto.length,
        backupCreatedAt: reader.header.createdAt,
      };
    },
  };
}
