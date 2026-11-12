import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FilmSlide } from '@/review/day-review';
import { formatTime } from '@/utils/dates';

const SLIDE_MS = 4000;
const FADE_MS = 900;
const ZOOM_TO = 1.08;
/** Above this many photos, show one continuous progress bar instead of segments. */
const MAX_SEGMENTS = 20;

type Props = {
  slides: FilmSlide[];
  /** Fill the parent (full-screen) instead of the inline card shape. */
  fullScreen?: boolean;
  autoPlay?: boolean;
  onOpenMemory?: (memoryId: string) => void;
  onClose?: () => void;
};

/**
 * A "motion picture" of a day's photos: each photo cross-fades in over the last,
 * with a slow zoom, and is labelled with when and where it was taken.
 */
export function DayFilm({ slides, fullScreen = false, autoPlay = true, onOpenMemory, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [playing, setPlaying] = useState(autoPlay);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [fade] = useState(() => new Animated.Value(1));
  const [zoom] = useState(() => new Animated.Value(0));

  const atEnd = index === slides.length - 1;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= slides.length || next === index) return;
      setPrevious(index);
      setIndex(next);
    },
    [index, slides.length],
  );

  // Cross-fade and slow zoom for every new slide.
  useEffect(() => {
    fade.setValue(previous === null ? 1 : 0);
    zoom.setValue(0);
    const animation = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(zoom, { toValue: 1, duration: SLIDE_MS + FADE_MS, easing: Easing.linear, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [index, previous, fade, zoom]);

  // Auto-advance; stop on the last photo.
  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setTimeout(() => goTo(index + 1), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, atEnd, index, goTo]);

  if (slides.length === 0) return null;

  const current = slides[index];
  const scale = zoom.interpolate({ inputRange: [0, 1], outputRange: [1, ZOOM_TO] });

  function renderPhoto(slide: FilmSlide) {
    if (failed.has(slide.key)) {
      return (
        <View style={[StyleSheet.absoluteFill, styles.missing]}>
          <Text style={styles.missingText}>Photo file not available</Text>
        </View>
      );
    }
    return (
      <Image
        source={{ uri: slide.uri }}
        style={StyleSheet.absoluteFill}
        contentFit={fullScreen ? 'contain' : 'cover'}
        onError={() => setFailed((set) => new Set(set).add(slide.key))}
        accessibilityIgnoresInvertColors
      />
    );
  }

  function togglePlay() {
    if (atEnd) {
      setPrevious(null);
      setIndex(0);
      setPlaying(true);
    } else {
      setPlaying((value) => !value);
    }
  }

  return (
    <View style={[styles.frame, fullScreen ? styles.fullScreen : styles.inline]}>
      {previous !== null && previous !== index && (
        <View style={StyleSheet.absoluteFill}>{renderPhoto(slides[previous])}</View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, transform: [{ scale }] }]}>
        {renderPhoto(current)}
      </Animated.View>

      {/* Tap zones: left = back, right = forward. */}
      <View style={styles.tapZones}>
        <Pressable style={styles.flex} onPress={() => goTo(index - 1)} accessibilityLabel="Previous photo" />
        <Pressable style={styles.flex} onPress={() => goTo(index + 1)} accessibilityLabel="Next photo" />
      </View>

      <View style={styles.progressRow} pointerEvents="none">
        {slides.length <= MAX_SEGMENTS ? (
          slides.map((slide, i) => (
            <View key={slide.key} style={[styles.progressBar, i <= index && styles.progressBarOn]} />
          ))
        ) : (
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${((index + 1) / slides.length) * 100}%` }]} />
          </View>
        )}
      </View>

      <View style={styles.topRight}>
        {onClose && (
          <Pressable onPress={onClose} style={styles.roundButton} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Text style={styles.roundButtonText}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.caption}>
        <View style={styles.flex}>
          <Text style={styles.captionTime}>🕐 {formatTime(current.capturedAt)}</Text>
          <Text style={styles.captionPlace} numberOfLines={1}>
            📍 {current.placeName ?? 'Place not recorded'}
          </Text>
          {current.source === 'auto' && <Text style={styles.captionMemory}>📷 Auto camera</Text>}
          {onOpenMemory && current.memoryId && (
            <Pressable onPress={() => onOpenMemory(current.memoryId!)} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.captionMemory} numberOfLines={1}>
                {current.memoryTitle} ›
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={togglePlay}
          style={styles.roundButton}
          accessibilityRole="button"
          accessibilityLabel={atEnd ? 'Replay' : playing ? 'Pause' : 'Play'}
          hitSlop={8}>
          <Text style={styles.roundButtonText}>{atEnd ? '↺' : playing ? '❚❚' : '▶'}</Text>
        </Pressable>
      </View>

      <Text style={styles.counter} pointerEvents="none">
        {index + 1} / {slides.length}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#0B0C0E' },
  inline: { width: '100%', aspectRatio: 4 / 5, borderRadius: 18 },
  fullScreen: { flex: 1 },
  flex: { flex: 1 },
  missing: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2125' },
  missingText: { color: '#9CA3AF', fontSize: 14 },
  tapZones: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row' },
  progressRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 4 },
  progressBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  progressBarOn: { backgroundColor: '#FFFFFF' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  topRight: { position: 'absolute', top: 26, right: 12 },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  captionTime: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  captionPlace: { marginTop: 4, color: '#F3F4F6', fontSize: 14 },
  captionMemory: { marginTop: 6, color: '#D1D5DB', fontSize: 13, fontWeight: '600' },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  roundButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  counter: { position: 'absolute', top: 28, left: 14, color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
