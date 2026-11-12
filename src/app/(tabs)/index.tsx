import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { MemoryCard } from "@/components/memory-card";
import { BottomTabInset } from "@/constants/theme";
import { getNativeStatus, isAutoCameraAvailable } from "@/services/auto-camera";
import { isLocationLogActive } from "@/services/background-location";
import { memoryService } from "@/services/memory-service";
import { getReminderSettings } from "@/services/reminders";
import { MemoryEvent } from "@/types/memory";
import { groupByDay } from "@/utils/dates";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; memories: MemoryEvent[] };

type AutoStatus = {
  logActive: boolean;
  reminders: number | null;
  cameraOn: boolean;
};

export default function HomeScreen() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [auto, setAuto] = useState<AutoStatus | null>(null);

  const loadAutoStatus = useCallback(() => {
    Promise.all([isLocationLogActive(), getReminderSettings()]).then(
      ([logActive, reminders]) =>
        setAuto({
          logActive,
          reminders: reminders.enabled ? reminders.times.length : null,
          cameraOn: getNativeStatus()?.running ?? false,
        }),
      () => setAuto(null),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const memories = await memoryService.list();
      setState({ status: "ready", memories });
    } catch (error) {
      console.warn(
        "Loading memories failed:",
        error instanceof Error ? error.message : error,
      );
      setState({ status: "error" });
    }
  }, []);

  // Reload whenever Home regains focus, e.g. after Capture or a deletion.
  useFocusEffect(
    useCallback(() => {
      load();
      loadAutoStatus();
    }, [load, loadAutoStatus]),
  );

  const sections =
    state.status === "ready"
      ? groupByDay(state.memories, (memory) => memory.capturedAt)
      : [];

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.container}
      sections={sections}
      keyExtractor={(memory) => memory.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.logo}>MEMORA</Text>
            <Pressable
              onPress={() => router.push("/privacy")}
              accessibilityRole="button"
              accessibilityLabel="Privacy and data"
              hitSlop={12}
            >
              <Text style={styles.headerLink}>Privacy</Text>
            </Pressable>
          </View>

          <Text style={styles.subtitle}>Your personal memory companion</Text>

          <View style={styles.statusRow}>
            <Pressable
              style={[styles.pill, auto?.logActive && styles.pillOn]}
              onPress={() => router.push("/location-log")}
              accessibilityRole="button"
              accessibilityLabel={`Location log ${auto?.logActive ? "on" : "off"}`}
            >
              {auto?.logActive && <View style={styles.dot} />}
              <Text style={[styles.pillText, auto?.logActive && styles.pillTextOn]}>
                📍 Location log · {auto?.logActive ? "On" : "Off"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.pill, auto?.reminders != null && styles.pillOn]}
              onPress={() => router.push("/reminders")}
              accessibilityRole="button"
              accessibilityLabel="Reminders"
            >
              <Text
                style={[
                  styles.pillText,
                  auto?.reminders != null && styles.pillTextOn,
                ]}
              >
                🔔 Reminders ·{" "}
                {auto?.reminders != null ? `${auto.reminders}/day` : "Off"}
              </Text>
            </Pressable>
            {isAutoCameraAvailable && (
              <Pressable
                style={[styles.pill, auto?.cameraOn && styles.pillOn]}
                onPress={() => router.push("/auto-camera")}
                accessibilityRole="button"
                accessibilityLabel={`Auto camera ${auto?.cameraOn ? "on" : "off"}`}
              >
                {auto?.cameraOn && <View style={styles.dot} />}
                <Text
                  style={[styles.pillText, auto?.cameraOn && styles.pillTextOn]}
                >
                  📷 Auto camera · {auto?.cameraOn ? "On" : "Off"}
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            style={styles.button}
            onPress={() => router.push("/capture")}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>+ REMEMBER THIS</Text>
          </Pressable>

          <Pressable
            style={styles.reviewButton}
            onPress={() => router.push("/review")}
            accessibilityRole="button"
          >
            <Text style={styles.reviewButtonText}>▶ TODAY’S REVIEW</Text>
          </Pressable>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
      )}
      renderItem={({ item }) => <MemoryCard memory={item} />}
      ListEmptyComponent={
        state.status === "loading" ? (
          <ActivityIndicator style={styles.loading} color="#6B7280" />
        ) : state.status === "error" ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn&apos;t load memories</Text>
            <Text style={styles.emptyText}>
              Something went wrong reading your saved memories.
            </Text>
            <Pressable
              onPress={() => {
                setState({ status: "loading" });
                load();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No memories yet</Text>
            <Text style={styles.emptyText}>
              Tap “Remember This” to save a note, photo or place. Everything
              stays on this device.
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },

  container: {
    padding: 24,
    paddingTop: 70,
    paddingBottom: BottomTabInset + 24,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerLink: {
    fontSize: 15,
    fontWeight: "700",
    color: "#555B66",
  },

  statusRow: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  pill: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },

  pillOn: {
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#16A34A",
  },

  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555B66",
  },

  pillTextOn: {
    color: "#15803D",
  },

  logo: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1B1D22",
  },

  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: "#6B7280",
  },

  sectionTitle: {
    marginTop: 30,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#777E89",
    letterSpacing: 1,
  },

  loading: {
    marginTop: 40,
  },

  emptyCard: {
    marginTop: 30,
    padding: 20,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
  },

  emptyText: {
    marginTop: 6,
    color: "#6B7280",
  },

  retry: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "700",
    color: "#1B1D22",
  },

  button: {
    marginTop: 24,
    paddingVertical: 17,
    borderRadius: 14,
    backgroundColor: "#1B1D22",
    alignItems: "center",
  },

  reviewButton: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },

  reviewButtonText: {
    color: "#1B1D22",
    fontSize: 15,
    fontWeight: "700",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
