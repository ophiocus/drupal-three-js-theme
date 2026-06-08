<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Signature\Signature;

/**
 * Writes a Signature to an entity's `field_world_signature` field
 * as JSON, in a save that bypasses re-entering the queue.
 *
 * The cypher's queue worker reads the entity, computes the
 * Signature, and hands it here. This service is the only place
 * that writes the field, so we can statically guard against the
 * write triggering its own entity_update hook → infinite loop.
 */
final class SignatureWriter {

  /**
   * Static flag set during a write so hook_entity_update can skip
   * re-enqueueing. See world_signature_entity_update().
   */
  public static bool $writing = FALSE;

  public function __construct(
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Encode the signature as JSON and write to the entity's
   * `field_world_signature` field, then save.
   *
   * Returns TRUE on success, FALSE if the entity has no
   * `field_world_signature` field (not a participating bundle).
   */
  public function write(FieldableEntityInterface $entity, Signature $signature): bool {
    if (!$entity->hasField('field_world_signature')) {
      $this->logger->debug(
        'Entity @type/@id has no field_world_signature; skipping write.',
        ['@type' => $entity->getEntityTypeId(), '@id' => $entity->id()],
      );
      return FALSE;
    }

    // Embedding preservation. The SignatureExtractor never produces a
    // semantic.embedding — it's the corpus-wide world:embed pass that
    // mints those vectors. A plain re-extraction (entity_update, seed
    // re-run, content edit) would therefore wipe the existing
    // embedding even when the source text is unchanged. Guard against
    // that: when the entity already carries an embedding AND the new
    // signature's semanticHash matches the existing one (same source
    // text → same embedding still valid), carry the existing
    // embedding + modelVersion + embeddedAt across.
    //
    // When the hash DIFFERS, the embedding genuinely becomes stale
    // and we let the null overwrite stand — the next world:embed
    // catches up.
    $payload = $signature->toArray();
    $existingRaw = $entity->get('field_world_signature')->isEmpty()
      ? NULL
      : $entity->get('field_world_signature')->value;
    if (is_string($existingRaw) && $existingRaw !== '') {
      $existing = json_decode($existingRaw, TRUE);
      $existingEmb = $existing['semantic']['embedding'] ?? NULL;
      $existingHash = $existing['semantic']['semanticHash'] ?? NULL;
      $incomingHash = $payload['semantic']['semanticHash'] ?? NULL;
      $hasIncomingEmb = isset($payload['semantic']['embedding'])
        && is_array($payload['semantic']['embedding'])
        && count($payload['semantic']['embedding']) > 0;
      if (
        !$hasIncomingEmb
        && is_array($existingEmb)
        && count($existingEmb) > 0
        && is_string($existingHash)
        && $existingHash !== ''
        && $existingHash === $incomingHash
      ) {
        $payload['semantic']['embedding'] = $existingEmb;
        $payload['semantic']['modelVersion'] = $existing['semantic']['modelVersion'] ?? NULL;
        $payload['semantic']['embeddedAt'] = $existing['semantic']['embeddedAt'] ?? NULL;
        $this->logger->debug(
          'Preserved existing embedding for @type/@id (hash match).',
          ['@type' => $entity->getEntityTypeId(), '@id' => $entity->id()],
        );
      }
    }

    $json = json_encode(
      $payload,
      JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
    );

    if ($json === FALSE) {
      $this->logger->error(
        'Signature JSON encode failed for @type/@id: @err',
        [
          '@type' => $entity->getEntityTypeId(),
          '@id' => $entity->id(),
          '@err' => json_last_error_msg(),
        ],
      );
      return FALSE;
    }

    $entity->set('field_world_signature', $json);

    self::$writing = TRUE;
    try {
      $entity->save();
    }
    finally {
      self::$writing = FALSE;
    }

    $this->logger->debug(
      'Wrote signature for @type/@id (@bytes bytes).',
      [
        '@type' => $entity->getEntityTypeId(),
        '@id' => $entity->id(),
        '@bytes' => strlen($json),
      ],
    );

    return TRUE;
  }

}
