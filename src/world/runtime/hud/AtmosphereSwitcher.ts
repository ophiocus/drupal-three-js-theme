// AtmosphereSwitcher — a small fixed-position skin toggle (v2 world
// switcher, the "preview switch" from docs/feature-requests/world-switcher.md).
//
// Pure DOM, zero dependencies, sibling to WorldHud in spirit but NOT
// world-anchored: it's chrome that sits in a fixed corner and flips the
// active atmosphere via SceneManager.switchAtmosphere(name). That call
// re-fetches /world/snapshot/full?atmosphere=<name> (read-only server
// hint — no node write), so this is a per-client preview, not a global
// edit.
//
// Lifecycle: created ONCE by SceneManager (it survives a switch — it's
// chrome, not world content). setActive() re-highlights after each flip;
// setBusy() disables the row while a switch is in flight.

import { t, type Lang } from "./i18n.js";

export interface AtmosphereOption {
  /** Snapshot key, e.g. "forest" | "inner-mind". */
  name: string;
  /** Human label shown on the button. */
  label: string;
}

export interface AtmosphereSwitcherOptions {
  atmospheres: AtmosphereOption[];
  /** Currently-active atmosphere key (highlights the matching button). */
  initial: string;
  /** Invoked with the chosen atmosphere key when a button is clicked. */
  onSelect: (name: string) => void;
  /**
   * Optional ambient-sound toggle appended after the skins. `onToggle`
   * fires on click with the new on/off state — and since the click is a
   * user gesture, it's a valid moment to start a Web Audio context.
   */
  sound?: { initialOn: boolean; onToggle: (on: boolean) => void };
  /** UI language. Falls back to English when omitted. */
  lang?: Lang;
}

/** Singleton style injection — the spinner keyframes plus a tiny
 *  helper class. Idempotent: if the <style> with this id is already
 *  in the DOM (because two switchers were ever instantiated, or HMR
 *  re-evaluated this module) we keep the existing one. */
const SPINNER_STYLE_ID = "world-atmosphere-switcher-spinner";
function ensureSpinnerStyle(): void {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = SPINNER_STYLE_ID;
  el.textContent = `
@keyframes world-atmosphere-switcher-spin {
  to { transform: rotate(360deg); }
}
.world-atmosphere-switcher-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  vertical-align: middle;
  animation: world-atmosphere-switcher-spin 0.85s linear infinite;
}
`;
  document.head.appendChild(el);
}

export class AtmosphereSwitcher {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  /** Original label text per button, so `setPending → clearPending` */
  /** can restore the exact contents the user saw before the spinner. */
  private readonly labels = new Map<string, string>();
  private active: string;
  /** Name of the pill currently showing a spinner, or null. */
  private pending: string | null = null;

  constructor(private readonly options: AtmosphereSwitcherOptions) {
    ensureSpinnerStyle();
    this.active = options.initial;

    this.root = document.createElement("div");
    this.root.className = "world-atmosphere-switcher";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", t(options.lang ?? "en", "switcher.atmosphere.aria"));
    this.root.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:18px",
      "transform:translateX(-50%)",
      "display:flex",
      "gap:4px",
      "padding:4px",
      "border-radius:999px",
      "background:rgba(20,30,30,0.6)",
      "backdrop-filter:blur(8px)",
      "-webkit-backdrop-filter:blur(8px)",
      // Below CardOverlay (1000) + LoaderOverlay (999) so the modal /
      // switch loader always win; above WorldHud (100).
      "z-index:200",
      "pointer-events:auto",
      "user-select:none",
      "font-family:system-ui,-apple-system,sans-serif",
      "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
    ].join(";");

