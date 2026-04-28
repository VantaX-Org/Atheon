/**
 * Cryptographic Provenance Ledger
 * ================================
 *
 * Tamper-evident chain of every AI decision the platform makes:
 *
 *   • Catalyst execution (which sub-catalyst ran, on what data hash)
 *   • HITL approval (who approved which item, with signature)
 *   • Assessment runs (which findings were detected, value-at-risk)
 *   • Simulator predictions (predicted vs actual residuals)
 *   • License lifecycle (provisioned, suspended, renewed)
 *
 * Each entry stores:
 *   - seq           — monotonic sequence per tenant
 *   - parent_id     — id of the previous entry (chain link)
 *   - payload_type  — discriminator
 *   - payload_hash  — SHA-256 of canonical-JSON payload
 *   - signed_by     — user id (HITL approver) where applicable
 *   - signature     — HMAC over (parent.merkle_root || payload_hash)
 *   - merkle_root_after — running Merkle root after this leaf
 *
 * Tampering with any historical entry breaks merkle_root_after for every
 * subsequent entry and `verifyChain()` will catch it.
 *
 * This is the second of the three "world-first" primitives Atheon ships:
 * BI tools log decisions; Atheon's log is **cryptographically verifiable**.
 *
 * The signature uses HMAC-SHA256 with `JWT_SECRET` (already a per-deploy
 * shared secret) so the customer's instance can verify in isolation
 * without contacting the cloud. For higher-assurance customers, the
 * signature scheme can be swapped for ECDSA without changing the chain
 * structure.
 */
import type { AppBindings } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Stable enum of every payload type the platform ever appends. Adding a
 * new type is a deliberate act — we deliberately keep this small.
 */
export type ProvenanceType =
  | 'catalyst_run.completed'
  | 'catalyst_run.exception'
  | 'hitl.approval'
  | 'hitl.rejection'
  | 'assessment.completed'
  | 'simulation.created'
  | 'simulation.outcome_recorded'
  | 'license.provisioned'
  | 'license.suspended'
  | 'license.renewed'
  | 'config.pushed';

export interface ProvenanceEntry {
  id: string;
  tenant_id: string;
  seq: number;
  parent_id: string | null;
  payload_type: ProvenanceType;
  payload_hash: string;
  payload_json: string;
  signed_by_user_id: string | null;
  signature: string | null;
  merkle_root_after: string;
  created_at: string;
}

export interface AppendOptions {
  /** Set when a human approver signed off (HITL). */
  signedByUserId?: string;
}

// ── Hashing primitives ────────────────────────────────────────────────────

/** SHA-256 → lowercase hex. Used for both payload hash and merkle nodes. */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** HMAC-SHA256(key, message) → hex. */
async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Canonical JSON: sorted keys, no whitespace. Two invocations on
 * structurally-equivalent payloads MUST produce identical strings so the
 * payload_hash is deterministic across encoders / runtimes.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * Merkle root after appending `leafHash` to a chain whose previous root
 * was `parentRoot`. We use a simple binary Merkle: root = SHA-256(parent ||
 * leaf). For an empty chain (parentRoot null), root = leafHash.
 *
 * This isn't a full Merkle tree — it's a hash chain. For the use case
 * (tamper-evidence on append-only audit log), the chain is sufficient and
 * cheaper than a tree. A future variant can promote to a tree if proofs
 * of inclusion become a requirement.
 */
async function computeMerkleRoot(parentRoot: string | null, leafHash: string): Promise<string> {
  if (!parentRoot) return leafHash;
  return sha256Hex(parentRoot + leafHash);
}

// ── Append ───────────────────────────────────────────────────────────────

/**
 * Append a new entry to the tenant's provenance chain.
 *
 * Returns the persisted entry. Idempotency is the caller's responsibility —
 * if you append the same payload twice, you get two distinct entries (with
 * different timestamps and seq numbers).
 *
 * Failure modes:
 *   - payload too large (> 64KB after canonicalisation) → throws
 *   - tenant_id missing → throws
 *   - DB error → propagates
 */
export async function appendEvent(
  env: AppBindings['Bindings'],
  tenantId: string,
  payloadType: ProvenanceType,
  payload: Record<string, unknown>,
  options: AppendOptions = {},
): Promise<ProvenanceEntry> {
  if (!tenantId) throw new Error('tenant_id required');
  const payloadJson = canonicalJson(payload);
  if (payloadJson.length > 64 * 1024) {
    throw new Error('provenance payload exceeds 64 KB; consider storing the bulk elsewhere and referencing by id');
  }

  // Find the most recent entry for this tenant to chain off.
  const tip = await env.DB.prepare(
    `SELECT id, seq, merkle_root_after FROM provenance_chain
      WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1`,
  ).bind(tenantId).first<{ id: string; seq: number; merkle_root_after: string }>();
  const parentId = tip?.id ?? null;
  const parentRoot = tip?.merkle_root_after ?? null;
  const seq = (tip?.seq ?? 0) + 1;

  const payloadHash = await sha256Hex(payloadJson);
  const merkleRootAfter = await computeMerkleRoot(parentRoot, payloadHash);

  // Sign the entry — the signature binds the payload to its position in
  // the chain. Anyone with JWT_SECRET can verify it; tampering with any
  // earlier entry breaks all subsequent signatures.
  const signature = await hmacHex(env.JWT_SECRET, `${parentRoot ?? ''}|${payloadHash}|${merkleRootAfter}`);

  const id = `prov-${tenantId.slice(0, 8)}-${seq.toString(36).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(
    `INSERT INTO provenance_chain
       (id, tenant_id, seq, parent_id, payload_type, payload_hash, payload_json,
        signed_by_user_id, signature, merkle_root_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    id, tenantId, seq, parentId, payloadType, payloadHash, payloadJson,
    options.signedByUserId ?? null, signature, merkleRootAfter,
  ).run();

  return {
    id, tenant_id: tenantId, seq, parent_id: parentId, payload_type: payloadType,
    payload_hash: payloadHash, payload_json: payloadJson,
    signed_by_user_id: options.signedByUserId ?? null, signature,
    merkle_root_after: merkleRootAfter,
    created_at: new Date().toISOString(),
  };
}

