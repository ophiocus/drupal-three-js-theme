// LanguageSwitcher — small fixed-position language pill, sibling to
// AtmosphereSwitcher. When the user clicks a language, the chosen lang
// gets persisted in localStorage and the page reloads with `?lang=` in
// the URL — the snapshot endpoint reads it server-side and serves the
// translated descriptors. The HUD is otherwise stateless.
//
// We don't fight three Drupal-side: the server is the canonical source
// of the translation overlay (per SnapshotPublisher::applyTranslationOverlay).
// All this component does is choose which lang to ask for.

export interface LanguageOption {
  /** ISO-639-1 code (en, es, ...). Sent to the server as ?lang=<code>. */
  code: string;
  /** Short label displayed on the button (often the code in caps). */
  label: string;
}

export interface LanguageSwitcherOptions {
  languages: LanguageOption[];
  /** Currently-active language code (highlights the matching button). */
  initial: string;
  /** Invoked when the user clicks a different language. Default behavior:
   *  set localStorage, reload with `?lang=<code>` preserved. */
  onSelect?: (code: string) => void;
}

const STORAGE_KEY = "world.lang";

/** Read the user's stored language preference, falling back through
 *  URL `?lang=` → localStorage → browser language → `fallback`. URL
 *  wins so deep-links survive a stored preference. Consumed by
 *  SceneManager to decide the initial `?lang=` for the snapshot. */
export function readStoredLanguage(supported: ReadonlyArray<string>, fallback = "en"): string {
  // 1. URL query — deep links win.
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("lang");
    if (fromUrl && supported.includes(fromUrl)) {
      // Persist what the deep link asked for so subsequent navigations
      // keep the language without needing the param.
      try { window.localStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* swallow */ }
      return fromUrl;
    }
  } catch { /* malformed URL — fall through */ }
  // 2. Stored preference.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && supported.includes(stored)) return stored;
  } catch { /* private browsing — fall through */ }
  // 3. Browser hint: navigator.language is "es-CO", "en-US", etc.
  const browser = (navigator.language ?? "").slice(0, 2).toLowerCase();
  if (browser && supported.includes(browser)) return browser;
  return fallback;
}

export class LanguageSwitcher {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private active: string;

  constructor(private readonly options: LanguageSwitcherOptions) {
    this.active = options.initial;

    this.root = document.createElement("div");
    this.root.className = "world-language-switcher";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Language");
    // Sits to the LEFT of the atmosphere switcher in the same horizontal
    // strip — a sibling pill, not a stacked row. ~140px clearance from
    // the atmosphere switcher's centered position.
    this.root.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "display:flex",
      "gap:4px",
      "padding:4px",
      "border-radius:999px",
      "background:rgba(20,30,30,0.6)",
      "backdrop-filter:blur(8px)",
      "-webkit-backdrop-filter:blur(8px)",
      "z-index:200",
      "pointer-events:auto",
      "user-select:none",
      "font-family:system-ui,-apple-system,sans-serif",
      "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
    ].join(";");

    for (const lang of options.languages) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = lang.label;
      btn.dataset.lang = lang.code;
      btn.style.cssText = this.buttonCss(lang.code === this.active);
      btn.addEventListener("click", () => {
        if (lang.code === this.active) return;
        this.select(lang.code);
      });
      this.buttons.set(lang.code, btn);
      this.root.appendChild(btn);
    }

    document.body.appendChild(this.root);
  }

  /** Programmatic selection — used when a deep link's `?lang=` overrides
   *  the stored preference. */
  setActive(code: string): void {
    if (this.active === code) return;
    const prev = this.buttons.get(this.active);
    if (prev) prev.style.cssText = this.buttonCss(false);
    this.active = code;
    const next = this.buttons.get(code);
    if (next) next.style.cssText = this.buttonCss(true);
  }

  dispose(): void {
    this.root.remove();
  }

  private select(code: string): void {
    this.setActive(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch { /* swallow */ }
    if (this.options.onSelect) {
      this.options.onSelect(code);
      return;
    }
    // Default: reload with the new lang preserved. Atmosphere preview
    // hint (if any) survives — we only replace the `lang` param.
    const url = new URL(window.location.href);
    url.searchParams.set("lang", code);
    window.location.href = url.toString();
  }

  private buttonCss(isActive: boolean): string {
    return [
      "all:unset",
      "padding:4px 12px",
      "border-radius:999px",
      `background:${isActive ? "rgba(240,232,200,0.92)" : "transparent"}`,
      `color:${isActive ? "#1d2230" : "rgba(240,240,235,0.7)"}`,
      "font:600 11px/1 system-ui,-apple-system,sans-serif",
      "letter-spacing:0.08em",
      "text-transform:uppercase",
      "cursor:pointer",
      "transition:background 160ms,color 160ms",
    ].join(";");
  }
}
