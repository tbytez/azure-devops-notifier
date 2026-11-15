import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'sounds', 'notification.wav');

const SAMPLE_RATE = 22050;
const DURATION = 1.25;
const GAIN = 0.42;
const ATTACK = 0.012;
const RELEASE = 0.25;
const FUNDAMENTAL = 523.25;
const PARTIALS = [
  { ratio: 1.0, weight: 1.0, decay: 4.0 },
  { ratio: 2.756, weight: 0.22, decay: 6.5 },
  { ratio: 5.404, weight: 0.075, decay: 9.0 },
  { ratio: 8.933, weight: 0.025, decay: 12.0 },
];

const frames = Math.round(SAMPLE_RATE * DURATION);
const pcm = Buffer.alloc(frames * 2);
let peak = 0;

for (let i = 0; i < frames; i++) {
  const t = i / SAMPLE_RATE;
  const attack = Math.min(1, t / ATTACK);
  const release = t > DURATION - RELEASE
    ? 0.5 - 0.5 * Math.cos(Math.PI * ((DURATION - t) / RELEASE))
    : 1;
  let s = 0;
  for (const p of PARTIALS) {
    s += Math.sin(2 * Math.PI * FUNDAMENTAL * p.ratio * t) * p.weight * Math.exp(-p.decay * t);
  }
  const v = Math.max(-1, Math.min(1, s * GAIN * attack * release));
  const sample = Math.round(v * 32767);
  if (Math.abs(sample) > peak) peak = Math.abs(sample);
  pcm.writeInt16LE(sample, i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36, 'ascii');
header.writeUInt32LE(pcm.length, 40);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log(`wrote ${OUT} (${frames} frames, ${SAMPLE_RATE}Hz mono 16-bit, ${(frames / SAMPLE_RATE).toFixed(2)}s, peak ${peak})`);
