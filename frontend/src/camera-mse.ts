import type { Hass } from "./types";

const CODECS = ["avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0"];
const ERRORS = new Set([
  "mse_provider_unavailable",
  "mse_connection_lost",
  "mse_codec_unavailable",
  "mse_protocol_error",
  "mse_session_changed",
]);
/** Binary fMP4 over the authenticated HA origin; no camera or go2rtc secrets in the browser. */
export class CameraMSE {
  private socket?: WebSocket;
  private media?: MediaSource;
  private buffer?: SourceBuffer;
  private objectUrl?: string;
  private queue: ArrayBuffer[] = [];
  private queued = 0;
  private closed = false;
  private bytes = 0;
  private chunks = 0;
  private codec = "";
  private playing = false;
  private loaded = () => {
    if (!this.closed && !this.playing && this.video.videoWidth && this.video.videoHeight) {
      this.playing = true;
      this.ready();
    }
  };
  constructor(
    private hass: Hass,
    private station: string,
    private video: HTMLVideoElement,
    private ready: () => void,
    private failed: (reason: string) => void,
  ) {}
  async start() {
    try {
      const Constructor =
        (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ??
        window.MediaSource;
      if (!Constructor) {
        this.fail("mse_browser_unavailable");
        return;
      }
      const codecs = CODECS.filter((codec) =>
        Constructor.isTypeSupported(`video/mp4; codecs="${codec}"`),
      );
      if (!codecs.length) {
        this.fail("mse_codec_unavailable");
        return;
      }
      const path = "/api/hikvision_intercom/mse/" + encodeURIComponent(this.station);
      const signed = await this.hass.callWS<{ path: string }>({
        type: "auth/sign_path",
        path,
        expires: 30,
      });
      if (this.closed) return;
      const url = new URL(signed.path, location.origin);
      if (url.origin !== location.origin || url.pathname !== path || url.username || url.password)
        throw Error();
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const media = (this.media = new Constructor());
      media.addEventListener(
        "sourceopen",
        () => {
          if (this.closed) return;
          const socket = (this.socket = new WebSocket(url.href));
          socket.binaryType = "arraybuffer";
          socket.onopen = () => socket.send(JSON.stringify({ codecs }));
          socket.onclose = () => this.fail("mse_connection_lost");
          socket.onerror = () => this.fail("mse_connection_lost");
          socket.onmessage = (event) => {
            if (this.closed) return;
            try {
              if (typeof event.data === "string") {
                if (event.data.length > 1024) throw Error();
                const message = JSON.parse(event.data);
                if (message.type === "error") {
                  this.fail(ERRORS.has(message.code) ? message.code : "mse_connection_lost");
                  return;
                }
                if (
                  this.buffer ||
                  message.type !== "mse" ||
                  typeof message.value !== "string" ||
                  !/^video\/mp4; codecs="(?:avc1|hvc1|hev1)[A-Za-z0-9.]+"$/.test(message.value) ||
                  !Constructor.isTypeSupported(message.value)
                )
                  throw Error();
                this.codec = message.value;
                this.buffer = media.addSourceBuffer(message.value);
                this.buffer.addEventListener("updateend", this.drain);
                this.buffer.addEventListener("error", this.bufferError);
              } else {
                if (
                  !(event.data instanceof ArrayBuffer) ||
                  !this.buffer ||
                  event.data.byteLength > 4 * 1024 * 1024 ||
                  this.queued + event.data.byteLength > 8 * 1024 * 1024
                )
                  throw Error();
                this.bytes += event.data.byteLength;
                this.chunks++;
                this.queue.push(event.data);
                this.queued += event.data.byteLength;
                this.drain();
              }
            } catch {
              this.fail("mse_protocol_error");
            }
          };
        },
        { once: true },
      );
      this.video.addEventListener("loadeddata", this.loaded);
      this.video.disableRemotePlayback = true;
      this.objectUrl = URL.createObjectURL(media);
      this.video.srcObject = null;
      this.video.src = this.objectUrl;
      void this.video.play().catch(() => {});
    } catch {
      this.fail("mse_connection_lost");
    }
  }
  private bufferError = () => this.fail("mse_codec_unavailable");
  private drain = () => {
    const buffer = this.buffer;
    if (this.closed || !buffer || buffer.updating) return;
    try {
      if (buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        const start = buffer.buffered.start(0);
        if (end - this.video.currentTime > 3) this.video.currentTime = Math.max(start, end - 0.5);
        if (end - start > 8) {
          buffer.remove(start, end - 6);
          return;
        }
      }
      const data = this.queue.shift();
      if (data) {
        this.queued -= data.byteLength;
        buffer.appendBuffer(data);
      }
    } catch {
      this.fail("mse_buffer_failed");
    }
  };
  summary() {
    return {
      bytes_received: this.bytes,
      fragments_received: this.chunks,
      codec: this.codec,
      video_decoded: this.playing,
      closed: this.closed,
    };
  }
  private fail(reason: string) {
    if (!this.closed) {
      this.close();
      this.failed(reason);
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.video.removeEventListener("loadeddata", this.loaded);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    if (this.buffer) {
      this.buffer.removeEventListener("updateend", this.drain);
      this.buffer.removeEventListener("error", this.bufferError);
      try {
        this.buffer.abort();
      } catch {}
    }
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.queue = [];
    this.queued = 0;
  }
}
