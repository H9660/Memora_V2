# MEMORA — Complete the Remaining Application

Act as a senior React Native engineer, software architect, and product-focused full-stack developer. Your task is to inspect the existing Memora repository and implement all remaining functionality required to deliver a polished, functional Android-first MVP.

**Do not rebuild the application from scratch. Do not replace working features unnecessarily. Continue from the existing codebase.**

Work directly in the repository, make the required code changes, install compatible dependencies where necessary, run checks, fix errors, and leave the application in a working state.

Do not stop after creating a plan or explaining what needs to be done. Implement the application.

---

# 1. Product Overview

Memora is a privacy-first personal memory assistant.

Its purpose is to help users capture experiences and retrieve them later using contextual evidence.

For example:

- A user visits a restaurant and captures a memory.
- Memora records the user's note, timestamp, and available location context.
- The memory is saved locally.
- Later, the user can browse their timeline or search for the memory.

Memora is not intended to be a conventional notes application. Its long-term purpose is to build a structured record of personal experiences using user-provided information and optional contextual observations.

## Core principles

1. Local-first: memories should be stored on the device.
2. Privacy-first: sensing and permissions must be transparent and user-controlled.
3. Evidence-based: distinguish user-provided information from sensor observations.
4. No fabricated memories: never present an inferred activity as a confirmed fact.
5. User notes are authoritative: AI-generated summaries must never silently overwrite original notes.
6. Modular architecture: sensor providers, memory logic, persistence, and UI must remain separate.
7. Graceful degradation: the app must still work when location permission is denied or a sensor is unavailable.

**Important distinction:** A location observation indicates where the device was. It does not prove what the user did there.

---

# 2. Existing Technology Stack

The project uses:

- React Native
- TypeScript
- Expo
- Expo Router
- Expo SQLite
- Expo Location
- Expo Crypto
- Android as the primary target platform
- React Native components and styles for the existing UI

Preserve the current stack unless a specific technical incompatibility requires a change.

Use Expo-compatible package versions. Prefer `npx expo install` when installing Expo modules.

Do not introduce unnecessary dependencies, backend infrastructure, or cloud services.

---

# 3. Existing Project Structure and Work Completed

The project has already been initialized and contains an existing UI and several services.

The repository has a structure similar to:

```text
Memora/
  src/
    app/
      _layout.tsx
      capture.tsx
      (tabs)/
        _layout.tsx
        index.tsx
        explore.tsx

    components/
      app-tabs.tsx
      memory-card.tsx
      ...

    services/
      location.ts
      ...

    types/
      memory.ts

    utils/
      id.ts
      memory-validation.ts

    repositories/
      memory-repository.ts
      sqlite-memory-repository.ts
      index.ts

    database/
      db.ts
```

Inspect the actual repository before assuming every file exists or has precisely this structure.

## 3.1 Expo application setup

Already completed:

- Expo application created.
- TypeScript configured.
- Expo Router configured.
- Root Stack navigation implemented.
- Tab navigation implemented.
- Home and Capture screens created.
- App branding and initial UI implemented.
- Android Studio and ADB configured.
- Expo development client installed.
- Native Android project generated using Expo prebuild.

The app was previously run through Expo Go.

An Android development build was attempted, but the build process encountered Windows path-length and native build-tool issues.

**Do not assume the Android development build currently succeeds. Inspect and verify it.**

The previous Windows build issues included:

- Gradle download timeout, addressed by increasing the wrapper network timeout.
- NDK installation problems, subsequently addressed by reinstalling NDK 27.1.12297006.
- CMake installation/extraction problems.
- Ninja failing because a generated filename exceeded the Windows 260-character limit.
- A stale build-cache reference to the former OneDrive project path.

The project was moved to:

```text
C:\IS\Memora
```

The Android SDK location was:

```text
C:\Users\lohah\AppData\Local\Android\Sdk
```

Windows long-path support was discussed, but successful completion of the native build has not been confirmed.

Do not blindly change Gradle, Kotlin, React Native, NDK, or CMake versions. Diagnose the actual error first.

## 3.2 Location service

The application already has a working foreground location service.

The existing implementation uses `expo-location` and:

- Requests foreground location permission.
- Retrieves the current coordinates.
- Uses reverse geocoding to obtain a human-readable place name.
- Returns latitude, longitude, and place name.
- Handles reverse-geocoding failures gracefully.

