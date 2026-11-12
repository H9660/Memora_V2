import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DayFilm } from '@/components/day-film';
import { MemoryCard } from '@/components/memory-card';
import { Palette } from '@/constants/palette';
import { MAX_DAY_NOTE_LENGTH } from '@/repositories/day-note-repository';
import { dayKey, parseDayKey, shiftDay } from '@/review/day-review';
import { LoadedDayReview, loadDayReview, saveDayNote } from '@/services/day-review-service';
import { formatTime, getDayLabel } from '@/utils/dates';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; review: LoadedDayReview };

export default function DailyReviewScreen() {
  const params = useLocalSearchParams<{ day?: string }>();
  const [day, setDay] = useState<Date>(() => parseDayKey(params.day) ?? new Date());
  const [state, setState] = useState<State>({ status: 'loading' });
  const [fullScreen, setFullScreen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const key = dayKey(day);
  const isToday = key === dayKey(new Date());

  const load = useCallback(() => {
    loadDayReview(day).then(
      (review) => {
        setState({ status: 'ready', review });
        setNoteDraft(review.note?.note ?? '');
      },
      (error) => {
        console.warn('Loading daily review failed:', error instanceof Error ? error.message : error);
        setState({ status: 'error' });
      },
    );
  }, [day]);

  useFocusEffect(load);

  function changeDay(offset: number) {
    const next = shiftDay(day, offset);
    if (dayKey(next) > dayKey(new Date())) return;
    setState({ status: 'loading' });
    setDay(next);
  }

  const savedNote = state.status === 'ready' ? (state.review.note?.note ?? '') : '';
  const noteChanged = noteDraft !== savedNote;

  async function saveNote() {
    setSavingNote(true);
    try {
      await saveDayNote(key, noteDraft);
      load();
    } catch (error) {
      console.warn('Saving day note failed:', error instanceof Error ? error.message : error);
      Alert.alert('Couldn’t save your note', 'Please try again.');
    } finally {
      setSavingNote(false);
    }
  }

  const openMemory = (id: string) => {
    setFullScreen(false);
    router.push({ pathname: '/memory/[id]', params: { id } });
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Daily Review</Text>

        <View style={styles.dayNav}>
          <Pressable onPress={() => changeDay(-1)} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={8}>
            <Text style={styles.navText}>‹</Text>
          </Pressable>
          <Text style={styles.dayLabel}>{getDayLabel(day.toISOString())}</Text>
          <Pressable
            onPress={() => changeDay(1)}
            style={[styles.navButton, isToday && styles.disabled]}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            hitSlop={8}>
            <Text style={styles.navText}>›</Text>
          </Pressable>
        </View>

        {state.status === 'loading' && <ActivityIndicator style={styles.loading} color={Palette.textMuted} />}

        {state.status === 'error' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Couldn’t load this day</Text>
            <Pressable onPress={load} accessibilityRole="button">
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.status === 'ready' && (
          <>
            {state.review.slides.length > 0 ? (
              <View style={styles.filmWrap}>
                <DayFilm key={key} slides={state.review.slides} autoPlay={false} onOpenMemory={openMemory} />
                <Pressable
                  style={styles.playAll}
                  onPress={() => setFullScreen(true)}
                  accessibilityRole="button">
                  <Text style={styles.playAllText}>▶  PLAY FULL SCREEN</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.muted}>No photos on this day.</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>SUMMARY</Text>
            <View style={styles.card}>
              {state.review.summary.map((line) => (
                <Text key={line} style={styles.summaryLine}>
                  {line}
                </Text>
              ))}
              <Text style={styles.footnote}>
                Built from what Memora recorded — places are where your phone was, not a record of what you did.
              </Text>
            </View>

            {state.review.stops.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>PLACES</Text>
                <View style={styles.card}>
                  {state.review.stops.map((stop, i) => (
                    <View key={`${stop.placeName}-${stop.from}`} style={styles.stopRow}>
                      <View style={styles.timeline}>
                        <View style={styles.dot} />
                        {i < state.review.stops.length - 1 && <View style={styles.line} />}
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.stopPlace}>{stop.placeName}</Text>
                        <Text style={styles.stopTime}>
                          {stop.from === stop.to
                            ? formatTime(stop.from)
                            : `${formatTime(stop.from)} – ${formatTime(stop.to)}`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>YOUR NOTE FOR THIS DAY</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.noteInput}
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="How was the day? Who did you see? How did you feel?"
                placeholderTextColor={Palette.textFaint}
                multiline
                maxLength={MAX_DAY_NOTE_LENGTH}
                editable={!savingNote}
                accessibilityLabel="Your note for this day"
              />
              {noteChanged && (
                <Pressable
                  style={[styles.primaryButton, savingNote && styles.disabled]}
                  onPress={saveNote}
                  disabled={savingNote}
                  accessibilityRole="button">
                  <Text style={styles.primaryText}>SAVE NOTE</Text>
                </Pressable>
              )}
              <Text style={styles.footnote}>Written by you and kept exactly as you write it.</Text>
            </View>

            {state.review.memories.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>MEMORIES</Text>
                {state.review.memories.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </>
            )}

            {state.review.onThisDay.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>ON THIS DAY</Text>
                {state.review.onThisDay.map((group) => (
                  <Pressable
                    key={group.day}
                    style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                    onPress={() => {
                      const date = parseDayKey(group.day);
                      if (date) {
                        setState({ status: 'loading' });
                        setDay(date);
                      }
                    }}
                    accessibilityRole="button">
                    <Text style={styles.cardTitle}>{group.label}</Text>
                    <Text style={styles.muted} numberOfLines={2}>
                      {group.memories.map((m) => m.title).join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {state.status === 'ready' && state.review.slides.length > 0 && (
        <Modal visible={fullScreen} animationType="fade" onRequestClose={() => setFullScreen(false)} statusBarTranslucent>
          <StatusBar barStyle="light-content" />
          <View style={styles.modal}>
            <DayFilm
              slides={state.review.slides}
              fullScreen
              autoPlay
              onOpenMemory={openMemory}
              onClose={() => setFullScreen(false)}
            />
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Palette.background },
  container: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  backButton: { alignSelf: 'flex-start', marginBottom: 28 },
  back: { fontSize: 16, color: Palette.textSecondary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text },
  dayNav: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surface,
  },
  navText: { fontSize: 22, fontWeight: '700', color: Palette.text },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Palette.text },
  loading: { marginTop: 40 },
  filmWrap: { marginTop: 20 },
  playAll: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  playAllText: { color: Palette.surface, fontSize: 14, fontWeight: '700' },
  sectionTitle: { marginTop: 26, marginBottom: 2, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel, letterSpacing: 1 },
  card: { marginTop: 12, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Palette.text },
  muted: { marginTop: 4, fontSize: 14, color: Palette.textMuted },
  retry: { marginTop: 10, fontSize: 15, fontWeight: '700', color: Palette.text },
  summaryLine: { fontSize: 15, lineHeight: 22, color: Palette.text, marginBottom: 6 },
  footnote: { marginTop: 8, fontSize: 12, lineHeight: 17, color: Palette.textFaint },
  stopRow: { flexDirection: 'row', gap: 12, minHeight: 48 },
  timeline: { width: 12, alignItems: 'center' },
  dot: { marginTop: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: Palette.text },
  line: { flex: 1, width: 2, backgroundColor: Palette.border, marginVertical: 2 },
  stopPlace: { fontSize: 15, fontWeight: '600', color: Palette.text },
  stopTime: { marginTop: 2, fontSize: 13, color: Palette.textMuted, marginBottom: 10 },
  noteInput: {
    minHeight: 100,
    fontSize: 15,
    lineHeight: 21,
    color: Palette.text,
    textAlignVertical: 'top',
  },
  primaryButton: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  primaryText: { color: Palette.surface, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  modal: { flex: 1, backgroundColor: '#000000' },
});
