// FirstVisitOverlay — one-shot formal welcome shown after the
// `/admin/world/onboarding` wizard completes and the user lands on
// `/` for the first time.
//
// Two trigger gates:
//   1. drupalSettings.worldSignature.firstVisit === true (server hint;
//      the module's hook_page_attachments_alter sets this once then
//      clears its State flag, so it only fires after a successful
//      onboarding).
//   2. localStorage["world.firstVisit.seen"] !== "1" (defensive — a
//      manual State edit shouldn't re-trigger the overlay if the user
//      already dismissed it).
//
// On dismiss the localStorage flag is set and the DOM is removed.
// The overlay is non-blocking: the world renders behind it; the user
// can dismiss any time.
//
// Voice: formal product. Three signposts, terse copy.

const LOCALSTORAGE_KEY = "world.firstVisit.seen";

interface DrupalSettingsShape {
  worldSignature?: { firstVisit?: boolean };
}

/** Mount the overlay if the gates allow. Idempotent — calling twice
 *  is a no-op (already-seen flag or already-in-DOM check). */
export function maybeShowFirstVisitOverlay(): void {
  if (typeof window === "undefined") return;
  const settings = (window as unknown as { drupalSettings?: DrupalSettingsShape }).drupalSettings;
  if (settings?.worldSignature?.firstVisit !== true) return;
  try {
    if (window.localStorage.getItem(LOCALSTORAGE_KEY) === "1") return;
  } catch { /* private browsing — fall through */ }
  if (document.getElementById("world-first-visit-overlay")) return;
  document.body.appendChild(build());
}

function build(): HTMLElement {
  const root = document.createElement("div");
  root.id = "world-first-visit-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Welcome to your world");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:1100", // above CardOverlay (1000) so the welcome wins on entry
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "background:rgba(10,15,20,0.55)",
    "backdrop-filter:blur(4px)",
    "-webkit-backdrop-filter:blur(4px)",
    "pointer-events:auto",
    "font-family:system-ui,-apple-system,sans-serif",
  ].join(";");

  const card = document.createElement("div");
  card.style.cssText = [
    "background:#fff",
    "color:#1d2230",
    "padding:2rem 2.25rem",
    "max-width:32rem",
    "border-radius:0.75rem",
    "box-shadow:0 16px 48px rgba(0,0,0,0.35)",
    "line-height:1.55",
  ].join(";");

  card.innerHTML = `
    <h2 style="margin:0 0 0.5rem;font-size:1.25rem;font-weight:600;letter-spacing:-0.01em;">
      Welcome to your world
    </h2>
    <p style="margin:0 0 1.25rem;opacity:0.75;font-size:0.95rem;">
      Your content has been arranged in three-dimensional space according to
      semantic proximity. Three controls govern navigation:
    </p>
    <dl style="margin:0 0 1.5rem;display:grid;grid-template-columns:auto 1fr;column-gap:1rem;row-gap:0.5rem;font-size:0.9rem;">
      <dt style="font-weight:600;white-space:nowrap;">Scene</dt>
      <dd style="margin:0;opacity:0.8;">The pill at the bottom-centre toggles between visual styles.</dd>
      <dt style="font-weight:600;white-space:nowrap;">Language</dt>
      <dd style="margin:0;opacity:0.8;">The smaller pill at the bottom-right switches the interface locale.</dd>
      <dt style="font-weight:600;white-space:nowrap;">Content</dt>
      <dd style="margin:0;opacity:0.8;">Click any rendered entity to read its full text.</dd>
    </dl>
    <div style="display:flex;justify-content:flex-end;">
      <button type="button"
              data-dismiss
              style="background:#1d2230;color:#fff;border:0;border-radius:0.4rem;padding:0.6rem 1.25rem;font:600 0.875rem/1 inherit;letter-spacing:0.02em;cursor:pointer;">
        Got it
      </button>
    </div>
  `;

  const dismiss = (): void => {
    try { window.localStorage.setItem(LOCALSTORAGE_KEY, "1"); }
    catch { /* private browsing — overlay just won't re-arm cleanly */ }
    root.remove();
  };

  card.querySelector<HTMLButtonElement>("[data-dismiss]")?.addEventListener("click", dismiss);
  // Click on the backdrop also dismisses — common modal affordance.
  root.addEventListener("click", (e) => {
    if (e.target === root) dismiss();
  });
  // Escape key dismisses too.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      dismiss();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  root.appendChild(card);
  return root;
}
