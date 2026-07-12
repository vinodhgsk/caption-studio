# Caption Studio — Release Checklist

Use this checklist before tagging a production release. Work top-to-bottom; do not skip items.

## Code quality

- [ ] All TypeScript type-checks pass: `npx tsc --noEmit` exits 0.
- [ ] All unit tests pass: `npx vitest run` exits 0 with no skipped suites.
- [ ] ESLint reports zero warnings: `npx eslint src --ext .ts,.tsx --max-warnings 0`.
- [ ] CI pipeline is green on the release branch in GitHub Actions.

## Build

- [ ] Production build succeeds: `npm run build` (electron-vite) exits 0.
- [ ] `electron-builder` packages the app: `npm run package` completes for macOS, Windows, and Linux targets.
- [ ] Output artefacts are present in `dist-electron/` (`.dmg`, `.exe` / `.nsis`, `.AppImage`).

## Code-signing & notarisation (macOS)

- [ ] `mac.identity` in `electron-builder.config.cjs` is set to your Developer ID certificate.
- [ ] `build/entitlements.mac.plist` has been reviewed; no extra entitlements requested beyond those needed.
- [ ] App is notarised with `xcrun notarytool` and stapled with `xcrun stapler`.
- [ ] Gatekeeper assessment passes on a clean macOS machine: `spctl --assess --type exec <app>`.

## Code-signing (Windows)

- [ ] `win.certificateFile` and `WIN_CERT_PASSWORD` env var are configured in CI secrets.
- [ ] Authenticode signature present on the `.exe` installer.

## Functional smoke test

- [ ] App launches on macOS (both x64 and arm64), Windows 10+, and Ubuntu 22+.
- [ ] Create project → import media → generate captions → export MP4 (or subtitle file) round-trip works.
- [ ] OneDrive sync (if enabled) lists and saves projects without error.
- [ ] Onboarding modal appears on first run and does not reappear after completion.
- [ ] Autosave indicator shows "Saved" and no `saveStatus: 'error'` appears in DevTools console.

## Release artefacts

- [ ] Version in `package.json` is bumped (semver) and committed.
- [ ] Git tag created: `git tag v<version>` and pushed to `origin`.
- [ ] GitHub Release drafted with the artefacts attached and a changelog entry.
