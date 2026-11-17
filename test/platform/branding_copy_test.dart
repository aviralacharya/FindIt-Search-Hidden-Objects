import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:findit/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('current public copy and bundled credits use Find It', () {
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
    ]) {
      // The existing repository/policy URL is a technical identifier, not copy.
      final copy = File(path)
          .readAsStringSync()
          .replaceAll(RegExp(r'https://[^\s"<>]+'), '');
      expect(copy, isNot(contains('FindIt')), reason: path);
    }
    final catalog = jsonDecode(
      File('assets/content/catalog.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    expect(catalog['license'], contains(AppConfig.name));
    expect(catalog['license'], isNot(contains('FindIt')));
    for (final path in [
      'config/packs/example-v1.json',
      'config/packs/pack-v1.schema.json',
    ]) {
      expect(File(path).readAsStringSync(), isNot(contains('FindIt')));
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
