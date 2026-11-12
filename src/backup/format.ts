/**
 * Memora backup file format (version 1).
 *
 *   "MEMORABK"                      8-byte magic
 *   u32 BE + JSON header            plaintext: format, version, createdAt, KDF params (salt, iterations)
 *   record*                         u32 BE length, then 12-byte IV + AES-256-GCM ciphertext (+16-byte tag)
 *
 * Record 0 is the encrypted manifest (memories, evidence, location log, photo list),
 * records 1..n are the photos in manifest order, and the last record is an encrypted
 * end marker so a truncated file is detected. Each record's index is bound in as AAD,
 * so records can't be reordered, dropped or swapped between backups unnoticed.
 *
 * Only the header is readable without the password, and it contains nothing personal.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const MAGIC = utf8ToBytes('MEMORABK');
export const FORMAT_VERSION = 1;
export const DEFAULT_ITERATIONS = 210_000;
export const MIN_PASSWORD_LENGTH = 8;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
/** Refuse absurd record sizes from a corrupted length field before allocating. */
const MAX_RECORD_BYTES = 256 * 1024 * 1024;

export interface BackupHeader {
  format: 'memora-backup';
  version: number;
  createdAt: string;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: 'AES-256-GCM';
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** Thrown when a record fails authentication: wrong password, or a damaged/tampered file. */
export class BackupAuthError extends Error {
  constructor() {
    super('Wrong password, or the backup file is damaged.');
    this.name = 'BackupAuthError';
  }
}

/** Sequential byte sink/source, so the format works with files (streamed) and in-memory tests. */
export interface ByteWriter {
  write(bytes: Uint8Array): Promise<void>;
}
export interface ByteReader {
  /** Reads exactly `length` bytes, or fewer only at end of file. */
  read(length: number): Promise<Uint8Array>;
}

export type RandomBytes = (length: number) => Uint8Array;

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function readU32(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function aad(index: number): Uint8Array {
  return utf8ToBytes(`memora-backup:v${FORMAT_VERSION}:record:${index}`);
}

export function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: KEY_LENGTH, asyncTick: 20 });
}

export class BackupWriter {
  private index = 0;

  private constructor(
    private readonly out: ByteWriter,
    private readonly key: Uint8Array,
    private readonly random: RandomBytes,
  ) {}

  /** Writes the magic and header; returns a writer for encrypted records. */
  static async start(
    out: ByteWriter,
    password: string,
    random: RandomBytes,
    options: { iterations?: number; now?: Date } = {},
  ): Promise<BackupWriter> {
    const iterations = options.iterations ?? DEFAULT_ITERATIONS;
    const salt = random(16);
    const header: BackupHeader = {
      format: 'memora-backup',
      version: FORMAT_VERSION,
      createdAt: (options.now ?? new Date()).toISOString(),
      kdf: { name: 'PBKDF2-SHA256', iterations, salt: toBase64(salt) },
      cipher: 'AES-256-GCM',
    };
    const headerBytes = utf8ToBytes(JSON.stringify(header));
    const key = await deriveKey(password, salt, iterations);

    await out.write(MAGIC);
    await out.write(u32(headerBytes.length));
    await out.write(headerBytes);
    return new BackupWriter(out, key, random);
  }

  async writeRecord(plaintext: Uint8Array): Promise<void> {
    const iv = this.random(IV_LENGTH);
    const sealed = gcm(this.key, iv, aad(this.index)).encrypt(plaintext);
    await this.out.write(u32(IV_LENGTH + sealed.length));
    await this.out.write(iv);
    await this.out.write(sealed);
    this.index++;
  }

  writeJson(value: unknown): Promise<void> {
    return this.writeRecord(utf8ToBytes(JSON.stringify(value)));
  }
}

export class BackupReader {
  private index = 0;

  private constructor(
    private readonly input: ByteReader,
    private readonly key: Uint8Array,
    readonly header: BackupHeader,
  ) {}

  /** Reads just the plaintext header (no password needed), e.g. to show the backup date. */
  static async readHeader(input: ByteReader): Promise<BackupHeader> {
    const magic = await input.read(MAGIC.length);
    if (magic.length !== MAGIC.length || !magic.every((byte, i) => byte === MAGIC[i])) {
      throw new BackupFormatError('This isn’t a Memora backup file.');
    }
    const lengthBytes = await input.read(4);
    const length = lengthBytes.length === 4 ? readU32(lengthBytes) : 0;
    if (length <= 0 || length > 64 * 1024) throw new BackupFormatError('The backup header is damaged.');

    let header: BackupHeader;
    try {
      header = JSON.parse(bytesToUtf8(await input.read(length)));
    } catch {
      throw new BackupFormatError('The backup header is damaged.');
    }
    if (header.format !== 'memora-backup' || header.kdf?.name !== 'PBKDF2-SHA256') {
      throw new BackupFormatError('This isn’t a Memora backup file.');
    }
    if (header.version > FORMAT_VERSION) {
      throw new BackupFormatError('This backup was made by a newer version of Memora. Update the app first.');
    }
    return header;
  }

  static async open(input: ByteReader, password: string): Promise<BackupReader> {
    const header = await BackupReader.readHeader(input);
    const key = await deriveKey(password, fromBase64(header.kdf.salt), header.kdf.iterations);
    return new BackupReader(input, key, header);
  }

  /** Next decrypted record, or null at a clean end of file. */
  async readRecord(): Promise<Uint8Array | null> {
    const lengthBytes = await this.input.read(4);
    if (lengthBytes.length === 0) return null;
    if (lengthBytes.length !== 4) throw new BackupFormatError('The backup file is incomplete.');

    const length = readU32(lengthBytes);
    if (length <= IV_LENGTH || length > MAX_RECORD_BYTES) throw new BackupFormatError('The backup file is damaged.');

    const body = await this.input.read(length);
    if (body.length !== length) throw new BackupFormatError('The backup file is incomplete.');

    try {
      const plaintext = gcm(this.key, body.subarray(0, IV_LENGTH), aad(this.index)).decrypt(
        body.subarray(IV_LENGTH),
      );
      this.index++;
      return plaintext;
    } catch {
      throw new BackupAuthError();
    }
  }

  async readJson<T>(): Promise<T> {
    const record = await this.readRecord();
    if (!record) throw new BackupFormatError('The backup file is incomplete.');
    return JSON.parse(bytesToUtf8(record)) as T;
  }
}

/** In-memory ByteWriter/ByteReader, used by tests. */
export class MemoryBytes implements ByteWriter, ByteReader {
  private chunks: Uint8Array[] = [];
  private data: Uint8Array | null = null;
  private position = 0;

  async write(bytes: Uint8Array): Promise<void> {
    this.chunks.push(bytes.slice());
    this.data = null;
  }

  bytes(): Uint8Array {
    if (!this.data) {
      const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      this.data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of this.chunks) {
        this.data.set(chunk, offset);
        offset += chunk.length;
      }
    }
    return this.data;
  }

  static from(bytes: Uint8Array): MemoryBytes {
    const memory = new MemoryBytes();
    memory.chunks = [bytes];
    return memory;
  }

  async read(length: number): Promise<Uint8Array> {
    const data = this.bytes();
    const out = data.slice(this.position, this.position + length);
    this.position += out.length;
    return out;
  }
}
