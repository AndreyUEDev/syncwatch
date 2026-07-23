// Генерирует картинки для NSIS-инсталлятора из логотипа:
//   header.bmp  — 150x57  (баннер вверху страниц установки)
//   sidebar.bmp — 164x314 (боковая панель welcome/finish)
// NSIS требует BMP; sharp его не пишет, поэтому кодируем 24-bit BMP вручную. Вес ~150 КБ.
const sharp = require('sharp');
const fs = require('fs');

const dir = 'src-tauri/installer';
fs.mkdirSync(dir, { recursive: true });

function gradient(w, h) {
  // фиолетовый градиент под тему приложения
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="${w}" y2="${h}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#5b21b6"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`;
  return Buffer.from(svg);
}

// raw RGB (channels=3, top-down) → 24-bit BMP (bottom-up, BGR, строки кратны 4 байтам)
function encodeBmp(rgb, w, h) {
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixels = rowSize * h;
  const fileSize = 54 + pixels;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; // bottom-up
    let off = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 3;
      buf[off++] = rgb[s + 2]; // B
      buf[off++] = rgb[s + 1]; // G
      buf[off++] = rgb[s]; // R
    }
  }
  return buf;
}

// Белый play-значок с мягкой тенью (хорошо читается на фиолетовом градиенте)
function whitePlay(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#2e1065" flood-opacity="0.45"/>
    </filter></defs>
    <path filter="url(#s)" fill="#ffffff"
      d="M 34 24 L 34 76 Q 34 84 41 80 L 78 54 Q 84 50 78 46 L 41 20 Q 34 16 34 24 Z"/>
  </svg>`;
  return Buffer.from(svg);
}

async function makeBmp(w, h, logoBuf, top, left, out) {
  const { data } = await sharp(gradient(w, h))
    .composite([{ input: logoBuf, top, left }])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  fs.writeFileSync(out, encodeBmp(data, w, h));
}

(async () => {
  const headerLogo = await sharp(whitePlay(40), { density: 256 }).resize(40, 40).png().toBuffer();
  const sideLogo = await sharp(whitePlay(84), { density: 384 }).resize(84, 84).png().toBuffer();
  await makeBmp(150, 57, headerLogo, 9, 102, `${dir}/header.bmp`);
  await makeBmp(164, 314, sideLogo, 46, 40, `${dir}/sidebar.bmp`);
  console.log('installer images: header.bmp + sidebar.bmp');
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
