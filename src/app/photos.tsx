import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import { dayBounds, dayKey, parseDayKey, shiftDay } from '@/review/day-review';
import { DEFAULT_RECENT_HOURS, recentRange, RECENT_HOURS_OPTIONS, ReviewPhoto } from '@/review/photo-review';
import { deletePhotos, LoadedPhotos, loadPhotos, memoriesEmptiedBy } from '@/services/photo-review-service';
import { formatTime, getDayLabel } from '@/utils/dates';

type Mode = { kind: 'recent'; hours: number } | { kind: 'day'; day: Date };
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: LoadedPhotos };

const COLUMNS = 3;
const GAP = 4;
const PADDING = 16;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export default function PhotosScreen() {
  const params = useLocalSearchParams<{ day?: string; hours?: string }>();
  const [mode, setMode] = useState<Mode>(() => {
    const day = params.day === 'today' ? new Date() : parseDayKey(params.day);
    if (day) return { kind: 'day', day };
    const hours = Number(params.hours);
    return { kind: 'recent', hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_RECENT_HOURS };
  });
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const modeKey = mode.kind === 'day' ? `day:${dayKey(mode.day)}` : `recent:${mode.hours}`;

  const load = useCallback(() => {
    const range = mode.kind === 'day' ? dayBounds(mode.day) : recentRange(mode.hours);
    loadPhotos(range).then(
      (data) => setState({ status: 'ready', data }),
      (error) => {
        console.warn('Loading photos failed:', error instanceof Error ? error.message : error);
        setState({ status: 'error' });
      },
    );
    // modeKey captures everything about `mode` that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  useFocusEffect(load);

  const photos = useMemo(() => (state.status === 'ready' ? state.data.photos : []), [state]);
  const chosen = photos.filter((photo) => selected.has(photo.key));
  const autoCount = photos.filter((photo) => photo.kind === 'auto').length;

  function changeMode(next: Mode) {
    setState({ status: 'loading' });
    setSelecting(false);
    setSelected(new Set());
    setMode(next);
  }

  function toggle(photo: ReviewPhoto) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photo.key)) next.delete(photo.key);
      else next.add(photo.key);
      return next;
    });
  }

  function confirmDelete(targets: ReviewPhoto[], after?: () => void) {
    if (targets.length === 0 || state.status !== 'ready') return;
    const emptied = memoriesEmptiedBy(targets, state.data.memories);
    const extra =
      emptied.length > 0
        ? `\n\n${plural(emptied.length, 'memory has', 'memories have')} no note, so ${emptied.length === 1 ? 'it' : 'they'} will be deleted too.`
        : '';
    Alert.alert(
      `Delete ${plural(targets.length, 'photo', 'photos')}?`,
      `${targets.length === 1 ? 'It is' : 'They are'} removed from this phone permanently and won’t be in future backups.${extra}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const result = await deletePhotos(targets);
              if (result.failed > 0) {
                Alert.alert('Some photos weren’t deleted', `${plural(result.failed, 'photo', 'photos')} couldn’t be removed. Please try again.`);
              }
            } finally {
              setDeleting(false);
              setSelected(new Set());
              setSelecting(false);
              after?.();
              load();
            }
          },
        },
      ],
    );
  }

  const isToday = mode.kind === 'day' && dayKey(mode.day) === dayKey(new Date());
  const current = viewing !== null ? photos[viewing] : undefined;

  const header = (
    <View>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>Your photos</Text>
      <Text style={styles.subtitle}>See what was captured and delete anything you don’t want kept.</Text>

      <View style={styles.segment}>
        {(['recent', 'day'] as const).map((kind) => (
          <Pressable
            key={kind}
            style={[styles.segmentItem, mode.kind === kind && styles.segmentOn]}
            onPress={() =>
              mode.kind !== kind &&
              changeMode(kind === 'recent' ? { kind, hours: DEFAULT_RECENT_HOURS } : { kind, day: new Date() })
            }
            accessibilityRole="button"
            accessibilityState={{ selected: mode.kind === kind }}>
            <Text style={[styles.segmentText, mode.kind === kind && styles.segmentTextOn]}>
              {kind === 'recent' ? 'Recent' : 'Whole day'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode.kind === 'recent' ? (
        <View style={styles.chips}>
          {RECENT_HOURS_OPTIONS.map((hours) => (
            <Pressable
              key={hours}
              style={[styles.chip, mode.hours === hours && styles.chipOn]}
              onPress={() => changeMode({ kind: 'recent', hours })}
              accessibilityRole="button"
              accessibilityState={{ selected: mode.hours === hours }}>
              <Text style={[styles.chipText, mode.hours === hours && styles.chipTextOn]}>
                Last {hours === 1 ? 'hour' : `${hours} h`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.dayNav}>
          <Pressable
            onPress={() => changeMode({ kind: 'day', day: shiftDay(mode.day, -1) })}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Previous day">
            <Text style={styles.navText}>‹</Text>
          </Pressable>
          <Text style={styles.dayLabel}>{getDayLabel(mode.day.toISOString())}</Text>
          <Pressable
            onPress={() => changeMode({ kind: 'day', day: shiftDay(mode.day, 1) })}
            style={[styles.navButton, isToday && styles.disabled]}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day">
            <Text style={styles.navText}>›</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && photos.length > 0 && (
        <View style={styles.toolbar}>
          <Text style={styles.count}>
            {selecting
              ? `${chosen.length} SELECTED`
              : `${plural(photos.length, 'PHOTO', 'PHOTOS')}${autoCount > 0 ? ` · ${autoCount} AUTO` : ''}`}
          </Text>
          {selecting && (
            <Pressable
              onPress={() =>
                setSelected(chosen.length === photos.length ? new Set() : new Set(photos.map((p) => p.key)))
              }
              accessibilityRole="button"
              hitSlop={8}>
              <Text style={styles.toolbarLink}>{chosen.length === photos.length ? 'Select none' : 'Select all'}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
            accessibilityRole="button"
            hitSlop={8}>
            <Text style={styles.toolbarLink}>{selecting ? 'Cancel' : 'Select'}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'loading' && <ActivityIndicator style={styles.loading} color={Palette.textMuted} />}
      {state.status === 'error' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Couldn’t load photos</Text>
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={styles.toolbarLink}>Try again</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'ready' && photos.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.muted}>
            {mode.kind === 'recent'
              ? `No photos in the last ${mode.hours === 1 ? 'hour' : `${mode.hours} hours`}.`
              : 'No photos on this day.'}
          </Text>
        </View>
      )}
    </View>
  );

  const footer =
    mode.kind === 'day' && state.status === 'ready' ? (
      <View style={styles.footer}>
        <Text style={styles.footnote}>
          Happy with this day? Backups only contain what’s still on this phone, so anything you deleted stays gone.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/backup')} accessibilityRole="button">
          <Text style={styles.primaryText}>DONE — BACK UP NOW</Text>
        </Pressable>
      </View>
    ) : undefined;

  return (
    <View style={styles.flex}>
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.container}
        data={state.status === 'ready' ? photos : []}
        keyExtractor={(photo) => photo.key}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderItem={({ item, index }) => {
          const isSelected = selected.has(item.key);
          return (
            <Pressable
              onPress={() => (selecting ? toggle(item) : setViewing(index))}
              onLongPress={() => {
                setSelecting(true);
                toggle(item);
              }}
              style={[{ width: tile, height: tile }, styles.tile]}
              accessibilityRole={selecting ? 'checkbox' : 'imagebutton'}
              accessibilityState={selecting ? { checked: isSelected } : undefined}
              accessibilityLabel={`${item.kind === 'auto' ? 'Auto camera photo' : `Photo in ${item.memoryTitle}`}, ${formatTime(item.capturedAt)}`}>
              <Image source={{ uri: item.uri }} style={styles.fill} contentFit="cover" recyclingKey={item.key} />
              <View style={styles.tileCaption}>
                <Text style={styles.tileTime}>
                  {item.kind === 'auto' ? '📷 ' : ''}
                  {formatTime(item.capturedAt)}
                </Text>
              </View>
              {selecting && (
                <View style={[styles.check, isSelected && styles.checkOn]}>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              )}
              {isSelected && <View style={styles.selectedTint} />}
            </Pressable>
          );
        }}
      />

      {selecting && (
        <View style={styles.actionBar}>
          <Pressable
            style={[styles.deleteButton, (chosen.length === 0 || deleting) && styles.disabled]}
            disabled={chosen.length === 0 || deleting}
            onPress={() => confirmDelete(chosen)}
            accessibilityRole="button">
            {deleting ? (
              <ActivityIndicator color={Palette.surface} />
            ) : (
              <Text style={styles.deleteText}>
                DELETE {chosen.length > 0 ? plural(chosen.length, 'PHOTO', 'PHOTOS') : ''}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      <Modal visible={current !== undefined} animationType="fade" onRequestClose={() => setViewing(null)} statusBarTranslucent>
        <StatusBar barStyle="light-content" />
        {current && viewing !== null && (
          <View style={styles.viewer}>
            <Image source={{ uri: current.uri }} style={styles.fill} contentFit="contain" />
            <Pressable
              style={[styles.viewerZone, styles.zoneLeft]}
              onPress={() => setViewing(Math.max(0, viewing - 1))}
              accessibilityLabel="Newer photo"
            />
            <Pressable
              style={[styles.viewerZone, styles.zoneRight]}
              onPress={() => setViewing(Math.min(photos.length - 1, viewing + 1))}
              accessibilityLabel="Older photo"
            />
            <View style={styles.viewerTop}>
              <Text style={styles.viewerCounter}>
                {viewing + 1} / {photos.length}
              </Text>
              <Pressable onPress={() => setViewing(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
                <Text style={styles.viewerClose}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.viewerBottom}>
              <Text style={styles.viewerTime}>
                {getDayLabel(current.capturedAt)} · {formatTime(current.capturedAt)}
              </Text>
              <Text style={styles.viewerSub}>
                {current.kind === 'auto'
                  ? '📷 Auto camera'
                  : `${current.memoryTitle}${current.placeName ? ` · ${current.placeName}` : ''}`}
              </Text>
              <View style={styles.viewerActions}>
                {current.kind === 'memory' && (
                  <Pressable
                    style={styles.viewerButton}
                    onPress={() => {
                      setViewing(null);
                      router.push({ pathname: '/memory/[id]', params: { id: current.memoryId } });
                    }}
                    accessibilityRole="button">
                    <Text style={styles.viewerButtonText}>OPEN MEMORY</Text>
                  </Pressable>
                )}
                <Pressable
                  style={[styles.viewerButton, styles.viewerDelete]}
                  disabled={deleting}
                  onPress={() =>
                    confirmDelete([current], () =>
                      // Stay in the viewer on the next photo, or close it if that was the last one.
                      setViewing(photos.length > 1 ? Math.min(viewing, photos.length - 2) : null),
                    )
                  }
                  accessibilityRole="button">
                  <Text style={styles.viewerButtonText}>DELETE</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Palette.background },
  container: { padding: PADDING, paddingTop: 60, paddingBottom: 120 },
  backButton: { alignSelf: 'flex-start', marginBottom: 28, marginLeft: 8 },
  back: { fontSize: 16, color: Palette.textSecondary },
  title: { fontSize: 30, fontWeight: '800', color: Palette.text, marginHorizontal: 8 },
  subtitle: { marginTop: 8, fontSize: 15, color: Palette.textMuted, marginHorizontal: 8 },
  segment: {
    marginTop: 20,
    flexDirection: 'row',
    backgroundColor: Palette.border,
    borderRadius: 12,
    padding: 3,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  segmentOn: { backgroundColor: Palette.surface },
  segmentText: { fontSize: 14, fontWeight: '600', color: Palette.textMuted },
  segmentTextOn: { color: Palette.text, fontWeight: '700' },
  chips: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  chipOn: { backgroundColor: Palette.text, borderColor: Palette.text },
  chipText: { fontSize: 14, fontWeight: '600', color: Palette.text },
  chipTextOn: { color: Palette.surface },
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
  toolbar: { marginTop: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 18, marginHorizontal: 4 },
  count: { flex: 1, fontSize: 13, fontWeight: '700', color: Palette.sectionLabel, letterSpacing: 1 },
  toolbarLink: { fontSize: 15, fontWeight: '700', color: Palette.text, marginTop: 4 },
  loading: { marginTop: 40 },
  card: { marginTop: 16, padding: 18, borderRadius: 16, backgroundColor: Palette.surface },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Palette.text },
  muted: { fontSize: 14, color: Palette.textMuted },
  row: { gap: GAP, marginBottom: GAP },
  tile: { borderRadius: 6, overflow: 'hidden', backgroundColor: Palette.border },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tileCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tileTime: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: Palette.danger, borderColor: Palette.danger },
  checkMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  selectedTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: Palette.danger,
    borderRadius: 6,
  },
  footer: { marginTop: 20, paddingHorizontal: 4 },
  footnote: { fontSize: 13, lineHeight: 18, color: Palette.textMuted },
  primaryButton: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  primaryText: { color: Palette.surface, fontSize: 14, fontWeight: '700' },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: Palette.surface,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  deleteButton: { paddingVertical: 16, borderRadius: 14, backgroundColor: Palette.danger, alignItems: 'center' },
  deleteText: { color: Palette.surface, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerZone: { position: 'absolute', top: 100, bottom: 200, width: '35%' },
  zoneLeft: { left: 0 },
  zoneRight: { right: 0 },
  viewerTop: {
    position: 'absolute',
    top: 48,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewerCounter: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  viewerClose: { color: '#FFFFFF', fontSize: 24 },
  viewerBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewerTime: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  viewerSub: { marginTop: 4, color: '#E5E7EB', fontSize: 14 },
  viewerActions: { marginTop: 16, flexDirection: 'row', gap: 12 },
  viewerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  viewerDelete: { backgroundColor: Palette.danger, borderColor: Palette.danger },
  viewerButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
