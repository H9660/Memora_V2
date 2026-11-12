import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID, used for memories and evidence. */
export function generateId(): string {
  return Crypto.randomUUID();
}
