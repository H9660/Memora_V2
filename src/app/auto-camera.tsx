import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import {
  AutoCameraSettings,
  autoCaptureStorage,
  CameraLens,
  deleteAllAutoCaptures,
  formatIntervalSeconds,
  getAutoCameraSettings,
  getNativeStatus,
  INTERVAL_PRESETS_SECONDS,
  isAutoCameraAvailable,
  isIgnoringBatteryOptimizations,
  isValidIntervalSeconds,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  openBatteryOptimizationSettings,
  RETENTION_OPTIONS_DAYS,
  saveAutoCameraSettings,
  startAutoCamera,
  stopAutoCamera,
  syncAutoCaptures,
} from '@/services/auto-camera';
import { formatTime } from '@/utils/dates';

type Unit = 'sec' | 'min';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function AutoCameraScreen() {
  const [settings, setSettings] = useState<AutoCameraSettings | null>(null);
  const [status, setStatus] = useState(getNativeStatus());
  const [storage, setStorage] = useState({ count: 0, bytes: 0 });
  const [batteryOk, setBatteryOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [unit, setUnit] = useState<Unit>('min');

  const refreshStatus = useCallback(() => {
    setStatus(getNativeStatus());
    setStorage(autoCaptureStorage());
    setBatteryOk(isIgnoringBatteryOptimizations());
  }, []);

  useFocusEffect(
    useCallback(() => {
      getAutoCameraSettings().then(setSettings, () => undefined);
      syncAutoCaptures().catch(() => undefined).finally(refreshStatus);
    }, [refreshStatus]),
  );

  // Live counter while the screen is open.
  useEffect(() => {
    const timer = setInterval(refreshStatus, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const running = status?.running ?? false;

  async function update(next: AutoCameraSettings, restart: boolean) {
    setSettings(next);
    await saveAutoCameraSettings(next).catch(() => undefined);
    if (restart && running) await start(next);
  }

  async function start(next: AutoCameraSettings) {
    setBusy(true);
    const result = await startAutoCamera(next);
    setBusy(false);

    if (result.status === 'camera-denied') {
      Alert.alert(
        'Camera not allowed',
        'The auto camera needs camera access.',
        result.canAskAgain
          ? [{ text: 'OK' }]
          : [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ],
      );
    } else if (result.status === 'error') {
      Alert.alert('Couldn’t start the auto camera', result.message);
    } else if (result.status === 'invalid-interval') {
      Alert.alert('Choose a valid interval', `Between ${MIN_INTERVAL_SECONDS} seconds and 24 hours.`);
    }
    setTimeout(refreshStatus, 800);
  }

  function confirmStart() {
    if (!settings) return;
    Alert.alert(
      'Start the auto camera?',
      `Memora will take a photo with the ${settings.lens} camera every ${formatIntervalSeconds(settings.intervalSeconds)}, ` +
        'even with the screen off, until you stop it. A notification stays visible while it’s on.\n\n' +
        'Please make sure the people around you are OK with being photographed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => start(settings) },
      ],
    );
  }

  async function stop() {
    setBusy(true);
    try {
      await stopAutoCamera();
    } finally {
      setBusy(false);
      setTimeout(refreshStatus, 500);
    }
  }

  function applyCustom() {
    if (!settings) return;
    const value = Number(custom.trim());
    const seconds = unit === 'min' ? Math.round(value * 60) : Math.round(value);
    if (!isValidIntervalSeconds(seconds)) {
      Alert.alert('Choose a valid interval', `Between ${MIN_INTERVAL_SECONDS} seconds and 24 hours.`);
      return;
    }
    setCustom('');
    update({ ...settings, intervalSeconds: seconds }, true);
  }

  function confirmDeleteAll() {
    Alert.alert('Delete all auto-camera photos?', 'They’ll be removed from this device. Memories aren’t affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAllAutoCaptures();
          } catch {
            Alert.alert('Couldn’t delete', 'Please try again.');
          }
          refreshStatus();
        },
      },
    ]);
  }

  if (!isAutoCameraAvailable) {
    return (
      <View style={[styles.flex, styles.container]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Auto Camera</Text>
        <View style={styles.card}>
          <Text style={styles.body}>
            The auto camera needs the latest Memora app build on Android. Update the app to use it.
          </Text>
        </View>
      </View>
    );
  }

  const isCustomInterval =
    settings !== null && !(INTERVAL_PRESETS_SECONDS as readonly number[]).includes(settings.intervalSeconds);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Auto Camera</Text>
        <Text style={styles.subtitle}>Photos taken for you at an interval you choose.</Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, running && styles.dotOn]} />
            <Text style={[styles.statusText, running && styles.statusOn]}>
              {running ? `On · every ${formatIntervalSeconds(status!.intervalSeconds)}` : 'Off'}
            </Text>
          </View>
          {running && (
            <Text style={styles.body}>
              {status!.sessionCount} photo{status!.sessionCount === 1 ? '' : 's'} this session
              {status!.lastCaptureAt ? ` · last at ${formatTime(new Date(status!.lastCaptureAt).toISOString())}` : ''}
            </Text>
          )}
          {status?.lastError && <Text style={styles.error}>{status.lastError}</Text>}

          {busy || settings === null ? (
            <ActivityIndicator style={styles.spinner} color={Palette.textMuted} />
          ) : running ? (
            <Pressable style={styles.stopButton} onPress={stop} accessibilityRole="button">
              <Text style={styles.stopText}>STOP</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primaryButton} onPress={confirmStart} accessibilityRole="button">
              <Text style={styles.primaryText}>START</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>
            Start it here while Memora is open; it then keeps going with the screen off. Stop it here or from the
            notification.
          </Text>
        </View>

        {settings && (
          <>
            <Text style={styles.sectionTitle}>TAKE A PHOTO EVERY</Text>
            <View style={styles.card}>
              <View style={styles.chips}>
                {INTERVAL_PRESETS_SECONDS.map((seconds) => {
                  const selected = settings.intervalSeconds === seconds;
                  return (
                    <Pressable
                      key={seconds}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => update({ ...settings, intervalSeconds: seconds }, true)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}>
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {formatIntervalSeconds(seconds)}
                      </Text>
                    </Pressable>
                  );
                })}
                {isCustomInterval && (
                  <View style={[styles.chip, styles.chipSelected]}>
                    <Text style={[styles.chipText, styles.chipTextSelected]}>
                      {formatIntervalSeconds(settings.intervalSeconds)}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.customRow}>
                <TextInput
                  style={styles.customInput}
                  value={custom}
                  onChangeText={(text) => setCustom(text.replace(/[^0-9.]/g, ''))}
                  placeholder="Custom"
                  placeholderTextColor={Palette.textFaint}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  onSubmitEditing={applyCustom}
                  accessibilityLabel="Custom interval"
                />
                {(['sec', 'min'] as Unit[]).map((u) => (
                  <Pressable
                    key={u}
                    style={[styles.unit, unit === u && styles.chipSelected]}
                    onPress={() => setUnit(u)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: unit === u }}>
                    <Text style={[styles.chipText, unit === u && styles.chipTextSelected]}>{u}</Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.setButton, !custom && styles.disabled]}
                  onPress={applyCustom}
                  disabled={!custom}
                  accessibilityRole="button">
                  <Text style={styles.setText}>SET</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                From {MIN_INTERVAL_SECONDS} seconds up to {MAX_INTERVAL_SECONDS / 3600} hours. Short intervals use more
                battery and storage.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>CAMERA</Text>
            <View style={styles.card}>
              <View style={styles.chips}>
                {(['back', 'front'] as CameraLens[]).map((lens) => {
                  const selected = settings.lens === lens;
                  return (
                    <Pressable
                      key={lens}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => update({ ...settings, lens }, true)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}>
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {lens === 'back' ? 'Back camera' : 'Front camera'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={styles.sectionTitle}>KEEP PHOTOS FOR</Text>
            <View style={styles.card}>
              <View style={styles.chips}>
                {RETENTION_OPTIONS_DAYS.map((days) => {
                  const selected = settings.retentionDays === days;
                  return (
                    <Pressable
                      key={String(days)}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => update({ ...settings, retentionDays: days }, false)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}>
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {days === null ? 'Forever' : `${days} days`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.body}>
                {storage.count} photo{storage.count === 1 ? '' : 's'} stored · {formatBytes(storage.bytes)}
              </Text>
              {storage.count > 0 && (
                <Pressable onPress={confirmDeleteAll} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.deleteLink}>Delete all auto-camera photos</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {!batteryOk && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Let it run in the background</Text>
            <Text style={styles.body}>
              Your phone may pause Memora to save battery, which can make photos stop while the screen is off. Choose
              “Don’t optimise” / “Unrestricted” for Memora.
            </Text>
            <Pressable style={styles.secondaryButton} onPress={openBatteryOptimizationSettings} accessibilityRole="button">
              <Text style={styles.secondaryText}>OPEN BATTERY SETTINGS</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.footnote}>
          Photos stay on this device in Memora’s private storage, are shown in your Daily Review with the time and the
          place from your location log, and aren’t included in backups (they can be very large).
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Palette.background },
  container: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  backButton: { alignSelf: 'flex-start', marginBottom: 28 },
  back: { fontSize: 16, color: Palette.textSecondary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  subtitle: { marginTop: 8, fontSize: 15, color: Palette.textMuted },
  sectionTitle: { marginTop: 26, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel, letterSpacing: 1 },
  card: { marginTop: 12, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Palette.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Palette.textFaint },
  dotOn: { backgroundColor: '#16A34A' },
  statusText: { fontSize: 18, fontWeight: '700', color: Palette.textMuted },
  statusOn: { color: '#15803D' },
  body: { marginTop: 8, fontSize: 14, lineHeight: 20, color: Palette.textMuted },
  error: { marginTop: 8, fontSize: 13, color: Palette.danger },
  hint: { marginTop: 10, fontSize: 12, lineHeight: 17, color: Palette.textFaint },
  spinner: { marginTop: 18 },
  primaryButton: { marginTop: 16, paddingVertical: 15, borderRadius: 14, backgroundColor: Palette.text, alignItems: 'center' },
  primaryText: { fontSize: 15, fontWeight: '700', color: Palette.surface },
  stopButton: {
    marginTop: 16,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.dangerBorder,
    alignItems: 'center',
  },
  stopText: { fontSize: 15, fontWeight: '700', color: Palette.danger },
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
  customRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  unit: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  setButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 12, backgroundColor: Palette.text },
  setText: { fontSize: 14, fontWeight: '700', color: Palette.surface },
  disabled: { opacity: 0.5 },
  deleteLink: { marginTop: 12, fontSize: 14, fontWeight: '700', color: Palette.danger },
  secondaryButton: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '700', color: Palette.text },
  footnote: { marginTop: 20, fontSize: 12, lineHeight: 18, color: Palette.textFaint },
});
