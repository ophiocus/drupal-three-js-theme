<?php

/**
 * Asset catalog seeder — bulk-import the CANDIDATES.md shortlist
 * into Drupal as pack + asset content.
 *
 * Materializes the curation library that lives in markdown at
 * assets/props/CANDIDATES.md as editable, queryable Drupal content.
 * After running:
 *
 *   /admin/content?type=pack   → 15 shortlisted source packs
 *   /admin/content?type=asset  → 17 shortlisted asset candidates,
 *                                each referencing its parent pack
 *
 * Status: every asset starts as `shortlisted` — neither raw file
 * nor curated file uploaded; just provenance + slot binding + a
 * body note tracing back to the source. Acquisition (uploading the
 * raw file onto the pack node) and curation (Blender pass producing
 * the curated .glb on each asset) happen via the editor UI or
 * future drush commands.
 *
 * Idempotent — re-running cleans existing pack + asset nodes first.
 *
 * Prereq: scaffold/seed-asset-vocab.php must have run first
 * (provides the asset_licenses / asset_slots / asset_status terms
 * this script references by name).
 *
 * Run via:
 *   ddev drush scr scaffold/seed-asset-catalog.php
 */

declare(strict_types=1);

use Drupal\node\Entity\Node;

// ─── Pack definitions ──────────────────────────────────────────────────────
//
// Each key is a slug used by $assets[] below to reference the pack.
// Two packs (kaykit-forest, quaternius-ultimate) get assets in
// multiple slots — they're created once, referenced N times.

