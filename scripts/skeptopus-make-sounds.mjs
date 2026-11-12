#!/usr/bin/env node
// SkeptOpus / the four sounds, one per answer. Written by arithmetic, here: no recording, no sample, no library.
//
//   node scripts/skeptopus-make-sounds.mjs [out folder]      (default: core/sounds)
//
// The octopus lives under water, and the page already shows one bubble per thing seen. So:
//   proven           one bright bubble, then a smaller one above it: it rose, it is there.
//   not_proven       two knocks on an empty box, the second lower: nobody home.
//   contradicted     the stamp comes down, then a short sour note that sinks.
//   could_not_check  a muffled bubble that stays low, then a small rising "hm?".
// Same input, same bytes: a test rebuilds them and compares, so what ships is what this file writes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RATE = 22050;
const TAU = Math.PI * 2;

/** A small repeatable noise source: the same seed gives the same grain on every machine. */
function noiseSource(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/** One voice added into the buffer: a tone that may glide, with a quick start and a fading tail. */
function tone(buf, { at = 0, dur, from, to = from, gain = 0.5, decay = dur / 3, bend = 1, partials = [[1, 1]], drive = 0 }) {
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  const phases = partials.map(() => 0);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const f = from + (to - from) * Math.pow(i / n, bend);
    const rise = Math.min(1, t / 0.003);
    const fall = Math.min(1, (n - i) / (0.006 * RATE));
    const env = rise * fall * Math.exp(-Math.max(0, t - 0.003) / decay);
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      phases[p] += (TAU * f * partials[p][0]) / RATE;
      s += Math.sin(phases[p]) * partials[p][1];
    }
    if (drive) s = Math.tanh(s * drive) / Math.tanh(drive);
    buf[start + i] += s * env * gain;
  }
}

/** A short breath of filtered noise: the wood of a knock, the rubber of a stamp. */
function knock(buf, { at = 0, dur = 0.03, gain = 0.4, decay = 0.008, cutoff = 1500, seed = 1 }) {
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  const next = noiseSource(seed);
  const k = 1 - Math.exp((-TAU * cutoff) / RATE);
  let low = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    low += k * (next() - low);
    buf[start + i] += low * Math.exp(-(i / RATE) / decay) * Math.min(1, i / (0.0008 * RATE)) * gain;
  }
}

export const SOUNDS = {
  proven: {
    seconds: 0.3,
    peak: 0.42,
    build: (b) => {
      tone(b, { at: 0, dur: 0.11, from: 560, to: 1180, bend: 0.7, gain: 0.5, decay: 0.036 });
      tone(b, { at: 0.118, dur: 0.1, from: 840, to: 1660, bend: 0.7, gain: 0.3, decay: 0.03 });
    },
  },
  not_proven: {
    seconds: 0.36,
    peak: 0.5,
    build: (b) => {
      knock(b, { at: 0, gain: 0.5, cutoff: 1900, seed: 11 });
      tone(b, { at: 0, dur: 0.1, from: 392, to: 372, gain: 0.55, decay: 0.024, partials: [[1, 1], [2.76, 0.22]] });
      knock(b, { at: 0.135, gain: 0.45, cutoff: 1500, seed: 12 });
      tone(b, { at: 0.135, dur: 0.13, from: 294, to: 276, gain: 0.6, decay: 0.03, partials: [[1, 1], [2.76, 0.2]] });
    },
  },
  contradicted: {
    seconds: 0.5,
    peak: 0.62,
    build: (b) => {
      knock(b, { at: 0, dur: 0.05, gain: 0.9, decay: 0.012, cutoff: 900, seed: 21 });
      tone(b, { at: 0, dur: 0.24, from: 124, to: 52, bend: 0.6, gain: 0.9, decay: 0.07 });
      tone(b, { at: 0.17, dur: 0.3, from: 233.1, to: 200, gain: 0.3, decay: 0.1, partials: [[1, 1], [2, 0.5], [3, 0.3]], drive: 1.6 });
      tone(b, { at: 0.17, dur: 0.3, from: 246.9, to: 212, gain: 0.3, decay: 0.1, partials: [[1, 1], [2, 0.5], [3, 0.3]], drive: 1.6 });
    },
  },
  could_not_check: {
    seconds: 0.4,
    peak: 0.45,
    build: (b) => {
      tone(b, { at: 0, dur: 0.14, from: 300, to: 262, gain: 0.5, decay: 0.055 });
      tone(b, { at: 0.2, dur: 0.14, from: 286, to: 374, bend: 1.4, gain: 0.36, decay: 0.05 });
    },
  },
};

/** The bytes of one sound: 16-bit mono WAV. */
export function wav(name) {
  const spec = SOUNDS[name];
  const buf = new Float64Array(Math.round(spec.seconds * RATE));
  spec.build(buf);
  let top = 0;
  for (const v of buf) top = Math.max(top, Math.abs(v));
  const scale = top ? spec.peak / top : 0;
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * scale)) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const startedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (startedAs === import.meta.url) {
  const out = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "core", "sounds"));
  mkdirSync(out, { recursive: true });
  for (const name of Object.keys(SOUNDS)) {
    const bytes = wav(name);
    writeFileSync(join(out, name + ".wav"), bytes);
    console.log(name + ".wav", bytes.length, "bytes", SOUNDS[name].seconds + " s");
  }
}
