<?php

/**
 * Atlas_coffee fixtures — v0.3 bundle rebalance.
 *
 * Idempotent: re-running cleans the previous fixture set first.
 * 20 entries across 5 region terms in the `topics` vocabulary
 * (each region becomes a sector), distributed across three
 * bundles:
 *
 *   11 articles — reportage / explainers / technique deep-dives
 *    5 profiles — producers, cooperative leads, mill operators
 *    4 events   — harvests, cup competitions, cupping weeks
 *
 * Bundle declared per-entry via the `bundle` key. Body text is
 * tuned per bundle voice (article = third-person reportage;
 * profile = one-line role anchor then biographical; event =
 * explicit temporal anchor then outcome).
 *
 * Run via:
 *   ddev drush scr scaffold/seed-atlas-coffee.php
 *
 * The script terminates with a summary; afterward run
 * `drush world:publish` to push descriptors to the gateway.
 */

declare(strict_types=1);

use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Term;
use Drupal\taxonomy\Entity\Vocabulary;

// ─── Region terms ──────────────────────────────────────────────────────────
//
// Five Latin-American origins. Slug → display name. The slug becomes
// the taxonomy term machine-friendly handle (sector id under the
// cypher); display name is what shows in the UI.

$regions = [
  'antigua'      => 'Antigua, Guatemala',
  'cauca'        => 'Cauca, Colombia',
  'boquete'      => 'Boquete, Panamá',
  'sierra-madre' => 'Sierra Madre, México',
  'tarrazu'      => 'Tarrazú, Costa Rica',
];

// ─── Entries ───────────────────────────────────────────────────────────────
//
// 20 entries — four per region by design. Each carries its bundle:
//
//   article — reportage, explainers, deep-dives (third-person voice)
//   profile — a named person; opens with role-anchor line
//   event   — a date-anchored happening; opens with temporal anchor
//
// The Metaphor plugins under src/Plugin/Metaphor/Node/{Article,
// Profile,Event}.php are what the cypher dispatches on; the three.js
// builders ArticleAsTree / ProfileAsSpirit / EventAsTotem read the
// resulting signature and render the bundle's primitive.

