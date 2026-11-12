import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { MemoryCard } from "@/components/memory-card";
import { BottomTabInset } from "@/constants/theme";
import { memoryService } from "@/services/memory-service";
import { MemoryEvent } from "@/types/memory";
import {
  DATE_PRESETS,
  DAY_PARTS,
  DatePreset,
  DayPart,
  formatCustomRange,
  isInDayPart,
  resolveDateRange,
} from "@/utils/search-filters";

const SEARCH_DEBOUNCE_MS = 250;

type SearchResult = { key: string; run: number } & (
  | { status: "done"; results: MemoryEvent[] }
  | { status: "error" }
);

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error" }
  | { status: "done"; results: MemoryEvent[] };

type CustomRange = { from: Date; to: Date };

/** Opens the system date picker; resolves with the chosen day or null if dismissed. */
function pickDate(title: string, initial: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== "android") {
      Alert.alert("Date picker is available on Android");
      resolve(null);
      return;
    }
    DateTimePickerAndroid.open({
      mode: "date",
      title,
      value: initial,
      maximumDate: new Date(),
      onChange: (event, date) => resolve(event.type === "set" && date ? date : null),
    });
  });
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [dayPart, setDayPart] = useState<DayPart>("any");
  // Last completed search; the visible state is derived from it and the current inputs.
  const [result, setResult] = useState<SearchResult | null>(null);
  // Bumped on focus so results reflect memories added or deleted elsewhere.
  const [focusCount, setFocusCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusCount((count) => count + 1);
    }, []),
  );

  const trimmed = query.trim();
  const range = resolveDateRange(datePreset, new Date(), customRange ?? undefined);
  const filtered = range !== null || dayPart !== "any";
  const active = trimmed.length > 0 || filtered;
  // Everything that decides the results, so stale responses are ignored.
  const searchKey = JSON.stringify([trimmed, range, dayPart]);

  useEffect(() => {
    if (!active) return;

    let live = true;
    const timer = setTimeout(() => {
      // No date window but a part of the day: search everything, then keep that part of the day.
      const window = range ?? (trimmed.length === 0 ? { start: "", end: "￿" } : undefined);
      memoryService
        .search(trimmed, window)
        .then((found) => {
          const results = found.filter((memory) => isInDayPart(memory.capturedAt, dayPart));
          if (live) setResult({ key: searchKey, run: focusCount, status: "done", results });
        })
        .catch((error) => {
          console.warn("Search failed:", error instanceof Error ? error.message : error);
          if (live) setResult({ key: searchKey, run: focusCount, status: "error" });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
    // searchKey covers trimmed, range and dayPart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, focusCount, active]);

  const isCurrent = result !== null && result.key === searchKey && result.run === focusCount;

  const state: SearchState = !active
    ? { status: "idle" }
    : !isCurrent
      ? { status: "searching" }
      : result.status === "error"
        ? { status: "error" }
        : { status: "done", results: result.results };

  // While a new search runs, keep showing the previous matches instead of flashing empty.
  const results =
    state.status === "done"
      ? state.results
      : state.status === "searching" && result?.status === "done"
        ? result.results
        : [];

  async function chooseCustomDates() {
    const from = await pickDate("From", customRange?.from ?? new Date());
    if (!from) return;
    const to = await pickDate("To", customRange?.to && customRange.to >= from ? customRange.to : from);
    if (!to) return;
    setCustomRange({ from, to });
    setDatePreset("custom");
  }

  function clearFilters() {
    setDatePreset("any");
    setCustomRange(null);
    setDayPart("any");
  }

  const describeFilter = () => {
    const parts: string[] = [];
    if (datePreset === "custom" && customRange) parts.push(formatCustomRange(customRange.from, customRange.to));
    else if (datePreset !== "any") parts.push(DATE_PRESETS.find((p) => p.value === datePreset)!.label.toLowerCase());
    if (dayPart !== "any") parts.push(`in the ${DAY_PARTS.find((p) => p.value === dayPart)!.label.toLowerCase()}`);
    return parts.join(", ");
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.container}
      data={results}
      keyExtractor={(memory) => memory.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>Search</Text>
          <Text style={styles.subtitle}>
            Find a memory by its words, place or when it happened.
          </Text>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Search your memories..."
              placeholderTextColor="#9CA3AF"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search memories"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                style={styles.clear}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
              >
                <Text style={styles.clearText}>✕</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.filterLabel}>WHEN</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {DATE_PRESETS.map((preset) =>
              preset.value === "custom" ? (
                <Chip
                  key={preset.value}
                  label={datePreset === "custom" && customRange ? formatCustomRange(customRange.from, customRange.to) : preset.label}
                  selected={datePreset === "custom"}
                  onPress={chooseCustomDates}
                />
              ) : (
                <Chip
                  key={preset.value}
                  label={preset.label}
                  selected={datePreset === preset.value}
                  onPress={() => setDatePreset(preset.value)}
                />
              ),
            )}
          </ScrollView>

          <Text style={styles.filterLabel}>TIME OF DAY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {DAY_PARTS.map((part) => (
              <Chip
                key={part.value}
                label={part.label}
                selected={dayPart === part.value}
                onPress={() => setDayPart(part.value)}
              />
            ))}
          </ScrollView>

          {state.status !== "idle" && results.length > 0 && (
            <View style={styles.countRow}>
              <Text style={styles.count}>
                {results.length} {results.length === 1 ? "MEMORY" : "MEMORIES"}
              </Text>
              {filtered && (
                <Pressable onPress={clearFilters} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.clearFilters}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => <MemoryCard memory={item} showDate />}
      ListEmptyComponent={
        state.status === "searching" && results.length === 0 ? (
          <ActivityIndicator style={styles.loading} color="#6B7280" />
        ) : state.status === "error" ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Search failed</Text>
            <Text style={styles.emptyText}>
              Something went wrong searching your memories.
            </Text>
            <Pressable
              onPress={() => setFocusCount((count) => count + 1)}
              accessibilityRole="button"
            >
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : state.status === "done" ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyText}>
              {trimmed.length > 0
                ? `No memories contain “${trimmed}”${filtered ? ` ${describeFilter()}` : ""}.`
                : `No memories ${describeFilter()}.`}
            </Text>
            {filtered && (
              <Pressable onPress={clearFilters} accessibilityRole="button">
                <Text style={styles.retry}>Clear filters</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Search runs entirely on this device. Type a word from a note or a
              place, or pick a time to see everything from then.
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

  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1B1D22",
  },

  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: "#6B7280",
  },

  inputRow: {
    marginTop: 24,
    marginBottom: 6,
    justifyContent: "center",
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 48,
    paddingVertical: 14,
    fontSize: 15,
  },

  clear: {
    position: "absolute",
    right: 4,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },

  clearText: {
    fontSize: 16,
    color: "#6B7280",
  },

  filterLabel: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#777E89",
    letterSpacing: 1,
  },

  chips: {
    gap: 8,
    paddingRight: 24,
  },

  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },

  chipOn: {
    backgroundColor: "#1B1D22",
    borderColor: "#1B1D22",
  },

  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1B1D22",
  },

  chipTextOn: {
    color: "#FFFFFF",
  },

  countRow: {
    marginTop: 20,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  count: {
    fontSize: 13,
    fontWeight: "700",
    color: "#777E89",
    letterSpacing: 1,
  },

  clearFilters: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1B1D22",
  },

  loading: {
    marginTop: 24,
  },

  emptyCard: {
    marginTop: 16,
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
});
