import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/palette';
import { photoExists } from '@/services/photos';
import { MemoryEvidence } from '@/types/memory';
import { formatDateTime } from '@/utils/dates';

type Origin = 'user' | 'sensor';

const LABELS: Record<MemoryEvidence['type'], { title: string; source: string; origin: Origin }> = {
  USER_NOTE: { title: 'Your note, as first captured', source: 'Written by you', origin: 'user' },
  LOCATION: { title: 'Device location', source: 'Sensor observation', origin: 'sensor' },
  PHOTO: { title: 'Photo', source: 'Added by you', origin: 'user' },
};

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function PhotoBody({ uri }: { uri: string | null }) {
  // Files can disappear (e.g. app data partially cleared); show a placeholder instead of a broken image.
  const [failed, setFailed] = useState(() => uri === null || !photoExists(uri));

  if (failed || uri === null) {
    return <Text style={styles.detail}>The photo file is no longer available on this device.</Text>;
  }

  return (
    <Image
      source={{ uri }}
      style={styles.photo}
      contentFit="cover"
      onError={() => setFailed(true)}
      accessibilityLabel="Memory photo"
    />
  );
}

function EvidenceBody({ evidence }: { evidence: MemoryEvidence }) {
  if (evidence.type === 'USER_NOTE') {
    return (
      <Text style={styles.body} selectable>
        {asString(evidence.data.text) ?? 'This note could not be read.'}
      </Text>
    );
  }

  if (evidence.type === 'LOCATION') {
    const latitude = asNumber(evidence.data.latitude);
    const longitude = asNumber(evidence.data.longitude);
    const accuracy = asNumber(evidence.data.accuracyMeters);
    const placeName = asString(evidence.data.placeName);

    return (
      <View style={styles.bodyGroup}>
        {placeName && <Text style={styles.body}>{placeName}</Text>}
        {latitude !== null && longitude !== null ? (
          <Text style={styles.detail} selectable>
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
            {accuracy !== null ? `  (±${Math.round(accuracy)} m)` : ''}
          </Text>
        ) : (
          <Text style={styles.detail}>Coordinates could not be read.</Text>
        )}
        <Text style={styles.caveat}>
          Where your phone was when this was captured — not a record of what you were doing.
        </Text>
      </View>
    );
  }

  return <PhotoBody uri={asString(evidence.data.uri)} />;
}

export function EvidenceItem({ evidence }: { evidence: MemoryEvidence }) {
  const labels = LABELS[evidence.type];
  const isSensor = labels.origin === 'sensor';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{labels.title}</Text>
        <View style={[styles.badge, isSensor ? styles.sensorBadge : styles.userBadge]}>
          <Text style={[styles.badgeText, isSensor ? styles.sensorBadgeText : styles.userBadgeText]}>
            {labels.source}
          </Text>
        </View>
      </View>

      <EvidenceBody evidence={evidence} />

      <Text style={styles.timestamp}>Recorded {formatDateTime(evidence.capturedAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  userBadge: {
    backgroundColor: Palette.userBadgeBg,
  },
  sensorBadge: {
    backgroundColor: Palette.sensorBadgeBg,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  userBadgeText: {
    color: Palette.userBadgeText,
  },
  sensorBadgeText: {
    color: Palette.sensorBadgeText,
  },
  bodyGroup: {
    gap: 4,
  },
  body: {
    fontSize: 15,
    color: Palette.text,
    lineHeight: 22,
  },
  detail: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  caveat: {
    marginTop: 6,
    fontSize: 12,
    color: Palette.textMuted,
    fontStyle: 'italic',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: Palette.border,
  },
  timestamp: {
    marginTop: 12,
    fontSize: 12,
    color: Palette.textFaint,
  },
});
