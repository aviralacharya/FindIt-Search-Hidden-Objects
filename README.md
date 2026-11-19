# Seek More

<img src="assets/branding/app_icon.png" alt="Seek More magnifying-glass and golden-leaf app icon" width="96" height="96" />

*Little things. Wonderful places. Look closer.*

Seek More is an offline hidden-object game for Android. Explore colorful scenes, find hidden items, and earn rewards at your own pace.

- **Version:** 1.0.0 (unreleased).
- **Android:** 7.0 and later.

## Features

- 60 bundled levels that work offline.
- Pan, zoom, and follow the object checklist.
- Relaxed or timed gameplay.
- Earned coins, two-stage hints, scores, and stars.
- Daily Challenges with bonus rewards.
- Save and resume progress, with adjustable sound, music, and vibration.

## Mobile browser preview

An APK requires Android; a browser cannot execute it directly. The same Flutter
project can run as a phone-sized web preview. In the prepared local workspace:

```sh
flutter build web --release --no-pub --no-web-resources-cdn --dart-define-from-file=config/production.json
python tool/serve_preview.py --port 8772
```

Open [the mobile preview](http://127.0.0.1:8772/mobile-preview). Choose a phone size
or rotate it without resetting progress. The local server supplies the isolation
headers needed for durable web storage; do not replace it with a plain file URL.
The preview is not an Android installation or APK/device test. Local Python
helpers are excluded from the public repository.

## Branding

The app, launcher, and production installer display name is **Seek More**. The Google Play listing title is **Seek More: Hidden Objects Game**, recorded in `release/play-store/title.txt`. Development and QA installers keep their identifying suffixes (**Seek More Dev** and **Seek More QA**). The Android package ID, signing identity, and local save namespace are unchanged.

The original logo is preserved in `assets/branding/icon_source.png`. The app, Android launcher and splash screens, web icons, and Play Store icon are generated from that image without stretching it.

To regenerate the branding assets:

```sh
flutter test --no-pub tool/prepare_branding_test.dart
```

The in-app logo retains transparency. `release/play-store/graphics/icon-512.png` is the opaque 512-pixel Play Store icon. Existing APKs must be rebuilt and reinstalled to show updated branding.

Android 12 opening screens use `assets/branding/android12_splash_mark.png`, a 960-pixel master rendered from the same original logo. Native day/night splash assets are generated at 240dp for each screen density (240–960 pixels), rather than enlarging the small legacy splash image.

## Privacy

No accounts, ads, analytics, or in-app purchases. Game progress and settings are stored locally on your device. The complete policy is also available offline in the app.

[Read the privacy policy](https://aviralacharya.github.io/FindIt-Search-Hidden-Objects/privacy-policy)

## Support

- **Developer:** Abiral Acharya.
- **Email:** `abiralacharya80@gmail.com`.
