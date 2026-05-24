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
}

export class AtmosphereSwitcher {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private active: string;

  constructor(private readonly options: AtmosphereSwitcherOptions) {
    this.active = options.initial;

    this.root = document.createElement("div");
    this.root.className = "world-atmosphere-switcher";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "World atmosphere");
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
        this.options.onSelect(opt.name);
      });
      this.buttons.set(opt.name, btn);
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
      sbtn.title = "Toggle ambient sound";
      sbtn.setAttribute("aria-label", "Toggle ambient sound");
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

  /** Re-highlight the active atmosphere (call after a switch settles). */
  setActive(name: string): void {
    this.active = name;
    for (const [key, btn] of this.buttons) {
      btn.style.cssText = this.buttonCss(key === name);
    }
  }

  /** Disable / re-enable the whole row while a switch is in flight. */
  setBusy(busy: boolean): void {
    this.root.style.opacity = busy ? "0.5" : "1";
    this.root.style.pointerEvents = busy ? "none" : "auto";
    for (const btn of this.buttons.values()) btn.disabled = busy;
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
