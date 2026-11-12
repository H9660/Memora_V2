import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MemoryEvent } from '@/types/memory';
import { formatDateTime, formatTime } from '@/utils/dates';

type MemoryCardProps = {
  memory: MemoryEvent;
  /** Show the full date instead of just the time, e.g. in search results. */
  showDate?: boolean;
};

export function MemoryCard({ memory, showDate = false }: MemoryCardProps) {
  const trimmedNote = memory.note.trim();
  const notePreview = trimmedNote.length === 0 || trimmedNote === memory.title ? null : trimmedNote;
  const hasPhoto = memory.evidence.some((evidence) => evidence.type === 'PHOTO');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/memory/[id]', params: { id: memory.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open memory: ${memory.title}`}>
      <Text style={styles.title} numberOfLines={2}>
        {memory.title}
      </Text>

      {notePreview && (
        <Text style={styles.note} numberOfLines={2}>
          {notePreview}
        </Text>
      )}

      <View style={styles.meta}>
        <Text style={styles.metaText}>
          🕐 {showDate ? formatDateTime(memory.capturedAt) : formatTime(memory.capturedAt)}
        </Text>
        {memory.placeName && (
          <Text style={styles.metaText} numberOfLines={1}>
            📍 {memory.placeName}
          </Text>
        )}
        {hasPhoto && <Text style={styles.metaText}>📷 Photo attached</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },

  pressed: {
    opacity: 0.7,
  },

  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B1D22',
  },

  note: {
    marginTop: 6,
    fontSize: 14,
    color: '#555B66',
  },

  meta: {
    marginTop: 10,
    gap: 4,
  },

  metaText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