// ── Verify ───────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  total_entries: number;
  /** First seq where the chain integrity check failed; null if valid. */
  first_invalid_seq: number | null;
  reason: string;
  current_root: string | null;
}

/**
 * Walk the chain in seq order and re-derive merkle_root_after for every
 * entry. Compare against the stored value. First mismatch = tampering.
 *
 * Also verifies the HMAC signature on each entry to catch the case where
 * an attacker tries to rewrite the merkle_root_after column directly
 * without holding JWT_SECRET.
 *
 * Performance: O(n) DB reads + O(n) hashes per chain. Tenants with very
 * long chains (10k+ entries) should paginate or run this on a
 * background job — not request-path.
 */
export async function verifyChain(
  env: AppBindings['Bindings'],
  tenantId: string,
): Promise<VerifyResult> {
  const rows = await env.DB.prepare(
    `SELECT seq, parent_id, payload_hash, payload_json, signature, merkle_root_after
       FROM provenance_chain WHERE tenant_id = ? ORDER BY seq ASC`,
  ).bind(tenantId).all<{
    seq: number; parent_id: string | null;
    payload_hash: string; payload_json: string;
    signature: string; merkle_root_after: string;
  }>();
  const entries = rows.results || [];

  let prevRoot: string | null = null;
  for (const e of entries) {
    // Re-derive payload hash from stored canonical JSON.
    const reHash = await sha256Hex(e.payload_json);
    if (reHash !== e.payload_hash) {
      return {
        valid: false,
        total_entries: entries.length,
        first_invalid_seq: e.seq,
        reason: `seq ${e.seq}: payload_json no longer hashes to stored payload_hash (entry tampered with)`,
        current_root: prevRoot,
      };
    }

    // Re-derive merkle_root_after.
    const reRoot = await computeMerkleRoot(prevRoot, e.payload_hash);
    if (reRoot !== e.merkle_root_after) {
      return {
        valid: false,
        total_entries: entries.length,
        first_invalid_seq: e.seq,
        reason: `seq ${e.seq}: merkle_root_after re-derives to ${reRoot.slice(0, 12)}... but stored ${e.merkle_root_after.slice(0, 12)}... (chain tampered)`,
        current_root: prevRoot,
      };
    }

    // Re-derive signature.
    const reSig = await hmacHex(env.JWT_SECRET, `${prevRoot ?? ''}|${e.payload_hash}|${e.merkle_root_after}`);
    if (reSig !== e.signature) {
      return {
        valid: false,
        total_entries: entries.length,
        first_invalid_seq: e.seq,
        reason: `seq ${e.seq}: signature does not validate (signed with a different JWT_SECRET, or row was forged)`,
        current_root: prevRoot,
      };
    }

    prevRoot = e.merkle_root_after;
  }

  return {
    valid: true,
    total_entries: entries.length,
    first_invalid_seq: null,
    reason: entries.length === 0 ? 'chain is empty (no events appended yet)' : 'all entries verify against stored hashes + signatures',
    current_root: prevRoot,
  };
}

// ── Read helpers ─────────────────────────────────────────────────────────

/**
 * Paginated chain view for the audit UI. Returns most-recent first by
 * default (the audit dashboard reads top-down) — pass `order: 'asc'` for
 * a chronological export.
 */
export async function listChain(
  env: AppBindings['Bindings'],
  tenantId: string,
  options: { limit?: number; offset?: number; order?: 'asc' | 'desc'; payloadType?: ProvenanceType } = {},
): Promise<{ entries: ProvenanceEntry[]; total: number }> {
  const limit = Math.min(options.limit ?? 100, 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const order = options.order === 'asc' ? 'ASC' : 'DESC';

  const conditions = ['tenant_id = ?'];
  const binds: unknown[] = [tenantId];
  if (options.payloadType) {
    conditions.push('payload_type = ?');
    binds.push(options.payloadType);
  }

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM provenance_chain WHERE ${conditions.join(' AND ')}`,
  ).bind(...binds).first<{ cnt: number }>();
  const rows = await env.DB.prepare(
    `SELECT id, tenant_id, seq, parent_id, payload_type, payload_hash, payload_json,
            signed_by_user_id, signature, merkle_root_after, created_at
       FROM provenance_chain
      WHERE ${conditions.join(' AND ')}
      ORDER BY seq ${order}
      LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all<ProvenanceEntry>();

  return {
    entries: rows.results || [],
    total: totalRow?.cnt ?? 0,
  };
}

/** Read the current Merkle tip — useful for "we last updated to root X" attestations. */
export async function getCurrentRoot(
  env: AppBindings['Bindings'],
  tenantId: string,
): Promise<{ root: string | null; seq: number; created_at: string | null }> {
  const tip = await env.DB.prepare(
    `SELECT seq, merkle_root_after, created_at FROM provenance_chain
      WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1`,
  ).bind(tenantId).first<{ seq: number; merkle_root_after: string; created_at: string }>();
  if (!tip) return { root: null, seq: 0, created_at: null };
  return { root: tip.merkle_root_after, seq: tip.seq, created_at: tip.created_at };
}

// ── Test-only export ─────────────────────────────────────────────────────
export const _testExports = { sha256Hex, canonicalJson, computeMerkleRoot, hmacHex };
