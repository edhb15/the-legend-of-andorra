/**
 * Device detection for choosing touch controls and sensible graphics defaults.
 * `?touch=1` / `?touch=0` in the address bar forces touch controls on or off.
 */
export function touchOverride(): boolean | null {
  try {
    const v = new URLSearchParams(window.location.search).get("touch");
    if (v === "1" || v === "on") return true;
    if (v === "0" || v === "off") return false;
  } catch {
    /* ignore */
  }
  return null;
}

/** True when the main pointer is a finger (phones, tablets). */
export function prefersTouch(): boolean {
  const o = touchOverride();
  if (o !== null) return o;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    return navigator.maxTouchPoints > 0 && !window.matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
}