The existing service is approximately:

```ts
export type LocationData = {
  latitude: number;
  longitude: number;
  placeName: string | null;
};
```

The actual existing service may use a different function signature. Inspect it and preserve compatibility.

GPS and reverse geocoding were tested successfully.

Do not request location permission automatically on the Home screen. Request it only when the user initiates an action that needs it or has explicitly enabled a relevant feature.

## 3.3 Existing Home screen

The Home screen already includes:

- Memora branding.
- A current-context section.
- Location status.
- Background-capture status and navigation.
- Captured-activity navigation.
- A memory timeline using `SectionList`.
- Memory cards.
- Empty and error states.
- A Remember This button that navigates to the Capture screen.

The existing Home screen uses:

```ts
import { MemoryCard } from "@/components/memory-card";
import { formatPlace, MemoryEvent } from "@/domain/memory-event";
import { useMemoryRepository } from "@/hooks/use-memory-repository";
```

It loads memories through:

```ts
repository.listRecent();
```

It also groups memories by day.

**Preserve the existing UI and working functionality.**

The temporary database test code that was previously added to the Home screen should not remain in the production implementation.

## 3.4 Existing Capture screen

A Capture screen already exists.

Inspect its current functionality and preserve its design where practical.

It includes or was intended to include:

- A note input.
- Current location/context.
- A photo placeholder.
- A Save Memory button.
- Navigation back to the previous screen.

The Save Memory functionality was previously only a placeholder and needs to be implemented properly.

## 3.5 Memory data model

A new memory model was created in:

`src/types/memory.ts`

It contains:

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

Interpretation:

- `id`: unique memory ID.
- `title`: human-readable memory title.
- `note`: original user-provided description.
- `eventTime`: when the experience happened, if known.
- `capturedAt`: when Memora recorded the memory.
- `placeName`: optional location context.
- `latitude` and `longitude`: optional coordinates.
- `evidence`: supporting observations or user-provided information.

`capturedAt` and `eventTime` are not interchangeable.

Do not invent `eventTime` when it is unknown.

## 3.6 ID generation

The following utility was created:

`src/utils/id.ts`

```ts
import * as Crypto from "expo-crypto";

export function generateId(): string {
  return Crypto.randomUUID();
}
```

Reuse this utility for memories and evidence.

## 3.7 Memory validation

The following utility was created:

`src/utils/memory-validation.ts`

It exports:

```ts
validateMemory(memory: MemoryEvent): string[]
```

It validates:

- Memory ID.
- Title.
- Capture timestamp.
- Event timestamp when provided.
- Coordinate pairing.
- Latitude range.
- Longitude range.

Reuse and improve it where necessary.

## 3.8 Repository interface

The following interface was created:

`src/repositories/memory-repository.ts`

```ts
import type { MemoryEvent } from "@/types/memory";

export interface MemoryRepository {
  save(memory: MemoryEvent): Promise<void>;
  getById(id: string): Promise<MemoryEvent | null>;
  getAll(): Promise<MemoryEvent[]>;
  delete(id: string): Promise<void>;
}
```

## 3.9 SQLite database

The following file was created:

`src/database/db.ts`

It exports:

```ts
export const dbPromise = SQLite.openDatabaseAsync("memora.db");

export async function initializeDatabase(): Promise<void>;
```

The database schema contains two tables:

### memories

- id
- title
- note
- event_time
- captured_at
- place_name
- latitude
- longitude

### memory_evidence

- id
- memory_id
- type
- captured_at
- data

The evidence table has a foreign key referencing the memory table, with cascade deletion.

Indexes were added for memory capture time and evidence memory ID.

Evidence-specific data is stored as JSON text.

## 3.10 SQLite repository implementation

The following file was created:

`src/repositories/sqlite-memory-repository.ts`

It implements:

- `save()`
- `getById()`
- `getAll()`
- `delete()`

Saving a memory and its evidence uses a transaction.

The shared repository instance was created in:

`src/repositories/index.ts`

```ts
import { SQLiteMemoryRepository } from "./sqlite-memory-repository";

export const memoryRepository = new SQLiteMemoryRepository();
```

## 3.11 Database initialization

The root application layout was updated to initialize SQLite before rendering navigation.

Inspect the existing `src/app/_layout.tsx` and preserve:

