# Editorial guide — content for the Site as World

> **Audience:** editors, writers, content strategists working on a
> property that runs the `drupal_threejs` theme. Engineers can read
> this too; mostly it's not for you.

If you've edited a Drupal site before, almost everything you know
still applies — content types, fields, taxonomy, paragraphs, the
Edit form. What's different is what those choices *mean* downstream.
This guide is a translation: from the editorial primitives you
already use, to the world your readers will inhabit.

## What changed

You used to publish *pages*. Now you shape a *place*.

A site running this theme presents itself to readers as a navigable
world — a continuous canvas with regions, objects, and atmosphere.
The geography of that world is a function of the corpus you and
your team produce. Where you write, the world thickens. Where you
don't, it thins. **You are not just adding content; you are
making places more or less alive.**

The theme renders the world. You shape it. The translation between
"what you save in the Edit form" and "how the world looks and
feels" is mechanical — handled by a module called the *cypher*
([world_signature](../web/modules/custom/world_signature/)). This
guide tells you how to feed the cypher well.

## The reading list — eight axes that determine richness

The cypher reads eight properties of your corpus and turns them into
the world's texture. Content that scores well on six or more axes
yields a lived-in world. Content that scores on only one or two
yields a thin, geometric one — readable but not inhabited.

| Axis | What it gives the world | What it costs the editor |
|---|---|---|
| **Cardinality** | Population per region | Volume — make enough content per topic |
| **Diversity** | Species variety (rooms, monuments, beacons, gardens) | Use multiple content types, not just `article` |
| **Structure** | Card decks + sub-objects on each thing | Use mixed paragraph types: text, image, pull-quote, callout, map |
| **Connectivity** | Visible threads between objects | Cross-reference: "see also", "by this author", "in this series" |
| **Tagging** | Sectors and borderlands | Use multiple vocabularies; tag across them |
| **Temporality** | Patina, glow, weathering | Don't publish everything in one batch; let dates spread |
| **Authorship** | Stylistic neighborhoods | Multiple authors with distinct voices |
| **Form** | Sensorial richness | Mix media: image, video, audio, geo, structured data |

### Cardinality — populate before you decorate