$packs = [
  // — Standing-stone candidates —
  'sketchfab-mystical-stone' => [
    'title' => 'Stylized Mystical Stone',
    'source_url' => 'https://sketchfab.com/3d-models/stylized-mystical-stone-low-poly-free-89c8b43df46942d7b171702e45751e33',
    'source_author' => 'Glimmer',
    'license' => 'CC-BY',
    'license_url' => '',
    'attribution' => 'Stylized Mystical Stone by Glimmer (Sketchfab) — license needs verification before commercial use.',
    'raw_format' => 'glb',
    'version' => '',
    'body' => "Single mystical stone with baked normal maps. Free download on Sketchfab. License tier placeholder set to CC-BY pending verification — confirm before commercial use. Cinematic prop scale; would need rescaling for marker reading.\n\nSource catalog reference: assets/props/CANDIDATES.md slot standing-stone, candidate S4.",
  ],
  'sketchfab-low-poly-stone' => [
    'title' => 'Stylized low-poly stone',
    'source_url' => 'https://sketchfab.com/3d-models/stylized-low-poly-stone-c7de83088a904a1a8b7420b00d395dec',
    'source_author' => 'Alex_Pepper',
    'license' => 'CC-BY',
    'license_url' => '',
    'attribution' => 'Stylized low-poly stone by Alex_Pepper (Sketchfab) — license needs verification.',
    'raw_format' => 'glb',
    'version' => '',
    'body' => "Generic stone — rounder than a stela reading, but useful as scenery filler in the same pull. License tier placeholder; verify before use.\n\nSource catalog reference: CANDIDATES.md slot standing-stone, candidate S5.",
  ],

  // — Sapling-figure candidates —
  'kaykit-adventurers' => [
    'title' => 'KayKit Character Pack: Adventurers',
    'source_url' => 'https://kaylousberg.itch.io/kaykit-adventurers',
    'source_author' => 'Kay Lousberg',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Three rigged stylized low-poly humanoids in .GLB. Production-quality CC0. Exceptional fit for the 'stylized but readable' aesthetic the forest atmosphere wants. Probably overkill for a profile silhouette but the bar it sets is real.\n\nSource catalog reference: CANDIDATES.md slot sapling-figure, candidate P1.",
  ],
  'kaykit-forest' => [
    'title' => 'KayKit Forest Nature Pack',
    'source_url' => 'https://kaylousberg.itch.io/kaykit-forest',
    'source_author' => 'Kay Lousberg',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "100+ models — trees, mushrooms, ferns, rocks, fallen logs, flowers. Possibly some humanoid silhouettes. .GLB included. The single best fit for the forest-scenery slot in one pull; doubles as a sapling-figure candidate.\n\nSource catalog reference: CANDIDATES.md slots sapling-figure (P2) and forest-scenery (F1).",
  ],
  'standout7-adventure' => [
    'title' => 'Adventure Character Pack',
    'source_url' => 'https://standout7.itch.io/adventure-character-pack',
    'source_author' => 'standout7',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Three fully rigged stylized low-poly heroes in FBX / Unity / Unreal / GLB / glTF / OBJ. Direct alternative to KayKit Adventurers if a different aesthetic is wanted.\n\nSource catalog reference: CANDIDATES.md slot sapling-figure, candidate P4.",
  ],
  'opengameart-cc0-3d-low-poly' => [
    'title' => 'CC0 ASSETS 3D LOW POLY',
    'source_url' => 'https://opengameart.org/content/cc0-assets-3d-low-poly',
    'source_author' => 'OpenGameArt contributors',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Older, scrappier collection of CC0 low-poly assets. Worth searching if the stylized aesthetic doesn't fit and a more abstract humanoid figure is wanted.\n\nSource catalog reference: CANDIDATES.md slot sapling-figure, candidate P5.",
  ],

  // — Oak-stylized candidates —
  'quaternius-stylized-tree-pack' => [
    'title' => 'Quaternius Stylized Tree Pack',
    'source_url' => 'https://quaternius.com/packs/stylizedtree.html',
    'source_author' => 'Quaternius',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Animal Crossing-style stylized trees, multiple species in one pack. The canonical answer for the oak-stylized slot. Ships as .FBX / .OBJ / .Blend; convert via Blender export to .glb.\n\nSource catalog reference: CANDIDATES.md slot oak-stylized, candidate T1.",
  ],
  'quaternius-150-lowpoly-nature' => [
    'title' => 'Quaternius 150+ LowPoly Nature Models',
    'source_url' => 'https://quaternius.itch.io/150-lowpoly-nature-models',
    'source_author' => 'Quaternius',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Mega-pack: trees + plants + rocks + props. Probably overlaps with the Ultimate Stylized Nature Pack but the older 150+ pack has classics worth keeping.\n\nSource catalog reference: CANDIDATES.md slot oak-stylized, candidate T2.",
  ],
  'quaternius-ultimate' => [
    'title' => 'Quaternius Ultimate Stylized Nature Pack',
    'source_url' => 'https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr',
    'source_author' => 'Quaternius',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "60+ nature assets, FBX + GLB, normal-mapped textures. Single best value of the Quaternius packs for our needs — covers trees AND scenery in one bundle.\n\n**Highest-impact single pull** per CANDIDATES.md recommendation: pair with KayKit Forest and we cover oak-stylized + forest-scenery in two CC0 downloads.\n\nSource catalog reference: CANDIDATES.md slots oak-stylized (T3) and forest-scenery (F3).",
  ],
  'quaternius-textured-lowpoly-trees' => [
    'title' => 'Quaternius Textured LowPoly Trees',
    'source_url' => 'https://quaternius.itch.io/textured-lowpoly-trees',
    'source_author' => 'Quaternius',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "45 tree models, more variety than the Stylized Tree Pack alone. Use as overflow if T1's species count feels limited.\n\nSource catalog reference: CANDIDATES.md slot oak-stylized, candidate T4.",
  ],
  'opengameart-low-poly-nature-pack-1' => [
    'title' => 'OpenGameArt Low Poly Nature Pack',
    'source_url' => 'https://opengameart.org/content/low-poly-nature-pack-1',
    'source_author' => 'OpenGameArt contributors',
    'license' => 'CC-BY',
    'license_url' => '',
    'attribution' => 'OpenGameArt Low Poly Nature Pack — license tier mixed; verify per-mesh before use.',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Alternative aesthetic — slightly more 'indie game' than Quaternius's polish. Useful if a less-uniform forest is wanted. License tier mixed within the pack; verify per-mesh.\n\nSource catalog reference: CANDIDATES.md slot oak-stylized, candidate T5.",
  ],

  // — Forest-scenery candidates (additional to kaykit-forest + quaternius-ultimate above) —
  'eclair-nature-kit-glb' => [
    'title' => 'Eclair Assets Nature Kit GLB Pack',
    'source_url' => 'https://eclair-assets.itch.io/nature-kit-glb-pack-329-free-cc0-3d-models',
    'source_author' => 'Eclair Assets',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "329 nature models, GLB-ready, CC0. Massive variety; the 'if KayKit isn't quite right, this almost certainly is' backup.\n\nSource catalog reference: CANDIDATES.md slot forest-scenery, candidate F2.",
  ],
  'opengameart-cc0-nature' => [
    'title' => 'OpenGameArt CC0 Nature',
    'source_url' => 'https://opengameart.org/content/cc0-nature',
    'source_author' => 'OpenGameArt contributors',
    'license' => 'CC0',
    'license_url' => 'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution' => '',
    'raw_format' => 'zip',
    'version' => '',
    'body' => "Older but reliable CC0 nature collection. Worth checking for specific items KayKit might lack (broad-leaf tropical plants in particular — cloud-forest-specific aesthetic).\n\nSource catalog reference: CANDIDATES.md slot forest-scenery, candidate F4.",
  ],
  'sketchfab-renderhaven-forest' => [
    'title' => 'Low Poly Forest Pack (RenderHaven)',
    'source_url' => 'https://sketchfab.com/3d-models/low-poly-forest-pack-free-3d-models-b17884c5fa7942fb97b48e1fb7d81ba5',
    'source_author' => 'RenderHaven',
    'license' => 'CC-BY',
    'license_url' => '',
    'attribution' => 'Low Poly Forest Pack by RenderHaven (Sketchfab) — license needs verification.',
    'raw_format' => 'glb',
    'version' => '',
    'body' => "Trees + logs + mushrooms + rocks bundle. License check needed before commit.\n\nSource catalog reference: CANDIDATES.md slot forest-scenery, candidate F5.",
  ],
  'sketchfab-purepoly-forest' => [
    'title' => 'Free Low Poly Forest (purepoly)',
    'source_url' => 'https://sketchfab.com/3d-models/free-low-poly-forest-6dc8c85121234cb59dbd53a673fa2b8f',
    'source_author' => 'purepoly',
    'license' => 'CC-BY',
    'license_url' => '',
    'attribution' => 'Free Low Poly Forest by purepoly (Sketchfab) — license needs verification.',
    'raw_format' => 'glb',
    'version' => '',
    'body' => "Whole-forest pack; could provide silhouette anchors for the sector environment. License check needed.\n\nSource catalog reference: CANDIDATES.md slot forest-scenery, candidate F6.",
  ],
];