- Existing ThemeProvider.
- Expo Router Stack.
- Animated splash overlay.
- Existing splash-screen behavior.

Database initialization should happen once and should expose an appropriate loading/error state.

Do not leave the app indefinitely showing a loading spinner when initialization fails. Implement a retry or meaningful error screen.

---

# 4. CRITICAL ARCHITECTURAL ISSUE TO RESOLVE

The existing application and the new SQLite implementation currently use two different memory architectures.

The existing application uses:

```text
domain/memory-event
hooks/use-memory-repository
repository.listRecent()
```

The newly created implementation uses:

```text
types/memory
repositories/memory-repository
SQLiteMemoryRepository
repository.getAll()
```

These implementations must be reconciled.

**Do not create a second memory system. Do not leave the Home screen reading from one repository while Capture saves into another.**

Your first implementation task is to inspect:

- `src/domain/memory-event.ts`
- `src/hooks/use-memory-repository.ts`
- All existing repository implementations.
- The Capture screen.
- The new memory types.
- The new SQLite repository.

Then establish one canonical memory model and one persistence implementation.

Preferred approach:

1. Preserve existing domain concepts and UI contracts when they are already useful.
2. Use SQLite as the canonical local persistence layer.
3. Adapt the existing `useMemoryRepository()` hook to the SQLite repository.
4. Provide a consistent API for the rest of the app.
5. If necessary, create explicit mapping functions between the existing domain model and persistence model.
6. Avoid duplicate data models unless there is a clear separation of responsibilities.
7. Avoid silently dropping existing fields from legacy memories.
8. Preserve backward compatibility or implement a migration if the old schema/data requires it.

The final application should have one consistent flow:

```text
Home / Capture / Search
        ↓
Memory Engine / Application Services
        ↓
Memory Repository Interface
        ↓
SQLite Repository
        ↓
SQLite Database
```

Sensor providers should be separate from the UI and persistence implementation.

---

# 5. Remaining Implementation Tasks

Complete the following milestones in order.

## MILESTONE 1 — Audit and stabilize the existing codebase

1. Inspect the entire repository.
2. Identify existing functionality and unfinished placeholders.
3. Resolve duplicate or conflicting memory types.
4. Resolve the existing repository versus SQLite repository mismatch.
5. Ensure TypeScript aliases and imports work.
6. Remove temporary test code and stale imports.
7. Ensure database initialization happens exactly once.
8. Add appropriate initialization error handling.
9. Verify Expo Router navigation.
10. Preserve existing UI and styles.

Do not delete working background-capture or activity-related code simply because those features are not part of the immediate persistence implementation.

## MILESTONE 2 — Complete the Memory Engine and Capture workflow

Implement the actual memory-capture pipeline.

When a user opens the Capture screen:

- Display an input for a memory note.
- Allow the user to enter what happened.
- Obtain foreground location only when appropriate.
- Display a human-readable location if available.
- Handle location permission denial gracefully.
- Allow the user to capture a memory without location.
- Allow the user to capture a memory without a photo.
- Do not require every field to be filled.

When the user taps Save Memory:

1. Validate the input.
2. Generate a unique memory ID.
3. Generate a capture timestamp using the current time.
4. Keep event time null unless the user provides it or it is otherwise explicitly known.
5. Create the memory record.
6. Create a `USER_NOTE` evidence record if the user provided a note.
7. Create a `LOCATION` evidence record if a location observation was successfully captured.
8. Preserve the original note exactly as entered.
9. Save the memory and its evidence in one database transaction.
10. Show a success state only after the database operation succeeds.
11. Navigate back to Home after successful saving.
12. Display a useful error if saving fails.

The memory should not be saved twice if the user taps the button repeatedly.

Use a loading state and disable the Save button while saving.

### Suggested location evidence structure

Store structured evidence data, for example:

```ts
{
  latitude: 12.9716,
  longitude: 77.5946,
  placeName: "Example Place",
  source: "expo-location"
}
```

These coordinates are illustrative only. Always use actual sensor results.

The evidence timestamp should represent when the observation was captured.

### Memory title generation

If the existing product design supports a title input, preserve it.

Otherwise, create a simple deterministic title based on the note, such as the first few words, with a sensible fallback like "Untitled memory".

Do not add an LLM dependency just to generate titles.

## MILESTONE 3 — Complete SQLite persistence

