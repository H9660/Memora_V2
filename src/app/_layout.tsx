import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { getDatabase } from '@/database/database';
import { Palette } from '@/constants/palette';
// Side effect: defines the background location task so the OS can run it while the app is closed.
import '@/services/background-location';
import { isReminderResponse } from '@/services/reminders';

SplashScreen.preventAutoHideAsync();

type DbState = 'loading' | 'ready' | 'error';

/** Opens and migrates the database once before any screen reads from it. */
function useDatabaseReady() {
  const [state, setState] = useState<DbState>('loading');

  const open = useCallback(() => {
    // getDatabase() memoizes success and clears a failure, so retrying re-opens.
    getDatabase().then(
      () => setState('ready'),
      (error) => {
        console.warn('Database initialization failed:', error instanceof Error ? error.message : error);
        setState('error');
      },
    );
  }, []);

  useEffect(open, [open]);

  const retry = useCallback(() => {
    setState('loading');
    open();
  }, [open]);

  return { state, retry };
}

/** Opens Capture when the user taps a reminder, including one that launched the app. */
function useReminderNavigation(ready: boolean) {
  useEffect(() => {
    if (!ready) return;

    if (isReminderResponse(Notifications.getLastNotificationResponse())) {
      Notifications.clearLastNotificationResponse();
      router.push('/capture');
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (isReminderResponse(response)) router.push('/capture');
    });
    return () => subscription.remove();
  }, [ready]);
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { state, retry } = useDatabaseReady();
  useReminderNavigation(state === 'ready');

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="dark" />

      {state === 'ready' ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Palette.background },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="capture" />
          <Stack.Screen name="memory/[id]" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="location-log" />
          <Stack.Screen name="reminders" />
          <Stack.Screen name="backup" />
          <Stack.Screen name="review" />
          <Stack.Screen name="auto-camera" />
        </Stack>
      ) : (
        <View style={styles.gate}>
          {state === 'loading' ? (
            <ActivityIndicator color={Palette.textMuted} />
          ) : (
            <View style={styles.card}>
              <Text style={styles.title}>Memora couldn&apos;t open your memories</Text>
              <Text style={styles.body}>
                The on-device database failed to open. Your saved memories have not been changed.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                onPress={retry}
                accessibilityRole="button">
                <Text style={styles.buttonText}>TRY AGAIN</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <AnimatedSplashOverlay />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Palette.background,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: Palette.surface,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.text,
  },
  body: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: Palette.textMuted,
  },
  button: {
    marginTop: 20,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: Palette.text,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: Palette.surface,
    fontSize: 15,
    fontWeight: '700',
  },
});
