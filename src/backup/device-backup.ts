/**
 * Device glue for backups: streams the encrypted file to app cache, hands it to
 * the Android share sheet ("Save to Drive", Files, …) and reads a picked file back.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dayNoteRepository } from '@/repositories/day-note-repository';
import { locationLogRepository } from '@/repositories/location-log-repository';
import { memoryRepository } from '@/repositories/sqlite-memory-repository';
import { deletePhoto, readPhotoBytes, savePhotoBytes } from '@/services/photos';

import { BackupStats, createBackupService, Progress, RestoreStats } from './backup-service';
import { BackupHeader, BackupReader, ByteReader, ByteWriter } from './format';

export const BACKUP_EXTENSION = 'memora';
const BACKUP_MIME = 'application/octet-stream';

const service = createBackupService({
  memories: memoryRepository,
  locationLog: locationLogRepository,
  dayNotes: dayNoteRepository,
  photos: { read: readPhotoBytes, save: savePhotoBytes, remove: deletePhoto },
  random: (length) => Crypto.getRandomBytes(length),
});

function backupDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'backups');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function fileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `memora-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${BACKUP_EXTENSION}`;
}

/** Keeps only the newest local copy so old backups don't pile up in cache. */
function clearOldBackups(keep: File) {
  for (const entry of backupDirectory().list()) {
    if (entry instanceof File && entry.uri !== keep.uri) {
      try {
        entry.delete();
      } catch {
        // Cache cleanup is best-effort.
      }
    }
  }
}

function handleReader(file: File): { reader: ByteReader; close: () => void } {
  const handle = file.open(FileMode.ReadOnly);
  return {
    reader: {
      async read(length: number) {
        // Loop until we have `length` bytes or reach end of file.
        const parts: Uint8Array[] = [];
        let total = 0;
        while (total < length) {
          const chunk = await handle.readBytes(length - total);
          if (chunk.length === 0) break;
          parts.push(chunk);
          total += chunk.length;
        }
        if (parts.length === 1) return parts[0];
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        return out;
      },
    },
    close: () => handle.close(),
  };
}

/** Picked files may be content:// URIs; copy into cache if they can't be opened directly. */
function openPicked(file: File): { reader: ByteReader; close: () => void } {
  try {
    return handleReader(file);
  } catch {
    const copy = new File(backupDirectory(), `restore-${Date.now()}.${BACKUP_EXTENSION}`);
    file.copySync(copy);
    const opened = handleReader(copy);
    return {
      reader: opened.reader,
      close: () => {
        opened.close();
        try {
          copy.delete();
        } catch {
          // best-effort
        }
      },
    };
  }
}

export async function createBackupFile(
  password: string,
  onProgress?: Progress,
): Promise<{ file: File; stats: BackupStats }> {
  const file = new File(backupDirectory(), fileName(new Date()));
  if (file.exists) file.delete();
  file.create();

  const handle = file.open(FileMode.WriteOnly);
  const writer: ByteWriter = { write: (bytes) => handle.writeBytes(bytes) };
  try {
    const stats = await service.exportTo(writer, password, onProgress);
    handle.close();
    clearOldBackups(file);
    return { file, stats };
  } catch (error) {
    handle.close();
    try {
      file.delete();
    } catch {
      // best-effort
    }
    throw error;
  }
}

/** Opens the share sheet so the user can choose "Save to Drive" (or any other destination). */
export async function shareBackupFile(file: File): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing isn’t available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: BACKUP_MIME,
    dialogTitle: 'Save Memora backup',
  });
}

/** Opens the system file picker (Drive, Downloads, …). Returns null if the user cancels. */
export async function pickBackupFile(): Promise<File | null> {
  const result = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (result.canceled) return null;
  return Array.isArray(result.result) ? result.result[0] ?? null : result.result;
}

export async function readBackupInfo(file: File): Promise<BackupHeader> {
  const opened = openPicked(file);
  try {
    return await BackupReader.readHeader(opened.reader);
  } finally {
    opened.close();
  }
}

export async function restoreBackupFile(
  file: File,
  password: string,
  onProgress?: Progress,
): Promise<RestoreStats> {
  const opened = openPicked(file);
  try {
    return await service.importFrom(opened.reader, password, onProgress);
  } finally {
    opened.close();
  }
}
