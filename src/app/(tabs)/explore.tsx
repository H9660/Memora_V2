import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { MemoryCard } from "@/components/memory-card";
import { BottomTabInset } from "@/constants/theme";
import { memoryService } from "@/services/memory-service";
import { MemoryEvent } from "@/types/memory";

const SEARCH_DEBOUNCE_MS = 250;

type SearchResult = { query: string; run: number } & (
  | { status: "done"; results: MemoryEvent[] }
  | { status: "error" }
);

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error" }
  | { status: "done"; results: MemoryEvent[] };

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  // Last completed search; the visible state is derived from it and the current query.
  const [result, setResult] = useState<SearchResult | null>(null);
  // Bumped on focus so results reflect memories added or deleted elsewhere.
  const [focusCount, setFocusCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusCount((count) => count + 1);
    }, []),
  );

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length === 0) return;

    let active = true;
    const timer = setTimeout(() => {
      memoryService
        .search(trimmed)
        .then((results) => {
          if (active) {
            setResult({ query: trimmed, run: focusCount, status: "done", results });
          }
        })
        .catch((error) => {
          console.warn(
            "Search failed:",
            error instanceof Error ? error.message : error,
          );
          if (active) setResult({ query: trimmed, run: focusCount, status: "error" });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [trimmed, focusCount]);

  const isCurrent =
    result !== null && result.query === trimmed && result.run === focusCount;

  const state: SearchState =
    trimmed.length === 0
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
            Find a memory by its title, note or place.
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

          {state.status !== "idle" && results.length > 0 && (
            <Text style={styles.count}>
              {results.length} {results.length === 1 ? "memory" : "memories"}
            </Text>
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
              No memories contain “{query.trim()}”.
            </Text>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Search runs entirely on this device. Try a word from a note or a
              place name.
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
    marginBottom: 16,
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

  count: {
    marginBottom: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#777E89",
    letterSpacing: 1,
  },

  loading: {
    marginTop: 24,
  },

  emptyCard: {
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
