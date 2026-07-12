---
name: storage-provider
description: The StorageProvider contract backing local disk and OneDrive (synced-folder + Graph). Project bundle I/O, atomic writes, conflict handling. Use for all save/open/output flows.
---
# storage-provider

## Interface
`listProjects/createProject/readProject/writeProject/readMedia/writeOutput/resolvePath`. Returns `ProjectMeta`/`ProjectRef`.

## Bundle
`.vproj/` folder: project.json + media/ + cache/ + exports/ + media/fonts/. Self-contained & portable.

## Implementations
- LocalProvider: fs/promises, atomic write (temp file + rename).
- OneDriveProvider: (a) synced-folder mode = LocalProvider against the OneDrive path; (b) Graph mode = MSAL auth + Graph drive items, local cache, reconcile on reconnect.

## Conflicts
Last-write-wins + warning by default; detect via updatedAt/etag.
