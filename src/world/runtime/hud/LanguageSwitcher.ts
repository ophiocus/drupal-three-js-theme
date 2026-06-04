// LanguageSwitcher — small fixed-position language pill, sibling to
// AtmosphereSwitcher. When the user clicks a language, the chosen lang
// gets persisted in localStorage and the page reloads with `?lang=` in
// the URL — the snapshot endpoint reads it server-side and serves the
// translated descriptors. The HUD is otherwise stateless.
//
// We don't fight three Drupal-side: the server is the canonical source
// of the translation overlay (per SnapshotPublisher::applyTranslationOverlay).
// All this component does is choose which lang to ask for.

import { t, type Lang } from "./i18n.js";
import { getCurrentLang, setCurrentLang, SUPPORTED_LANGUAGES } from "./lang.js";

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

/** Re-export `getCurrentLang` from the canonical lang module so
 *  existing call sites that imported it from here keep working. */
export { getCurrentLang as readStoredLanguage } from "./lang.js";

export class LanguageSwitcher {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private active: string;

  constructor(private readonly options: LanguageSwitcherOptions) {
    this.active = options.initial;

    this.root = document.createElement("div");
    this.root.className = "world-language-switcher";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", t(this.active as Lang, "switcher.language.aria"));
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
    setCurrentLang(code as Lang);
    if (this.options.onSelect) {
      this.options.onSelect(code);
      return;
    }
    // Default: reload so SceneManager re-fetches the snapshot in the
    // new language. Don't bake `?lang=` into the URL — localStorage
    // is the persistent truth now, and a URL param would re-seed on
    // every reload, defeating the persistence guarantee.
    window.location.reload();
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
