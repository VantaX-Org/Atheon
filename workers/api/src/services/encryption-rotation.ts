/**
 * Encryption Key Rotation
 *
 * Supports rotating the ENCRYPTION_KEY used to protect ERP credentials stored in
 * the `erp_connections.encrypted_config` column. Used during key rollover
 * (e.g. suspected compromise, scheduled rotation per POPIA §19 / ISO 27001 A.10).
 *
 * Strategy:
 *  1. Stream every row with a non-null `encrypted_config`.
 *  2. Decrypt with `oldKey`. If decryption fails (already-rotated rows, corrupt
 *     blobs, or rows encrypted under a different key) we skip and report.
 *  3. Re-encrypt the plaintext under `newKey` and write it back in place.
 *
 * The operation is per-row idempotent at the database level: a row that fails
 * to decrypt with `oldKey` is left untouched, so running the rotation twice is
 * safe. Callers should call this with `oldKey` set to the CURRENTLY-DEPLOYED
 * key and `newKey` set to the key that will be swapped in afterwards. The
 * environment binding swap must happen in the same maintenance window.
 */
import { decrypt, encrypt, isEncrypted } from './encryption';

export interface RotationResult {
  /** Rows successfully re-encrypted under the new key. */
  rotated: number;
  /** Rows where decryption with `oldKey` failed (skipped, not overwritten). */
  failed: number;
  /** Rows that were non-encrypted (plaintext `{}` or similar) — counted here to surface data quality issues. */
  skippedPlaintext: number;
  /** Human-readable error messages (one per failed row, capped at 50). */
  errors: string[];
}

/**
 * Re-encrypt every `erp_connections.encrypted_config` row under a new key.
 *
 * @param db - The D1 database binding.
 * @param oldKey - The key the rows are currently encrypted under.
 * @param newKey - The key to re-encrypt under.
 * @returns Counts of rotated, failed, and skipped rows + a capped error list.
 */
export async function rotateErpConnectionEncryption(
  db: D1Database,
  oldKey: string,
  newKey: string,
): Promise<RotationResult> {
  if (!oldKey || oldKey.length < 16) {
    throw new Error('oldKey must be at least 16 characters');
  }
  if (!newKey || newKey.length < 16) {
    throw new Error('newKey must be at least 16 characters');
  }
  if (oldKey === newKey) {
    throw new Error('oldKey and newKey must differ');
  }

  const result: RotationResult = { rotated: 0, failed: 0, skippedPlaintext: 0, errors: [] };

  const rows = await db.prepare(
    'SELECT id, encrypted_config FROM erp_connections WHERE encrypted_config IS NOT NULL',
  ).all<{ id: string; encrypted_config: string | null }>();

  for (const row of rows.results) {
    const blob = row.encrypted_config;
    if (!blob) continue;

    if (!isEncrypted(blob)) {
      // Row never went through the encryption path (or was reset). Not a failure, but
      // we count it so operators can find unprotected rows post-rotation.
      result.skippedPlaintext++;
      continue;
    }

    try {
      const plaintext = await decrypt(blob, oldKey);
      if (plaintext === null) {
        result.failed++;
        if (result.errors.length < 50) {
          result.errors.push(`row ${row.id}: decryption with oldKey returned null`);
        }
        continue;
      }
      // Sanity check that what we decrypted looks like JSON — prevents silent data
      // corruption if a caller accidentally passed the wrong "old" key that happens
      // to produce garbage plaintext. decrypt() itself returns null on AES-GCM tag
      // failure, so this path is a defense-in-depth check only.
      try {
        JSON.parse(plaintext);
      } catch {
        result.failed++;
        if (result.errors.length < 50) {
          result.errors.push(`row ${row.id}: decrypted plaintext is not valid JSON`);
        }
        continue;
      }

      const reEncrypted = await encrypt(plaintext, newKey);
      await db.prepare('UPDATE erp_connections SET encrypted_config = ? WHERE id = ?')
        .bind(reEncrypted, row.id).run();
      result.rotated++;
    } catch (err) {
      result.failed++;
      if (result.errors.length < 50) {
        result.errors.push(`row ${row.id}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}
