// Persistent language state — single source of truth.
//
// The active language lives in localStorage under STORAGE_KEY. URL
// `?lang=` is consumed ONCE at boot (via consumeUrlLang()) to seed
// the store from a deep link; after that, the URL is irrelevant.
// Reading from the URL on every fetch is what made the previous
// implementation flaky: the URL changes as the user navigates,
// loses the param on reloads from a different entry point, and gets
// rewritten by SPA routers — but localStorage is stable.
//
// Boot sequence (SceneManager.constructor → mount):
//   1. consumeUrlLang()  // strips URL param + writes localStorage
//   2. getCurrentLang() everywhere thereafter
//
// Every reader (the host's transport for snapshot / card / surface
// requests, label projection) calls getCurrentLang(). The language
// switcher writes via setCurrentLang() and SceneManager.switchLanguage
// rebuilds the world from a fresh snapshot in the new language. How
// the language reaches the server is the transport's business.

export type Lang = "en" | "es";

export const SUPPORTED_LANGUAGES: ReadonlyArray<Lang> = ["en", "es"];
const STORAGE_KEY = "world.lang";
const DEFAULT_LANG: Lang = "en";

/**
 * Consume the URL's `?lang=<code>` if present and supported. Writes
 * the value to localStorage and strips the param from the URL so
 * subsequent in-app navigation isn't dragging it around. Idempotent
 * — calling twice does nothing the second time because the URL has
 * already been cleaned.
 *
 * Returns the consumed code (or null if no valid URL hint). Callers
 * generally ignore the return value and just call getCurrentLang()
 * afterward.
 *
 * Call this once at boot before any consumer reads the language.
 */
export function consumeUrlLang(): Lang | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("lang");
    if (!fromUrl) return null;
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(fromUrl)) return null;
    const lang = fromUrl as Lang;
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* private browsing — keep going */ }
    // Strip the param + replace the URL so reloads and navigation
    // don't keep re-seeding from a stale deep link.
    url.searchParams.delete("lang");
    const clean = url.pathname + (url.search ? url.search : "") + url.hash;
    try { window.history.replaceState(window.history.state, "", clean); } catch { /* legacy / blocked */ }
    return lang;
  } catch {
    return null;
  }
}

/**
 * Read the active language. Sources, in order:
 *   1. localStorage (canonical at runtime)
 *   2. navigator.language (first-time visitor without a stored pref)
 *   3. DEFAULT_LANG
 *
 * Pure read — never touches the URL.
 */
export function getCurrentLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as Lang;
    }
  } catch { /* private browsing */ }
  const browser = (navigator.language ?? "").slice(0, 2).toLowerCase();
  if (browser && (SUPPORTED_LANGUAGES as readonly string[]).includes(browser)) {
    return browser as Lang;
  }
  return DEFAULT_LANG;
}

/**
 * Persist a new language choice. Returns true when the value
 * actually changed (so callers can decide whether to reload).
 * Does NOT reload — the LanguageSwitcher owns the page-reload UX
 * decision separately.
 */
export function setCurrentLang(lang: Lang): boolean {
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) return false;
  let prior: string | null = null;
  try { prior = window.localStorage.getItem(STORAGE_KEY); }
  catch { /* private browsing */ }
  if (prior === lang) return false;
  try { window.localStorage.setItem(STORAGE_KEY, lang); }
  catch { /* swallow — the change won't survive a reload but the current session still flips */ }
  return true;
}
