<?php

declare(strict_types=1);

namespace Drupal\world_signature\Embedding;

/**
 * Produces semantic embedding vectors for a corpus of documents.
 *
 * Corpus-level (not per-document) on purpose: the local TF-IDF
 * provider needs the whole corpus to compute inverse-document
 * frequency, and neural providers can trivially loop internally.
 * Embeddings are a corpus concern recomputed in batches (drush
 * world:embed), not part of the per-node ExtractSignature job.
 *
 * See docs/MILESTONES.md BETA 2.
 */
interface EmbeddingProviderInterface {

  /**
   * A stable identifier for the model + version. Stored alongside
   * each vector (SignatureSemantic::modelVersion) so the staleness
   * check can flag vectors for re-embed when the model changes.
   */
  public function modelVersion(): string;

  /**
   * The fixed dimensionality of vectors this provider emits. Lets
   * the projector + storage reason about shape without inspecting
   * a sample. Local TF-IDF uses feature hashing to a fixed width
   * so this is constant regardless of corpus vocabulary size.
   */
  public function dimensions(): int;

  /**
   * Embed a corpus. Input is keyed by descriptor id; output is the
   * same keys mapped to L2-normalized float vectors of length
   * dimensions(). Documents that produce no signal (empty text)
   * map to a zero vector — the projector handles those gracefully.
   *
   * @param array<string, string> $documents
   *   descriptorId => raw text to embed.
   *
   * @return array<string, float[]>
   *   descriptorId => embedding vector.
   */
  public function embedCorpus(array $documents): array;

}
