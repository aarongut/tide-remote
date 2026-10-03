import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["web/app.js"],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "dist/app.js",
});
for (const file of [
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
]) {
  await copyFile(`web/${file}`, `dist/${file}`);
}
// Raster equivalents of our small geometric app icon, including iOS's icon.
function png(size) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  const bars = [
    [112, 194, 34, 124],
    [176, 144, 34, 224],
    [240, 104, 34, 304],
    [304, 160, 34, 192],
    [368, 207, 34, 98],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) * 512) / size,
        py = ((y + 0.5) * 512) / size;
      const active = bars.some(([bx, by, w, h]) => {
        const cx = Math.max(bx + w / 2, Math.min(bx + w / 2, px));
        const cy = Math.max(by + w / 2, Math.min(by + h - w / 2, py));
        return (px - cx) ** 2 + (py - cy) ** 2 <= (w / 2) ** 2;
      });
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      bytes[offset] = active ? 129 : 16;
      bytes[offset + 1] = active ? 176 : 17;
      bytes[offset + 2] = active ? 255 : 20;
      bytes[offset + 3] = 255;
    }
  function crc(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const n = Buffer.alloc(4);
    n.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([n, name, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(bytes)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
await Promise.all(
  [
    [192, "icon-192.png"],
    [512, "icon-512.png"],
    [180, "apple-touch-icon.png"],
  ].map(([size, name]) => writeFile(`dist/${name}`, png(size))),
);
console.log("Built Tide 16 PWA in dist/");
