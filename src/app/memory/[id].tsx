import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EvidenceItem } from '@/components/evidence-item';
import { Palette } from '@/constants/palette';
import { memoryService } from '@/services/memory-service';
import { MemoryEvent } from '@/types/memory';
import { formatDateTime } from '@/utils/dates';
import { MAX_NOTE_LENGTH, MAX_TITLE_LENGTH, validateEdit } from '@/utils/validation';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; memory: MemoryEvent };

type Draft = { title: string; note: string };

export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    memoryService
      .get(id)
      .then((memory) => {
        if (active) setState(memory ? { status: 'ready', memory } : { status: 'not-found' });
      })
      .catch((error) => {
        console.warn('Loading memory failed:', error instanceof Error ? error.message : error);
        if (active) setState({ status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const memory = state.status === 'ready' ? state.memory : null;
  const hasPhoto = memory?.evidence.some((evidence) => evidence.type === 'PHOTO') ?? false;
  const isDirty =
    draft !== null && memory !== null && (draft.title !== memory.title || draft.note !== memory.note);

  const cancelEdit = useCallback(() => {
    if (!isDirty) {
      setDraft(null);
      setEditError(null);
      return;
    }
    Alert.alert('Discard your changes?', 'Your edits to this memory haven’t been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setDraft(null);
          setEditError(null);
        },
      },
    ]);
  }, [isDirty]);

  // Android back while editing leaves edit mode instead of the screen.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (draft === null || busy) return false;
        cancelEdit();
        return true;
      });
      return () => subscription.remove();
    }, [draft, busy, cancelEdit]),
  );

  async function saveEdit() {
    if (!memory || !draft || busy) return;

    const problem = validateEdit(draft, hasPhoto);
    if (problem) {
      setEditError(problem);
      return;
    }
    if (!isDirty) {
      setDraft(null);
      return;
    }

    setBusy('saving');
    setEditError(null);
    try {
      const updated = await memoryService.edit(memory.id, draft);
      if (updated) {
        setState({ status: 'ready', memory: updated });
        setDraft(null);
      } else {
        setState({ status: 'not-found' });
      }
    } catch (error) {
      console.warn('Editing memory failed:', error instanceof Error ? error.message : error);
      setEditError('Couldn’t save your changes. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteMemory() {
    if (!memory) return;
    setBusy('deleting');
    try {
      await memoryService.remove(memory.id);
      router.back();
    } catch (error) {
      console.warn('Deleting memory failed:', error instanceof Error ? error.message : error);
      setBusy(null);
      Alert.alert('Couldn’t delete', 'This memory could not be deleted. Please try again.');
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this memory?',
      'The note, photo and all other evidence will be permanently removed from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteMemory },
      ],
    );
  }

  function goBack() {
    if (draft !== null) {
      cancelEdit();
      return;
    }
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={goBack} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          {memory && draft === null && (
            <Pressable
              onPress={() => setDraft({ title: memory.title, note: memory.note })}
              accessibilityRole="button"
              hitSlop={12}
              disabled={busy !== null}>
              <Text style={styles.edit}>Edit</Text>
            </Pressable>
          )}
        </View>

        {state.status === 'loading' && (
          <ActivityIndicator style={styles.loading} color={Palette.textMuted} />
        )}

        {(state.status === 'not-found' || state.status === 'error') && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>
              {state.status === 'not-found' ? 'Memory not found' : 'Couldn’t load memory'}
            </Text>
            <Text style={styles.emptyText}>
              {state.status === 'not-found'
                ? 'It may have been deleted.'
                : 'Something went wrong reading this memory.'}
            </Text>
            {state.status === 'error' && (
              <Pressable
                onPress={() => {
                  setState({ status: 'loading' });
                  setReloadKey((key) => key + 1);
                }}
                accessibilityRole="button">
                <Text style={styles.retry}>Try again</Text>
              </Pressable>
            )}
          </View>
        )}

        {memory && draft !== null && (
          <View>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.titleInput}
              value={draft.title}
              onChangeText={(title) => {
                setDraft({ ...draft, title });
                setEditError(null);
              }}
              maxLength={MAX_TITLE_LENGTH}
              editable={busy === null}
              accessibilityLabel="Memory title"
            />

            <Text style={styles.label}>Your note</Text>
            <TextInput
              style={styles.noteInput}
              value={draft.note}
              onChangeText={(note) => {
                setDraft({ ...draft, note });
                setEditError(null);
              }}
              multiline
              maxLength={MAX_NOTE_LENGTH}
              editable={busy === null}
              accessibilityLabel="Memory note"
            />
            <Text style={styles.hint}>
              Your note as first captured stays in the evidence below, so edits never erase it.
            </Text>

            {editError && <Text style={styles.error}>{editError}</Text>}

            <View style={styles.editActions}>
              <Pressable
                style={[styles.secondaryButton, styles.flexButton]}
                onPress={cancelEdit}
                disabled={busy !== null}
                accessibilityRole="button">
                <Text style={styles.secondaryText}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, styles.flexButton, busy && styles.disabled]}
                onPress={saveEdit}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityState={{ busy: busy === 'saving' }}>
                {busy === 'saving' ? (
                  <ActivityIndicator color={Palette.surface} />
                ) : (
                  <Text style={styles.primaryText}>SAVE</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {memory && draft === null && (
          <>
            <Text style={styles.title}>{memory.title}</Text>

            {memory.note.trim().length > 0 && (
              <View style={styles.card}>
                <Text style={styles.metaLabelFirst}>YOUR NOTE</Text>
                <Text style={styles.note} selectable>
                  {memory.note}
                </Text>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.metaLabelFirst}>CAPTURED</Text>
              <Text style={styles.metaValue}>{formatDateTime(memory.capturedAt)}</Text>

              <Text style={styles.metaLabel}>HAPPENED</Text>
              <Text style={styles.metaValue}>
                {memory.eventTime ? formatDateTime(memory.eventTime) : 'Not recorded'}
              </Text>

              {memory.updatedAt && (
                <>
                  <Text style={styles.metaLabel}>LAST EDITED</Text>
                  <Text style={styles.metaValue}>{formatDateTime(memory.updatedAt)}</Text>
                </>
              )}

              <Text style={styles.metaLabel}>PLACE</Text>
              <Text style={styles.metaValue}>
                {memory.placeName ??
                  (memory.latitude !== null ? 'Unnamed location' : 'No location recorded')}
              </Text>
              {memory.latitude !== null && memory.longitude !== null && (
                <Text style={styles.coords} selectable>
                  {memory.latitude.toFixed(5)}, {memory.longitude.toFixed(5)}
                </Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>EVIDENCE</Text>

            {memory.evidence.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyText}>No evidence was recorded with this memory.</Text>
              </View>
            ) : (
              memory.evidence.map((evidence) => (
                <EvidenceItem key={evidence.id} evidence={evidence} />
              ))
            )}

            <Pressable
              style={[styles.deleteButton, busy === 'deleting' && styles.disabled]}
              onPress={confirmDelete}
              disabled={busy !== null}
              accessibilityRole="button">
              {busy === 'deleting' ? (
                <ActivityIndicator color={Palette.danger} />
              ) : (
                <Text style={styles.deleteText}>DELETE MEMORY</Text>
              )}
            </Pressable>
          </>
        )}
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  back: {
    fontSize: 16,
    color: Palette.textSecondary,
  },
  edit: {
    fontSize: 16,
    fontWeight: '700',
    color: Palette.text,
  },
  loading: {
    marginTop: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Palette.text,
  },
  card: {
    marginTop: 20,
    padding: 18,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  note: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 23,
    color: Palette.text,
  },
  metaLabelFirst: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.sectionLabel,
    letterSpacing: 0.5,
  },
  metaLabel: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    color: Palette.sectionLabel,
    letterSpacing: 0.5,
  },
  metaValue: {
    marginTop: 2,
    fontSize: 15,
    color: Palette.text,
  },
  coords: {
    marginTop: 2,
    fontSize: 13,
    color: Palette.textSecondary,
  },
  sectionTitle: {
    marginTop: 30,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: '700',
    color: Palette.sectionLabel,
    letterSpacing: 1,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Palette.text,
  },
  emptyText: {
    marginTop: 6,
    color: Palette.textMuted,
  },
  retry: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  label: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: Palette.text,
  },
  titleInput: {
    backgroundColor: Palette.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Palette.text,
    marginBottom: 16,
  },
  noteInput: {
    minHeight: 140,
    backgroundColor: Palette.surface,
    borderRadius: 14,
    padding: 16,
    fontSize: 15,
    color: Palette.text,
    textAlignVertical: 'top',
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    color: Palette.danger,
  },
  editActions: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  primaryText: {
    color: Palette.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
    alignItems: 'center',
  },
  secondaryText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.6,
  },
  deleteButton: {
    marginTop: 24,
    paddingVertical: 17,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.dangerBorder,
    backgroundColor: Palette.surface,
    alignItems: 'center',
  },
  deleteText: {
    color: Palette.danger,
    fontSize: 15,
    fontWeight: '700',
  },
});
