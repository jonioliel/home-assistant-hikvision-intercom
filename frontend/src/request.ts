import type { Hass } from "./types";

/** Bound a browser wait without retrying or claiming to cancel server-side work. */
export function boundedRequest<T>(
  send: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      cleanup();
      reject({ code: "connection_lost" });
    };
    const timer = setTimeout(cancel, timeoutMs);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      send().then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** A view's bounded requests, cancelled on detach and authenticated connection loss. */
export class ScopedRequests {
  private requests = new Set<AbortController>();
  constructor(private current: () => Hass | undefined) {}
  cancel() {
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
  async run<T>(message: Record<string, unknown>, timeout = 60000): Promise<T> {
    const hass = this.current();
    if (!hass?.user?.is_admin || hass.connection.connected === false)
      throw { code: "connection_lost" };
    const connection = hass.connection,
      actor = hass.user.id;
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    this.requests.add(controller);
    connection.addEventListener?.("disconnected", disconnected);
    try {
      const result = await boundedRequest(
        () => hass.callWS<T>(message),
        timeout,
        controller.signal,
      );
      const current = this.current();
      if (
        !current?.user?.is_admin ||
        current.user.id !== actor ||
        current.connection !== connection ||
        connection.connected === false
      )
        throw { code: "connection_lost" };
      return result;
    } finally {
      this.requests.delete(controller);
      connection.removeEventListener?.("disconnected", disconnected);
    }
  }
}
