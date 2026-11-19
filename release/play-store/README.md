# Seek More · Play listing inputs

Use **Seek More: Hidden Objects Game** as the Google Play listing title (30
characters). The app, production launcher, and installer display name are
**Seek More**. The package remains `abiral.mobile.findit`.

## Listing files

- Title: `release/play-store/title.txt`.
- Short description: `short-description.md` in the project root.
- Full description: `long-description.md` in the project root.
- Icon: `release/play-store/graphics/icon-512.png` (512 × 512).
- Feature graphic: `release/play-store/graphics/feature-graphic-1024x500.png`
  (1024 × 500, 24-bit RGB PNG without alpha).
- Phone screenshots: the verified capture run listed in
  `release/play-store/screenshots/manifest.json`. Each run is retained separately.
  These are actual release-web app captures without browser chrome; review them
  against the Android app before using them in the listing.
- Public policy:
  `https://aviralacharya.github.io/FindIt-Search-Hidden-Objects/privacy-policy`.
  Publish the current generated `privacy-policy.html`; the signed build helper
  checks the complete live page against the app's offline policy.

Generate the feature graphic from the existing logo, scenes and bundled fonts:

```sh
flutter test --no-pub tool/prepare_play_store_test.dart
```

Build and inspect the browser preview and refresh its screenshot evidence:

```sh
flutter build web --release --no-pub --no-web-resources-cdn --dart-define-from-file=config/production.json
python tool/serve_preview.py --port 8772
node tool/verify_web_preview.mjs http://127.0.0.1:8772/
```

Open `http://127.0.0.1:8772/mobile-preview` for a live, resizable phone review.
The server exposes the web build and this review page, not private project files.

## Signed bundle

After the current policy is public, use private masked password entry:

```sh
python tool/build_signed_aab.py --dialog --policy-url https://aviralacharya.github.io/FindIt-Search-Hidden-Objects/privacy-policy
```

The helper retains `Seek-More-1.0.0.aab`, its matching R8 mapping, inspection and
checksums in a new `release/local/<date>/revisions/signed-<time>/` directory. It
reuses the existing upload key and never uploads or publishes anything.

If Flutter's Windows native hooks fail because the installed SDK path contains a
space, use a no-space SDK alias. This workspace's local release helper also checks
`C:\Users\Lenovo\AppData\Local\Temp\opencode\flutter-sdk\bin\flutter.bat`.
The alias points at the installed SDK; it does not move or copy it.

## Console and device gates

- Check that version code `1` is unused for this package before the first upload.
- Confirm the upload certificate and Play App Signing configuration in Console.
- Complete the content rating, target audience, app access, ads and Data safety
  declarations based on the actual app. Do not select child-directed settings or
  certify asset rights automatically.
- Supply the support contact, public privacy-policy URL and required listing art.
- Upload to internal testing, review Play's checks and test Play-generated APKs,
  including a real Android 16 KB-page-size runtime. A browser review is not device QA.
- Complete closed testing/production-access requirements if your developer account
  is subject to them. These cannot be certified from this local repository.

Older APKs and historical verification snapshots are not evidence for the latest
source. Do not upload them as the newly verified release.