A region of the world (a sector, in the cypher's vocabulary) becomes
visible when there are *enough things in it*. A topic with three
articles is a sparse meadow. A topic with thirty is a town. The
inhabitants find town interesting; meadow gets a glance.

**What to do.** When you tag content with a topic, plan to write
4–10 pieces under that topic before moving on. Don't spread too thin.

### Diversity — different *kinds* of objects

If every object in the world is the same shape, the world is boring.
The cypher creates a different *species* of object per content type:

- An **Article** becomes a *room* — you walk into it and read.
- A **Profile** (author, contributor) becomes a *standing figure*
  with a bio card.
- An **Event** becomes a *temporal beacon* with a date card.
- A **Product** (Drupal Commerce) becomes a *stall* in a marketplace.
- A **Location** becomes a *pin* on the map layer.

A site with only articles is one species. Adding profiles and
events makes the world's bestiary richer.

**What to do.** Use the content types your property has. If you
keep wanting to use `article` for things that aren't articles
(like author bios), tell the engineering team — that's a missing
content type, not a copy fix.

### Structure — paragraphs aren't decoration

This is the axis that tends to surprise editors. Inside an article,
the *structure* of paragraphs determines what the corresponding
object in the world looks like:

- A long body of plain text → a *uniform surface*.
- A body with **image paragraphs** → *facets* on the object that
  glint and reflect.
- A body with **pull-quote paragraphs** → *inscriptions* visible
  from outside the object.
- A body with **callout paragraphs** → *signage* visitors see at a
  distance.
- A body with **map / location paragraphs** → *anchors* placing the
  object in geographic space.

The cypher's per-paragraph-type configuration decides whether a
paragraph becomes a sub-object in the world (visible from outside)
or a card on the parent (visible only when activated). Hero
paragraphs and pull-quotes typically become cards-on-parent.
Section dividers and major callouts typically become sub-objects.

**What to do.** Use varied paragraph types deliberately. A "wall of
text" article works, but a structured one — quote, image, callout,
text, image, conclusion — produces a richer object.

### Connectivity — the world has a graph

When you reference another piece of content (an entity reference, a
"see also", an in-text link with `entity:` syntax), you create a
*visible thread* between objects in the world. Readers can see and
follow these threads.

A site where nothing references anything else is a constellation of
isolated points. A site where everything references at least 2-3
related pieces is a web. Webs are walkable.

**What to do.** When you publish an article, add 2–5 entity
references to related content. "By this author" if you have an
authors vocabulary. "In this series" if the content is part of one.
"Mentions" if it discusses a person or place that has its own page.
You've probably been doing this for SEO; the world model rewards it
twice.

### Tagging — vocabularies become biomes

The cypher uses your top-level taxonomy terms to define *sectors*
in the world. Top-level terms in a `topics` vocabulary might create
sectors for `fishing`, `climbing`, `cooking`. Each sector has its
own color palette, ambient light, weather.

When you tag an article with multiple top-level terms across
*different* vocabularies (e.g. `topics: fishing` and `regions: pacific-northwest`),
the article lands in a **borderland** between sectors — visible
from both, claimed by neither.

**What to do.**

- Use at least 2 vocabularies (e.g. `topics`, `regions`, `era`).
- Tag content with 1–3 terms per vocabulary.
- Cross-vocabulary tagging is fine and meaningful — it places
  content at sector boundaries, which is sometimes the most
  interesting place in the world.
- Don't tag everything with everything; that flattens the
  geography.

### Temporality — let the dates spread

The cypher reads `created_at` and `changed_at` on every entity. It
uses them to decide:

- How weathered an object looks (older content acquires patina,
  paler colors).
- How brightly it glows (recently-edited content emits light).
- How fast its ambient animation runs (newer content is more
  active).

If every article was created on the same day, the world is
uniformly fresh and lacks history. If articles span months or
years with periodic edits, the world has time-depth.

**What to do.**

- Don't bulk-publish if you can avoid it. Let publishing happen
  over weeks.
- Edit older content occasionally. Updates get reflected as
  revived glow.
- Some content can be deliberately archival — publish-and-forget;
  it weathers gracefully and adds depth.

### Authorship — voices have stylistic homes

The cypher reads the content's author and uses it as a stylistic
signature. Each author's articles get a coherent visual treatment
(a material, a color signature, an animation pattern). Walking
through their content cluster feels like walking through a
neighborhood.

**What to do.**

- Use real author accounts (don't all publish as `admin`).
- Author profiles (a `profile` content type per writer) anchor
  the cluster — the author's "standing figure" is at the center
  of their authored articles.
- An article authored by multiple people is fine; it sits at the
  borderland between their neighborhoods.

### Form — beyond text

A pure-text article is a small, simple object in the world. Add
images and the object gains reflective surfaces. Add a video and
it ambient-loops. Add audio and the object emits sound when the
inhabitant approaches. Add a map (geo coordinates) and the article
also exists as a pin on the world's map layer. Add structured data
(facts and figures) and the cypher renders precise visualizations
on the object's surface.

**What to do.** Don't write only prose. Mix media when it's true to
the subject. The world rewards content with multiple senses
engaged.

## Per-content-type recipes (defaults — your engineer may have configured differently)

Look up your property's `theme/config/world_metaphors.yml` for the
authoritative version. The defaults are:

### Article (the canonical species)

- **What it becomes:** a room.
- **Cards on activation:** the full article body (default), plus
  optional `related` and `comments` cards.
- **Trigger pad:** a bookmark-shape on the room's exterior.
- **Sector membership:** taxonomy terms in `field_tags`.
- **Editor's checklist:**
  1. Title — clear, short.
  2. Body — at least 300 words; mixed paragraph types; pull-quotes
     for memorable lines.
  3. Tags — 1–3 from `topics`, optionally 1–2 from `regions`.
  4. Author — a real profile, not `admin`.
  5. Hero image — at least one, ideally with alt text that
     reads aloud well (the chatvatar will read it).
  6. References — 2–5 related entities.

### Profile (an author, a contributor)

- **What it becomes:** a standing figure.
- **Cards on activation:** bio + works-by-this-author.
- **Trigger pad:** a portrait silhouette.
- **Sector membership:** the author's primary topic (taxonomy via
  `field_areas_of_focus` or similar).
- **Editor's checklist:**
  1. Name, role, short bio (~100 words).
  2. Photo or rendered avatar.
  3. Areas of focus — taxonomy.
  4. (Optional) external links — produces *radiating filaments*
     toward the world's edge.

### Event (a thing happening at a time)

- **What it becomes:** a temporal beacon.
- **Cards on activation:** description + details + RSVP/registration.
- **Trigger pad:** a date marker.
- **Sector membership:** topic + venue (if you have a venues vocab).
- **Editor's checklist:**
  1. Title, description, dates (start, end).
  2. Venue or geo coordinates.
  3. Topic tags.
  4. Status: published, scheduled (future), or archived.

### Product (Drupal Commerce)

- **What it becomes:** a stall in the marketplace.
- **Cards on activation:** description + variants + add-to-cart.
- **Trigger pad:** a price tag.
- **Sector membership:** product category vocabulary.
- **Editor's checklist:** standard Commerce fields apply. The world
  treats products with imagery, structured specs, and customer
  reviews as the richest stalls.

## A "good content" mental checklist

Before hitting publish, glance through:

- [ ] Title and body are clear.
- [ ] At least 300 words of substantive prose.
- [ ] At least one image (with alt text).
- [ ] Tagged with 1–3 terms from at least one taxonomy.
- [ ] Author set to a real person/profile.
- [ ] At least one entity reference to related content.
- [ ] If part of a series or collection, the series field is set.
- [ ] Published date makes sense (not today, if it isn't).

Hitting all 8 yields rich corpus. Hitting 4-5 is fine — the world
adapts. Hitting 1-2 produces a world that feels skeletal in the
neighborhood of that content.

## What you can ignore

- The `field_world_signature` field on each content type. It's
  computed by the cypher; you should not see it on the edit form.
  If you do, tell engineering — it's meant to be hidden.
- The descriptor JSON the cypher emits. You'll never see it; it's
  data the renderer consumes.
- The vector embeddings. The cypher computes them automatically
  on save. There's no editor surface for them.

## When you have a question

- **"Why is this article showing up in the wrong sector?"** → Check
  its taxonomy tags. The first top-level term you've assigned
  determines its primary sector.
- **"Why does this article look sparse in the world?"** → Run it
  through the eight-axis checklist. If it scores 1–2, the world
  is reflecting that honestly.
- **"How do I make an object stand out more?"** → Add structure
  (paragraphs), references (graph weight), or recent edits
  (recency glow). Don't try to game the cypher; just write better
  content.
- **"Why does the chatvatar say it doesn't know about X when I
  wrote about X?"** → The chatvatar's grounding only includes
  *published* content. Drafts and unpublished entities don't reach
  the embedding index.
- **"Can I preview my changes in the world before publishing?"** →
  Once the editor preview lands (v0.0.3 milestone), yes. Until
  then, save as draft and ask engineering to run a preview.

## What we're not asking you to do

- Learn three.js. Ever.
- Think about coordinates, vectors, embeddings, sectors, or any
  cypher-side mechanics directly. They're our concern.
- Change how you write. Just keep the eight axes in peripheral
  attention; the rest is the same craft.

## Coming soon

When the chatvatar lands (v0.0.3), readers will be able to ask the
world questions in natural language. The chatvatar's answers come
from *your content*, cited back to specific cards. Content that's
clear, factual, and well-attributed performs best — same as the
content that performs best with human readers, which is to say,
your normal craft is the right craft.

The world doesn't ask you to write differently. It rewards you for
writing well.
