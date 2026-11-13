import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DISPLAY_MAX_EDGE,
  ImageTooLargeError,
  MAX_INPUT_PIXELS,
  processImage,
  THUMB_MAX_EDGE,
  UnsupportedImageError,
} from "./process-image.js";

/** A solid image of the given size, encoded in the given format. */
function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>',
);

describe("processImage: what it accepts", () => {
  it.each([
    ["jpeg", () => solid(64, 48).jpeg().toBuffer()],
    ["png", () => solid(64, 48).png().toBuffer()],
    ["webp", () => solid(64, 48).webp().toBuffer()],
    ["gif", () => solid(64, 48).gif().toBuffer()],
    ["avif", () => solid(64, 48).avif().toBuffer()],
  ])("takes %s and stores WebP", async (_format, make) => {
    const result = await processImage(await make());
    expect(result.width).toBe(64);
    expect(result.height).toBe(48);
    expect((await sharp(result.display).metadata()).format).toBe("webp");
    expect((await sharp(result.thumb).metadata()).format).toBe("webp");
    expect(result.mimeType).toBe("image/webp");
    expect(result.bytes).toBe(result.display.length);
  });

  it.each([
    // libvips in sharp's prebuilt binaries reads SVG through librsvg. "It
    // decodes" is not the test: an SVG is a document that can carry script and
    // a decompression bomb, and is refused before sharp ever parses it.
    ["SVG", async () => SVG],
    ["TIFF", () => solid(64, 48).tiff().toBuffer()],
    ["text", async () => Buffer.from("this is not an image at all")],
    ["an empty upload", async () => Buffer.alloc(0)],
    [
      "HTML wearing a PNG signature",
      async () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("<html>")]),
    ],
  ])("refuses %s", async (_label, make) => {
    await expect(processImage(await make())).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("refuses a JPEG that is cut off part-way", async () => {
    const full = await solid(400, 300).jpeg().toBuffer();
    await expect(processImage(full.subarray(0, Math.floor(full.length / 2)))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it("refuses an image over the pixel limit without decoding it", async () => {
    // A tiny PNG that claims a huge canvas — the shape of a decompression bomb.
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 1;
    const bomb = await solid(side, side).png({ compressionLevel: 9 }).toBuffer();
    await expect(processImage(bomb)).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});

describe("processImage: what it produces", () => {
  it("shrinks the display image to the long-edge cap and the thumbnail to its own, keeping the aspect", async () => {
    const result = await processImage(await solid(4000, 3000).jpeg().toBuffer());
    expect([result.width, result.height]).toEqual([DISPLAY_MAX_EDGE, 1920]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([THUMB_MAX_EDGE, 360]);
  });

  it("never enlarges a small image", async () => {
    const result = await processImage(await solid(120, 90).png().toBuffer());
    expect([result.width, result.height]).toEqual([120, 90]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([120, 90]);
  });

  it("turns a photo the right way up from its EXIF orientation, so stripping it loses nothing", async () => {
    // Stored 200×100 with "rotate 90° clockwise to view": it is a portrait.
    // `withMetadata` writes the tag; the code under test must never call it.
    const sideways = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);
    const result = await processImage(sideways);
    expect([result.width, result.height]).toEqual([100, 200]);
  });

  it("strips every kind of metadata, so a photo's location never reaches the disk", async () => {
    const located = await solid(64, 48)
      .jpeg()
      .withExif({
        IFD0: { Artist: "do-not-keep", Copyright: "do-not-keep" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
      )
      .withIccProfile("p3")
      .toBuffer();
    const before = await sharp(located).metadata();
    expect(before.exif, "the fixture must carry EXIF, or this proves nothing").toBeDefined();
    expect(before.exif?.includes(Buffer.from("do-not-keep"))).toBe(true);
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();

    const result = await processImage(located);
    for (const output of [result.display, result.thumb]) {
      const after = await sharp(output).metadata();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(output.includes(Buffer.from("do-not-keep"))).toBe(false);
    }
  });

  it("keeps only the first frame of an animated GIF", async () => {
    const frames = await sharp({
      create: { width: 32, height: 64, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
    })
      .gif()
      .toBuffer();
    const animated = await sharp(frames, { animated: true }).gif({ loop: 0 }).toBuffer();
    const result = await processImage(animated);
    expect((await sharp(result.display).metadata()).pages ?? 1).toBe(1);
  });
});
