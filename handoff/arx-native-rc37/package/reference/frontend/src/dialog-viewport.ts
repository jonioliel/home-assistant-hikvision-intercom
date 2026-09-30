/** Size top-layer dialogs in layout pixels, including zoom across shadow hosts. */
export function fitDialogViewport(dialog: HTMLDialogElement | null) {
  if (!dialog) return;
  let zoom = 1;
  let element: Element | null = dialog;
  while (element) {
    const scale = Number.parseFloat(getComputedStyle(element).zoom);
    if (Number.isFinite(scale) && scale > 0) zoom *= scale;
    const root = element.getRootNode();
    element = element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  const height = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
  const limit = `min(90dvh, ${Math.max(80, height / zoom - 24)}px)`;
  if (dialog.style.maxHeight !== limit) dialog.style.maxHeight = limit;
  const width = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth);
  const widthLimit = `min(${Math.max(80, width / zoom - 24)}px, calc(100cqw - 16px))`;
  if (dialog.style.maxWidth !== widthLimit) dialog.style.maxWidth = widthLimit;
}