    for (const opt of options.atmospheres) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.dataset.atmosphere = opt.name;
      btn.style.cssText = this.buttonCss(opt.name === this.active);
      btn.addEventListener("click", () => {
        if (opt.name === this.active) return;
        if (this.pending) return; // another switch already in flight
        // Show the spinner BEFORE we hand off to onSelect — the caller
        // (SceneManager.switchAtmosphere) does heavy async work before
        // the new scene is mounted, and the user needs immediate
        // feedback that the click registered.
        this.setPending(opt.name);
        this.options.onSelect(opt.name);
      });
      this.buttons.set(opt.name, btn);
      this.labels.set(opt.name, opt.label);
      this.root.appendChild(btn);
    }

    // Optional ambient-sound toggle — a separator then a note glyph that
    // highlights when sound is on. Click is a user gesture (lets Web
    // Audio start). Default off, set by the caller.
    if (options.sound) {
      const sep = document.createElement("span");
      sep.style.cssText =
        "width:1px;align-self:stretch;margin:2px 2px;background:rgba(240,240,235,0.18)";
      this.root.appendChild(sep);

      let soundOn = options.sound.initialOn;
      const sbtn = document.createElement("button");
      sbtn.type = "button";
      sbtn.textContent = "♪"; // musical note
      sbtn.title = t(options.lang ?? "en", "switcher.atmosphere.sound.title");
      sbtn.setAttribute("aria-label", t(options.lang ?? "en", "switcher.atmosphere.sound.title"));
      sbtn.style.cssText = this.buttonCss(soundOn);
      sbtn.addEventListener("click", () => {
        soundOn = !soundOn;
        sbtn.style.cssText = this.buttonCss(soundOn);
        options.sound!.onToggle(soundOn);
      });
      this.root.appendChild(sbtn);
    }

    document.body.appendChild(this.root);
  }

  /** Re-highlight the active atmosphere (call after a switch settles).
   *  Also clears the pending spinner — the switch completed, restore
   *  the label and re-enable the row. */
  setActive(name: string): void {
    this.active = name;
    this.clearPending();
    for (const [key, btn] of this.buttons) {
      btn.style.cssText = this.buttonCss(key === name);
    }
  }

  /**
   * Swap the named pill's label for a spinning glyph and disable the
   * row. Visual feedback that the click was received and a switch is
   * in progress — the new scene's preload (snapshot fetch + atmosphere
   * module dynamic import + buildScene) happens during this window.
   *
   * Idempotent: calling twice with the same name is a no-op; calling
   * with a different name moves the spinner. `setActive` clears it.
   */
  setPending(name: string): void {
    if (this.pending === name) return;
    if (this.pending) this.restoreLabel(this.pending);
    this.pending = name;
    const btn = this.buttons.get(name);
    if (btn) {
      btn.innerHTML = '<span class="world-atmosphere-switcher-spinner" aria-hidden="true"></span>';
      btn.setAttribute("aria-busy", "true");
    }
    // Dim the row + lock interaction, same as the old setBusy(true).
    this.root.style.opacity = "0.85";
    this.root.style.pointerEvents = "none";
    for (const b of this.buttons.values()) b.disabled = true;
  }

  /** Restore labels and re-enable the row. */
  clearPending(): void {
    if (this.pending) {
      this.restoreLabel(this.pending);
      const btn = this.buttons.get(this.pending);
      btn?.removeAttribute("aria-busy");
      this.pending = null;
    }
    this.root.style.opacity = "1";
    this.root.style.pointerEvents = "auto";
    for (const b of this.buttons.values()) b.disabled = false;
  }

  /** Legacy entry point — still used by SceneManager's error path.
   *  Implemented in terms of clearPending for symmetry. */
  setBusy(busy: boolean): void {
    if (!busy) this.clearPending();
    else {
      this.root.style.opacity = "0.5";
      this.root.style.pointerEvents = "none";
      for (const btn of this.buttons.values()) btn.disabled = true;
    }
  }

  private restoreLabel(name: string): void {
    const btn = this.buttons.get(name);
    const label = this.labels.get(name);
    if (btn && label !== undefined) {
      btn.textContent = label;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private buttonCss(isActive: boolean): string {
    return [
      "appearance:none",
      "border:0",
      "border-radius:999px",
      "padding:6px 14px",
      "font:500 12px/1 system-ui,-apple-system,sans-serif",
      "letter-spacing:0.04em",
      "text-transform:uppercase",
      "cursor:pointer",
      "transition:background 160ms ease-out, color 160ms ease-out",
      isActive ? "background:rgba(240,232,200,0.92)" : "background:transparent",
      isActive ? "color:#1d2230" : "color:rgba(240,240,235,0.7)",
    ].join(";");
  }
}
