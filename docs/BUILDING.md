# Building Order Board

Order Board is built by **GitHub Actions**. You don't need Android Studio or a local Android SDK.

## Install or update the app (no GitHub account needed)

1. On your Android phone, open **https://github.com/melhive/OrderBoard/releases/latest/download/OrderBoard.apk**
2. Open the downloaded `OrderBoard.apk` and tap **Install**. The first time, Android asks you to allow installing apps from your browser. Allow it.
3. To update later, open the same link again and tap **Install** (or **Update**). It replaces the old version and keeps your data. In the app, the link is also at Settings → About → **Latest Android app**.

**Never uninstall to update.** Uninstalling deletes the app's data. Make a backup first if you ever must (Settings → Export all data).

Share the same link with anyone. The Releases page lists every version with its changes: https://github.com/melhive/OrderBoard/releases

**Web app:** https://melhive.github.io/OrderBoard/ works in any phone browser (Add to Home screen) and offline. The Android app and the web app keep separate data. Move it with Export all data → Import backup.

## How releases are made

- `.github/workflows/android.yml` builds the APK on every push and pull request: `pnpm build` → `cap sync android` → `gradlew assembleRelease`, then checks the signature.
- **Push to `main`:** publishes GitHub Release `v<version>` with `OrderBoard.apk` attached, marked **Latest**. The release notes are the newest entry of the in-app changelog (`scripts/release-notes.mjs`). If that version already has a release, the APK is replaced.
- **Pull request:** replaces the **preview** pre-release with that PR's signed APK, so it can be tested on the phone before merging:
  https://github.com/melhive/OrderBoard/releases/download/preview/OrderBoard-preview.apk
- `.github/workflows/deploy.yml` runs the tests and the web build on every push and PR, and deploys the web app to GitHub Pages from `main`.

### Version numbers

The version is `version` in `package.json`. The app shows the major part ("v19"). Android's `versionCode` is computed from it (`19.0.0` → `190000`, in `android/app/build.gradle`), and Android only updates to a **higher** versionCode. So for every Android release:

1. Bump `package.json` (`19.0.0` → `19.1.0` for features, `19.0.1` for fixes, `20.0.0` for a big release).
2. Add the changes at the top of `CHANGELOG` in `src/data/changelog.ts`. They become the release notes.
3. Merge to `main`.

## Release signing

Every APK is signed with the same release key, which is what lets Android install updates over the old version. The key (PKCS12, alias `orderboard`) is stored as repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `orderboard` |

**Keep a private backup of the keystore and its password. Never make a new key.** If the key is lost or changed, installed copies can't be updated: users would have to uninstall, which deletes their sales data. Without the secrets (for example in a PR from a fork), CI builds a debug APK instead, which can't update a release install.

## Local development

```sh
pnpm install
pnpm dev          # dev server (open on the phone over LAN, or use Chrome device mode)
pnpm test         # agent, storage and full-UI tests (Vitest + jsdom)
pnpm typecheck
pnpm build        # production web build to dist/
pnpm preview      # serve dist/ with the service worker (test offline)
pnpm android:sync # build + copy into android/ (only for a local Gradle build)
```

A local APK build needs Java 21 and the Android SDK (`cd android && ./gradlew assembleDebug`). It's usually easier to push and let CI build it.
