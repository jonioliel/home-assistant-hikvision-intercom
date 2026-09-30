// Read-only contract slice. The injected transport is already authenticated as
// the actual HA operator; this module neither obtains nor stores a credential.
const PREFIX = "hikvision_intercom/";

export class WisKeyReadOnlyClient {
  constructor(transport, onChange = () => {}) {
    this.transport = transport;
    this.onChange = onChange;
    this.unsubscribe = null;
    this.session = null;
    this.summary = null;
    this.closed = false;
  }

  async start() {
    if (this.closed || this.unsubscribe) throw new Error("client_state_invalid");
    const session = await this.transport.call(PREFIX + "authorization/session", {});
    if (!session?.allowed) throw new Error("wiskey_access_denied");
    const summary = await this.transport.call(PREFIX + "overview/summary", {});
    if (!summary?.api || summary.api.version < 1 || summary.api.min_client > 1)
      throw new Error("wiskey_api_incompatible");
    if (!summary.api.commands?.includes("overview/summary"))
      throw new Error("wiskey_command_unavailable");
    this.session = session;
    this.summary = summary;
    const unsubscribe = await this.transport.subscribe(PREFIX + "subscribe", (event) => {
      if (this.closed) return;
      if (event?.kind === "refresh") this.onChange({ kind: "refresh" });
      if (event?.kind === "access_revoked" || event?.kind === "screen_locked") {
        this.session = null;
        this.summary = null;
        this.onChange({ kind: event.kind });
        this.close();
      }
    });
    if (this.closed) unsubscribe();
    else this.unsubscribe = unsubscribe;
    return { session, summary };
  }

  async refreshSummary() {
    if (this.closed || !this.session) throw new Error("client_state_invalid");
    const summary = await this.transport.call(PREFIX + "overview/summary", {});
    if (!summary?.access?.allowed) {
      this.close();
      throw new Error("wiskey_access_denied");
    }
    this.summary = summary;
    return summary;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.session = null;
    this.summary = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
