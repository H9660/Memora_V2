# Memora

A privacy-first personal memory assistant (Android-first, Expo SDK 58). Capture a moment with a note,
an optional photo and an optional location observation; everything is stored locally in SQLite.

## Run it

```bash
npm install
npx expo start              # then press "a" (Expo Go or an installed dev build)
```

Development build on a connected Android device or emulator:

```bash
npx expo prebuild --platform android   # only after app.json / native dependency changes
npx expo run:android
```

The Android SDK must be discoverable: set `ANDROID_HOME` (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`)
or create `android/local.properties` with `sdk.dir=...`. `android/` is generated (Continuous Native
Generation) and git-ignored — configure native behaviour in `app.json`, never by hand.

## Checks

```bash
npx tsc --noEmit   # typecheck
npx expo lint      # lint
npm test           # Jest: validation, factory, SQLite repository, memory service
```

Repository tests run real SQL through Node's built-in `node:sqlite` (Node 22.5+), via a small adapter in
`src/test-utils/` that mimics the expo-sqlite methods Memora uses.

## Architecture

```
Screens (src/app)        Home · Capture · Search · Memory detail · Privacy
        │
Memory service           src/services/memory-service.ts  (capture, edit, delete, delete-all, reads)
        │          ╲
Providers              src/services/location.ts · src/services/photos.ts
        │
MemoryEvent + evidence   src/types/memory.ts, src/utils/memory-factory.ts, src/utils/validation.ts
        │
Repository               src/repositories/memory-repository.ts (interface)
                         src/repositories/sqlite-memory-repository.ts (implementation)
        │
SQLite                   src/database/database.ts (single connection, FK on, WAL)
                         src/database/migrations.ts (versioned via PRAGMA user_version)
```

Principles enforced in code:

- **Notes are authoritative.** The note is stored exactly as typed. Edits change the memory's note, but the
  `USER_NOTE` evidence keeps the note as originally captured, and `updated_at` records the edit.
- **Observations are not facts.** `LOCATION` evidence is labelled as a sensor observation of where the
  phone was, never as an activity.
- **Optional permissions.** Location is fetched automatically on Capture only if already granted; otherwise
  the user taps "Add my location". Camera permission is requested only on "Take photo"; the gallery uses the
  system picker. No background location.
- **Local-only.** Photos are copied into app-private storage (`<documents>/memory-photos/`). No network
  services, accounts or analytics.

### Optional automatic capture (both off by default)

- **Location log** (`src/services/background-location.ts`, screen `src/app/location-log.tsx`): records where
  the phone is every 5/15/30/60 min via `expo-location` background updates + `expo-task-manager`. Needs
  "Allow all the time" and shows a foreground-service notification while on. Readings go to
  `location_observations` — never into memories — and are pruned after 30 days. Home shows an On/Off pill.
- **Reminders** (`src/services/reminders.ts`, screen `src/app/reminders.tsx`): daily local notifications at
  chosen times via `expo-notifications`; tapping one opens Capture. Nothing is captured unless the user saves.

Both need the development build (not Expo Go). Background photo capture is not offered: Android blocks
background camera access.

### Data model

| Table             | Columns                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| `memories`        | id, title, note, event_time, captured_at, updated_at, place_name, latitude, longitude    |
| `memory_evidence` | id, memory_id → memories(id) ON DELETE CASCADE, type, captured_at, data_json             |
| `location_observations` | id, captured_at, latitude, longitude, accuracy_meters, source (background log)    |
| `settings`        | key, value (JSON) — location-log interval, reminder times                                |

Evidence types: `USER_NOTE`, `LOCATION`, `PHOTO`. Timestamps are ISO 8601 UTC strings.
