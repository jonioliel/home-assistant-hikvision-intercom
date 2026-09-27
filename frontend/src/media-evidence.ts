export type MediaEvidence = {
  video: "frame" | "failed" | "waiting";
  listen:
    "rtc_traffic" | "mse_track" | "isapi_signal" | "isapi_bytes" | "not_checked" | "unverified";
  talk: "signal_written" | "bytes_written" | "packets_accepted" | "not_checked";
  transport: string;
  codec: string;
  jitterMs: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Transport evidence only; no browser counter can prove physical audibility. */
export function evaluateMediaEvidence(
  playback: Record<string, unknown> | null,
  audio: {
    state: string;
    microphonePacketsAcknowledged: number;
    backend: Record<string, unknown> | null;
  },
): MediaEvidence {
  const report = record(playback);
  const mse = record(report.mse);
  const rtc = record(report.rtc);
  const rtcAudio = record(rtc.audio);
  const backend = record(audio.backend);
  const transport = typeof report.active_transport === "string" ? report.active_transport : "";
  const codec =
    transport === "rtc" && typeof rtcAudio.codec === "string"
      ? rtcAudio.codec
      : transport === "mse" && typeof mse.codec === "string"
        ? (mse.codec.match(/mp4a\.[A-Za-z0-9.]+|flac|opus/)?.[0] ?? "")
        : "";
  const jitter = rtcAudio.jitter;
  return {
    video:
      report.failed === true
        ? "failed"
        : report.first_frame_at && count(report.width) > 0 && count(report.height) > 0
          ? "frame"
          : "waiting",
    listen:
      report.camera_audio_enabled !== true && audio.state !== "listening"
        ? "not_checked"
        : report.camera_audio_enabled === true &&
            transport === "rtc" &&
            rtc.closed !== true &&
            count(rtcAudio.bytesReceived) > 0
          ? "rtc_traffic"
          : report.camera_audio_enabled === true &&
              transport === "mse" &&
              mse.closed !== true &&
              mse.audio_included === true
            ? "mse_track"
            : count(backend.received_signal_bytes) > 0
              ? "isapi_signal"
              : count(backend.received_bytes) > 0
                ? "isapi_bytes"
                : "unverified",
    talk:
      count(backend.microphone_signal_bytes_written) > 0
        ? "signal_written"
        : count(backend.microphone_bytes_written) > 0
          ? "bytes_written"
          : audio.microphonePacketsAcknowledged > 0
            ? "packets_accepted"
            : "not_checked",
    transport,
    codec,
    jitterMs:
      transport === "rtc" && typeof jitter === "number" && Number.isFinite(jitter) && jitter >= 0
        ? jitter * 1000
        : null,
  };
}
