# Data Dictionary

## Source Dataset

**Name:** City of Bloomington — UAV (Drone) Flight Log  
**Publisher:** City of Bloomington, Indiana  
**Portal:** [data.bloomington.in.gov](https://data.bloomington.in.gov/api/views/3a7f6kb4)  
**Formats available:** CSV, JSON, XML  
**Update cadence:** Bi-monthly  
**Last updated (snapshot):** July 24, 2024

---

## Canonical Transaction Schema

Each UAV flight record is converted to a **canonical transaction** (`tx` object) with the following fields.  
All keys are **sorted lexicographically** (deep). All values are compact UTF-8 strings or `null`.

| Field | Type | Source Column | Notes |
|---|---|---|---|
| `authorized_use` | string \| null | `authorized_use` | Trimmed; whitespace normalised |
| `department` | string \| null | `department` | Trimmed |
| `drone_make_model` | string \| null | `drone_make_model` | Trimmed |
| `faa_drone_reg` | string \| null | `faa_drone_reg` | Uppercased |
| `flight_id` | string \| null | `_id` / `id` / `row_id` | Stringified integer |
| `location_area_surveyed` | string \| null | `location_area_surveyed` | Trimmed |
| `pilot_certificate` | string \| null | `pilot_certificate` | Uppercased |
| `snapshot_hash` | string | computed | SHA-256 of the raw downloaded file |
| `source_url` | string | download URL | Full URL including `accessType=DOWNLOAD` |
| `street_address_area_surveyed` | string \| null | `street_address_area_surveyed` | Trimmed |
| `timestamp` | string \| null | `date` / `timestamp` | ISO-8601 UTC, milliseconds stripped: `YYYY-MM-DDTHH:mm:ssZ` |
| `tx_version` | integer | constant `1` | Schema version; increment on breaking changes |

---

## Canonicalization Rules

These rules guarantee that **the same snapshot always produces the same transaction hashes**.

1. **Key sorting** — all object keys at every nesting level are sorted lexicographically (`Object.keys(obj).sort()`).  
2. **Compact JSON** — `JSON.stringify(tx)` with no spacing (no `replacer`, no `space` argument).  
3. **Timestamp normalisation** — any date/datetime string is parsed and re-emitted as ISO-8601 UTC with the milliseconds component removed, e.g. `2024-03-15T00:00:00Z`. Missing time defaults to `T00:00:00Z`.  
4. **Null for missing/empty** — every field in the schema is always present; absent or empty source values become `null` (not omitted, not `""`, not `undefined`).  
5. **Uppercase identifiers** — `faa_drone_reg` and `pilot_certificate` are uppercased so `fa3091xz` and `FA3091XZ` hash identically.  
6. **String trimming** — all string values have leading/trailing whitespace stripped.  
7. **No locale-dependent operations** — no `toLocaleString()`, no locale sort.

### txHash derivation

```
txHash = SHA-256( JSON.stringify(sortedTx) )
```

Computed in `src/tx/normalize.js → buildTransaction()`.

---

## Signed Transaction Envelope

The object stored in `data/transactions.json` and embedded in each block wraps the canonical `tx` with:

| Field | Type | Notes |
|---|---|---|
| `tx` | object | Canonical transaction (sorted keys) |
| `txJson` | string | `JSON.stringify(tx)` — canonical source used for hash derivation |
| `txHash` | string | SHA-256 hex of `txJson` |
| `signature` | string | ECDSA/P-256 DER signature (hex) of `txHash` with the CityIssuer private key |
| `issuerPublicKey` | string | DER-encoded SPKI public key (hex) of the signer |

---

## Block Header Fields

| Field | Type | Notes |
|---|---|---|
| `index` | integer | Sequential block number; genesis = 0 |
| `timestamp` | string | ISO-8601 UTC, set at mine time |
| `prevHash` | string | `blockHash` of the preceding block; genesis uses `"000...0"` (64 zeros) |
| `nonce` | integer | Incremented during PoW mining |
| `difficulty` | integer | Number of required leading hex zeros in `blockHash` |
| `merkleRoot` | string | SHA-256 Merkle root of all `txHash` values in the block |
| `txCount` | integer | Number of transactions |
| `blockHash` | string | SHA-256 of the canonical JSON-serialised header (sorted keys, compact) |