Ensure all repository operations work correctly.

Required behavior:

- Save a memory.
- Retrieve a memory by ID.
- Retrieve all memories.
- Retrieve recent memories ordered by capture time.
- Delete a memory.
- Retrieve evidence for a memory.
- Delete associated evidence when a memory is deleted.

Additional requirements:

- Use parameterized SQL queries.
- Use transactions for operations involving multiple related writes.
- Enable foreign-key enforcement for every database connection or initialization as appropriate.
- Avoid storing JavaScript objects directly in SQLite.
- Parse and validate JSON evidence safely.
- Handle malformed JSON or corrupted records without crashing the whole application.
- Ensure timestamps are consistently stored in ISO 8601 format.
- Add appropriate indexes.
- Make the repository API consistent with the existing hooks and screens.

If there are old SQLite schemas or stored memories, inspect them and implement a versioned migration strategy where required.

Do not use `INSERT OR REPLACE` blindly if it could delete and recreate parent rows or produce unexpected foreign-key behavior. Prefer an explicit upsert/update strategy.

## MILESTONE 4 — Complete the Home timeline

The Home screen already has a timeline layout.

Connect it to the canonical SQLite-backed repository.

Requirements:

- Display real saved memories.
- Order memories by most recently captured.
- Group memories by day.
- Show "Today" and "Yesterday" appropriately.
- Display older dates in a readable format.
- Show the memory title.
- Show a note preview.
- Show location context if available.
- Show an appropriate timestamp.
- Display a meaningful empty state when no memories exist.
- Display a loading state.
- Display an error state with retry behavior.
- Reload the timeline when returning from Capture.
- Avoid unnecessary repeated database requests.
- Keep the existing visual design unless improvements are needed.

The timeline must never show hardcoded or temporary test data.

## MILESTONE 5 — Implement Memory Detail

Add a dedicated memory-detail screen.

When the user selects a memory card, navigate to its detail screen using its ID.

Display:

- Memory title.
- Original user note.
- Capture timestamp.
- Event time if known.
- Location name if available.
- Coordinates where appropriate.
- All supporting evidence.
- Evidence type.
- Evidence capture timestamp.
- Photo preview if a photo exists.

Clearly distinguish:

- User-provided notes.
- Location observations.
- Photo evidence.
- Any future AI-generated interpretation.

Do not describe sensor observations as confirmed activities.

### Memory editing

Allow users to edit:

- Memory title.
- Original note.

Do not silently overwrite the original note with generated text.

If useful, maintain an edit timestamp or edit history.

### Memory deletion

Provide a delete action with a confirmation dialog.

After deletion:

- Delete the memory.
- Delete associated evidence through cascade deletion.
- Return to the timeline.
- Refresh the timeline.
- Ensure the deleted memory cannot still be retrieved.

## MILESTONE 6 — Implement Search and Explore

The existing app contains an Explore tab.

Turn it into a functional local memory search experience.

Search should support:

- Memory title.
- User note.
- Place name.
- Relevant evidence text where practical.

Requirements:

- Search local SQLite data.
- Search should be case-insensitive.
- Show useful results while the user types.
- Debounce search input where appropriate.
- Display a no-results state.
- Allow the user to open a memory from search results.
- Provide a way to clear the query.
- Do not require internet access.

Use SQLite queries where practical instead of loading every record unnecessarily.

For the MVP, basic SQL `LIKE` search is sufficient.

Do not implement embeddings or vector databases at this stage.

## MILESTONE 7 — Implement Photo Evidence

Add optional photo capture or selection to the Capture screen.

Use Expo-compatible modules, such as:

- `expo-image-picker`
- `expo-file-system`, if required for local file management.

Requirements:

- Allow the user to select an image from the gallery.
- If feasible, allow taking a new photo.
- Request permissions only when the user chooses the relevant action.
- Display a preview before saving.
- Allow removing a selected image before saving.
- Store the image in app-controlled local storage rather than relying only on a temporary picker URI.
- Store the local image URI in the `PHOTO` evidence record.
- Handle missing or inaccessible image files gracefully.
- Do not upload photos to a remote service.

Avoid embedding image bytes as large JSON or BLOB fields unless there is a compelling reason.

The photo is optional. Memory capture must continue to work without it.

## MILESTONE 8 — Optional Activity Context

Inspect the existing background-capture and activity-related implementation.

