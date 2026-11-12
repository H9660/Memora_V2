import { useCameraPermissions } from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import { dayNoteRepository } from '@/repositories/day-note-repository';
import { locationLogRepository } from '@/repositories/location-log-repository';
import { isLocationLogActive, RETENTION_DAYS } from '@/services/background-location';
import { getLocationPermission, LocationPermission } from '@/services/location';
import { memoryService } from '@/services/memory-service';

const LOCATION_LABELS: Record<LocationPermission, string> = {
  granted: 'Allowed while using the app',
  undetermined: 'Not asked yet',
  denied: 'Not allowed',
  blocked: 'Not allowed (change in settings)',
};

export default function PrivacyScreen() {
  const [locationPermission, setLocationPermission] = useState<LocationPermission | null>(null);
  // Reads status only; never prompts.
  const [cameraPermission] = useCameraPermissions({ get: true, request: false });
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [logActive, setLogActive] = useState<boolean | null>(null);
  const [logCount, setLogCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    getLocationPermission().then(setLocationPermission);
    isLocationLogActive().then(setLogActive);
    locationLogRepository.count().then(setLogCount, () => setLogCount(null));
    memoryService.count().then(
      (total) => {
        setCount(total);
        setCountError(false);
      },
      () => setCountError(true),
    );
  }, []);

  // Re-read when returning from system settings or another screen.
  useFocusEffect(refresh);

  async function deleteAll() {
    setDeleting(true);
    try {
      await memoryService.removeAll();
      await dayNoteRepository.deleteAll();
      setCount(0);
      Alert.alert('All memories deleted', 'Memora no longer has any memories stored on this device.');
    } catch (error) {
      console.warn('Deleting all memories failed:', error instanceof Error ? error.message : error);
      Alert.alert('Couldn’t delete', 'Your memories could not be deleted. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  function confirmDeleteAll() {
    Alert.alert(
      'Delete all memories?',
      `This permanently removes ${count === 1 ? '1 memory' : `all ${count ?? ''} memories`}, their photos, all evidence and your day notes from this device. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: deleteAll },
      ],
    );
  }

  const cameraLabel = !cameraPermission
    ? '…'
    : cameraPermission.granted
      ? 'Allowed'
      : cameraPermission.status === 'undetermined'
        ? 'Not asked yet'
        : 'Not allowed';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        hitSlop={12}
        style={styles.backButton}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Privacy & Data</Text>
      <Text style={styles.subtitle}>You decide what Memora captures and keeps.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Where your memories live</Text>
        <Text style={styles.body}>
          Memories, notes, photos and locations are stored only on this device. Memora has no
          account, no cloud sync and no analytics, and it never uploads your data.
        </Text>
        <Text style={styles.body}>
          Your notes are kept exactly as you wrote them. Sensor observations such as location are
          stored separately and labelled as observations — never as facts about what you did.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>PERMISSIONS</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location</Text>
        <Text style={styles.status}>
          {locationPermission ? LOCATION_LABELS[locationPermission] : '…'}
        </Text>
        <Text style={styles.body}>
          Used while you capture a memory, to note where your phone was. You can remove it from any
          memory before saving. Background access is used only if you turn on the location log.
        </Text>

        <View style={styles.divider} />

        <Text style={styles.cardTitle}>Camera</Text>
        <Text style={styles.status}>{cameraLabel}</Text>
        <Text style={styles.body}>
          Requested only when you tap “Take photo”. Choosing an existing photo uses the system
          picker, which shares just the photo you select.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button">
          <Text style={styles.secondaryText}>OPEN SYSTEM SETTINGS</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>OPTIONAL AUTOMATIC CAPTURE</Text>

      <View style={styles.card}>
        <Pressable
          onPress={() => router.push('/location-log')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Location log</Text>
            <Text style={styles.status}>
              {logActive === null ? '…' : logActive ? 'On' : 'Off'}
              {logCount ? ` · ${logCount} readings stored` : ''}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={() => router.push('/reminders')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Reminders</Text>
            <Text style={styles.status}>Daily prompts to capture a memory</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={() => router.push('/auto-camera')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Auto camera</Text>
            <Text style={styles.status}>Photos at an interval you choose, with a visible notification</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Text style={styles.body}>
          All are off unless you turn them on. Location log readings are kept separate from your
          memories and deleted after {RETENTION_DAYS} days.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>YOUR DATA</Text>

      <View style={styles.card}>
        <Pressable
          onPress={() => router.push('/backup')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Backup & restore</Text>
            <Text style={styles.status}>Encrypted copy you can save to Google Drive</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stored memories</Text>
        <Text style={styles.status}>
          {countError ? 'Couldn’t count memories' : count === null ? '…' : `${count} on this device`}
        </Text>
        <Text style={styles.body}>
          You can delete a single memory from its detail screen, or remove everything here.
        </Text>

        <Pressable
          style={[styles.deleteButton, (deleting || !count) && styles.disabled]}
          onPress={confirmDeleteAll}
          disabled={deleting || !count}
          accessibilityRole="button"
          accessibilityState={{ disabled: deleting || !count, busy: deleting }}>
          {deleting ? (
            <ActivityIndicator color={Palette.danger} />
          ) : (
            <Text style={styles.deleteText}>DELETE ALL MEMORIES</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 48,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 28,
  },
  back: {
    fontSize: 16,
    color: Palette.textSecondary,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Palette.text,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: Palette.textMuted,
  },
  sectionTitle: {
    marginTop: 30,
    fontSize: 13,
    fontWeight: '700',
    color: Palette.sectionLabel,
    letterSpacing: 1,
  },
  card: {
    marginTop: 16,
    padding: 18,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  status: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: Palette.border,
    marginVertical: 18,
  },
  secondaryButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
  },
  pressed: {
    opacity: 0.7,
  },
  flex: {
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  chevron: {
    fontSize: 24,
    color: Palette.textFaint,
  },
  deleteButton: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.dangerBorder,
    alignItems: 'center',
  },
  deleteText: {
    color: Palette.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
