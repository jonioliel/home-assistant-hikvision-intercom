/** Watches decoded video progress only while playing. A paused/hidden view is never a fault. */
export class PlaybackWatchdog {
  private timer?: ReturnType<typeof setInterval>;
  private frame?: number;
  private stopped = true;
  private progressAt = 0;
  private mediaTime = 0;
  private frames = 0;
  constructor(
    private video: HTMLVideoElement,
    private current: () => boolean,
    private stalled: () => void,
  ) {}
  start() {
    this.stop();
    this.stopped = false;
    this.progressAt = performance.now();
    this.mediaTime = this.video.currentTime;
    if (this.video.requestVideoFrameCallback) {
      const next = () => {
        this.frame = this.video.requestVideoFrameCallback(() => {
          if (this.stopped) return;
          this.progressAt = performance.now();
          this.frames++;
          next();
        });
      };
      next();
    }
    this.timer = setInterval(() => {
      if (this.stopped || !this.current()) {
        this.stop();
        return;
      }
      const now = performance.now();
      if (this.video.paused || document.hidden) {
        this.progressAt = now;
        return;
      }
      if (!this.video.requestVideoFrameCallback && this.video.currentTime !== this.mediaTime) {
        this.mediaTime = this.video.currentTime;
        this.progressAt = now;
      }
      if (now - this.progressAt >= 12000) {
        this.stop();
        this.stalled();
      }
    }, 1000);
  }
  summary() {
    return {
      decoded_frames_observed: this.frames,
      progress_age_ms: Math.max(0, Math.round(performance.now() - this.progressAt)),
      active: !this.stopped,
    };
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.frame !== undefined) this.video.cancelVideoFrameCallback?.(this.frame);
    this.frame = undefined;
  }
}
