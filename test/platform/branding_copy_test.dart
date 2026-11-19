import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:findit/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('current public copy and bundled credits have no legacy branding', () {
    for (final path in [
      'README.md',
      'pubspec.yaml',
      'short-description.md',
      'long-description.md',
      'privacy-policy.html',
      'assets/legal/privacy-policy.json',
      'assets/legal/original-assets.txt',
      'web/index.html',
      'web/manifest.json',
      'tool/mobile_preview.html',
      'release/play-store/README.md',
      'release/play-store/title.txt',
    ]) {
      // The existing repository/policy URL is a technical identifier, not copy.
      final copy = File(path)
          .readAsStringSync()
          .replaceAll(RegExp(r'https://[^\s"<>]+'), '');
      expect(copy, isNot(matches(RegExp(r'\bFind[ -]?It\b'))), reason: path);
    }
    final catalog = jsonDecode(
      File('assets/content/catalog.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    expect(catalog['license'], contains(AppConfig.name));
    expect(catalog['license'], isNot(matches(RegExp(r'\bFind[ -]?It\b'))));
    for (final path in [
      'config/packs/example-v1.json',
      'config/packs/pack-v1.schema.json',
    ]) {
      expect(
        File(path).readAsStringSync(),
        isNot(matches(RegExp(r'\bFind[ -]?It\b'))),
        reason: path,
      );
    }
  });

  test('Google Play title is distinct from the installed app name', () {
    expect(AppConfig.playStoreTitle, 'Seek More: Hidden Objects Game');
    expect(AppConfig.playStoreTitle.length, lessThanOrEqualTo(30));
    expect(AppConfig.playStoreTitle, isNot(AppConfig.name));
    expect(
      File('release/play-store/title.txt').readAsStringSync().trim(),
      AppConfig.playStoreTitle,
    );
    expect(
      File('long-description.md').readAsStringSync(),
      contains(AppConfig.playStoreTitle),
    );
  });

  test('current Play artwork and screenshots use the renamed app', () {
    final graphic = jsonDecode(
      File('release/play-store/graphics/feature-graphic.json')
          .readAsStringSync(),
    ) as Map<String, dynamic>;
    final screenshots = jsonDecode(
      File('release/play-store/screenshots/manifest.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    expect(graphic['appName'], AppConfig.name);
    expect(screenshots['appName'], AppConfig.name);
    expect(screenshots['status'], 'passed');
    expect(screenshots['captures'], hasLength(4));
    for (final record in [graphic, ...(screenshots['captures'] as List)]) {
      final file = File(record['file'] as String);
      expect(
        sha256.convert(file.readAsBytesSync()).toString(),
        record['sha256'],
        reason: file.path,
      );
    }
  });

  test('bundled provenance identifies the current untouched publisher PNG', () {
    final digest = sha256
        .convert(File('assets/branding/icon_source.png').readAsBytesSync())
        .toString();
    final provenance = File('assets/legal/original-assets.txt')
        .readAsStringSync();
    expect(provenance, contains('SHA-256 $digest.'));
    expect(provenance, contains('golden-leaf'));
    final record = jsonDecode(
      File('verification/branding/icon-source.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    expect(record['sha256'], digest);
  });
}
