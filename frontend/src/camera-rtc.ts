import { AddonSignaling } from "./camera-signaling";
import type { Hass } from "./types";

type Signal =
  | { type: "session"; session_id: string }
  | { type: "answer"; answer: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "error" };
/** Use HA's authenticated camera signaling and its configured WebRTC provider. */
export class CameraRTC {
  private addon?: AddonSignaling;
  private peer?: RTCPeerConnection;
  private closed = false;
  private unsubscribe?: () => void;
  private session?: string;
  private candidates: RTCIceCandidateInit[] = [];
  private remote: RTCIceCandidateInit[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private stream = new MediaStream();
  private sequence = Promise.resolve();
  private playing = false;
  private lastConnection = "new";
  private lastIce = "new";
  private startedAt = new Date().toISOString();
  private firstFrameAt: string | null = null;
  private failureReason: string | null = null;
  private incoming = 0;
  private sentCandidates = 0;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private loaded = () => {
    if (
      this.closed ||
      this.playing ||
      !this.stream.getVideoTracks().length ||
      !this.video.videoWidth ||
      !this.video.videoHeight
    )
      return;
    this.playing = true;
    this.firstFrameAt = new Date().toISOString();
    clearTimeout(this.timer);
    this.ready();
  };
  constructor(
    private hass: Hass,
    private entity: string,
    private video: HTMLVideoElement,
    private ready: () => void,
    private failed: (reason: string) => void,
    private station?: string,
    private tcpOnly = true,
  ) {}
  async start() {
    this.timer = setTimeout(() => this.fail("no_frame"), 12000);
    this.video.addEventListener("loadeddata", this.loaded);
    try {
      if (this.station) this.addon = new AddonSignaling(this.hass, this.station, () => this.fail());
      const config = this.addon
        ? { configuration: { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] } }
        : await this.hass.callWS<{
            configuration: RTCConfiguration;
            dataChannel?: string;
          }>({ type: "camera/webrtc/get_client_config", entity_id: this.entity });
      if (this.closed) return;
      const peer = (this.peer = new RTCPeerConnection(config.configuration));
      if ("dataChannel" in config && config.dataChannel) peer.createDataChannel(config.dataChannel);
      peer.ontrack = (event) => {
        if (this.closed) return;
        this.stream.addTrack(event.track);
        event.track.onended = () => this.fail("track_ended");
        this.video.srcObject = this.stream;
        void this.video.play().catch(() => {});
      };
      peer.onconnectionstatechange = () => {
        clearTimeout(this.disconnectTimer);
        if (peer.connectionState === "failed") this.fail("connection_failed");
        else if (peer.connectionState === "disconnected")
          this.disconnectTimer = setTimeout(() => this.fail("connection_lost"), 3000);
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate || this.closed) return;
        const candidate = event.candidate.toJSON();
        if (this.station && this.tcpOnly && / udp /i.test(candidate.candidate ?? "")) return;
        if (this.session) void this.send(candidate);
        else if (this.candidates.length < 100) this.candidates.push(candidate);
        else this.fail("signal_limit");
      };
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      const offer = await peer.createOffer();
      if (this.closed) return;
      await peer.setLocalDescription(offer);
      if (this.closed) return;
      const unsubscribe = await (
        this.addon
          ? this.addon.subscribe.bind(this.addon)
          : this.hass.connection.subscribeMessage.bind(this.hass.connection)
      )<Signal>(
        (event) => {
          if (this.closed) return;
          if (++this.incoming > 256) {
            this.fail("signal_limit");
            return;
          }
          this.sequence = this.sequence.then(() => this.receive(event)).catch(() => this.fail());
        },
        { type: "camera/webrtc/offer", entity_id: this.entity, offer: offer.sdp },
        { resubscribe: false, preCheck: () => !this.closed && this.peer === peer },
      );
      if (this.closed) void Promise.resolve(unsubscribe()).catch(() => {});
      else this.unsubscribe = unsubscribe;
    } catch {
      this.fail();
    }
  }
  private async send(candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    if (++this.sentCandidates > 100) {
      this.fail("signal_limit");
      return;
    }
    try {
      if (this.addon) {
        this.addon.candidate(candidate);
        return;
      }
      await this.hass.callWS({
        type: "camera/webrtc/candidate",
        entity_id: this.entity,
        session_id: this.session,
        candidate,
      });
    } catch {
      this.fail();
    }
  }
  private async receive(event: Signal) {
    const peer = this.peer;
    if (this.closed || !peer) return;
    if (event.type === "session") {
      if (this.session || typeof event.session_id !== "string" || event.session_id.length > 256) {
        this.fail();
        return;
      }
      this.session = event.session_id;
      const queued = this.candidates.splice(0);
      for (const candidate of queued) await this.send(candidate);
    } else if (event.type === "answer") {
      if (typeof event.answer !== "string" || event.answer.length > 262144) {
        this.fail();
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: event.answer });
      if (this.closed) return;
      for (const candidate of this.remote.splice(0)) {
        if (this.closed) return;
        await peer.addIceCandidate(candidate);
      }
    } else if (event.type === "candidate") {
      if (this.station && this.tcpOnly && / udp /i.test(event.candidate.candidate ?? "")) return;
      const candidate =
        event.candidate.sdpMid != null || event.candidate.sdpMLineIndex != null
          ? event.candidate
          : { ...event.candidate, sdpMid: "0" };
      if (peer.remoteDescription) await peer.addIceCandidate(candidate);
      else if (this.remote.length < 100) this.remote.push(candidate);
      else this.fail("signal_limit");
    } else this.fail();
  }
  summary(): Record<string, unknown> {
    return {
      ice_transport: this.station && this.tcpOnly ? "tcp" : "auto",
      connection_state: this.closed ? this.lastConnection : (this.peer?.connectionState ?? "new"),
      ice_state: this.closed ? this.lastIce : (this.peer?.iceConnectionState ?? "new"),
      provider: this.station ? "selected_go2rtc" : "home_assistant",
      started_at: this.startedAt,
      first_frame_at: this.firstFrameAt,
      video_decoded: this.playing,
      closed: this.closed,
      failure: this.failureReason,
      signaling_messages: this.incoming,
      local_candidates_sent: this.sentCandidates,
    };
  }
  async diagnostics(): Promise<Record<string, unknown>> {
    const result = this.summary();
    const peer = this.peer;
    if (!peer || this.closed || typeof peer.getStats !== "function") return result;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const stats = await Promise.race([
        peer.getStats(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(Error()), 2000);
        }),
      ]);
      const video: Record<string, unknown> = {};
      stats.forEach((entry) => {
        if (entry.type !== "inbound-rtp" || entry.kind !== "video") return;
        for (const key of [
          "bytesReceived",
          "packetsReceived",
          "packetsLost",
          "framesDecoded",
          "framesDropped",
          "frameWidth",
          "frameHeight",
        ])
          if (typeof entry[key] === "number" && Number.isFinite(entry[key]) && entry[key] >= 0)
            video[key] = Math.round(entry[key]);
        const codec = stats.get(entry.codecId)?.mimeType;
        if (["video/H264", "video/VP8", "video/VP9", "video/AV1", "video/H265"].includes(codec))
          video.codec = codec;
      });
      result.video = video;
    } catch {
      result.stats_unavailable = true;
    } finally {
      clearTimeout(timeout);
    }
    return result;
  }
  private fail(reason = "signaling_failed") {
    if (this.closed) return;
    this.failureReason = reason;
    this.close();
    this.failed(reason);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.video.removeEventListener("loadeddata", this.loaded);
    clearTimeout(this.timer);
    clearTimeout(this.disconnectTimer);
    try {
      void Promise.resolve(this.unsubscribe?.()).catch(() => {});
    } catch {}
    this.unsubscribe = undefined;
    this.addon?.close();
    if (this.peer) {
      this.lastConnection = this.peer.connectionState;
      this.lastIce = this.peer.iceConnectionState;
      this.peer.ontrack = null;
      this.peer.onicecandidate = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
    }
    this.stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (this.video.srcObject === this.stream) this.video.srcObject = null;
    this.candidates = [];
    this.remote = [];
  }
}
