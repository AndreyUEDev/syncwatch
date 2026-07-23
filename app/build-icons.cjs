// Собирает icon.ico со смешанными кадрами: мелкие размеры — упрощённый play (чёткий в трее),
// крупные — детальный логотип. Плюс перезаписывает Windows-PNG мелких размеров.
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');

const dir = 'src-tauri/icons';
const detailed = `${dir}/logo.svg`;
const small = `${dir}/logo-small.svg`;

const png = (svg, size) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();

(async () => {
  const smallFrames = await Promise.all([16, 24, 32, 48].map((s) => png(small, s)));
  const largeFrames = await Promise.all([64, 128, 256].map((s) => png(detailed, s)));
  const ico = await pngToIco([...smallFrames, ...largeFrames]);
  fs.writeFileSync(`${dir}/icon.ico`, ico);
  fs.writeFileSync(`${dir}/32x32.png`, await png(small, 32));
  console.log('icon.ico (mixed) + 32x32.png rebuilt');
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
