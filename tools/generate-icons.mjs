import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GitBranch } from 'lucide-react';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'icons');

const svg = renderToStaticMarkup(
  createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 64, height: 64, viewBox: '0 0 64 64' },
    createElement('rect', { width: 64, height: 64, rx: 20, fill: '#1f7a71' }),
    createElement(GitBranch, { x: 16, y: 16, width: 32, height: 32, color: '#ffffff', strokeWidth: 2 }),
  ),
);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'brand.svg'), `${svg}\n`);
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png`);
}
