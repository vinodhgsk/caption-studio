'use strict'

/**
 * electron-builder configuration.
 * Code-signing fields are placeholders — fill in before a production release.
 */

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.captionstudio.app',
  productName: 'Caption Studio',
  directories: {
    output: 'dist-electron'
  },
  files: [
    'dist/**/*',
    'dist-main/**/*',
    'node_modules/**/*'
  ],
  extraResources: [
    // Bundle Indic/Latin TTF fonts so FFmpeg/libass can find them at runtime.
    // Downloaded to resources/fonts/ via `npm run download-fonts`.
    { from: 'resources/fonts', to: 'fonts', filter: ['**/*.ttf', '**/*.otf'] }
  ],
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.video',
    // identity: 'Developer ID Application: Your Name (TEAMID)',  // fill in for release
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // certificateFile: 'build/certificate.pfx',  // fill in for release
    // certificatePassword: process.env.WIN_CERT_PASSWORD
  },
  linux: {
    target: ['AppImage'],
    category: 'Video'
  },
  publish: null  // auto-update stub — configure when ready
}

module.exports = config
