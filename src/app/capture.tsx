import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';

import { Palette } from '@/constants/palette';
import { getCurrentLocation, getLocationPermission, LocationData } from '@/services/location';
import { CaptureValidationError, memoryService } from '@/services/memory-service';
import { PendingPhoto, PhotoPickResult, pickFromLibrary, takePhoto } from '@/services/photos';
import { formatDateTime } from '@/utils/dates';
import { MAX_NOTE_LENGTH, validateCaptureInput } from '@/utils/validation';

type LocationState =
  | { status: 'checking' }
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'success'; location: LocationData }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable' };

function describeLocation(state: LocationState): string {
  switch (state.status) {
    case 'checking':
    case 'loading':
      return 'Detecting...';
    case 'success':
      return (
        state.location.placeName ??
        `${state.location.latitude.toFixed(5)}, ${state.location.longitude.toFixed(5)}`
      );
    case 'off':
      return 'Not attached';
    case 'denied':
      return 'Permission denied';
    case 'unavailable':
      return 'Unavailable';
  }
}

function locationHint(state: LocationState): string {
  switch (state.status) {
    case 'success':
      return 'Records where your phone is right now — not what you were doing. Stays on this device.';
    case 'off':
      return 'Optional. Memora checks your location here only when you ask.';
    case 'denied':
      return 'This memory will be saved without a location.';
    case 'unavailable':
      return 'Couldn’t get a location fix. This memory will be saved without one.';
    default:
      return 'Location is used only while you capture. It stays on this device.';
  }
}

function openSettingsPrompt(title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => Linking.openSettings() },
  ]);
}

