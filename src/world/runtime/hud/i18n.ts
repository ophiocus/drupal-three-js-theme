// Tiny i18n dictionary for the in-canvas chrome (Stage panel, loader,
// atmosphere + language switchers). Server-rendered content (article
// bodies, sector names) is translated server-side via
// SnapshotPublisher::applyTranslationOverlay; this module covers only
// what the bundle renders client-side.
//
// Lifecycle: the active language is chosen on page load via
// LanguageSwitcher.readStoredLanguage() and stays fixed until the user
// picks a different language (which reloads the page). So we don't
// need reactivity — each component takes `lang` at construction and
// looks up strings against it.
//
// Adding a new string:
//   1. Add a key+value to each language's branch below
//   2. Call t(lang, "your.key") in the component
//   3. Optional: t(lang, "key", {sub: "value"}) for {sub} interpolation
//
// Adding a new language: append a branch, expose it via the
// LANGUAGES export so LanguageSwitcher knows about it, update
// world_signature's WorldController::LANGUAGE_HINTS and the server's
// per-language seeder files.

export type Lang = "en" | "es";

/** Languages the UI supports (codes that map to a translation branch
 *  below and a `?lang=` value the server's WorldController accepts). */
export const SUPPORTED_LANGUAGES: ReadonlyArray<Lang> = ["en", "es"];

type Dict = Record<string, string>;
type Catalog = Record<Lang, Dict>;

