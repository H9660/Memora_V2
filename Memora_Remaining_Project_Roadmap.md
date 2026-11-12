# Memora --- Remaining Project Roadmap

**Platform:** Android-first prototype\
**Stack:** React Native, TypeScript, Expo Router, Expo Development
Build, Expo Location, SQLite\
**Core pipeline:** Sensors → Memory Event → Repository → Retrieval

## 1. Goal

Complete a privacy-first personal memory app that lets a user capture an
experience, attach available context, save it locally, browse memories
chronologically, and retrieve them later.

The first prototype should prove this loop:

1.  Manually capture a memory.
2.  Record its capture timestamp.
3.  Attach foreground GPS context when permission is granted.
4.  Save the memory and its evidence locally.
5.  Browse the timeline.
6.  Search for and open a saved memory.
7.  Clearly distinguish user-provided notes from sensor observations.

Background tracking, continuous audio/video, AI reconstruction, cloud
sync, embeddings, and vector databases are **not prerequisites** for the
first complete prototype.

## 2. Current progress

---

Component Status

---

Expo + React Native + TypeScript Done
project

Expo Router navigation Done

Home/timeline screen skeleton Done

Capture screen skeleton Done

Foreground GPS and reverse Implemented and tested
geocoding

Expo development client installed Done

Android native project generated Done
with prebuild

Android SDK, NDK and CMake setup Installed; native build progressed

Successful Android development **Still blocked / not confirmed**
build on phone

Memory data model Remaining

SQLite persistence Remaining

Capture → Save workflow Remaining

Real timeline backed by SQLite Remaining

Memory detail and delete Remaining

Text search Remaining

Photo evidence Later milestone

Activity recognition Optional later milestone

Testing and demo polish Remaining

---

### Current build blocker

The project was moved from a long OneDrive path to `C:\IS\Memora`.
Earlier build attempts reused stale paths; later attempts reached native
C++ compilation and encountered a Windows 260-character path limit in
Ninja.

Before feature work that requires the development client:

- Enable Windows long-path support (`LongPathsEnabled = 1`) and
  restart Windows.
- Run commands from `C:\IS\Memora`.
- Remove stale generated CMake/Ninja build directories if they still
  contain the old OneDrive path.
- Run a clean build and confirm the app installs and opens on the
  connected Android phone.

Do not change Gradle, Kotlin, React Native, CMake, or NDK versions
unless a specific error demonstrates a version incompatibility.

---

## 3. Remaining milestones

## Milestone 0 --- Finish the Android development build

**Goal:** Build and launch the custom Memora app on the Android phone.

- [ ] Enable Windows long paths and restart Windows.

- [ ] Open PowerShell in `C:\IS\Memora`.

- [ ] Confirm `Get-Location` returns `C:\IS\Memora`.

- [ ] Stop Gradle:

  ```powershell
  cd android
  .\gradlew.bat --stop
  cd ..
  ```

- [ ] Remove generated native build folders that may retain stale
      paths:

  ```powershell
  Remove-Item -Recurse -Force android\.cxx -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force android\app\.cxx -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force node_modules\react-native-screens\android\.cxx -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force node_modules\react-native-worklets\android\.cxx -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force node_modules\react-native-gesture-handler\android\.cxx -ErrorAction SilentlyContinue
  ```

- [ ] Clean Gradle:

  ```powershell
  cd android
  .\gradlew.bat clean
  cd ..
  ```

- [ ] Build and install:

  ```powershell
  npx expo run:android
  ```

- [ ] Confirm the app launches and connects to Metro.

**Acceptance criteria:** Build succeeds; app installs and opens;
Home/Capture navigation works; foreground location still works when
permission is granted.

## Milestone 1 --- Define the core memory model

**Goal:** Use one consistent representation for every memory.

Create `src/types/memory.ts`:

```ts
export type EvidenceType = "USER_NOTE" | "LOCATION" | "PHOTO";

export interface MemoryEvidence {
  id: string;
  memoryId: string;
  type: EvidenceType;
  capturedAt: string;
  data: Record<string, unknown>;
}

export interface MemoryEvent {
  id: string;
  title: string;
  note: string;
  eventTime: string | null;
  capturedAt: string;
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  evidence: MemoryEvidence[];
}
```

Rules: - `capturedAt` is when Memora recorded the memory. - `eventTime`
is when the experience happened, if known; it may be `null`. - A
location observation indicates where the device was, not proof of what
the user was doing. - A user note is user-provided information. - Keep
evidence separate from the note. Never silently replace the original
note with an AI summary. - Represent unavailable information as `null`,
not an invented value.

Tasks: - \[ \] Add the types. - \[ \] Add an ID-generation utility. - \[
\] Add validation for required fields. - \[ \] Require a non-empty note
for the first prototype. - \[ \] Create sample memory data for testing.

**Acceptance criteria:** A memory can be created independently of UI
components, and user notes and sensor evidence remain distinguishable.

## Milestone 2 --- Add SQLite persistence

