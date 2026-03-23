'use strict';
/**
 * src/tx/normalize.js
 * Converts raw UAV flight records into canonical JSON transactions.
 *
 * Canonicalization rules (must be stable across runs):
 *  1. All keys are sorted lexicographically (deep).
 *  2. All string values are trimmed and lowercased where specified.
 *  3. Timestamps are normalised to ISO-8601 UTC (YYYY-MM-DDTHH:mm:ssZ).
 *     Missing time → "T00:00:00Z".
 *  4. Numeric strings that represent integers are kept as integers.
 *  5. Empty / null values are stored as null (not omitted) so the key set
 *     is always the same → same byte count → same hash.
 *  6. JSON.stringify uses no spacing (compact).
 */

const crypto = require('crypto');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise an arbitrary date string to ISO-8601 UTC.
 * Returns null if the value is falsy or unparseable.
 */
function normaliseDate(raw) {
  if (!raw || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  // Try direct parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); // drop milliseconds
  }
  // Try MM/DD/YYYY or MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    const [, m, day, yr] = mdy;
    const d2 = new Date(Date.UTC(+yr, +m - 1, +day));
    return d2.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return null;
}

function clean(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

function cleanUpper(val) {
  const s = clean(val);
  return s ? s.toUpperCase() : null;
}

// ── canonical transaction builder ─────────────────────────────────────────────

/**
 * Build a canonical transaction object from a raw record.
 * The record may come from CSV (plain object) or XML (xml2js parsed).
 *
 * @param {object} raw  - one row from the dataset
 * @param {string} sourceUrl - download URL used
 * @param {string} snapshotHash - SHA-256 hex of the raw snapshot file
 * @returns {{ tx: object, txJson: string, txHash: string }}
 */
function buildTransaction(raw, sourceUrl, snapshotHash) {
  // Field mappings handle both CSV headers and XML tag names
  const get = (...keys) => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
      if (v !== undefined && v !== null) {
        // xml2js wraps single values in arrays
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return null;
  };

  // Derive flight_id: prefer _id, then id, then row_id
  const rawId = get('_id', 'id', 'row_id', 'ID', 'flight_id');
  const flightId = rawId ? String(rawId).trim() : null;

  const tx = {
    authorized_use:                clean(get('Authorized Use: Select All that Apply','authorized_use','Authorized_Use')),
    department:                    clean(get('Department:','department','Department')),
    drone_make_model:              clean(get('Drone Make \u0026 Model:','drone_make_model','Drone_Make_Model')),
    faa_drone_reg:                 cleanUpper(get('FAA Provided Drone Registration Number:','faa_drone_reg','Faa_Drone_Reg')),
    flight_id:                     flightId,
    location_area_surveyed:        clean(get('Location (Area Surveyed):','location_area_surveyed','Location_Area_Surveyed')),
    pilot_certificate:             cleanUpper(get('FAA provided commercial pilot certificate number:','pilot_certificate','Pilot_Certificate')),
    snapshot_hash:                 snapshotHash,
    source_url:                    sourceUrl,
    street_address_area_surveyed:  clean(get('Street Address (Area Surveyed):','street_address_area_surveyed','Street_Address_Area_Surveyed')),
    timestamp:                     normaliseDate(get('Start Date:','Timestamp','date','Date','timestamp')),
    tx_version:                    1,
  };

  // Sort keys deterministically
  const txSorted = sortKeysDeep(tx);
  const txJson = JSON.stringify(txSorted); // compact, no spaces
  const txHash = sha256(txJson);

  return { tx: txSorted, txJson, txHash };
}

/** Deep sort all object keys lexicographically */
function sortKeysDeep(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, k) => { acc[k] = sortKeysDeep(obj[k]); return acc; }, {});
  }
  return obj;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

module.exports = { buildTransaction, sortKeysDeep, sha256, normaliseDate };
