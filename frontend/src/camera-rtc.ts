import type { Hass } from "./types";

type Signal =
  | { type: "session"; session_id: string }
  | { type: "answer"; answer: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "error" };
/** Use HA's authenticated camera signaling and its configured WebRTC provider. */
export class CameraRTC {
  private peer?: RTCPeerConnection;
  private closed = false;
  private unsubscribe?: () => void;
  private session?: string;
  private candidates: RTCIceCandidateInit[] = [];
  private remote: RTCIceCandidateInit[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private stream = new MediaStream();
  private sequence = Promise.resolve();
  constructor(
    private hass: Hass,
    private entity: string,
    private video: HTMLVideoElement,
    private ready: () => void,
    private failed: () => void,
  ) {}
  async start() {
    this.timer = setTimeout(() => this.fail(), 12000);
    try {
      const config = await this.hass.callWS<{
        configuration: RTCConfiguration;
        dataChannel?: string;
      }>({ type: "camera/webrtc/get_client_config", entity_id: this.entity });
      if (this.closed) return;
      const peer = (this.peer = new RTCPeerConnection(config.configuration));
      if (config.dataChannel) peer.createDataChannel(config.dataChannel);
      peer.ontrack = (event) => {
        if (this.closed) return;
        this.stream.addTrack(event.track);
        this.video.srcObject = this.stream;
        void this.video.play().catch(() => {});
        if (event.track.kind === "video") {
          clearTimeout(this.timer);
          this.ready();
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected")
          this.fail();
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate || this.closed) return;
        const candidate = event.candidate.toJSON();
        if (this.session) void this.send(candidate);
        else if (this.candidates.length < 100) this.candidates.push(candidate);
      };
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      const offer = await peer.createOffer();
      if (this.closed) return;
      await peer.setLocalDescription(offer);
      if (this.closed) return;
      const unsubscribe = await this.hass.connection.subscribeMessage<Signal>(
        (event) => {
          this.sequence = this.sequence.then(() => this.receive(event)).catch(() => this.fail());
        },
        { type: "camera/webrtc/offer", entity_id: this.entity, offer: offer.sdp },
      );
      if (this.closed) unsubscribe();
      else this.unsubscribe = unsubscribe;
    } catch {
      this.fail();
    }
  }
  private async send(candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    try {
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
      this.session = event.session_id;
      const queued = this.candidates.splice(0);
      for (const candidate of queued) await this.send(candidate);
    } else if (event.type === "answer") {
      await peer.setRemoteDescription({ type: "answer", sdp: event.answer });
      if (this.closed) return;
      for (const candidate of this.remote.splice(0)) {
        if (this.closed) return;
        await peer.addIceCandidate(candidate);
      }
    } else if (event.type === "candidate") {
      const candidate =
        event.candidate.sdpMid != null || event.candidate.sdpMLineIndex != null
          ? event.candidate
          : { ...event.candidate, sdpMid: "0" };
      if (peer.remoteDescription) await peer.addIceCandidate(candidate);
      else if (this.remote.length < 100) this.remote.push(candidate);
    } else this.fail();
  }
  private fail() {
    if (this.closed) return;
    this.close();
    this.failed();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onicecandidate = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
    }
    this.stream.getTracks().forEach((track) => track.stop());
    if (this.video.srcObject === this.stream) this.video.srcObject = null;
    this.candidates = [];
    this.remote = [];
  }
}
