# 09 — Local & OneDrive Storage

**Phase:** 2 · **Owning agent:** `storage-agent` · **Skill:** `storage-provider`

## Goal
Implement the `StorageProvider` abstraction so projects (the `.vproj` bundle) and exported output save identically to local disk or a network OneDrive folder, via synced-folder mode and/or Microsoft Graph mode.

## Dependencies
- Master plan Sections 4 (bundle), 5 (storage). All save/open flows depend on this.
- Skill: `storage-provider`.

## Data model touchpoints
- Whole project bundle; `project.json.storage = { location:"local|onedrive", root }`.

## UI/UX spec
New-project + Save-as dialogs offer storage location (Local folder / OneDrive). OneDrive first use triggers a connect/auth flow (Graph mode) or a folder picker (synced mode). Project cards show a storage badge. Conflict prompt on concurrent edits (last-write-wins default with warning).

## Build prompts
```
PROMPT 9.1 — Define the StorageProvider interface (listProjects/createProject/readProject/writeProject/readMedia/writeOutput/resolvePath) per the storage-provider skill, returning ProjectMeta/ProjectRef types.
```
```
PROMPT 9.2 — Implement LocalProvider over fs/promises: create the .vproj bundle (project.json + media/cache/exports), atomic writes (temp + rename), list/read/write.
```
```
PROMPT 9.3 — Implement OneDriveProvider synced-folder mode: treat the local OneDrive path as a normal directory; reuse LocalProvider logic against that root; detect the OneDrive folder location.
```
```
PROMPT 9.4 — Implement OneDriveProvider Graph mode: MSAL auth in main, read/write bundle items via Microsoft Graph drive API, with upload/download of media and exports. Cache locally for offline; reconcile on reconnect.
```
```
PROMPT 9.5 — Wire storage selection into New/Save-as dialogs and the storage badge; handle conflicts (last-write-wins + warning); ensure embedded fonts/media travel with the bundle.
```

## Acceptance criteria
- Create/open/save a project works on local and OneDrive (both modes).
- Bundle is self-contained (media + fonts) and portable between locations.
- Graph mode authenticates, syncs, and degrades gracefully offline.

## Test notes
Round-trip a project local→OneDrive→local with no data loss. Simulate auth failure and offline. Verify atomic writes don't corrupt project.json on interruption.