**Goal:** Save memories locally so they survive app restarts.

Install:

```powershell
npx expo install expo-sqlite
```

Suggested structure:

```text
src/
  database/
    database.ts
    migrations.ts
  repositories/
    memory-repository.ts
    sqlite-memory-repository.ts
  types/
    memory.ts
```

Initial schema:

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL,
  event_time TEXT,
  captured_at TEXT NOT NULL,
  place_name TEXT,
  latitude REAL,
  longitude REAL
);

CREATE TABLE IF NOT EXISTS memory_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL,
  type TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_captured_at
ON memories(captured_at);

CREATE INDEX IF NOT EXISTS idx_evidence_memory_id
ON memory_evidence(memory_id);
```

Repository contract:

```ts
export interface MemoryRepository {
  create(memory: MemoryEvent): Promise<void>;
  getById(id: string): Promise<MemoryEvent | null>;
  getAll(): Promise<MemoryEvent[]>;
  search(query: string): Promise<MemoryEvent[]>;
  delete(id: string): Promise<void>;
}
```

Tasks: - \[ \] Install `expo-sqlite`. - \[ \] Initialize the database
once. - \[ \] Create schema and indexes. - \[ \] Implement `create`,
`getById`, `getAll`, `search`, and `delete`. - \[ \] Return timeline
results newest first. - \[ \] Handle database errors. - \[ \] Verify
records remain after an app restart. - \[ \] Ensure deleting a memory
also deletes its evidence.

**Acceptance criteria:** Memories and evidence can be written/read
reliably and persist locally.

## Milestone 3 --- Complete Capture → Save

**Goal:** Connect the existing Capture screen to the model and
repository.

Flow:

1.  User opens Capture.
2.  Record the capture timestamp.
3.  Attempt foreground location retrieval.
4.  User enters a note.
5.  User taps Save.
6.  Validate the note.
7.  Create a `MemoryEvent`.
8.  Attach location evidence only if retrieval succeeded.
9.  Save memory and evidence.
10. Return to Home and refresh the timeline.

Tasks: - \[ \] Track note text in React state. - \[ \] Track location
loading, success, denial, and failure. - \[ \] Require a non-blank
note. - \[ \] Disable Save while a save is in progress. - \[ \] Create
the memory object and `USER_NOTE` evidence. - \[ \] Add `LOCATION`
evidence only when coordinates are available. - \[ \] Show save errors
and success confirmation. - \[ \] Prevent accidental duplicate saves. -
\[ \] Reset the form appropriately.

**Important:** Location permission is optional. A user must be able to
save a memory when GPS is unavailable or permission is denied.

**Acceptance criteria:** A note saves successfully with or without
location permission and remains available after restarting the app.

## Milestone 4 --- Build the real timeline

**Goal:** Replace placeholder Home content with SQLite-backed memories.

- [ ] Load data using `MemoryRepository.getAll()`.
- [ ] Display newest memories first.
- [ ] Add an empty state.
- [ ] Show note/title, capture time, and place name when available.
- [ ] Group entries by date (Today, Yesterday, earlier).
- [ ] Refresh after returning from Capture.
- [ ] Add loading and error states.
- [ ] Make each card open Memory Detail.

**Acceptance criteria:** A newly saved memory appears on Home without
restarting the app and entries are chronologically ordered.

## Milestone 5 --- Add Memory Detail and deletion

**Goal:** Let users inspect a memory and its supporting evidence.

Create a route such as `src/app/memory/[id].tsx`.

- [ ] Add a dynamic detail route.
- [ ] Load the memory by ID.
- [ ] Show a not-found state for invalid IDs.
- [ ] Display note, timestamps, place, and evidence.
- [ ] Label user notes and sensor observations distinctly.
- [ ] Add delete confirmation.
- [ ] Delete through the repository and refresh the timeline.

**Acceptance criteria:** A timeline card opens the correct memory;
evidence is labelled correctly; deletion removes the memory and its
evidence.

## Milestone 6 --- Add basic search

**Goal:** Find saved memories without introducing semantic search
infrastructure.

- [ ] Add a search field to Explore/Search.
- [ ] Search title and note using SQLite.
- [ ] Add debouncing if needed.
- [ ] Reuse the timeline memory card.
- [ ] Show an empty-results state.
- [ ] Open results in Memory Detail.
- [ ] Add date filters only after text search works.

**Acceptance criteria:** Searching a phrase from a saved note returns
the correct memory and opens its detail screen.

## Milestone 7 --- Add photo evidence

**Goal:** Attach a photo to a memory.

Choose an Expo-compatible image picker/camera package based on whether
the first version needs gallery selection, camera capture, or both.

- [ ] Implement photo permission handling.
- [ ] Add Take Photo / Choose Photo.
- [ ] Store the image in app-controlled persistent storage; do not
      rely only on a temporary picker URI.
- [ ] Attach a `PHOTO` evidence record.
- [ ] Display the photo in Memory Detail.
- [ ] Handle denial and cancellation.
- [ ] Clean up the stored photo when its memory is deleted.

**Acceptance criteria:** A photo remains available after app restart and
is linked to the correct memory.

## Milestone 8 --- Optional activity context

**Goal:** Add movement context without overstating what sensors prove.

Important distinction: - Accelerometer and gyroscope provide raw motion
measurements. - They do not automatically identify semantic activities
such as walking or running. - Semantic activity recognition requires a
suitable Android API/library, permissions, and device testing.

Tasks, only if activity context is needed for the demo: - \[ \]
Investigate Android Activity Recognition and its permissions. - \[ \]
Put it behind an `ActivityProvider` interface. - \[ \] Store results as
timestamped evidence. - \[ \] Label results as detected/estimated, not
user-confirmed. - \[ \] Ensure activity failure never blocks manual
capture.

**Acceptance criteria:** Activity context is optional and clearly
identified as sensor-derived.

## Milestone 9 --- Reliability, privacy, and testing

Functional tests: - \[ \] Save with location permission. - \[ \] Save
without location permission. - \[ \] Save when GPS is unavailable. - \[
\] Reject blank notes. - \[ \] Verify persistence after restart. - \[ \]
Verify timeline ordering. - \[ \] Verify search. - \[ \] Open memory
details. - \[ \] Delete a memory and verify evidence cleanup. - \[ \]
Verify failed saves do not leave partial records.

Privacy and UX: - \[ \] Request permissions only when the user invokes
the related feature. - \[ \] Explain why each permission is needed. - \[
\] Preserve manual capture when permissions are denied. - \[ \] Avoid
continuous background collection in the first prototype. - \[ \] Keep
memory data on-device; no cloud upload in this prototype. - \[ \]
Provide memory deletion. - \[ \] Do not imply GPS proves what the user
did. - \[ \] Preserve original user notes.

Engineering quality: - \[ \] Keep SQL out of UI components. - \[ \] Keep
sensor logic in provider/service modules. - \[ \] Keep data access
behind the repository interface. - \[ \] Handle loading, empty,
denied-permission, and error states. - \[ \] Run TypeScript checks and
resolve relevant errors. - \[ \] Test on the actual Android phone.

---

## 4. Suggested project structure

```text
src/
  app/
    _layout.tsx
    capture.tsx
    memory/
      [id].tsx
    (tabs)/
      _layout.tsx
      index.tsx
      explore.tsx
  components/
    app-tabs.tsx
    memory-card.tsx
    evidence-item.tsx
  database/
    database.ts
    migrations.ts
  repositories/
    memory-repository.ts
    sqlite-memory-repository.ts
  services/
    location.ts
    photo.ts
  providers/
    location-provider.ts
    photo-provider.ts
    activity-provider.ts
  types/
    memory.ts
  utils/
    ids.ts
    dates.ts
    validation.ts
