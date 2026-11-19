// Deterministic listing artwork from this app's existing logo, fonts and scenes.
// flutter test --no-pub tool/prepare_play_store_test.dart
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:findit/core/config/app_config.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _output = 'release/play-store/graphics/feature-graphic-1024x500.png';
const _cream = Color(0xFFFBF7EE);
const _forest = Color(0xFF183C32);
const _inputs = [
  AppConfig.iconAsset,
  'assets/scenes/hidden-001-a.png',
  'assets/scenes/hidden-002-a.png',
  'assets/fonts/Outfit.ttf',
  'assets/fonts/Nunito.ttf',
];

int _crc32(List<int> bytes) {
  var crc = 0xffffffff;
  for (final byte in bytes) {
    crc ^= byte;
    for (var bit = 0; bit < 8; bit++) {
      crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) & 0xffffffff;
}

void _chunk(BytesBuilder output, String type, List<int> data) {
  final content = [...ascii.encode(type), ...data];
  final length = ByteData(4)..setUint32(0, data.length);
  final checksum = ByteData(4)..setUint32(0, _crc32(content));
  output
    ..add(length.buffer.asUint8List())
    ..add(content)
    ..add(checksum.buffer.asUint8List());
}

Uint8List _rgbPng(int width, int height, Uint8List rgba) {
  expect(rgba.length, width * height * 4);
  final scanlines = Uint8List(height * (width * 3 + 1));
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      final source = (y * width + x) * 4;
      if (rgba[source + 3] != 255) {
        throw StateError('Listing artwork must be opaque.');
      }
      final target = y * (width * 3 + 1) + 1 + x * 3;
      scanlines.setRange(target, target + 3, rgba, source);
    }
  }
  final header = ByteData(13)
    ..setUint32(0, width)
    ..setUint32(4, height)
    ..setUint8(8, 8)
    ..setUint8(9, 2); // Truecolor RGB, not RGBA or indexed color.
  final output = BytesBuilder(copy: false)
    ..add([137, 80, 78, 71, 13, 10, 26, 10]);
  _chunk(output, 'IHDR', header.buffer.asUint8List());
  _chunk(output, 'IDAT', ZLibCodec(level: 9).encode(scanlines));
  _chunk(output, 'IEND', const []);
  return output.takeBytes();
}

Future<ui.Image> _loadImage(String path) async {
  final codec = await ui.instantiateImageCodec(File(path).readAsBytesSync());
  final image = (await codec.getNextFrame()).image;
  codec.dispose();
  return image;
}

void _text(
  Canvas canvas,
  String value,
  Offset offset, {
  required double size,
  double width = 450,
  FontWeight weight = FontWeight.w500,
  String family = 'Outfit',
  double height = 1.15,
  Color color = _forest,
}) {
  final painter = TextPainter(
    textDirection: TextDirection.ltr,
    text: TextSpan(
      text: value,
      style: TextStyle(
        fontFamily: family,
        fontSize: size,
        fontWeight: weight,
        height: height,
        color: color,
      ),
    ),
  )..layout(maxWidth: width);
  painter.paint(canvas, offset);
  painter.dispose();
}

void _image(Canvas canvas, ui.Image image, Rect destination) {
  final size = Size(image.width.toDouble(), image.height.toDouble());
  final fitted = applyBoxFit(BoxFit.cover, size, destination.size);
  canvas.drawImageRect(
    image,
    Alignment.center.inscribe(fitted.source, Offset.zero & size),
    Alignment.center.inscribe(fitted.destination, destination),
    Paint()..filterQuality = FilterQuality.high,
  );
}

void _card(Canvas canvas, ui.Image image, Rect rect, double radius) {
  final card = RRect.fromRectAndRadius(rect, Radius.circular(radius));
  canvas.drawShadow(Path()..addRRect(card), const Color(0x40183C32), 14, false);
  canvas.save();
  canvas.clipRRect(card);
  _image(canvas, image, rect);
  canvas.restore();
  canvas.drawRRect(
    card,
    Paint()
      ..color = _cream
      ..style = PaintingStyle.stroke
      ..strokeWidth = 7,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'RGB PNG output has no alpha and a valid round-trip pixel payload',
    () async {
      final pixels = Uint8List.fromList([255, 0, 0, 255, 0, 128, 64, 255]);
      final png = _rgbPng(2, 1, pixels);
      expect(png[24], 8);
      expect(png[25], 2);
      expect(_crc32(ascii.encode('123456789')), 0xcbf43926);
      final codec = await ui.instantiateImageCodec(png);
      final image = (await codec.getNextFrame()).image;
      final decoded = (await image.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      ))!;
      expect(decoded.buffer.asUint8List(), pixels);
      image.dispose();
      codec.dispose();
    },
  );

  test('prepare the Seek More 1024 by 500 Play feature graphic', () async {
    for (final family in ['Outfit', 'Nunito']) {
      final loader = FontLoader(family)
        ..addFont(rootBundle.load('assets/fonts/$family.ttf'));
      await loader.load();
    }
    final logo = await _loadImage(AppConfig.iconAsset);
    final home = await _loadImage(_inputs[1]);
    final garden = await _loadImage(_inputs[2]);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawColor(_cream, BlendMode.src);
    canvas.drawOval(
      const Rect.fromLTWH(472, -140, 800, 760),
      Paint()..color = const Color(0xFFE2E9D8),
    );
    canvas.drawCircle(
      const Offset(1020, 500),
      178,
      Paint()..color = const Color(0xFFD5E0C7),
    );
    _image(canvas, logo, const Rect.fromLTWH(44, 38, 118, 118));
    _text(
      canvas,
      'HIDDEN OBJECT ADVENTURES',
      const Offset(56, 165),
      size: 14,
      family: 'Nunito',
      weight: FontWeight.w800,
    );
    _text(
      canvas,
      AppConfig.name,
      const Offset(50, 194),
      size: 92,
      weight: FontWeight.w700,
    );
    _text(
      canvas,
      'Little things. Wonderful places.\nLook closer.',
      const Offset(56, 317),
      size: 25,
      family: 'Nunito',
      height: 1.4,
      color: const Color(0xFF53675E),
    );
    _card(canvas, home, const Rect.fromLTWH(532, 63, 441, 331), 26);
    _card(canvas, garden, const Rect.fromLTWH(718, 313, 243, 144), 19);
    final picture = recorder.endRecording();
    final image = await picture.toImage(1024, 500);
    final rgba = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    final bytes = _rgbPng(1024, 500, rgba.buffer.asUint8List());
    final file = File(_output)..parent.createSync(recursive: true);
    file.writeAsBytesSync(bytes);
    File('release/play-store/graphics/feature-graphic.json').writeAsStringSync(
      '${const JsonEncoder.withIndent('  ').convert({
        'createdAtUtc': DateTime.now().toUtc().toIso8601String(),
        'generator': 'tool/prepare_play_store_test.dart',
        'appName': AppConfig.name,
        'file': _output,
        'width': 1024,
        'height': 500,
        'format': '24-bit RGB PNG; no alpha',
        'sha256': sha256.convert(bytes).toString(),
        'inputs': {for (final path in _inputs) path: sha256.convert(File(path).readAsBytesSync()).toString()},
        'scope': 'Listing artwork from existing app assets; publisher rights and visual review still required. No new external artwork or fonts.',
      })}\n',
    );
    image.dispose();
    picture.dispose();
    logo.dispose();
    home.dispose();
    garden.dispose();
    stdout.writeln('Prepared $_output (opaque 24-bit RGB PNG).');
  });
}
