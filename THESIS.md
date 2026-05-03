# Thesis: Site as World

## The dichotomy

The World Wide Web has been read as a collection of *documents* since the
moment a browser first rendered HTML. Pages, paragraphs, hyperlinks,
headers — the document model is the substrate, and the rest of the
web's experience has been built as variations on it: applications
inside pages, single-page apps imitating documents, infinite scrolls,
modal dialogs, all of them genuflecting to the page as the unit of
experience.

The document model isn't *given* by the WWW. It is a *representation*
the WWW happens to favor, mostly because that's what HTML rendered
first and what early browsers could draw. The web's actual
specification is more permissive than its convention: any client can
request any resource and receive any representation the server agrees
to send. The page is one option, not an axiom.

This project commits to the other option. **Site as World.** A site
is not a collection of pages. It is a *place* whose geography is the
editorial team's attention given physical form. The reader is an
inhabitant. Content is not published — content is *measured*, and its
measurements shape the world.

## The constitutional argument

The WWW rests on three load-bearing facts.

1. **URIs identify resources.** Resources are stable, addressable,
   shareable.
2. **Representations are negotiated.** The same resource can return
   different representations to different clients.
3. **Links compose the graph.** A link is a typed edge between
   resources.

A WebGL-capable client requesting a URI receives the
world-representation: scene fragments, geometry references, the
inhabitant's spawn at that coordinate. A crawler or a screen reader
requesting the same URI receives the document-representation: HTML
describing what is at that coordinate. Both are valid views of the
same resource. Content negotiation, used for what it was specified to
solve.

The price of admission is admitting that *site* no longer means
*collection of pages*. It means *place*.

## The reframing

- A URI is not a page; it is a **coordinate**. The address bar stops
  meaning *what page I am on* and starts meaning *where I am*.
- A page is not the resource; it is one **representation** of the
  resource. The world is another, equally valid.
- A link is not a navigation; it is a **portal**. Inside the world,
  links move you within it. From outside, links open doorways into
  it.
- The site map is not a list; it is **geography**. Information
  architecture, expressed as terrain.

Drupal's primitives translate without loss. Content types become
*species* of object. Nodes become specific objects placed in the
world. Taxonomy terms become regions, biomes, climates. Entity
references become spatial adjacency. Views become spatial queries —
*what can I see from here?* Menus become major paths. Comments become
traces left by previous inhabitants. Drupal Commerce becomes
marketplaces, stalls, transactions as physical exchange. The CMS is
no longer a publishing tool; it is the world's content engine.

## Generated geography

The world is not authored. The geography is a function of the corpus.

When an entity is saved, Drupal extracts a four-layer signature —
**structural** counts, **temporal** facts, **relational** graph
position, **semantic** embedding — and stores it on the entity. The
renderer reads the signature and produces the entity's physical form:
size, mass, color, light, position. Taxonomy provides the cardinal
sectors of the world. Semantic embeddings provide the within-sector
geometry, so similar things stand near each other without anyone
tagging them so. Multi-tagged content sits at sector boundaries;
cross-tagging *means something* in the world.

The shape of the world is the shape of the editorial team's
attention. Where editors work, the world thickens. Where they don't,
it thins. Authorship is care, and care produces world.

## What is kept. What is given up.

**Kept — the web's gifts.**

- URIs as coordinates. Bookmarkable, shareable, citable.
- Content negotiation as the seam between world and document.
  Accessibility and SEO are not retrofitted; they are the same
  resource's other representation.
- Linkability. Outside links become portals into the world.
- Drupal's information architecture as data, even when it is
  expressed as geography.

**Given up — and we should be honest.**

- Pages as a unit of experience.
- The back button as *previous content*; it becomes *previous
  coordinate*.
- The header and menu as static UI; they become geography or
  ambient signage.
- Tabular list views; lists become spatial arrangements.
- The conventional reading-speed contract; reading-in-a-place is
  slower than reading-on-a-page, and the design must absorb that
  cost or refuse it.

## What this commits us to

**Persistence.** The canvas is the site, not a feature of the site,
and it does not unmount across navigation. The world is continuous
across what used to be page transitions.

**Determinism.** The world is the same to every visitor. Coordinates
derive from `(entity_uuid, signature, corpus snapshot)`, and the
corpus snapshots are versioned so links remain reproducible. The
world updates in editions, not continuously.

**Honesty.** Every Drupal action has a world-meaning, and the
editor's mental model has shifted. We owe editors interfaces that
say so plainly — fields whose physical consequence is legible at the
point of editing, not buried in the renderer.

## Closing

Site as World is not a fantasy stack on top of the web. It is the
web's own specification taken at its word, applied to a CMS that
already organizes content as exactly the kind of structured corpus a
generated world needs.

The page was a representation. So is the world. We are choosing the
world.