export default function CaptureScreen() {
  // The moment Memora starts recording this memory.
  const [capturedAt] = useState(() => new Date().toISOString());
  const [location, setLocation] = useState<LocationState>({ status: 'checking' });
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mounted = useRef(true);
  const locationRequest = useRef<Promise<LocationState> | null>(null);
  const savingGuard = useRef(false);

  const requestLocation = useCallback(() => {
    setLocation({ status: 'loading' });
    const request = getCurrentLocation().then((result): LocationState => {
      if (result.status === 'success') return result;
      if (result.status === 'denied') return { status: 'denied', canAskAgain: result.canAskAgain };
      return { status: 'unavailable' };
    });
    locationRequest.current = request;
    request.then((next) => {
      // Ignore results from a request the user has since cancelled or replaced.
      if (mounted.current && locationRequest.current === request) setLocation(next);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Only fetch automatically if the user already granted permission; never prompt unasked.
    getLocationPermission().then((permission) => {
      if (!mounted.current) return;
      if (permission === 'granted') requestLocation();
      else setLocation({ status: 'off' });
    });
    return () => {
      mounted.current = false;
    };
  }, [requestLocation]);

  function removeLocation() {
    locationRequest.current = null;
    setLocation({ status: 'off' });
  }

  function onAddLocation() {
    if (location.status === 'denied' && !location.canAskAgain) {
      openSettingsPrompt(
        'Location is turned off for Memora',
        'To attach where you are, allow location access for Memora in system settings.',
      );
      return;
    }
    requestLocation();
  }

  async function handlePhoto(pick: () => Promise<PhotoPickResult>) {
    setPhotoBusy(true);
    const result = await pick();
    if (!mounted.current) return;
    setPhotoBusy(false);

    if (result.status === 'success') {
      setPhoto(result.photo);
      setError(null);
    } else if (result.status === 'denied') {
      if (result.canAskAgain) {
        Alert.alert('Camera not allowed', 'You can still choose a photo from your gallery.');
      } else {
        openSettingsPrompt(
          'Camera is turned off for Memora',
          'To take photos in Memora, allow camera access in system settings.',
        );
      }
    } else if (result.status === 'error') {
      Alert.alert('Couldn’t add photo', 'Something went wrong opening the photo. Please try again.');
    }
  }

  const hasDraft = note.trim().length > 0 || photo !== null;

  const handleBack = useCallback(() => {
    if (!hasDraft || saving) {
      router.back();
      return;
    }

    Alert.alert('Discard this memory?', 'It hasn’t been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }, [hasDraft, saving]);

  // Android hardware back should confirm before throwing away a draft.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!hasDraft || saving) return false;
        handleBack();
        return true;
      });
      return () => subscription.remove();
    }, [hasDraft, saving, handleBack]),
  );

  async function handleSave() {
    // Guards against double taps that land before `saving` re-renders the button.
    if (savingGuard.current) return;

    const problem = validateCaptureInput({ note, hasPhoto: photo !== null });
    if (problem) {
      setError(problem);
      return;
    }

    savingGuard.current = true;
    setSaving(true);
    setError(null);

    try {
      // If location is still being detected, let it finish (the request has its own timeout).
      const pending = locationRequest.current;
      const finalLocation =
        location.status === 'loading' && pending ? await pending : location;

      await memoryService.capture({
        note,
        capturedAt,
        location: finalLocation.status === 'success' ? finalLocation.location : null,
        photo,
      });

      if (Platform.OS === 'android') {
        ToastAndroid.show('Memory saved', ToastAndroid.SHORT);
      }
      router.back();
    } catch (saveError) {
      console.warn('Saving memory failed:', saveError instanceof Error ? saveError.message : saveError);
      setError(
        saveError instanceof CaptureValidationError
          ? saveError.message
          : 'Couldn’t save this memory. Nothing was lost — please try again.',
      );
      savingGuard.current = false;
      setSaving(false);
    }
  }

  const locationBusy = location.status === 'checking' || location.status === 'loading';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <Pressable onPress={handleBack} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Remember This</Text>
        <Text style={styles.subtitle}>Capture something you want to remember.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current Context</Text>

          <View style={styles.contextRow}>
            <Text style={styles.contextText}>📍 Location: {describeLocation(location)}</Text>
            {locationBusy && <ActivityIndicator size="small" color={Palette.textMuted} />}
          </View>
          <Text style={styles.contextText}>🕐 Time: {formatDateTime(capturedAt)}</Text>

          <Text style={styles.hint}>{locationHint(location)}</Text>

          {!saving && (
            <View style={styles.inlineActions}>
              {location.status === 'success' || location.status === 'loading' ? (
                <Pressable onPress={removeLocation} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>Don’t attach location</Text>
                </Pressable>
              ) : location.status !== 'checking' ? (
                <Pressable onPress={onAddLocation} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>
                    {location.status === 'off' ? 'Add my location' : 'Try again'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        <Text style={styles.label}>What is happening?</Text>

        <TextInput
          style={styles.input}
          placeholder="Describe this moment..."
          placeholderTextColor={Palette.textFaint}
          multiline
          value={note}
          onChangeText={(text) => {
            setNote(text);
            if (error) setError(null);
          }}
          maxLength={MAX_NOTE_LENGTH}
          editable={!saving}
          autoFocus
          accessibilityLabel="Memory note"
        />

        <Text style={styles.label}>Photo (optional)</Text>

        {photo ? (
          <View style={styles.card}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.preview}
              contentFit="cover"
              accessibilityLabel="Selected photo"
            />
            {!saving && (
              <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, styles.removeLink]}>Remove photo</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.photoButtons}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={() => handlePhoto(takePhoto)}
              disabled={photoBusy || saving}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>📷 Take photo</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={() => handlePhoto(pickFromLibrary)}
              disabled={photoBusy || saving}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>🖼 Choose photo</Text>
            </Pressable>
          </View>
        )}
        {!photo && (
          <Text style={styles.hint}>
            Camera access is requested only if you tap “Take photo”. Photos are copied into
            Memora’s private storage and never uploaded.
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.saveButton, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving, busy: saving }}>
          {saving ? (
            <ActivityIndicator color={Palette.surface} />
          ) : (
            <Text style={styles.saveText}>SAVE MEMORY</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
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
  card: {
    marginTop: 28,
    padding: 18,
    backgroundColor: Palette.surface,
    borderRadius: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
    marginBottom: 12,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contextText: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 7,
    flexShrink: 1,
  },
  hint: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
  },
  inlineActions: {
    marginTop: 12,
    flexDirection: 'row',
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
    color: Palette.text,
    paddingVertical: 4,
  },
  removeLink: {
    marginTop: 12,
    color: Palette.danger,
  },
  label: {
    marginTop: 24,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  input: {
    minHeight: 110,
    backgroundColor: Palette.surface,
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: Palette.text,
    textAlignVertical: 'top',
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.text,
  },
  pressed: {
    opacity: 0.7,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: Palette.border,
  },
  error: {
    marginTop: 14,
    fontSize: 14,
    color: Palette.danger,
  },
  saveButton: {
    marginTop: 24,
    paddingVertical: 17,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  saveText: {
    color: Palette.surface,
    fontSize: 15,
    fontWeight: '700',
  },
});
