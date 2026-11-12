import type { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Progress, validatePassword } from '@/backup/backup-service';
import {
  createBackupFile,
  pickBackupFile,
  readBackupInfo,
  restoreBackupFile,
  shareBackupFile,
} from '@/backup/device-backup';
import { BackupAuthError, BackupFormatError, BackupHeader } from '@/backup/format';
import { Palette } from '@/constants/palette';
import { settingsRepository } from '@/repositories/settings-repository';
import { formatDateTime } from '@/utils/dates';

type BackupMeta = { lastBackupAt: string | null };
const META_KEY = 'backup';

function describeProgress(stage: Parameters<Progress>[0], done: number, total: number): string {
  if (stage === 'preparing') return 'Securing with your password…';
  if (stage === 'photos') return `Photos ${done} of ${total}…`;
  return `Saving memories ${done} of ${total}…`;
}

export default function BackupScreen() {
  const [meta, setMeta] = useState<BackupMeta>({ lastBackupAt: null });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<BackupHeader | null>(null);
  const [restorePassword, setRestorePassword] = useState('');

  useFocusEffect(
    useCallback(() => {
      settingsRepository.get<BackupMeta>(META_KEY, { lastBackupAt: null }).then(setMeta, () => undefined);
    }, []),
  );

  const busy = progress !== null;
  const onProgress: Progress = (stage, done, total) => setProgress(describeProgress(stage, done, total));

  async function share(file: File) {
    try {
      await shareBackupFile(file);
    } catch (error) {
      Alert.alert('Couldn’t open sharing', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  async function createBackup() {
    const problem = validatePassword(password);
    if (problem) {
      Alert.alert('Choose a stronger password', problem);
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords don’t match', 'Type the same password in both boxes.');
      return;
    }

    setProgress('Starting…');
    try {
      const { file, stats } = await createBackupFile(password, onProgress);
      const now = new Date().toISOString();
      await settingsRepository.set<BackupMeta>(META_KEY, { lastBackupAt: now });
      setMeta({ lastBackupAt: now });
      setLastFile(file);
      setPassword('');
      setConfirm('');
      setProgress(null);

      Alert.alert(
        'Backup ready',
        `${stats.memories} memories, ${stats.photos} photos, ${stats.dayNotes} day notes and ${stats.locationReadings} location readings, encrypted.` +
          (stats.missingPhotos > 0 ? `\n\n${stats.missingPhotos} photo files were missing and were skipped.` : '') +
          '\n\nNext, choose “Drive” (Save to Drive) to store it in Google Drive.',
        [{ text: 'Choose where to save', onPress: () => share(file) }],
      );
    } catch (error) {
      setProgress(null);
      console.warn('Backup failed:', error instanceof Error ? error.message : error);
      Alert.alert('Backup failed', 'Your memories weren’t changed. Please try again.');
    }
  }

  async function chooseRestoreFile() {
    try {
      const file = await pickBackupFile();
      if (!file) return;
      const info = await readBackupInfo(file);
      setRestoreFile(file);
      setRestoreInfo(info);
      setRestorePassword('');
    } catch (error) {
      setRestoreFile(null);
      setRestoreInfo(null);
      Alert.alert(
        'Can’t use this file',
        error instanceof BackupFormatError ? error.message : 'Pick a Memora backup (.memora) file.',
      );
    }
  }

  async function restore() {
    if (!restoreFile) return;
    setProgress('Starting…');
    try {
      const stats = await restoreBackupFile(restoreFile, restorePassword, onProgress);
      setProgress(null);
      setRestoreFile(null);
      setRestoreInfo(null);
      setRestorePassword('');
      Alert.alert(
        'Restore complete',
        `Added ${stats.memoriesAdded} memories (${stats.photosRestored} photos), ${stats.dayNotesAdded} day notes and ${stats.locationReadingsAdded} location readings.` +
          (stats.memoriesAlreadyPresent > 0
            ? `\n${stats.memoriesAlreadyPresent} memories were already on this phone and were left unchanged.`
            : '') +
          (stats.memoriesFailed > 0 ? `\n${stats.memoriesFailed} memories couldn’t be restored.` : ''),
      );
    } catch (error) {
      setProgress(null);
      if (error instanceof BackupAuthError) {
        Alert.alert('Wrong password', 'That password doesn’t open this backup (or the file is damaged). Nothing was changed.');
      } else if (error instanceof BackupFormatError) {
        Alert.alert('Can’t restore', `${error.message} Nothing was changed.`);
      } else {
        console.warn('Restore failed:', error instanceof Error ? error.message : error);
        Alert.alert('Restore failed', 'Nothing was changed. Please try again.');
      }
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.backButton}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Backup & Restore</Text>
        <Text style={styles.subtitle}>Keep a copy of your memories somewhere safe, like Google Drive.</Text>

        {busy && (
          <View style={styles.progressCard}>
            <ActivityIndicator color={Palette.text} />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>BACK UP</Text>
        <View style={styles.card}>
          <Text style={styles.status}>
            {meta.lastBackupAt ? `Last backup: ${formatDateTime(meta.lastBackupAt)}` : 'No backup made yet'}
          </Text>
          <Text style={styles.body}>
            Includes every memory, its photos and evidence, your day notes and your location log (not auto-camera photos, which can be very large), encrypted with a
            password you choose. Then save the file to Google Drive (or anywhere) from the share menu.
          </Text>

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Backup password (8+ characters)"
            placeholderTextColor={Palette.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel="Backup password"
          />
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Type it again"
            placeholderTextColor={Palette.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel="Confirm backup password"
          />
          <Text style={styles.warning}>
            Write this password down. Without it the backup can’t be opened — by you or anyone else.
          </Text>

          <Pressable
            style={[styles.primaryButton, busy && styles.disabled]}
            onPress={createBackup}
            disabled={busy}
            accessibilityRole="button">
            <Text style={styles.primaryText}>CREATE BACKUP</Text>
          </Pressable>
          {lastFile && !busy && (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => share(lastFile)}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>SAVE AGAIN (DRIVE, FILES…)</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionTitle}>RESTORE</Text>
        <View style={styles.card}>
          <Text style={styles.body}>
            Pick a .memora backup from Drive or your files. Memories already on this phone are kept as
            they are; only missing ones are added.
          </Text>

          {restoreInfo ? (
            <>
              <Text style={styles.status}>Backup from {formatDateTime(restoreInfo.createdAt)}</Text>
              <TextInput
                style={styles.input}
                value={restorePassword}
                onChangeText={setRestorePassword}
                placeholder="Backup password"
                placeholderTextColor={Palette.textFaint}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                accessibilityLabel="Password for this backup"
              />
              <Pressable
                style={[styles.primaryButton, (busy || !restorePassword) && styles.disabled]}
                onPress={restore}
                disabled={busy || !restorePassword}
                accessibilityRole="button">
                <Text style={styles.primaryText}>RESTORE</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setRestoreFile(null);
                  setRestoreInfo(null);
                }}
                disabled={busy}
                accessibilityRole="button"
                hitSlop={8}>
                <Text style={styles.link}>Choose a different file</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.secondaryButton, busy && styles.disabled]}
              onPress={chooseRestoreFile}
              disabled={busy}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>CHOOSE BACKUP FILE</Text>
            </Pressable>
          )}
        </View>
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
  progressCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressText: { fontSize: 15, fontWeight: '600', color: Palette.text },
  status: { fontSize: 15, fontWeight: '700', color: Palette.text },
  body: { marginTop: 8, fontSize: 14, lineHeight: 20, color: Palette.textMuted },
  input: {
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    fontSize: 15,
    color: Palette.text,
  },
  warning: { marginTop: 10, fontSize: 13, lineHeight: 18, color: Palette.sensorBadgeText },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '700', color: Palette.surface },
  secondaryButton: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '700', color: Palette.text },
  link: { marginTop: 14, fontSize: 14, fontWeight: '700', color: Palette.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
