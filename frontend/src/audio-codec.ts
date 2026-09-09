/** ITU G.711 mu-law, 8 kHz mono. Web Audio resamples the device microphone. */
export function encodeMuLaw(sample: number): number {
  let pcm = Math.max(-32768, Math.min(32767, Math.trunc(sample * 32768)));
  const sign = pcm < 0 ? 0x80 : 0;
  if (sign) pcm = -pcm;
  pcm = Math.min(32635, pcm) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(pcm & mask); mask >>= 1) exponent--;
  return ~(sign | (exponent << 4) | ((pcm >> (exponent + 3)) & 15)) & 255;
}
export function decodeMuLaw(value: number): number {
  const code = ~value & 255;
  const magnitude = (((code & 15) << 3) + 132) << ((code >> 4) & 7);
  return (code & 0x80 ? 132 - magnitude : magnitude - 132) / 32768;
}