$entries = [
  // ─── Antigua ──────────────────────────────────────────────────
  [
    'bundle' => 'article',
    'title' => 'Why Antigua\'s volcanic soil shows up in the cup',
    'region' => 'antigua',
    'body' => "Acatenango and Fuego dust their slopes with mineral-rich ash every few years. The soils that result drain fast, hold cation exchange capacity well above lowland averages, and keep coffee trees stressed enough to produce dense, complex seeds.\n\nAntigua's cups land medium-bodied with chocolate, hazelnut, and a bright but never sharp acidity. The classic profile isn't an accident — it's volcanism plus elevation plus a producer culture that has, over four generations, refined washed processing to the point where the terroir comes through unobscured.",
  ],
  [
    'bundle' => 'profile',
    'title' => 'Doña Rosa Méndez — three generations on the slopes of Acatenango',
    'region' => 'antigua',
    'body' => "Third-generation Antigua producer. Forty-eight hectares of Bourbon, Caturra, and an experimental block of Pacamara, 1,500 to 1,700 meters on the Acatenango slopes.\n\nDoña Rosa's grandfather cleared the upper terrace in 1948; her father added the wet mill in 1976; she added shade restoration and the second drying patio in the early 2010s. She still cups every lot herself before it leaves the beneficio.\n\n\"You taste the year in the cup,\" she says. \"You cannot hide the year.\"",
  ],
  [
    'bundle' => 'event',
    'title' => 'The 2026 Antigua harvest: La Niña and what producers are calling \'unusually clean\'',
    'region' => 'antigua',
    'body' => "Harvest window: December 2025 – March 2026.\n\nEarly arrivals are showing low defect counts across the region. Cooler nights through January, slightly delayed flowering in October, and a dry harvest window all combined into what beneficios are quietly calling a once-in-five-year crop.\n\nOutcome: the Antigua Coffee Producers Association's preliminary cupping shows an average 86.4 across submitted lots, with the top decile crossing 89. Buyers from Tokyo, Oslo, and Melbourne have been on the ground since late January.",
  ],
  [
    'bundle' => 'article',
    'title' => 'Carbonic maceration arrives in Antigua: a conversation with Beneficio Bella Vista',
    'region' => 'antigua',
    'body' => "Aida Batlle's El Salvador experiments with carbonic-style fermentation in coffee turned eight years old in 2026. The technique — sealed cherries under CO₂ for 72 to 120 hours before depulping — has crossed the Guatemalan border this season at Beneficio Bella Vista.\n\nThe Bella Vista team is cagey about exact parameters but open about the result: a cup that retains Antigua's structural acidity while gaining a fermented-fruit top note that recalls natural-process Ethiopia. They've committed three lots to the technique for the 2026 crop.",
  ],

  // ─── Cauca ────────────────────────────────────────────────────
  [
    'bundle' => 'article',
    'title' => 'Climate change at 1,900m: what Cauca producers are seeing this decade',
    'region' => 'cauca',
    'body' => "Cauca's smallholder belt sits between 1,700 and 2,100 meters along the eastern Andean cordillera. The decade's pattern has been compressed harvests, more intense rains during ripening, and an upward creep in the rust-pressure zone.\n\nProducers in Inzá and Páez have been moving Castillo and Cenicafé 1 plantings higher, replacing older Typica blocks that no longer set fruit reliably. The cup loses a little of its old-Colombia softness; it gains structure and a longer finish. Whether that trade was chosen or forced is the conversation at every producer meeting.",
  ],
  [
    'bundle' => 'profile',
    'title' => 'Camilo Restrepo, micro-lot specialist of Inzá',
    'region' => 'cauca',
    'body' => "Cauca micro-lot specialist. Eight hectares at 1,950 meters near Inzá — small by any measure — separated by varietal, picking date, and drying patio.\n\nLast year Camilo submitted nine distinct lots to the Cauca regional Cup of Excellence. His 2025 winning lot, an anaerobic-washed Pink Bourbon, scored 91.5 and sold at auction to a Korean roaster for an undisclosed sum widely rumored to be over \$80/lb. He used the proceeds to add solar drying beds and a small lab cupping room.\n\n\"Now,\" he says, \"I can taste before I ship.\"",
  ],
  [
    'bundle' => 'article',
    'title' => 'Inside the FNC mill: how Colombia\'s federation organizes Cauca\'s smallholders',
    'region' => 'cauca',
    'body' => "The Federación Nacional de Cafeteros operates dry mills in every coffee-producing department of Colombia. The Popayán facility serves Cauca's 90,000 producer families, most farming under three hectares.\n\nProducers deliver parchment coffee in burlap; the mill grades, samples, mills to green, and either purchases at the day's reference price or stores on the producer's behalf. The model — half cooperative, half regulator, half buyer of last resort — has held since 1927 and is one of the reasons Colombia's quality floor stays as high as it does even in adverse years.",
  ],
  [
    'bundle' => 'event',
    'title' => 'Cauca Harvest 2026: early arrivals at the dry mill',
    'region' => 'cauca',
    'body' => "Harvest window: April – June 2026.\n\nThe main crop began arriving at the Popayán dry mill in mid-April. Preliminary cuppings put the regional average at 84.2 — slightly down from last year's 84.9 but with a longer tail of high scorers. Inzá and Páez are leading the region's micro-lot submissions for the season.\n\nOutcome (in progress): the Federación expects the crop to finish receiving by late June. International buyers are expected on the ground in May for the regional Cup of Excellence pre-selection rounds.",
  ],

  // ─── Boquete ──────────────────────────────────────────────────
  [
    'bundle' => 'article',
    'title' => 'Why Boquete grows the Geisha varietal that the rest of the world can\'t quite match',
    'region' => 'boquete',
    'body' => "The Geisha varietal arrived in Panama in the early 1960s from a CATIE collection. For four decades it grew quietly in scattered Boquete blocks, valued for its disease resistance more than its cup.\n\nThe 2004 Best of Panama auction changed that overnight. Don Pachi's Geisha lot from Hacienda La Esmeralda scored above any single-origin coffee in living memory; the jasmine, bergamot, and tropical-fruit profile turned out to be specific to Boquete's combination of altitude (1,600 – 1,800m), cloud cover, and volcanic loam. Geisha is grown in Costa Rica, Colombia, and Ethiopia now. The Boquete cup is still in its own bracket.",
  ],
  [
    'bundle' => 'profile',
    'title' => 'Luis Quintero\'s natural-process Geisha — and what \'fruit-forward\' actually means',
    'region' => 'boquete',
    'body' => "Boquete naturals specialist. Three hectares of Geisha at 1,750 meters on the eastern slope of Volcán Barú; cherries dried whole on raised African beds for 22 to 28 days under controlled-humidity tents.\n\n\"Fruit-forward\" gets thrown around loosely; in Luis's cup it means concrete things. Strawberry on the front. Stone-fruit through the middle. A papaya-sweet finish that lingers without becoming syrupy.\n\nThe technique is unforgiving — a single warm afternoon during drying turns the entire patio into vinegar — but when it works, the cup reads more like a wine flight than a coffee.",
  ],
  [
    'bundle' => 'event',
    'title' => 'Boquete Geisha Cup 2026: final scoring announced',
    'region' => 'boquete',
    'body' => "Date: scoring rounds wrapped May 4, 2026; online auction May 22.\n\nThe winning lot — a 4.8-kg natural-process Geisha from Finca Sophia at 1,840 meters — scored 95.7, the highest in the competition's six-year history.\n\nOutcome: pre-auction sample requests have already exceeded 200, including buyers from Saudi Arabia, China, and a private estate in Liechtenstein. The 2025 winner sold for \$4,500 per pound green; market expectations for this lot are above that.",
  ],
  [
    'bundle' => 'article',
    'title' => 'Cloud forest microclimate and the slow-maturation argument',
    'region' => 'boquete',
    'body' => "Boquete sits in the rain shadow of Volcán Barú, but the eastern slopes catch Caribbean trade winds that condense as low cloud cover most afternoons. The result: morning sun, afternoon shade, daytime highs of 24°C, nighttime lows of 12°C, year-round.\n\nThat narrow diurnal range slows cherry maturation by three to five weeks compared to lower-elevation Central American origins. Producers argue — and a growing body of phytochemical research supports — that the additional ripening time is exactly what concentrates the sugars and aromatic precursors that show up in the cup as floral, fruit, and tea-like notes.",
  ],

  // ─── Sierra Madre ─────────────────────────────────────────────
  [
    'bundle' => 'article',
    'title' => 'Sierra Madre cooperatives and the long road to organic certification',
    'region' => 'sierra-madre',
    'body' => "Chiapas's Sierra Madre belt is the most organically certified coffee region in Latin America by hectare. Some 70% of the region's smallholders farm without synthetic inputs — not always by ideological choice, often by economic necessity, but the result is the same.\n\nGetting from \"de facto organic\" to \"certified organic\" takes three transition years, a 12-month audit cycle, and somewhere between \$4,000 and \$9,000 in fees per cooperative. Co-ops like Maya Vinic and Yachil Xojobal Chulchán have been doing this work since the early 2000s; the certified premium is real but slim, and the work behind it almost never shows up in retail-side marketing.",
  ],
  [
    'bundle' => 'profile',
    'title' => 'Marta Espinoza, cooperative lead at Café de Especialidad Chiapas',
    'region' => 'sierra-madre',
    'body' => "Export lead for 340 farms across the Sierra Madre. Marta heads the export desk at Café de Especialidad Chiapas: contract negotiation, cupping-lab management, and the co-op's representation at every major specialty event in North America.\n\nHer pitch is consistent. \"We sell at Mexican-coffee prices,\" she says, \"but our top lots cup with Antigua and Tarrazú. The differential is just market inertia.\"\n\nHer job is to break that inertia, one direct-trade relationship at a time.",
  ],
  [
    'bundle' => 'article',
    'title' => 'Honey process for high altitude: what Sierra Madre is learning from Costa Rica',
    'region' => 'sierra-madre',
    'body' => "The honey process — depulping cherries but leaving varying amounts of mucilage during drying — was perfected in Tarrazú during the micro-mill revolution of the 2000s. Sierra Madre producers have been adopting it slowly over the past five seasons.\n\nHigh-altitude honey lots (above 1,500m) ferment more slowly, which lets producers leave more mucilage in contact with the parchment without risking over-fermentation. The cups gain body and a subtle dried-fruit sweetness without losing the bright acidity that defines high-grown Mexican coffee. The technique is labor-intensive and weather-dependent. The premium, where it shows up, is justifying the investment.",
  ],
  [
    'bundle' => 'article',
    'title' => 'Mexico City roasters and the Sierra Madre buying season',
    'region' => 'sierra-madre',
    'body' => "A decade ago, almost all of Sierra Madre's certified-quality coffee left the country green. The domestic specialty market was thin. That has changed sharply since 2020.\n\nMexico City is now home to upwards of 80 specialty roasters, almost all of whom buy at least one Chiapas lot per year. The buying season runs January through April, and the better-known roasters — Café Avellaneda, Boicot Café, Cardinal — send buyers directly to producer cuppings rather than going through brokers. The domestic premium has narrowed the export differential, which producers welcome and exporters watch nervously.",
  ],

  // ─── Tarrazú ──────────────────────────────────────────────────
  [
    'bundle' => 'article',
    'title' => 'The Tarrazú micro-mill revolution, twenty years on',
    'region' => 'tarrazu',
    'body' => "Until the early 2000s, Tarrazú producers delivered all their cherry to one of three large beneficios. Quality was averaged across the region. Producers had no way to differentiate their lots — or to capture the premium their better lots deserved.\n\nThe micro-mill movement changed that. Producers built their own wet mills, hired their own pickers, and began selling lot by lot. Two decades on, Tarrazú is dotted with 200-plus micro-mills, the regional cupping average has climbed by a full point, and the producer's share of the export price has roughly doubled. It is one of the cleanest examples of structural change in a coffee economy that exists.",
  ],
  [
    'bundle' => 'profile',
    'title' => 'Diego Aguilar runs Beneficio Las Mercedes: a day in the life',
    'region' => 'tarrazu',
    'body' => "Tarrazú micro-mill operator. Beneficio Las Mercedes processes Diego's own cherry plus parchment from four neighboring farms.\n\n5 a.m.: receiving station, weighing cherries. 8 a.m.: depulping. 11 a.m.: cupping yesterday's samples while the lots dry on raised beds. Noon: a buyer from Oslo arrives. They cup four lots together. The buyer takes notes; Diego takes notes on the buyer taking notes.\n\n3 p.m.: bagging the previous day's parchment for transport to the dry mill. 7 p.m.: cleaning the depulper. 8 p.m.: dinner. Tomorrow, the same.",
  ],
  [
    'bundle' => 'article',
    'title' => 'Honey processes explained: white, yellow, red, black — what each one tastes like',
    'region' => 'tarrazu',
    'body' => "All honey processes start the same way: depulping the cherry and drying the parchment with mucilage still attached. The colors refer to how much mucilage and how long the contact time.\n\nWhite honey: most mucilage removed, fastest drying. Cup tilts clean and crisp. Yellow: about half the mucilage retained, moderate drying time. Body increases. Red: most of the mucilage retained, longer drying, frequent raking. Cup gains tropical-fruit and brown-sugar notes. Black: all the mucilage, slow careful drying with daytime shade. Cup is fullest-bodied, often with a wine-like fermented note. Each step up in mucilage is one step up in flavor complexity and one step up in risk.",
  ],
  [
    'bundle' => 'event',
    'title' => 'Tarrazú Cupping Week — March 2026',
    'region' => 'tarrazu',
    'body' => "Dates: March 17–21, 2026. Host: Coopetarrazú, San Marcos facility.\n\nForty-eight micro-mills submitted lots. Twenty-six international buyers attended in person; another eighteen called in remotely.\n\nOutcome: the top-scoring lot was a black-honey Caturra from Beneficio La Falda at 1,950 meters; it scored 91.0 and pre-sold to a Tokyo-based importer at \$14.50/lb green. The week's average lot scored 86.7. Coopetarrazú reports that 92% of submitted lots were spoken for by week's end, the highest sell-through rate in the event's history.",
  ],
];

