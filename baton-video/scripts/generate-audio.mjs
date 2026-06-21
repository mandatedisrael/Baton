import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";

const sampleRate = 48000;
const duration = 69;
const samples = sampleRate * duration;
const data = Buffer.alloc(samples * 2);
let seed = 0x2b61746f;

const noise = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0xffffffff * 2 - 1;
};

for (let i = 0; i < samples; i++) {
  const t = i / sampleRate;
  const fadeIn = Math.min(1, t / 1.8);
  const fadeOut = Math.min(1, (duration - t) / 3);
  const breath = 0.72 + 0.28 * Math.sin(Math.PI * 2 * 0.08 * t);
  const pulsePhase = t % 2;
  const pulse = Math.sin(Math.PI * 2 * 46 * t) * Math.exp(-7.5 * pulsePhase);
  const chimePhase = t % 8;
  const chime = Math.sin(Math.PI * 2 * 660 * t) * Math.exp(-4.8 * chimePhase);
  const air = noise() * (0.002 + 0.0015 * Math.sin(Math.PI * 2 * 0.05 * t));
  const drone =
    0.13 * Math.sin(Math.PI * 2 * 55 * t) +
    0.075 * Math.sin(Math.PI * 2 * 82.41 * t) +
    0.04 * Math.sin(Math.PI * 2 * 110 * t);
  const value = (drone * breath + pulse * 0.13 + chime * 0.035 + air) * fadeIn * fadeOut;
  data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), i * 2);
}

const out = Buffer.alloc(44 + data.length);
out.write("RIFF", 0);
out.writeUInt32LE(36 + data.length, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(sampleRate, 24);
out.writeUInt32LE(sampleRate * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(data.length, 40);
data.copy(out, 44);

const target = resolve("public/baton-soundtrack.wav");
mkdirSync(dirname(target), {recursive: true});
writeFileSync(target, out);
console.log(target);
