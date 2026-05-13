// LoaderOverlay — pre-warm gate.
//
// Shows a centered "Building the world..." panel while
// SceneManager.mount() pre-warms assets (HTML surfaces, future
// .glb meshes). Fades in on construction, fades out on hide().
// Pure DOM — no three.js dependency. A future v0.2 may inset a
// small rotating 3D primitive for warmth; for v0.1.2 the plain
// version is enough.
//
// Per D3 from the SmartObjects proposal: assets pre-warm
// happens before the render loop starts. The loader gives the
// user something to look at while it does.

interface LoaderOverlayOptions {
  /** Background gradient base. Defaults to a neutral pastel. */
  backgroundColor?: string;
  /** Text color. Defaults to a low-contrast slate. */
  color?: string;
  /** Initial message. */
  message?: string;
  /** Fade duration in milliseconds. */
  fadeMs?: number;
}

const DEFAULT_BACKGROUND = "#d0dce6";
const DEFAULT_COLOR = "#3a4a3a";
const DEFAULT_FADE_MS = 400;

export class LoaderOverlay {
  private readonly root: HTMLDivElement;
  private readonly messageEl: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly fadeMs: number;

  constructor(options: LoaderOverlayOptions = {}) {
    const bg = options.backgroundColor ?? DEFAULT_BACKGROUND;
    const fg = options.color ?? DEFAULT_COLOR;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;

    this.root = document.createElement("div");
    this.root.className = "world-loader";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.style.cssText = [
      "position:fixed",
      "inset:0",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:18px",
      `background:radial-gradient(circle at 50% 40%, ${lighten(bg, 0.06)}, ${bg})`,
      `color:${fg}`,
      "z-index:999",
      "opacity:0",
      `transition:opacity ${this.fadeMs}ms ease-out`,
      "font-family:system-ui,-apple-system,sans-serif",
      "letter-spacing:0.01em",
      "user-select:none",
      "pointer-events:none",
    ].join(";");

    // Title row.
    const title = document.createElement("div");
    title.textContent = "Building the world";
    title.style.cssText = [
      "font-size:14px",
      "font-weight:500",
      "text-transform:uppercase",
      "letter-spacing:0.18em",
      "opacity:0.7",
    ].join(";");

    // Spinner row — three pulsing dots. Pure CSS so the animation
    // continues during the heavy mount work (the main thread is
    // busy but the compositor still ticks CSS keyframes).
    const spinner = this.makeSpinner(fg);

    // Message row.
    this.messageEl = document.createElement("div");
    this.messageEl.textContent = options.message ?? "fetching corpus";
    this.messageEl.style.cssText = [
      "font-size:13px",
      "opacity:0.55",
      "min-height:18px",
    ].join(";");

    // Progress row (count-based). Hidden until setProgress is called.
    this.progressEl = document.createElement("div");
    this.progressEl.style.cssText = [
      "font-size:11px",
      "opacity:0.4",
      "font-variant-numeric:tabular-nums",
      "min-height:14px",
    ].join(";");

    this.root.append(title, spinner, this.messageEl, this.progressEl);
    this.injectKeyframes();
    document.body.appendChild(this.root);

    // Fade in on next animation frame so the transition catches.
    requestAnimationFrame(() => {
      this.root.style.opacity = "1";
    });
  }

  /** Update the line under the spinner. */
  setMessage(msg: string): void {
    this.messageEl.textContent = msg;
  }

  /** Show a "built / total" counter under the message. */
  setProgress(built: number, total: number): void {
    this.progressEl.textContent = total > 0
      ? `${built} / ${total}`
      : "";
  }

  /** Fade out and remove. Resolves after the fade completes. */
  async hide(): Promise<void> {
    this.root.style.opacity = "0";
    await new Promise<void>((resolve) => setTimeout(resolve, this.fadeMs));
    this.root.remove();
  }

  /** Immediate teardown (skip fade). For error-path bailout. */
  dispose(): void {
    this.root.remove();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private makeSpinner(color: string): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:8px";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.style.cssText = [
        "width:10px",
        "height:10px",
        "border-radius:50%",
        `background:${color}`,
        "animation:world-loader-pulse 1.2s ease-in-out infinite",
        `animation-delay:${i * 0.18}s`,
      ].join(";");
      wrap.appendChild(dot);
    }
    return wrap;
  }

  private injectKeyframes(): void {
    if (document.getElementById("world-loader-keyframes")) return;
    const style = document.createElement("style");
    style.id = "world-loader-keyframes";
    style.textContent = `
      @keyframes world-loader-pulse {
        0%, 80%, 100% { transform: scale(0.65); opacity: 0.35; }
        40%           { transform: scale(1.0);  opacity: 0.95; }
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Cheap RGB lighten — parse a hex color, push toward white by `factor`.
 * Used to derive the radial-gradient highlight from the palette
 * background; close enough to look palette-coherent.
 */
function lighten(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * factor));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * factor));
  const b = Math.min(255, (n & 0xff) + Math.round(255 * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
