import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import { LocationObservation, locationLogRepository } from '@/repositories/location-log-repository';
import {
  fillMissingPlaceNames,
  formatInterval,
  getLocationLogSettings,
  INTERVAL_OPTIONS_MINUTES,
  isLocationLogActive,
  isValidInterval,
  LOW_INTERVAL_WARNING_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  RETENTION_DAYS,
  saveInterval,
  startLocationLog,
  stopLocationLog,
} from '@/services/background-location';
import { formatTime, groupByDay } from '@/utils/dates';

type Status = { active: boolean; intervalMinutes: number };

export default function LocationLogScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<LocationObservation[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customInterval, setCustomInterval] = useState('');
  const [naming, setNaming] = useState(false);

  const loadHistory = useCallback(
    () =>
      locationLogRepository.list().then(
        (observations) => {
          setHistory(observations);
          setHistoryError(false);
          return observations;
        },
        () => {
          setHistoryError(true);
          return [] as LocationObservation[];
        },
      ),
    [],
  );

  const refresh = useCallback(() => {
    Promise.all([isLocationLogActive(), getLocationLogSettings()]).then(
      ([active, settings]) => setStatus({ active, intervalMinutes: settings.intervalMinutes }),
      () => setStatus({ active: false, intervalMinutes: 15 }),
    );
    loadHistory().then((observations) => {
      // Name readings that were recorded without network, then show the names.
      if (!observations.some((observation) => observation.placeName === null)) return;
      setNaming(true);
      fillMissingPlaceNames()
        .then((named) => (named > 0 ? loadHistory() : undefined))
        .catch(() => undefined)
        .finally(() => setNaming(false));
    });
  }, [loadHistory]);

  // Re-read on focus, e.g. after returning from system settings.
  useFocusEffect(refresh);

  async function start(intervalMinutes: number) {
    setBusy(true);
    const result = await startLocationLog(intervalMinutes);
    setBusy(false);

    if (result.status === 'background-denied' || (result.status === 'denied' && !result.canAskAgain)) {
      Alert.alert(
        'Allow location all the time',
        'The location log needs “Allow all the time” so it can record while Memora is closed. You can choose it in system settings → Permissions → Location.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ],
      );
    } else if (result.status === 'denied') {
      Alert.alert('Location not allowed', 'The location log stays off.');
    } else if (result.status === 'invalid-interval') {
      Alert.alert('Choose a valid interval', `Use ${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} minutes.`);
    } else if (result.status === 'error') {
      Alert.alert('Couldn’t start the location log', 'Please try again.');
      console.warn('Starting location log failed:', result.reason);
    }
    refresh();
  }

  async function stop() {
    setBusy(true);
    try {
      await stopLocationLog();
    } catch (error) {
      console.warn('Stopping location log failed:', error instanceof Error ? error.message : error);
      Alert.alert('Couldn’t turn off the location log', 'Please try again.');
    }
    setBusy(false);
    refresh();
  }

  function onToggle(value: boolean) {
    if (!status) return;
    if (value) {
      Alert.alert(
        'Turn on the location log?',
        `Memora will note where your phone is about every ${formatInterval(status.intervalMinutes)}, even when the app is closed, and look up the place for each reading. A notification stays visible while it’s on. History stays on this device and is deleted after ${RETENTION_DAYS} days.${status.intervalMinutes < LOW_INTERVAL_WARNING_MINUTES ? ' Intervals this short use noticeably more battery.' : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn on', onPress: () => start(status.intervalMinutes) },
        ],
      );
    } else {
      stop();
    }
  }

  function onPickInterval(minutes: number) {
    if (!status || busy || minutes === status.intervalMinutes) return;
    if (!isValidInterval(minutes)) {
      Alert.alert(
        'Choose a valid interval',
        `Enter a whole number of minutes from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES}.`,
      );
      return;
    }
    if (status.active) {
      start(minutes);
    } else {
      setStatus({ ...status, intervalMinutes: minutes });
      saveInterval(minutes).catch(() => undefined);
    }
  }

  function applyCustomInterval() {
    const minutes = Number(customInterval.trim());
    onPickInterval(minutes);
    if (isValidInterval(minutes)) setCustomInterval('');
  }

  const isCustom =
    status !== null && !(INTERVAL_OPTIONS_MINUTES as readonly number[]).includes(status.intervalMinutes);

  function confirmDeleteHistory() {
    Alert.alert('Delete location history?', 'All recorded locations will be removed from this device. Memories are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await locationLogRepository.deleteAll();
          } catch (error) {
            console.warn('Deleting location history failed:', error instanceof Error ? error.message : error);
            Alert.alert('Couldn’t delete', 'Please try again.');
          }
          refresh();
        },
      },
    ]);
  }

  const sections = history ? groupByDay(history, (observation) => observation.capturedAt) : [];

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.container}
      sections={sections}
      keyExtractor={(observation) => observation.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>

          <Text style={styles.title}>Location Log</Text>
          <Text style={styles.subtitle}>An optional record of where your phone has been.</Text>

          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Record my location</Text>
                <Text style={[styles.status, status?.active && styles.statusOn]}>
                  {status === null ? '…' : status.active ? `On · every ${formatInterval(status.intervalMinutes)}` : 'Off'}
                </Text>
              </View>
              {busy || status === null ? (
                <ActivityIndicator color={Palette.textMuted} />
              ) : (
                <Switch
                  value={status.active}
                  onValueChange={onToggle}
                  accessibilityLabel="Record my location in the background"
                />
              )}
            </View>

            <Text style={styles.label}>Interval</Text>
            <View style={styles.chips}>
              {INTERVAL_OPTIONS_MINUTES.map((minutes) => {
                const selected = status?.intervalMinutes === minutes;
                return (
                  <Pressable
                    key={minutes}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => onPickInterval(minutes)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {formatInterval(minutes)}
                    </Text>
                  </Pressable>
                );
              })}
              {isCustom && status && (
                <View style={[styles.chip, styles.chipSelected]}>
                  <Text style={[styles.chipText, styles.chipTextSelected]}>
                    {formatInterval(status.intervalMinutes)}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customInterval}
                onChangeText={(text) => setCustomInterval(text.replace(/[^0-9]/g, ''))}
                placeholder={`Custom (${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES})`}
                placeholderTextColor={Palette.textFaint}
                keyboardType="number-pad"
                maxLength={3}
                returnKeyType="done"
                onSubmitEditing={applyCustomInterval}
                editable={!busy}
                accessibilityLabel="Custom interval in minutes"
              />
              <Text style={styles.customUnit}>min</Text>
              <Pressable
                style={[styles.setButton, (!customInterval || busy) && styles.disabled]}
                onPress={applyCustomInterval}
                disabled={!customInterval || busy}
                accessibilityRole="button">
                <Text style={styles.setButtonText}>SET</Text>
              </Pressable>
            </View>
            {status !== null && status.intervalMinutes < LOW_INTERVAL_WARNING_MINUTES && (
              <Text style={styles.warning}>
                Every {formatInterval(status.intervalMinutes)} uses noticeably more battery and data.
              </Text>
            )}

            <Text style={styles.body}>
              • Needs location access “all the time”, and shows a notification while it’s on.{'\n'}
              • Readings are where your phone was — not what you were doing — and are kept apart from
              your memories.{'\n'}
              • Stays on this device and is deleted automatically after {RETENTION_DAYS} days.{'\n'}
              • Each reading is named by your phone’s geocoding service, which may use the internet.
              Readings within 100 m of the last one reuse its name.{'\n'}
              • Shorter intervals use more battery. Android may delay readings to save power.
            </Text>
          </View>

          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>
              HISTORY{history && history.length > 0 ? ` · ${history.length}` : ''}
            </Text>
            {naming && <ActivityIndicator size="small" color={Palette.textMuted} />}
            {history && history.length > 0 && (
              <Pressable onPress={confirmDeleteHistory} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.deleteLink}>Delete history</Text>
              </Pressable>
            )}
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.dayTitle}>{section.title}</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.rowTime}>{formatTime(item.capturedAt)}</Text>
          <Text style={[styles.rowPlace, !item.placeName && styles.rowPlacePending]} numberOfLines={2}>
            {item.placeName ?? (naming ? 'Finding place…' : 'Place not available yet')}
          </Text>
        </View>
      )}
      ListEmptyComponent={
        historyError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Couldn’t load location history.</Text>
            <Pressable onPress={refresh} accessibilityRole="button">
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : history === null ? (
          <ActivityIndicator color={Palette.textMuted} />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {status?.active
                ? 'No readings yet. The first one arrives within your chosen interval.'
                : 'Nothing recorded. Turn on the log to start.'}
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: Palette.background },
  container: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  flex: { flex: 1 },
  backButton: { alignSelf: 'flex-start', marginBottom: 28 },
  back: { fontSize: 16, color: Palette.textSecondary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  subtitle: { marginTop: 8, fontSize: 15, color: Palette.textMuted },
  card: { marginTop: 24, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Palette.text },
  status: { marginTop: 4, fontSize: 14, fontWeight: '600', color: Palette.textMuted },
  statusOn: { color: '#15803D' },
  label: { marginTop: 18, marginBottom: 8, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  chipSelected: { backgroundColor: Palette.text, borderColor: Palette.text },
  chipText: { fontSize: 14, fontWeight: '600', color: Palette.text },
  chipTextSelected: { color: Palette.surface },
  body: { marginTop: 16, fontSize: 13, lineHeight: 20, color: Palette.textMuted },
  historyHeader: {
    marginTop: 30,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel, letterSpacing: 1 },
  deleteLink: { fontSize: 14, fontWeight: '700', color: Palette.danger },
  dayTitle: { marginTop: 16, marginBottom: 8, fontSize: 14, fontWeight: '700', color: Palette.text },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    backgroundColor: Palette.surface,
  },
  rowTime: { width: 72, fontSize: 14, fontWeight: '600', color: Palette.text },
  rowPlace: { flex: 1, fontSize: 14, color: Palette.text },
  rowPlacePending: { color: Palette.textFaint, fontStyle: 'italic' },
  customRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    fontSize: 15,
    color: Palette.text,
  },
  customUnit: { fontSize: 14, color: Palette.textMuted },
  setButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: Palette.text,
  },
  setButtonText: { fontSize: 14, fontWeight: '700', color: Palette.surface },
  disabled: { opacity: 0.5 },
  warning: { marginTop: 10, fontSize: 13, color: Palette.sensorBadgeText },
  emptyCard: { marginTop: 12, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  emptyText: { color: Palette.textMuted },
  retry: { marginTop: 10, fontSize: 15, fontWeight: '700', color: Palette.text },
});
