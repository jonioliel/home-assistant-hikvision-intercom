import { expect, test } from "@playwright/test";
import { evaluateMediaEvidence } from "../src/media-evidence";

test("separates decoded video, MSE audio track and microphone transport", () => {
  const result = evaluateMediaEvidence(
    {
      active_transport: "mse",
      first_frame_at: "2026-09-28T00:00:00Z",
      width: 1280,
      height: 720,
      camera_audio_enabled: true,
      mse: { audio_included: true, codec: 'video/mp4; codecs="avc1.42E01E, flac"' },
    },
    {
      state: "listening",
      microphonePacketsAcknowledged: 8,
      backend: { microphone_signal_bytes_written: 800 },
    },
  );
  expect(result.video).toBe("frame");
  expect(result.listen).toBe("mse_track");
  expect(result.talk).toBe("signal_written");
});

test("reports untested paths without treating missing evidence as a failure", () => {
  const result = evaluateMediaEvidence(null, {
    state: "idle",
    microphonePacketsAcknowledged: 0,
    backend: null,
  });
  expect(result.video).toBe("waiting");
  expect(result.listen).toBe("not_checked");
  expect(result.talk).toBe("not_checked");
});

test("preserves RTC codec and jitter while distinguishing received traffic", () => {
  const result = evaluateMediaEvidence(
    {
      active_transport: "rtc",
      camera_audio_enabled: true,
      rtc: { audio: { bytesReceived: 4096, codec: "audio/PCMU", jitter: 0.018 } },
    },
    { state: "listening", microphonePacketsAcknowledged: 0, backend: null },
  );
  expect(result.listen).toBe("rtc_traffic");
  expect(result.codec).toBe("audio/PCMU");
  expect(result.jitterMs).toBe(18);
});

test("recognizes ISAPI receive signal but does not imply station speaker output", () => {
  const result = evaluateMediaEvidence(
    { active_transport: "hls", camera_audio_enabled: false },
    {
      state: "listening",
      microphonePacketsAcknowledged: 4,
      backend: { received_signal_bytes: 400, microphone_bytes_written: 800 },
    },
  );
  expect(result.listen).toBe("isapi_signal");
  expect(result.talk).toBe("bytes_written");
});

test("a muted or closed camera track cannot replace active ISAPI evidence", () => {
  const result = evaluateMediaEvidence(
    {
      active_transport: "mse",
      camera_audio_enabled: false,
      mse: { audio_included: true, closed: true },
    },
    {
      state: "listening",
      microphonePacketsAcknowledged: 0,
      backend: { received_signal_bytes: 400 },
    },
  );
  expect(result.listen).toBe("isapi_signal");
});
