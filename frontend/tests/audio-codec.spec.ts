import { test, expect } from "@playwright/test";
import { encodeMuLaw, decodeMuLaw } from "../src/audio-codec";

test("G.711 reference values include both silence codes and the full amplitude range", () => {
  const vectors = [
    [255, 0],
    [127, 0],
    [128, 32124],
    [0, -32124],
    [240, 120],
    [112, -120],
    [206, 988],
    [78, -988],
    [156, 9852],
    [28, -9852],
  ];
  for (const [code, pcm] of vectors) expect(decodeMuLaw(code) * 32768).toBe(pcm);
  expect(encodeMuLaw(0)).toBe(255);
  expect(encodeMuLaw(1)).toBe(128);
  expect(encodeMuLaw(-1)).toBe(0);
});

test("G.711 companding is monotonic with bounded quantization error across PCM16", () => {
  let previous = -Infinity,
    maximumError = 0,
    monotonic = true;
  for (let pcm = -32768; pcm <= 32767; pcm++) {
    const decoded = decodeMuLaw(encodeMuLaw(pcm / 32768)) * 32768;
    maximumError = Math.max(maximumError, Math.abs(decoded - pcm));
    monotonic &&= decoded >= previous;
    previous = decoded;
  }
  expect(maximumError).toBeLessThanOrEqual(644);
  expect(monotonic).toBe(true);
});
