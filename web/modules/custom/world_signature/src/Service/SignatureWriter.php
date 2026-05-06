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

    $json = json_encode(
      $signature->toArray(),
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
