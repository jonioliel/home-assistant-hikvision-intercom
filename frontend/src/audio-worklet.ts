import { encodeMuLaw } from "./audio-codec";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class IntercomMicrophone extends AudioWorkletProcessor {
  private packet = new Uint8Array(800);
  private offset = 0;
  process(inputs: Float32Array[][]): boolean {
    if (sampleRate !== 8000) return false;
    const samples = inputs[0]?.[0];
    if (samples)
      for (const sample of samples) {
        this.packet[this.offset++] = encodeMuLaw(sample);
        if (this.offset === 800) {
          this.port.postMessage(this.packet, [this.packet.buffer]);
          this.packet = new Uint8Array(800);
          this.offset = 0;
        }
      }
    return true;
  }
}
registerProcessor("hikvision-microphone", IntercomMicrophone);