// ─── Asset definitions ─────────────────────────────────────────────────────
//
// Each entry: which pack it belongs to, which slot it fills, lifecycle
// status (all start at `shortlisted`), eligible atmospheres, body
// note. The slot field is what binds the asset to a Builder via the
// atmosphere mappings.yml.

$assets = [
  // — Standing-stone —
  [
    'pack_key' => 'sketchfab-mystical-stone',
    'title' => 'Stylized Mystical Stone (standing-stone candidate)',
    'slot' => 'standing-stone',
    'body' => 'Mystical stone candidate for the standing-stone slot. Needs rescaling and possibly silhouette work to read as a marker rather than a hero prop.',
  ],
  [
    'pack_key' => 'sketchfab-low-poly-stone',
    'title' => 'Stylized low-poly stone (standing-stone candidate)',
    'slot' => 'standing-stone',
    'body' => 'Generic stone candidate. Lower priority than mystical-stone — shape reads more boulder than stela.',
  ],

  // — Sapling-figure —
  [
    'pack_key' => 'kaykit-adventurers',
    'title' => 'KayKit humanoid (sapling-figure candidate)',
    'slot' => 'sapling-figure',
    'body' => 'Primary candidate for the sapling-figure slot. Rigged stylized low-poly humanoid; bar-setter for stylized-but-readable aesthetic.',
  ],
  [
    'pack_key' => 'kaykit-forest',
    'title' => 'KayKit Forest character (sapling-figure candidate)',
    'slot' => 'sapling-figure',
    'body' => 'Speculative — KayKit Forest Nature Pack may include a humanoid silhouette suitable as a forest-spirit. Verify on download.',
  ],
  [
    'pack_key' => 'standout7-adventure',
    'title' => 'standout7 hero (sapling-figure candidate)',
    'slot' => 'sapling-figure',
    'body' => 'Alternative aesthetic to KayKit. Three rigged heroes; pick the most spirit-like silhouette.',
  ],
  [
    'pack_key' => 'opengameart-cc0-3d-low-poly',
    'title' => 'OpenGameArt humanoid (sapling-figure candidate)',
    'slot' => 'sapling-figure',
    'body' => 'Fallback option if a more abstract / less polished figure is wanted. OpenGameArt aesthetic is scrappier than KayKit.',
  ],

  // — Oak-stylized —
  [
    'pack_key' => 'quaternius-stylized-tree-pack',
    'title' => 'Quaternius stylized tree (oak-stylized candidate)',
    'slot' => 'oak-stylized',
    'body' => 'Canonical candidate. Multi-species pack — use the existing FNV-1a seed to pick a species per article so the forest has variety.',
  ],
  [
    'pack_key' => 'quaternius-150-lowpoly-nature',
    'title' => 'Quaternius 150+ tree (oak-stylized candidate)',
    'slot' => 'oak-stylized',
    'body' => 'Tree subset of the 150+ pack. Use as overflow if T1 species count needs more.',
  ],
  [
    'pack_key' => 'quaternius-ultimate',
    'title' => 'Quaternius Ultimate tree (oak-stylized candidate)',
    'slot' => 'oak-stylized',
    'body' => 'Trees subset of the Ultimate pack. Pairs with the forest-scenery assets from the same pack for one-download coverage.',
  ],
  [
    'pack_key' => 'quaternius-textured-lowpoly-trees',
    'title' => 'Quaternius textured tree (oak-stylized candidate)',
    'slot' => 'oak-stylized',
    'body' => '45 tree models. Use as overflow for additional species variety.',
  ],
  [
    'pack_key' => 'opengameart-low-poly-nature-pack-1',
    'title' => 'OpenGameArt tree (oak-stylized candidate)',
    'slot' => 'oak-stylized',
    'body' => 'Less-uniform aesthetic alternative. License tier mixed within pack; verify per-mesh.',
  ],

  // — Forest-scenery (mushroom as the canonical slot for the seeder;
  //    a single pack typically covers mushroom + fern + stone; the
  //    curator splits into per-slot assets later if needed) —
  [
    'pack_key' => 'kaykit-forest',
    'title' => 'KayKit Forest scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Canonical scenery candidate. Pack contains mushrooms + ferns + rocks + logs + flowers; split into per-slot asset children when curating.',
  ],
  [
    'pack_key' => 'eclair-nature-kit-glb',
    'title' => 'Eclair Nature Kit scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Variety backstop. 329 models covers mushroom + fern + stone slots; split per-slot when curating.',
  ],
  [
    'pack_key' => 'quaternius-ultimate',
    'title' => 'Quaternius Ultimate scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Scenery subset of the Ultimate pack. Pairs with the oak-stylized asset from the same pack.',
  ],
  [
    'pack_key' => 'opengameart-cc0-nature',
    'title' => 'OpenGameArt CC0 Nature scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Worth checking for tropical / cloud-forest plants the stylized packs may lack.',
  ],
  [
    'pack_key' => 'sketchfab-renderhaven-forest',
    'title' => 'RenderHaven forest scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Sketchfab pack. License verification required before use.',
  ],
  [
    'pack_key' => 'sketchfab-purepoly-forest',
    'title' => 'purepoly forest scenery (forest-scenery candidates)',
    'slot' => 'forest-scenery-mushroom',
    'body' => 'Sketchfab pack. License verification required before use.',
  ],
];

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Load a taxonomy term by name within a vocabulary, fail loudly if missing.
 */
