import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import {
  disableReminders,
  enableReminders,
  getReminderSettings,
  ReminderSettings,
  saveTimesWhileOff,
} from '@/services/reminders';
import {
  formatEvery,
  formatReminderTime,
  generateTimes,
  MAX_REMINDERS,
  normalizeTimes,
  REPEAT_OPTIONS_MINUTES,
  ReminderTime,
  sameTime,
} from '@/utils/reminder-times';

/** Opens the system time picker and resolves with the chosen time, or null if dismissed. */
function pickTime(initial: ReminderTime): Promise<ReminderTime | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'android') {
      Alert.alert('Time picker is available on Android');
      resolve(null);
      return;
    }
    DateTimePickerAndroid.open({
      mode: 'time',
      value: new Date(2000, 0, 1, initial.hour, initial.minute),
      onChange: (event, date) => {
        resolve(event.type === 'set' && date ? { hour: date.getHours(), minute: date.getMinutes() } : null);
      },
    });
  });
}

export default function RemindersScreen() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [every, setEvery] = useState<number>(60);
  const [windowStart, setWindowStart] = useState<ReminderTime>({ hour: 9, minute: 0 });
  const [windowEnd, setWindowEnd] = useState<ReminderTime>({ hour: 21, minute: 0 });

  useFocusEffect(
    useCallback(() => {
      getReminderSettings().then(setSettings, () => setSettings({ enabled: false, times: [] }));
    }, []),
  );

  /** Persists times (and reschedules if reminders are on). */
  async function save(enabled: boolean, requested: ReminderTime[]) {
    const times = normalizeTimes(requested);
    setBusy(true);
    try {
      if (!enabled) {
        if (settings?.enabled) await disableReminders();
        await saveTimesWhileOff(times);
        setSettings({ enabled: false, times });
        return;
      }

      const result = await enableReminders(times);
      if (result.status === 'enabled') {
        setSettings({ enabled: true, times });
      } else {
        setSettings((current) => (current ? { ...current, enabled: false } : current));
        Alert.alert(
          'Notifications are off for Memora',
          'Allow notifications in system settings to get reminders.',
          result.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open settings', onPress: () => Linking.openSettings() },
              ],
        );
      }
    } catch (error) {
      console.warn('Updating reminders failed:', error instanceof Error ? error.message : error);
      Alert.alert('Couldn’t update reminders', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function addTime() {
    if (!settings || busy) return;
    if (settings.times.length >= MAX_REMINDERS) {
      Alert.alert('That’s the maximum', `You can have up to ${MAX_REMINDERS} reminders a day.`);
      return;
    }
    const time = await pickTime({ hour: new Date().getHours(), minute: 0 });
    if (!time) return;
    if (settings.times.some((existing) => sameTime(existing, time))) {
      Alert.alert('Already added', `You already have a reminder at ${formatReminderTime(time)}.`);
      return;
    }
    save(settings.enabled, [...settings.times, time]);
  }

  async function editTime(time: ReminderTime) {
    if (!settings || busy) return;
    const next = await pickTime(time);
    if (!next || sameTime(next, time)) return;
    save(settings.enabled, [...settings.times.filter((t) => !sameTime(t, time)), next]);
  }

  function removeTime(time: ReminderTime) {
    if (!settings || busy) return;
    const remaining = settings.times.filter((t) => !sameTime(t, time));
    // Removing the last time turns reminders off rather than leaving an "on" schedule with nothing in it.
    save(settings.enabled && remaining.length > 0, remaining);
  }

  async function pickWindow(which: 'start' | 'end') {
    const time = await pickTime(which === 'start' ? windowStart : windowEnd);
    if (time) (which === 'start' ? setWindowStart : setWindowEnd)(time);
  }

  const preview = generateTimes(every, windowStart, windowEnd);

  function applyRepeat() {
    if (!settings || busy || preview.length === 0) return;
    const replace = () => save(settings.enabled, preview);
    if (settings.times.length === 0) {
      replace();
      return;
    }
    Alert.alert(
      'Replace your reminder times?',
      `Your ${settings.times.length} current ${settings.times.length === 1 ? 'time' : 'times'} will be replaced by ${preview.length}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: replace },
      ],
    );
  }

  function onToggle(value: boolean) {
    if (!settings) return;
    if (value && settings.times.length === 0) {
      Alert.alert('Add a time first', 'Add at least one reminder time, then turn reminders on.');
      return;
    }
    save(value, settings.times);
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Reminders</Text>
      <Text style={styles.subtitle}>A gentle nudge to capture what’s happening.</Text>

      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Daily reminders</Text>
            <Text style={[styles.status, settings?.enabled && styles.statusOn]}>
              {settings === null
                ? '…'
                : settings.enabled
                  ? `On · ${settings.times.length} a day`
                  : 'Off'}
            </Text>
          </View>
          {busy || settings === null ? (
            <ActivityIndicator color={Palette.textMuted} />
          ) : (
            <Switch value={settings.enabled} onValueChange={onToggle} accessibilityLabel="Daily reminders" />
          )}
        </View>
      </View>

      <Text style={styles.sectionTitle}>YOUR TIMES</Text>
      <View style={styles.card}>
        {settings && settings.times.length === 0 && (
          <Text style={styles.body}>No times yet. Add one, or use “Repeat” below.</Text>
        )}
        <View style={styles.chips}>
          {settings?.times.map((time) => (
            <View key={`${time.hour}:${time.minute}`} style={styles.timeChip}>
              <Pressable
                onPress={() => editTime(time)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Change ${formatReminderTime(time)}`}
                hitSlop={6}>
                <Text style={styles.timeChipText}>{formatReminderTime(time)}</Text>
              </Pressable>
              <Pressable
                onPress={() => removeTime(time)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${formatReminderTime(time)}`}
                hitSlop={8}
                style={styles.removeButton}>
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={addTime}
          disabled={busy || settings === null}
          accessibilityRole="button">
          <Text style={styles.secondaryText}>+ ADD A TIME</Text>
        </Pressable>
        <Text style={styles.hint}>Tap a time to change it. Up to {MAX_REMINDERS} a day.</Text>
      </View>

      <Text style={styles.sectionTitle}>REPEAT</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Every</Text>
        <View style={styles.chips}>
          {REPEAT_OPTIONS_MINUTES.map((minutes) => {
            const selected = every === minutes;
            return (
              <Pressable
                key={minutes}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setEvery(minutes)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{formatEvery(minutes)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.windowRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>From</Text>
            <Pressable style={styles.timeField} onPress={() => pickWindow('start')} accessibilityRole="button">
              <Text style={styles.timeFieldText}>{formatReminderTime(windowStart)}</Text>
            </Pressable>
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Until</Text>
            <Pressable style={styles.timeField} onPress={() => pickWindow('end')} accessibilityRole="button">
              <Text style={styles.timeFieldText}>{formatReminderTime(windowEnd)}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.body}>
          {preview.length === 0
            ? 'No times in this range.'
            : `${preview.length} reminders: ${preview
                .slice(0, 6)
                .map(formatReminderTime)
                .join(', ')}${preview.length > 6 ? ', …' : ''}`}
        </Text>

        <Pressable
          style={[styles.primaryButton, (busy || preview.length === 0) && styles.disabled]}
          onPress={applyRepeat}
          disabled={busy || preview.length === 0}
          accessibilityRole="button">
          <Text style={styles.primaryText}>USE THESE TIMES</Text>
        </Pressable>
      </View>

      <Text style={styles.footnote}>
        Tapping a reminder opens “Remember This”. Nothing is captured unless you save it. Reminders are
        scheduled on this device; Android may deliver them a few minutes late to save battery.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Palette.background },
  container: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  flex: { flex: 1 },
  backButton: { alignSelf: 'flex-start', marginBottom: 28 },
  back: { fontSize: 16, color: Palette.textSecondary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  subtitle: { marginTop: 8, fontSize: 15, color: Palette.textMuted },
  sectionTitle: {
    marginTop: 26,
    fontSize: 13,
    fontWeight: '700',
    color: Palette.sectionLabel,
    letterSpacing: 1,
  },
  card: { marginTop: 12, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Palette.text },
  status: { marginTop: 4, fontSize: 14, fontWeight: '600', color: Palette.textMuted },
  statusOn: { color: '#15803D' },
  label: { marginBottom: 8, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel },
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
  timeChip: {
    minHeight: 40,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: Palette.text,
  },
  timeChipText: { fontSize: 14, fontWeight: '600', color: Palette.surface },
  removeButton: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 13, color: Palette.textFaint },
  windowRow: { marginTop: 18, flexDirection: 'row', gap: 12 },
  timeField: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  timeFieldText: { fontSize: 15, fontWeight: '600', color: Palette.text },
  body: { marginTop: 14, fontSize: 13, lineHeight: 20, color: Palette.textMuted },
  hint: { marginTop: 10, fontSize: 12, color: Palette.textFaint },
  secondaryButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '700', color: Palette.text },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '700', color: Palette.surface },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  footnote: { marginTop: 20, fontSize: 12, lineHeight: 18, color: Palette.textFaint },
});