const CATALOG: Catalog = {
  en: {
    // — switchers + chrome —
    "switcher.atmosphere.aria":         "World atmosphere",
    "switcher.atmosphere.forest":       "Forest",
    "switcher.atmosphere.inner-mind":   "Inner mind",
    "switcher.atmosphere.sound.title":  "Toggle ambient sound",
    "switcher.language.aria":           "Language",

    // — loader —
    "loader.title":                     "Building the world",
    "loader.fetching":                  "fetching corpus",
    "loader.assembling":                "assembling entities",
    "loader.failed":                    "world failed to load",
    "loader.switch.title":              "Switching atmosphere",
    "loader.switch.message":            "rebuilding",

    // — Stage panel: toggle —
    "stage.toggle.label":               "EDIT STAGE",
    "stage.toggle.title":               "Toggle the in-canvas stage editor",
    "stage.save.flash":                 "SAVED ✓",

    // — Stage panel: World section —
    "stage.world.heading":              "World",
    "stage.world.atmosphere.label":     "default atmosphere",
    "stage.world.atmosphere.save":      "Save",
    "stage.world.tints.scope.base":     "tints → base palette",
    "stage.world.tints.scope.overlay":  "tints → {atmosphere} overlay",
    "stage.world.tints.background":     "background",
    "stage.world.tints.fog":            "fog",
    "stage.world.tints.ground":         "ground",
    "stage.world.embedded.label":       "embedded",
    "stage.world.embedded.stale":       "stale",
    "stage.world.model":                "model",
    "stage.world.lastembed":            "last embed",
    "stage.world.reembed":              "Re-embed corpus",
    "stage.world.reembed.stale":        "Re-embed (poles stale)",
    "stage.world.reembed.busy":         "Embedding…",
    "stage.world.reembed.help":         "Runs world:embed via the admin endpoint. Requires the edit world signature permission. Embedding compute remains external per BOUNDARY.md.",

    // — Stage panel: Interpretation section —
    "stage.interpretation.heading":     "Interpretation",
    "stage.interpretation.help":        "Anchor axes — the prose that mints meaning. Edits persist immediately on save; the new poles take effect on the next re-embed (axis vectors are computed server-side).",
    "stage.interpretation.stale":       "⚠ poles edited since last embed — re-embed to activate.",
    "stage.interpretation.axis":        "axis",
    "stage.interpretation.field.name":  "name",
    "stage.interpretation.field.pole_a":"pole a",
    "stage.interpretation.field.pole_b":"pole b",
    "stage.interpretation.save":        "Save axes",
    "stage.interpretation.save.busy":   "Saving…",

    // — Stage panel: Sign section (zodiac placements) —
    "stage.sign.heading.empty":         "Stage",
    "stage.sign.empty.hint":            "Click a numbered marker to select a sign.<br>Drag: horizontal → angle, vertical → height.",
    "stage.sign.heading":               "Sign {n}",
    "stage.sign.hint":                  "Drag: horizontal → angle, vertical → height.",
    "stage.sign.angle":                 "angle",
    "stage.sign.angle.unit":            "rad",
    "stage.sign.height":                "height",
    "stage.sign.height.unit":           "units",
    "stage.sign.scale":                 "scale",
    "stage.sign.deselect":              "Deselect",
    "stage.sign.save":                  "Save",

    // — status flash strings —
    "status.auth.failed":               "auth failed — need 'edit world signature' permission",
    "status.http":                      "HTTP {code} {body}",
    "status.save.ok":                   "saved ({count} {keys})",
    "status.save.ok.keys.singular":     "key",
    "status.save.ok.keys.plural":       "keys",
    "status.save.fields.singular":      "field",
    "status.save.fields.plural":        "fields",
    "status.save.nochange":             "no change",
    "status.save.activate":             "saved ({n} {fields}) — re-embed to activate",

    // — time-ago —
    "time.seconds":                     "{n}s ago",
    "time.minutes":                     "{n}m ago",
    "time.hours":                       "{n}h ago",
    "time.days":                        "{n}d ago",
    "time.never":                       "—",
  },

  es: {
    "switcher.atmosphere.aria":         "Atmósfera del mundo",
    "switcher.atmosphere.forest":       "Bosque",
    "switcher.atmosphere.inner-mind":   "Mente interior",
    "switcher.atmosphere.sound.title":  "Activar sonido ambiente",
    "switcher.language.aria":           "Idioma",

    "loader.title":                     "Construyendo el mundo",
    "loader.fetching":                  "obteniendo el corpus",
    "loader.assembling":                "ensamblando entidades",
    "loader.failed":                    "el mundo no pudo cargar",
    "loader.switch.title":              "Cambiando atmósfera",
    "loader.switch.message":            "reconstruyendo",

    "stage.toggle.label":               "EDITAR ESCENARIO",
    "stage.toggle.title":               "Alternar el editor de escenario en lienzo",
    "stage.save.flash":                 "GUARDADO ✓",

    "stage.world.heading":              "Mundo",
    "stage.world.atmosphere.label":     "atmósfera por defecto",
    "stage.world.atmosphere.save":      "Guardar",
    "stage.world.tints.scope.base":     "tintes → paleta base",
    "stage.world.tints.scope.overlay":  "tintes → overlay de {atmosphere}",
    "stage.world.tints.background":     "fondo",
    "stage.world.tints.fog":            "niebla",
    "stage.world.tints.ground":         "suelo",
    "stage.world.embedded.label":       "embebidos",
    "stage.world.embedded.stale":       "obsoleto",
    "stage.world.model":                "modelo",
    "stage.world.lastembed":            "último embebido",
    "stage.world.reembed":              "Re-embeber corpus",
    "stage.world.reembed.stale":        "Re-embeber (polos obsoletos)",
    "stage.world.reembed.busy":         "Embebiendo…",
    "stage.world.reembed.help":         "Ejecuta world:embed vía el endpoint de admin. Requiere el permiso 'edit world signature'. El cómputo del embedding permanece externo según BOUNDARY.md.",

    "stage.interpretation.heading":     "Interpretación",
    "stage.interpretation.help":        "Ejes ancla — la prosa que acuña significado. Los cambios persisten al guardar; los nuevos polos toman efecto en el próximo re-embebido (los vectores de eje se computan del lado servidor).",
    "stage.interpretation.stale":       "⚠ polos editados desde el último embebido — re-embeber para activar.",
    "stage.interpretation.axis":        "eje",
    "stage.interpretation.field.name":  "nombre",
    "stage.interpretation.field.pole_a":"polo a",
    "stage.interpretation.field.pole_b":"polo b",
    "stage.interpretation.save":        "Guardar ejes",
    "stage.interpretation.save.busy":   "Guardando…",

    "stage.sign.heading.empty":         "Escenario",
    "stage.sign.empty.hint":            "Haz clic en un marcador numerado para seleccionar un signo.<br>Arrastrar: horizontal → ángulo, vertical → altura.",
    "stage.sign.heading":               "Signo {n}",
    "stage.sign.hint":                  "Arrastrar: horizontal → ángulo, vertical → altura.",
    "stage.sign.angle":                 "ángulo",
    "stage.sign.angle.unit":            "rad",
    "stage.sign.height":                "altura",
    "stage.sign.height.unit":           "unid.",
    "stage.sign.scale":                 "escala",
    "stage.sign.deselect":              "Quitar selección",
    "stage.sign.save":                  "Guardar",

    "status.auth.failed":               "autenticación fallida — se requiere el permiso 'edit world signature'",
    "status.http":                      "HTTP {code} {body}",
    "status.save.ok":                   "guardado ({count} {keys})",
    "status.save.ok.keys.singular":     "clave",
    "status.save.ok.keys.plural":       "claves",
    "status.save.fields.singular":      "campo",
    "status.save.fields.plural":        "campos",
    "status.save.nochange":             "sin cambios",
    "status.save.activate":             "guardado ({n} {fields}) — re-embeber para activar",

    "time.seconds":                     "hace {n}s",
    "time.minutes":                     "hace {n}min",
    "time.hours":                       "hace {n}h",
    "time.days":                        "hace {n}d",
    "time.never":                       "—",
  },
};

/**
 * Look up a translation. Falls back to English when the key is
 * missing in the requested language, and to the key itself when
 * missing in both (so a misspelled key surfaces visibly during
 * development instead of producing empty strings).
 *
 * Interpolation: `{name}` placeholders are replaced from `subs`.
 *
 * @example
 *   t("es", "stage.sign.heading", {n: 4})  // "Signo 4"
 *   t("en", "status.http", {code: 500, body: "boom"})  // "HTTP 500 boom"
 */
export function t(
  lang: Lang,
  key: string,
  subs?: Record<string, string | number>,
): string {
  const branch = CATALOG[lang] ?? CATALOG.en;
  const raw = branch[key] ?? CATALOG.en[key] ?? key;
  if (!subs) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    const v = subs[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
