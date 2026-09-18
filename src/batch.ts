// Fan-out width for the per-URL stages, and the helper that enforces it.
// Shared so the workflow and the preview script hit linked sites at the same rate.

/**
 * Without a cap, a 100-row database opens 100 concurrent runs per stage and hits
 * every linked site at once.
 */
export const BATCH_SIZE = 10;

/** Promise.all in fixed-size batches, in input order. */
export async function mapInBatches<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    results.push(...(await Promise.all(batch.map((item, i) => fn(item, start + i)))));
  }
  return results;
}
