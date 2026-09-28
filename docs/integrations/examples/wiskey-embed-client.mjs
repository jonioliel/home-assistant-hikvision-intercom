/** Browser-only same-origin WisKey embed API v1 reference. No HA credentials. */
export function attachWiskey(iframe, options = {}) {
  const origin = window.location.origin;
  if (origin === "null")
    throw new Error("WisKey requires a same-origin document");
  let confirmed = options.initial || { tab: "overview", tool: null };
  let queued = null;
  let catalog = null;
  let timer;
  let disposed = false;

  const validList = (items) =>
    Array.isArray(items) &&
    items.every(
      (item) =>
        item && typeof item.id === "string" && typeof item.label === "string",
    );
  const known = ({ tab, tool }) =>
    catalog &&
    catalog.tabs.some((item) => item.id === tab) &&
    (!tool ||
      (tab === "tools" && catalog.tools.some((item) => item.id === tool)));

  function navigate(target) {
    if (
      disposed ||
      !target ||
      typeof target.tab !== "string" ||
      (target.tool != null && typeof target.tool !== "string")
    )
      return false;
    if (!catalog) {
      queued = target;
      return false;
    }
    if (!known(target)) return false;
    iframe.contentWindow?.postMessage(
      { type: "wiskey:navigate", tab: target.tab, tool: target.tool || null },
      origin,
    );
    return true;
  }

  function receive(event) {
    if (
      disposed ||
      event.origin !== origin ||
      event.source !== iframe.contentWindow
    )
      return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "wiskey:ready") {
      if (message.version !== 1) {
        clearTimeout(timer);
        options.onUnsupported?.(message.version);
        return;
      }
      if (!validList(message.tabs) || !validList(message.tools)) return;
      if (catalog) return;
      clearTimeout(timer);
      catalog = { tabs: message.tabs, tools: message.tools };
      options.onReady?.(catalog);
      if (queued) {
        const target = queued;
        queued = null;
        navigate(target);
      }
    } else if (
      catalog &&
      message.type === "wiskey:location" &&
      typeof message.tab === "string" &&
      (message.tool === null || typeof message.tool === "string")
    ) {
      confirmed = { tab: message.tab, tool: message.tool };
      options.onLocation?.(confirmed);
    } else if (
      catalog &&
      message.type === "wiskey:title" &&
      typeof message.text === "string"
    ) {
      options.onTitle?.(message.text);
    }
  }

  function loaded() {
    if (catalog || disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (catalog || disposed) return;
      // Only the public version marker is inspected; no Shadow DOM or internal calls.
      let root;
      try {
        if (iframe.contentWindow?.location.origin !== origin) {
          options.onWaiting?.();
          return;
        }
        root = iframe.contentDocument?.querySelector(
          "hikvision-intercom-panel",
        );
      } catch {
        options.onWaiting?.();
        return;
      }
      const marker = root?.hasAttribute("data-embed-api") ? root : null;
      if (!root) options.onWaiting?.();
      else if (!marker) options.onLegacy?.();
      else if (marker.getAttribute("data-embed-api") !== "1")
        options.onUnsupported?.(marker.getAttribute("data-embed-api"));
      else options.onWaiting?.();
    }, 12000);
  }

  function refresh() {
    if (disposed) return;
    clearTimeout(timer);
    catalog = null;
    const url = new URL("/hikvision-intercom", origin);
    url.searchParams.set("embed", "1");
    url.searchParams.set("tab", confirmed.tab);
    if (confirmed.tool) url.searchParams.set("tool", confirmed.tool);
    iframe.src = url.href;
  }

  // Listener ordering is intentional: the child may initialize before iframe load.
  window.addEventListener("message", receive);
  iframe.addEventListener("load", loaded);
  refresh();
  return {
    navigate,
    refresh,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      iframe.removeEventListener("load", loaded);
      catalog = null;
      queued = null;
    },
  };
}
