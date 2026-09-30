import type { Hass } from "./types";

/** Same-origin HA bridge to the administrator-selected go2rtc add-on. */
export class AddonSignaling {
  private socket?: WebSocket;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private hass: Hass,
    private station: string,
    private failed: () => void,
  ) {}
  async subscribe<T>(
    callback: (event: T) => void,
    request: Record<string, unknown>,
    _options?: unknown,
  ): Promise<() => void> {
    const path = "/api/hikvision_intercom/rtc/" + encodeURIComponent(this.station);
    const signed = await this.hass.callWS<{ path: string }>({
      type: "auth/sign_path",
      path,
      expires: 30,
    });
    if (this.closed) return () => {};
    const url = new URL(signed.path, location.origin);
    if (url.origin !== location.origin || url.pathname !== path || url.username || url.password)
      throw Error();
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = (this.socket = new WebSocket(url.href));
    socket.onopen = () => {
      if (this.closed) return;
      socket.send(JSON.stringify({ offer: request.offer }));
      callback({ type: "session", session_id: "addon" } as T);
      this.timer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 15000);
    };
    socket.onmessage = (event) => {
      if (this.closed) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 262144) throw Error();
        const message = JSON.parse(event.data);
        if (message.type === "pong") return;
        if (!["answer", "candidate", "error"].includes(message.type)) throw Error();
        callback(message);
      } catch {
        this.failed();
      }
    };
    socket.onclose = socket.onerror = () => {
      if (!this.closed) this.failed();
    };
    return () => this.close();
  }
  candidate(candidate: RTCIceCandidateInit) {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ candidate: candidate.candidate }));
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    if (this.socket) {
      this.socket.onopen = this.socket.onclose = this.socket.onerror = this.socket.onmessage = null;
      this.socket.close();
      this.socket = undefined;
    }
  }
}