// ─── Execution ─────────────────────────────────────────────────────────────

echo "[seed-atlas-coffee] phase 1: clean previous fixtures\n";

// Delete prior atlas_coffee fixture content — but ONLY the bundles
// this seeder owns (article, profile, event). Catalog content
// (pack, asset) is NOT world content and stays put.
//
// Scoping this matters: in v0.3.x the asset catalog seeder ships
// pack + asset nodes that live alongside the world content. An
// unscoped delete here would silently nuke them on every atlas
// re-seed, which is how we noticed this bug (the world rendered
// empty after a fresh install + both seeders + atlas re-run).
$ownedBundles = ['article', 'profile', 'event'];
$existingNids = \Drupal::entityQuery('node')
  ->accessCheck(FALSE)
  ->condition('type', $ownedBundles, 'IN')
  ->execute();
if ($existingNids) {
  $existingNodes = Node::loadMultiple($existingNids);
  foreach ($existingNodes as $n) {
    echo sprintf("  - deleting %s/%d: %s\n", $n->bundle(), $n->id(), $n->label());
    $n->delete();
  }
}

// Delete every existing term in the topics vocab. The fishing term
// goes; the region terms get added fresh below.
$topicsTerms = \Drupal::entityTypeManager()
  ->getStorage('taxonomy_term')
  ->loadByProperties(['vid' => 'topics']);