```

Create modules when their functionality is implemented; do not add empty
abstractions just to match this tree.

## 5. Recommended order and priority

    Order Work item                                  Priority

---

        0 Finish Android development build           Blocker
        1 Define `MemoryEvent` and evidence types    Must have
        2 Add SQLite schema and repository           Must have
        3 Connect Capture → Save                     Must have
        4 Load real memories in Timeline             Must have
        5 Add Memory Detail and deletion             Must have
        6 Add basic text search                      Must have
        7 Add photo evidence                         Should have
        8 Add activity recognition                   Optional
        9 Testing, privacy checks, and demo polish   Must have

## 6. Definition of done --- first complete prototype

The first prototype is complete when these work on the Android phone:

- [ ] Development build launches.
- [ ] User can manually create a memory.
- [ ] Capture timestamp is recorded.
- [ ] Foreground location is attached when permission is granted.
- [ ] Memory can be saved without location permission.
- [ ] Memories persist locally in SQLite.
- [ ] Home displays memories chronologically.
- [ ] User can open a memory and inspect its evidence.
- [ ] User can search saved notes.
- [ ] User can delete a memory.
- [ ] Permission denial and common failures are handled gracefully.
- [ ] No cloud backend or continuous background tracking is required.

**Suggested demo:** Create two or three memories at different locations,
show their location context, return to the timeline, search for a
phrase, open a result, and demonstrate persistence after restarting the
app.

## 7. Future scope --- after the first prototype

These are not first-prototype requirements:

- Background location collection with explicit opt-in and
  platform-compliant permissions.
- Android activity recognition.
- Calendar integration.
- Bluetooth proximity/context signals.
- Audio capture and transcription with explicit user control and
  recording indicators.
- Memory graph connecting people, places, events, and time.
- AI-assisted summaries grounded in stored evidence.
- Semantic search using embeddings.
- Recall practice and memory review.
- Export, backup, and optional encrypted synchronization.

For every future sensor, preserve the same architecture:

**Provider → timestamped evidence → MemoryEvent → Repository →
Retrieval**

AI interpretations must remain distinguishable from original user notes
and raw sensor observations.