function termByName(string $vid, string $name): int {
  $terms = \Drupal::entityTypeManager()
    ->getStorage('taxonomy_term')
    ->loadByProperties(['vid' => $vid, 'name' => $name]);
  if (!$terms) {
    throw new \RuntimeException(sprintf(
      "Missing term '%s' in vocabulary '%s'. Run scaffold/seed-asset-vocab.php first.",
      $name,
      $vid,
    ));
  }
  return (int) reset($terms)->id();
}

// ─── Execution ─────────────────────────────────────────────────────────────

echo "[seed-asset-catalog] phase 1: validate vocab terms present\n";
try {
  // Resolve the term ids we need upfront; bail early if any missing.
  $shortlistedTid = termByName('asset_status', 'shortlisted');
  $licenseTids = [
    'CC0' => termByName('asset_licenses', 'CC0'),
    'CC-BY' => termByName('asset_licenses', 'CC-BY'),
    'CC-BY-SA' => termByName('asset_licenses', 'CC-BY-SA'),
    'CC-BY-NC' => termByName('asset_licenses', 'CC-BY-NC'),
    'Sketchfab Standard' => termByName('asset_licenses', 'Sketchfab Standard'),
    'itch.io paid' => termByName('asset_licenses', 'itch.io paid'),
    'Custom (in-house)' => termByName('asset_licenses', 'Custom (in-house)'),
  ];
  $slotTids = [
    'standing-stone' => termByName('asset_slots', 'standing-stone'),
    'sapling-figure' => termByName('asset_slots', 'sapling-figure'),
    'oak-stylized' => termByName('asset_slots', 'oak-stylized'),
    'forest-scenery-mushroom' => termByName('asset_slots', 'forest-scenery-mushroom'),
    'forest-scenery-fern' => termByName('asset_slots', 'forest-scenery-fern'),
    'forest-scenery-stone' => termByName('asset_slots', 'forest-scenery-stone'),
  ];
} catch (\Throwable $e) {
  echo "  ! FATAL: " . $e->getMessage() . "\n";
  return;
}
echo "  + asset_status terms ok\n  + asset_licenses terms ok\n  + asset_slots terms ok\n";