foreach ($topicsTerms as $t) {
  echo sprintf("  - deleting term %d: %s\n", $t->id(), $t->label());
  $t->delete();
}

echo "\n[seed-atlas-coffee] phase 2: rebuild taxonomy terms\n";

// The `topics` vocabulary is module-owned config (shipped by
// world_signature as config/install/taxonomy.vocabulary.topics.yml)
// — a fresh `drush en world_signature` brings it. The seeder no
// longer creates or renames the vocabulary; it only creates the
// terms (content) inside it. If the vocabulary is somehow absent,
// that's a module-install problem, not a seeder problem — fail
// loud rather than papering over it.
if (!Vocabulary::load('topics')) {
  echo "  ! FATAL: vocabulary 'topics' missing. Enable world_signature first.\n";
  return;
}

$termByRegion = [];
foreach ($regions as $slug => $name) {
  $term = Term::create([
    'vid' => 'topics',
    'name' => $name,
    'description' => '',
  ]);
  $term->save();
  $termByRegion[$slug] = (int) $term->id();
  echo sprintf("  + term tid=%d %s\n", $term->id(), $name);
}

echo "\n[seed-atlas-coffee] phase 3: create entities\n";

$counts = ['article' => 0, 'profile' => 0, 'event' => 0];
foreach ($entries as $entry) {
  $tid = $termByRegion[$entry['region']] ?? NULL;
  if (!$tid) {
    echo sprintf("  ! skip %s — unknown region %s\n", $entry['title'], $entry['region']);
    continue;
  }
  $bundle = $entry['bundle'];
  if (!isset($counts[$bundle])) {
    echo sprintf("  ! skip %s — unknown bundle %s\n", $entry['title'], $bundle);
    continue;
  }
  $node = Node::create([
    'type' => $bundle,
    'title' => $entry['title'],
    'body' => [
      'value' => $entry['body'],
      'format' => 'basic_html',
      'summary' => '',
    ],
    'field_world_sector' => [['target_id' => $tid]],
    'status' => 1,
    'uid' => 1,
  ]);
  $node->save();
  $counts[$bundle]++;
  echo sprintf("  + nid=%d [%s/%s] %s\n", $node->id(), $bundle, $entry['region'], $entry['title']);
}