The app already has references to:

- `services/background-capture`
- Background capture status.
- Background capture screen.
- Captured activity screen.

Preserve and audit these features.

However, do not compromise the core MVP to implement unreliable background tracking.

For this milestone:

1. Determine what already works.
2. Identify any unfinished background or activity recognition functionality.
3. Ensure permission requests are explicit and understandable.
4. Ensure users can enable and disable optional capture.
5. Clearly indicate when background capture is active.
6. Avoid collecting unnecessary data.
7. Keep activity observations separate from user-confirmed memories.
8. If Android Activity Recognition requires a development build or native configuration, document and implement it only if it is stable and compatible with the existing project.

Accelerometer and gyroscope readings are raw motion data, not semantic activity recognition.

Do not label raw sensor readings as walking, running, driving, or other activities without a validated recognition mechanism.

Background tracking is not a blocker for the core MVP.

## MILESTONE 9 — Privacy and user controls

Implement privacy-conscious behavior throughout the app.

Requirements:

- Local-first storage.
- No cloud upload of memories.
- No analytics or tracking services added without explicit justification and consent.
- Explain location permissions.
- Explain photo permissions.
- Allow users to use the app without granting optional permissions.
- Provide a way to disable optional background capture.
- Avoid collecting location continuously unless the user explicitly enables the feature.
- Provide a way to delete individual memories.
- Consider an option to delete all local memories, with a clear confirmation.
- Do not log sensitive memory notes or coordinates unnecessarily.
- Keep sensor evidence separate from user notes.

The user must remain in control of what is captured and retained.

## MILESTONE 10 — UI polish

Keep the existing Memora visual identity.

Improve the application where necessary:

- Consistent spacing and typography.
- Consistent colors.
- Clear buttons and touch targets.
- Loading indicators.
- Empty states.
- Error messages.
- Confirmation dialogs.
- Keyboard handling.
- Scroll behavior.
- Android back-button behavior.
- Responsive layouts for different Android screen sizes.

Do not redesign the application unnecessarily.

The application should feel cohesive across:

- Home.
- Capture.
- Explore/Search.
- Memory Detail.
- Background Capture.
- Activity.

## MILESTONE 11 — Testing and reliability

Implement appropriate tests where the existing project supports them.

At minimum, verify:

### Memory model and validation

- Valid memory passes validation.
- Missing title fails validation.
- Invalid timestamps fail validation.
- Invalid coordinates fail validation.
- Null event time is accepted.
- Missing location is accepted.

### Repository

- Save a memory.
- Retrieve it by ID.
- Retrieve all memories.
- Retrieve memories in descending capture-time order.
- Save and retrieve evidence.
- Delete a memory.
- Verify associated evidence is deleted.
- Verify a failed transaction does not leave partial records.

### Application workflow

Manually verify:

1. Launch the app.
2. Open Capture.
3. Enter a note.
4. Save without location permission.
5. Confirm the memory appears on Home.
6. Open its detail screen.
7. Edit the note.
8. Search for it.
9. Delete it.
10. Confirm it disappears from the timeline.

Also verify:

- Capture with location permission.
- Capture without a note, if the UX supports it.
- Capture with a photo.
- Capture without a photo.
- Deny optional permissions.
- Restart the app and verify saved memories persist.

### Build and quality checks

Run the relevant project commands:

- TypeScript type checking.
- ESLint, if configured.
- Existing test suite.
- Expo configuration validation.
- Android development build.

Fix errors introduced by your implementation.

Do not claim the Android build succeeded unless it actually completes.

---

# 6. Target Architecture

Aim for a clean separation of responsibilities.

```text
React Native UI
    |
    ├── Home / Timeline
    ├── Capture
    ├── Explore / Search
    └── Memory Detail
            |
            v
      Application Services
            |
            v
        Memory Engine
            |
      -------------------
      |        |        |
   Location  Photos  Activity
   Provider  Provider Provider
      |        |        |
      -------------------
            |
            v
      MemoryEvent
            |
      MemoryEvidence
            |
            v
     Memory Repository
            |
            v
       SQLite Layer
            |
            v
      Local Database
```

Keep sensor-specific implementations outside the screens.

Use interfaces for providers where that improves testability.

Avoid overengineering the application with unnecessary abstractions.

---

# 7. Explicitly Deferred Features

