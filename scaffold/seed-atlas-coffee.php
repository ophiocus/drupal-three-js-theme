<?php

/**
 * Sprint 6a: seed the world with atlas_coffee fixtures.
 *
 * Idempotent: re-running cleans the previous fixture set first.
 * Lean shape: 20 articles across 5 region terms in the existing
 * `topics` vocabulary. Each region becomes a sector. Methods,
 * profiles-as-content-type, events-as-content-type, and image
 * fields are deferred — body text carries that information for
 * ALPHA.
 *
 * Run via:
 *   ddev drush scr scaffold/seed-atlas-coffee.php
 *
 * The script terminates with a summary and triggers a snapshot
 * republish; the world boots into a populated state on next load.
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

// ─── Articles ──────────────────────────────────────────────────────────────
//
// 20 entries. Four per region by design — gives biomes something
// to demonstrate against and gives every sector enough density to
// look populated at overview height.

$articles = [
  // — Antigua —
  [
    'title' => 'Why Antigua\'s volcanic soil shows up in the cup',
    'region' => 'antigua',
    'body' => "Acatenango and Fuego dust their slopes with mineral-rich ash every few years. The soils that result drain fast, hold cation exchange capacity well above lowland averages, and keep coffee trees stressed enough to produce dense, complex seeds.\n\nAntigua's cups land medium-bodied with chocolate, hazelnut, and a bright but never sharp acidity. The classic profile isn't an accident — it's volcanism plus elevation plus a producer culture that has, over four generations, refined washed processing to the point where the terroir comes through unobscured.",
  ],
  [
    'title' => 'Doña Rosa Méndez — three generations on the slopes of Acatenango',
    'region' => 'antigua',
    'body' => "Doña Rosa runs forty-eight hectares between 1,500 and 1,700 meters, planted in Bourbon, Caturra, and a small experimental block of Pacamara. Her grandfather cleared the upper terrace in 1948; her father added the wet mill in 1976; she added shade restoration and the second drying patio in the early 2010s.\n\nShe still cups every lot herself before it leaves the beneficio. \"You taste the year in the cup,\" she says. \"You cannot hide the year.\"",
  ],
  [
    'title' => 'The 2026 Antigua harvest: La Niña and what producers are calling \'unusually clean\'',
    'region' => 'antigua',
    'body' => "Early arrivals from the December 2025 – March 2026 picking window are showing low defect counts across the region. Cooler nights through January, slightly delayed flowering in October, and a dry harvest window all combined into what beneficios are quietly calling a once-in-five-year crop.\n\nThe Antigua Coffee Producers Association's preliminary cupping shows an average 86.4 across submitted lots, with the top decile crossing 89. Buyers from Tokyo, Oslo, and Melbourne have been on the ground since late January.",
  ],
  [
    'title' => 'Carbonic maceration arrives in Antigua: a conversation with Beneficio Bella Vista',
    'region' => 'antigua',
    'body' => "Aida Batlle's El Salvador experiments with carbonic-style fermentation in coffee turned eight years old in 2026. The technique — sealed cherries under CO₂ for 72 to 120 hours before depulping — has crossed the Guatemalan border this season at Beneficio Bella Vista.\n\nThe Bella Vista team is cagey about exact parameters but open about the result: a cup that retains Antigua's structural acidity while gaining a fermented-fruit top note that recalls natural-process Ethiopia. They've committed three lots to the technique for the 2026 crop.",
  ],

  // — Cauca —
  [
    'title' => 'Climate change at 1,900m: what Cauca producers are seeing this decade',
    'region' => 'cauca',
    'body' => "Cauca's smallholder belt sits between 1,700 and 2,100 meters along the eastern Andean cordillera. The decade's pattern has been compressed harvests, more intense rains during ripening, and an upward creep in the rust-pressure zone.\n\nProducers in Inzá and Páez have been moving Castillo and Cenicafé 1 plantings higher, replacing older Typica blocks that no longer set fruit reliably. The cup loses a little of its old-Colombia softness; it gains structure and a longer finish. Whether that trade was chosen or forced is the conversation at every producer meeting.",
  ],
  [
    'title' => 'Camilo Restrepo, micro-lot specialist of Inzá',
    'region' => 'cauca',
    'body' => "Camilo's farm is eight hectares — small by any measure — at 1,950 meters, near Inzá. He separates lots by varietal, by picking date, and by drying patio. Last year he submitted nine distinct lots to the Cauca regional Cup of Excellence.\n\nHis 2025 winning lot, an anaerobic-washed Pink Bourbon, scored 91.5. It sold at auction to a Korean roaster for an undisclosed sum widely rumored to be over $80/lb. Camilo used the proceeds to add solar drying beds and a small lab cupping room. \"Now,\" he says, \"I can taste before I ship.\"",
  ],
  [
    'title' => 'Inside the FNC mill: how Colombia\'s federation organizes Cauca\'s smallholders',
    'region' => 'cauca',
    'body' => "The Federación Nacional de Cafeteros operates dry mills in every coffee-producing department of Colombia. The Popayán facility serves Cauca's 90,000 producer families, most farming under three hectares.\n\nProducers deliver parchment coffee in burlap; the mill grades, samples, mills to green, and either purchases at the day's reference price or stores on the producer's behalf. The model — half cooperative, half regulator, half buyer of last resort — has held since 1927 and is one of the reasons Colombia's quality floor stays as high as it does even in adverse years.",
  ],
  [
    'title' => 'Cauca Harvest 2026: early arrivals at the dry mill',
    'region' => 'cauca',
    'body' => "The 2026 main crop began arriving at the Popayán dry mill in mid-April. Preliminary cuppings put the regional average at 84.2 — slightly down from last year's 84.9 but with a longer tail of high scorers. Inzá and Páez are leading the region's micro-lot submissions for the season.\n\nThe Federación expects the crop to finish receiving by late June. International buyers are expected on the ground in May for the regional Cup of Excellence pre-selection rounds.",
  ],

  // — Boquete —
  [
    'title' => 'Why Boquete grows the Geisha varietal that the rest of the world can\'t quite match',
    'region' => 'boquete',
    'body' => "The Geisha varietal arrived in Panama in the early 1960s from a CATIE collection. For four decades it grew quietly in scattered Boquete blocks, valued for its disease resistance more than its cup.\n\nThe 2004 Best of Panama auction changed that overnight. Don Pachi's Geisha lot from Hacienda La Esmeralda scored above any single-origin coffee in living memory; the jasmine, bergamot, and tropical-fruit profile turned out to be specific to Boquete's combination of altitude (1,600 – 1,800m), cloud cover, and volcanic loam. Geisha is grown in Costa Rica, Colombia, and Ethiopia now. The Boquete cup is still in its own bracket.",
  ],
  [
    'title' => 'Luis Quintero\'s natural-process Geisha — and what \'fruit-forward\' actually means',
    'region' => 'boquete',
    'body' => "Luis Quintero runs three hectares of Geisha at 1,750 meters on the eastern slope of Volcán Barú. His specialty is the natural process — cherries dried whole, on raised African beds, for 22 to 28 days under controlled-humidity tents.\n\n\"Fruit-forward\" gets thrown around loosely; in Luis's cup it means concrete things. Strawberry on the front. Stone-fruit through the middle. A papaya-sweet finish that lingers without becoming syrupy. The technique is unforgiving — a single warm afternoon during drying turns the entire patio into vinegar — but when it works, the cup reads more like a wine flight than a coffee.",
  ],
  [
    'title' => 'Boquete Geisha Cup 2026: final scoring announced',
    'region' => 'boquete',
    'body' => "The 2026 Boquete Geisha Cup wrapped its scoring rounds on May 4th. The winning lot — a 4.8-kg natural-process Geisha from Finca Sophia at 1,840 meters — scored 95.7, the highest in the competition's six-year history.\n\nThe lot will be auctioned online on May 22nd. Pre-auction sample requests have already exceeded 200, including buyers from Saudi Arabia, China, and a private estate in Liechtenstein. The 2025 winner sold for $4,500 per pound green.",
  ],
  [
    'title' => 'Cloud forest microclimate and the slow-maturation argument',
    'region' => 'boquete',
    'body' => "Boquete sits in the rain shadow of Volcán Barú, but the eastern slopes catch Caribbean trade winds that condense as low cloud cover most afternoons. The result: morning sun, afternoon shade, daytime highs of 24°C, nighttime lows of 12°C, year-round.\n\nThat narrow diurnal range slows cherry maturation by three to five weeks compared to lower-elevation Central American origins. Producers argue — and a growing body of phytochemical research supports — that the additional ripening time is exactly what concentrates the sugars and aromatic precursors that show up in the cup as floral, fruit, and tea-like notes.",
  ],

  // — Sierra Madre —
  [
    'title' => 'Sierra Madre cooperatives and the long road to organic certification',
    'region' => 'sierra-madre',
    'body' => "Chiapas's Sierra Madre belt is the most organically certified coffee region in Latin America by hectare. Some 70% of the region's smallholders farm without synthetic inputs — not always by ideological choice, often by economic necessity, but the result is the same.\n\nGetting from \"de facto organic\" to \"certified organic\" takes three transition years, a 12-month audit cycle, and somewhere between $4,000 and $9,000 in fees per cooperative. Co-ops like Maya Vinic and Yachil Xojobal Chulchán have been doing this work since the early 2000s; the certified premium is real but slim, and the work behind it almost never shows up in retail-side marketing.",
  ],
  [
    'title' => 'Marta Espinoza, cooperative lead at Café de Especialidad Chiapas',
    'region' => 'sierra-madre',
    'body' => "Marta heads the export desk at Café de Especialidad Chiapas, a producer-owned cooperative serving 340 farms across the Sierra Madre. She negotiates contracts, manages the cupping lab, and represents the co-op at every major specialty event in North America.\n\nHer pitch is consistent: Chiapas coffee is undervalued relative to its quality. \"We sell at Mexican-coffee prices,\" she says, \"but our top lots cup with Antigua and Tarrazú. The differential is just market inertia.\" Her job is to break that inertia, one direct-trade relationship at a time.",
  ],
  [
    'title' => 'Honey process for high altitude: what Sierra Madre is learning from Costa Rica',
    'region' => 'sierra-madre',
    'body' => "The honey process — depulping cherries but leaving varying amounts of mucilage during drying — was perfected in Tarrazú during the micro-mill revolution of the 2000s. Sierra Madre producers have been adopting it slowly over the past five seasons.\n\nHigh-altitude honey lots (above 1,500m) ferment more slowly, which lets producers leave more mucilage in contact with the parchment without risking over-fermentation. The cups gain body and a subtle dried-fruit sweetness without losing the bright acidity that defines high-grown Mexican coffee. The technique is labor-intensive and weather-dependent. The premium, where it shows up, is justifying the investment.",
  ],
  [
    'title' => 'Mexico City roasters and the Sierra Madre buying season',
    'region' => 'sierra-madre',
    'body' => "A decade ago, almost all of Sierra Madre's certified-quality coffee left the country green. The domestic specialty market was thin. That has changed sharply since 2020.\n\nMexico City is now home to upwards of 80 specialty roasters, almost all of whom buy at least one Chiapas lot per year. The buying season runs January through April, and the better-known roasters — Café Avellaneda, Boicot Café, Cardinal — send buyers directly to producer cuppings rather than going through brokers. The domestic premium has narrowed the export differential, which producers welcome and exporters watch nervously.",
  ],

  // — Tarrazú —
  [
    'title' => 'The Tarrazú micro-mill revolution, twenty years on',
    'region' => 'tarrazu',
    'body' => "Until the early 2000s, Tarrazú producers delivered all their cherry to one of three large beneficios. Quality was averaged across the region. Producers had no way to differentiate their lots — or to capture the premium their better lots deserved.\n\nThe micro-mill movement changed that. Producers built their own wet mills, hired their own pickers, and began selling lot by lot. Two decades on, Tarrazú is dotted with 200-plus micro-mills, the regional cupping average has climbed by a full point, and the producer's share of the export price has roughly doubled. It is one of the cleanest examples of structural change in a coffee economy that exists.",
  ],
  [
    'title' => 'Diego Aguilar runs Beneficio Las Mercedes: a day in the life',
    'region' => 'tarrazu',
    'body' => "5 a.m.: Diego is at the receiving station, weighing cherries from his own three pickers and from four neighboring farms that sell parchment through his mill. 8 a.m.: depulping. 11 a.m.: cupping yesterday's samples while the lots dry on raised beds.\n\nNoon: a buyer from Oslo arrives. They cup four lots together. The buyer takes notes; Diego takes notes on the buyer taking notes. 3 p.m.: bagging the previous day's parchment for transport to the dry mill. 7 p.m.: cleaning the depulper. 8 p.m.: dinner. Tomorrow, the same.",
  ],
  [
    'title' => 'Honey processes explained: white, yellow, red, black — what each one tastes like',
    'region' => 'tarrazu',
    'body' => "All honey processes start the same way: depulping the cherry and drying the parchment with mucilage still attached. The colors refer to how much mucilage and how long the contact time.\n\nWhite honey: most mucilage removed, fastest drying. Cup tilts clean and crisp. Yellow: about half the mucilage retained, moderate drying time. Body increases. Red: most of the mucilage retained, longer drying, frequent raking. Cup gains tropical-fruit and brown-sugar notes. Black: all the mucilage, slow careful drying with daytime shade. Cup is fullest-bodied, often with a wine-like fermented note. Each step up in mucilage is one step up in flavor complexity and one step up in risk.",
  ],
  [
    'title' => 'Tarrazú Cupping Week — March 2026',
    'region' => 'tarrazu',
    'body' => "The 2026 Tarrazú Cupping Week ran March 17–21, hosted by Coopetarrazú at their San Marcos facility. Forty-eight micro-mills submitted lots. Twenty-six international buyers attended in person; another eighteen called in remotely.\n\nThe top-scoring lot was a black-honey Caturra from Beneficio La Falda at 1,950 meters; it scored 91.0 and pre-sold to a Tokyo-based importer at $14.50/lb green. The week's average lot scored 86.7. Coopetarrazú reports that 92% of submitted lots were spoken for by week's end, the highest sell-through rate in the event's history.",
  ],
];

// ─── Execution ─────────────────────────────────────────────────────────────

echo "[seed-atlas-coffee] phase 1: clean previous fixtures\n";

// Delete every existing node (the trout, plus any prior atlas_coffee
// runs). The fixture is meant to be the only content in the world.
$existingNids = \Drupal::entityQuery('node')->accessCheck(FALSE)->execute();
if ($existingNids) {
  $existingNodes = Node::loadMultiple($existingNids);
  foreach ($existingNodes as $n) {
    echo sprintf("  - deleting node %d: %s\n", $n->id(), $n->label());
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

echo "\n[seed-atlas-coffee] phase 2: rebuild taxonomy\n";

// Ensure the topics vocabulary exists with the friendlier label
// "Regions." Machine name stays as topics so field_tags continues
// to work without field-config changes.
$vocab = Vocabulary::load('topics');
if (!$vocab) {
  $vocab = Vocabulary::create([
    'vid' => 'topics',
    'name' => 'Regions',
    'description' => 'Atlas_coffee origin regions. Each term becomes a sector.',
  ]);
  $vocab->save();
} else {
  $vocab->set('name', 'Regions')
    ->set('description', 'Atlas_coffee origin regions. Each term becomes a sector.')
    ->save();
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

echo "\n[seed-atlas-coffee] phase 3: create articles\n";

$count = 0;
foreach ($articles as $article) {
  $tid = $termByRegion[$article['region']] ?? NULL;
  if (!$tid) {
    echo sprintf("  ! skip %s — unknown region %s\n", $article['title'], $article['region']);
    continue;
  }
  $node = Node::create([
    'type' => 'article',
    'title' => $article['title'],
    'body' => [
      'value' => $article['body'],
      'format' => 'basic_html',
      'summary' => '',
    ],
    'field_tags' => [['target_id' => $tid]],
    'status' => 1,
    'uid' => 1,
  ]);
  $node->save();
  $count++;
  echo sprintf("  + nid=%d [%s] %s\n", $node->id(), $article['region'], $article['title']);
}

echo "\n[seed-atlas-coffee] phase 4: trigger signature extraction\n";

// The world_signature module's entity hooks enqueue extraction jobs
// on save, but for ALPHA we want signatures NOW, not async. Run the
// queue inline.
$queueFactory = \Drupal::service('queue');
$queueManager = \Drupal::service('plugin.manager.queue_worker');
$queueName = 'world_signature_extract';
$queue = $queueFactory->get($queueName);
$queueSize = $queue->numberOfItems();
echo sprintf("  queue depth before flush: %d\n", $queueSize);
if ($queueSize > 0) {
  try {
    $worker = $queueManager->createInstance($queueName);
    $processed = 0;
    while (($item = $queue->claimItem()) !== FALSE) {
      try {
        $worker->processItem($item->data);
        $queue->deleteItem($item);
        $processed++;
      } catch (\Throwable $e) {
        echo sprintf("  ! queue item failed: %s\n", $e->getMessage());
        $queue->releaseItem($item);
        break;
      }
    }
    echo sprintf("  processed %d queue items\n", $processed);
  } catch (\Throwable $e) {
    echo sprintf("  ! queue worker init failed: %s\n", $e->getMessage());
  }
}

echo "\n[seed-atlas-coffee] phase 5: snapshot is built on-demand\n";
echo "  /world/snapshot/full computes live from RESTHeart on each\n";
echo "  GET, so the only thing left is to push descriptors via\n";
echo "  'ddev drush world:publish' once this script returns.\n";

echo "\n[seed-atlas-coffee] done\n";
echo sprintf("  regions: %d, articles: %d\n", count($regions), $count);
echo "\nNext: ddev drush world:publish\n";