echo "\n[seed-atlas-coffee] phase 4: trigger signature extraction\n";

// The world_signature module's entity hooks enqueue extraction
// jobs on save into the *advancedqueue* `world_signature_extract`
// queue (NOT core's queue API — different beast). For ALPHA we
// want signatures NOW, not at the next cron run, so we drive
// advancedqueue's Processor service inline against the queue
// entity. Same code path `drush advancedqueue:queue:process` uses.
$queueEntity = \Drupal\advancedqueue\Entity\Queue::load('world_signature_extract');
if (!$queueEntity) {
  echo "  ! FATAL: queue 'world_signature_extract' missing. Reinstall world_signature.\n";
  return;
}
$queued = (int) ($queueEntity->getBackend()->countJobs()[\Drupal\advancedqueue\Job::STATE_QUEUED] ?? 0);
echo sprintf("  queue depth before flush: %d\n", $queued);
if ($queued > 0) {
  try {
    /** @var \Drupal\advancedqueue\ProcessorInterface $processor */
    $processor = \Drupal::service('advancedqueue.processor');
    $numProcessed = (int) $processor->processQueue($queueEntity);
    // Re-query backend for the per-state breakdown — processQueue
    // itself only returns a total, so we ask the queue for the
    // post-run distribution. Distinct variable name so we don't
    // stomp $counts (the bundle tallies from phase 3).
    $queueStats = $queueEntity->getBackend()->countJobs();
    echo sprintf(
      "  processed: %d total (success=%d, failure=%d, queued=%d)\n",
      $numProcessed,
      $queueStats[\Drupal\advancedqueue\Job::STATE_SUCCESS] ?? 0,
      $queueStats[\Drupal\advancedqueue\Job::STATE_FAILURE] ?? 0,
      $queueStats[\Drupal\advancedqueue\Job::STATE_QUEUED] ?? 0,
    );
  } catch (\Throwable $e) {
    echo sprintf("  ! processor failed: %s\n", $e->getMessage());
  }
}

echo "\n[seed-atlas-coffee] phase 5: snapshot is built on-demand\n";
echo "  /world/snapshot/full computes live from RESTHeart on each\n";
echo "  GET, so the only thing left is to push descriptors via\n";
echo "  'ddev drush world:publish' once this script returns.\n";

echo "\n[seed-atlas-coffee] done\n";
echo sprintf(
  "  regions: %d, articles: %d, profiles: %d, events: %d (total %d)\n",
  count($regions),
  $counts['article'],
  $counts['profile'],
  $counts['event'],
  array_sum($counts),
);
echo "\nNext: ddev drush world:publish\n";