Do not implement these as part of the current MVP unless the core application is already complete and stable:

1. Cloud synchronization.
2. User accounts and authentication.
3. Backend infrastructure.
4. LLM-powered memory reconstruction.
5. AI-generated memory summaries.
6. Embeddings and vector databases.
7. Semantic search.
8. Continuous audio recording.
9. Continuous video recording.
10. Automatic background photo capture.
11. Complex cross-device synchronization.
12. Social sharing.
13. Collaborative memories.
14. Advanced analytics.
15. Automatic inference of activities from location alone.

The architecture should leave room for these future capabilities, but they should not delay a reliable local-first MVP.

---

# 8. Important Engineering Rules

Follow these rules throughout implementation:

1. Inspect existing code before modifying it.
2. Preserve existing working functionality.
3. Do not replace the UI unnecessarily.
4. Do not create duplicate memory models or repositories.
5. Do not use mock data in production screens.
6. Do not leave TODO placeholders for core functionality.
7. Do not silently swallow errors.
8. Do not hardcode coordinates or timestamps.
9. Do not request optional permissions unnecessarily.
10. Do not claim an action succeeded before persistence succeeds.
11. Do not store temporary photo URIs when durable local storage is required.
12. Do not introduce cloud services.
13. Use TypeScript types consistently.
14. Use parameterized SQL.
15. Use transactions for related database writes.
16. Keep the original user note intact.
17. Distinguish sensor evidence from user-provided information.
18. Avoid unnecessary dependencies.
19. Avoid changing native toolchain versions without diagnosing a concrete issue.
20. Keep the code maintainable and suitable for future expansion.

When a technical decision is uncertain, inspect the current implementation and choose the least disruptive solution consistent with the architecture.

If an external limitation prevents completion of a feature, implement the best supported alternative, explain the limitation, and continue with the remaining work.

---

# 9. Definition of Done

The application is considered complete when the following workflow works reliably:

**Capture → Save → Timeline → Detail → Search → Edit/Delete → Persistence after restart.**

Specifically:

- The app launches without database initialization errors.
- The Home screen displays real memories from SQLite.
- The Capture screen creates memories.
- Location can be attached as optional evidence.
- Photos can be attached as optional evidence.
- Notes remain preserved.
- Memories and evidence are persisted locally.
- The timeline updates after saving.
- A memory can be opened and inspected.
- A memory can be edited.
- A memory can be deleted.
- Search retrieves matching memories.
- Data survives app restarts.
- Optional permissions can be denied without breaking core functionality.
- No temporary test records or hardcoded production data remain.
- TypeScript and other configured checks pass.
- The Android development build is verified or any remaining build blocker is documented precisely.

---

# 10. How to Execute This Task

Work autonomously and implement the remaining application in a sensible order.

Use this execution sequence:

1. Audit the codebase.
2. Reconcile the memory model and repository architecture.
3. Verify SQLite initialization.
4. Connect Capture to SQLite.
5. Connect Home to SQLite.
6. Implement Memory Detail.
7. Implement editing and deletion.
8. Implement Explore/Search.
9. Implement photo evidence.
10. Audit existing activity/background functionality.
11. Implement privacy controls.
12. Polish the UI.
13. Test the complete workflow.
14. Verify Android build and document any remaining native issues.

Do not stop and ask for approval after every milestone. Make reasonable engineering decisions and continue.

If a destructive migration or irreversible data change is required, preserve existing user data and use a safe migration rather than deleting the database.

Do not remove working features merely to make the implementation simpler.

At the end, provide a concise implementation report containing:

### A. Completed

List every feature actually implemented.

### B. Existing features preserved

List the functionality that was already present and retained.

### C. Architecture

Explain the final memory model, repository, SQLite, and provider structure.

### D. Files changed

List the important files created, modified, or removed.

### E. Dependencies

List new dependencies and why they were needed.

### F. Verification

Report actual results for:

- TypeScript.
- Linting.
- Tests.
- Database workflow.
- Android build.

Do not claim tests or builds passed unless you ran them successfully.

### G. Remaining work

List anything still incomplete, blocked, or intentionally deferred.

### H. How to run

Give the exact commands needed to start the app and build/run it on Android.

**Final objective: Deliver a working, polished, privacy-first Memora Android MVP using the existing repository—not merely a technical plan or a collection of disconnected components.**