echo "\n[seed-asset-catalog] phase 2: clean previous catalog\n";
$existing = \Drupal::entityQuery('node')
  ->accessCheck(FALSE)
  ->condition('type', ['pack', 'asset'], 'IN')
  ->execute();
if ($existing) {
  $nodes = Node::loadMultiple($existing);
  foreach ($nodes as $n) {
    echo sprintf("  - deleting %s/%d: %s\n", $n->bundle(), $n->id(), $n->label());
    $n->delete();
  }
} else {
  echo "  (no existing pack/asset nodes)\n";
}

echo "\n[seed-asset-catalog] phase 3: create packs\n";
$packIdBySlug = [];
foreach ($packs as $slug => $spec) {
  $node = Node::create([
    'type' => 'pack',
    'title' => $spec['title'],
    'body' => [
      'value' => $spec['body'],
      'format' => 'basic_html',
    ],
    'field_pack_source_url' => $spec['source_url']
      ? [['uri' => $spec['source_url'], 'title' => '']]
      : [],
    'field_pack_source_author' => $spec['source_author'],
    'field_pack_license' => [['target_id' => $licenseTids[$spec['license']]]],
    'field_pack_license_url' => $spec['license_url']
      ? [['uri' => $spec['license_url'], 'title' => '']]
      : [],
    'field_pack_attribution' => $spec['attribution'],
    'field_pack_raw_format' => $spec['raw_format'],
    'field_pack_version' => $spec['version'],
    'status' => 1,
    'uid' => 1,
  ]);
  $node->save();
  $packIdBySlug[$slug] = (int) $node->id();
  echo sprintf("  + pack nid=%d [%s] %s\n", $node->id(), $spec['license'], $spec['title']);
}

echo "\n[seed-asset-catalog] phase 4: create assets\n";
$assetCount = 0;
foreach ($assets as $entry) {
  $packId = $packIdBySlug[$entry['pack_key']] ?? NULL;
  if (!$packId) {
    echo sprintf("  ! skip — unknown pack_key '%s' for asset '%s'\n", $entry['pack_key'], $entry['title']);
    continue;
  }
  $slotTid = $slotTids[$entry['slot']] ?? NULL;
  if (!$slotTid) {
    echo sprintf("  ! skip — unknown slot '%s' for asset '%s'\n", $entry['slot'], $entry['title']);
    continue;
  }
  $node = Node::create([
    'type' => 'asset',
    'title' => $entry['title'],
    'body' => [
      'value' => $entry['body'],
      'format' => 'basic_html',
    ],
    'field_asset_pack' => [['target_id' => $packId]],
    'field_asset_slot' => [['target_id' => $slotTid]],
    'field_asset_status' => [['target_id' => $shortlistedTid]],
    'field_asset_atmospheres' => [['value' => 'forest']],
    'status' => 1,
    'uid' => 1,
  ]);
  $node->save();
  $assetCount++;
  echo sprintf(
    "  + asset nid=%d [%s] %s (pack nid=%d)\n",
    $node->id(),
    $entry['slot'],
    $entry['title'],
    $packId,
  );
}

echo "\n[seed-asset-catalog] done\n";
echo sprintf(
  "  packs created: %d, assets created: %d\n",
  count($packIdBySlug),
  $assetCount,
);
echo "\nBrowse:\n";
echo "  /admin/content?type=pack\n";
echo "  /admin/content?type=asset\n";
