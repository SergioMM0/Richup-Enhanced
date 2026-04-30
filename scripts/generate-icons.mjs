import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svg = readFileSync(resolve('public/icons/icon.svg'));

for (const size of [16, 48, 128]) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(`public/icons/icon${size}.png`));
  console.log(`wrote public/icons/icon${size}.png`);
}
