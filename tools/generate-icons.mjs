import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GitBranch } from 'lucide-react';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'icons');

function renderBrand(glyphSize, strokeWidth) {
  const inset = (64 - glyphSize) / 2;
  return renderToStaticMarkup(
    createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 64, height: 64, viewBox: '0 0 64 64' },
      createElement('rect', { width: 64, height: 64, rx: 20, fill: '#1f7a71' }),
      createElement(GitBranch, {
        x: inset, y: inset, width: glyphSize, height: glyphSize, color: '#ffffff', strokeWidth,
      }),
    ),
  );
}

const svg = renderBrand(32, 2);
// Make the branch legible at Chrome's 16 DIP toolbar size.
const smallIconSvg = renderBrand(48, 2.5);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'brand.svg'), `${svg}\n`);
for (const size of [16, 20, 24, 32, 48, 128]) {
  const iconSvg = size <= 32 ? smallIconSvg : svg;
  const png = new Resvg(iconSvg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png`);
}
