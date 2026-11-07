import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const source = readFileSync(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = fileURLToPath(new URL('.', import.meta.url));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = [];
for (const size of sizes) images.push(await sharp(source).trim().resize(size - 2, size - 2, { fit: 'contain', background: '#00000000' }).extend({ top: 1, bottom: 1, left: 1, right: 1, background: '#00000000' }).png().toBuffer());
writeFileSync(directory + 'CyberFi-tray.png', images.at(-1));
writeFileSync(directory + 'CyberFi-tray-20.png', images[1]);
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (const [index, png] of images.entries()) {
  const start = 6 + index * 16, size = sizes[index];
  header[start] = size === 256 ? 0 : size; header[start + 1] = header[start];
  header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(png.length, start + 8); header.writeUInt32LE(offset, start + 12);
  offset += png.length;
}
const ico = Buffer.concat([header, ...images]);
writeFileSync(directory + '../windows/CyberFi.ico', ico);
writeFileSync(directory + 'asset-manifest.json', JSON.stringify({ sourceSha256: hash(source), pngSha256: hash(images.at(-1)), icoSha256: hash(ico), sizes, derivation: 'Approved source pixels; transparent trim, contain resize, one-pixel transparent border. Spiral and white circuitry retained.' }, null, 2));
