# Key Management

## Overview

This system uses **ECDSA over P-256 (prime256v1)** for transaction signing and verification.  
Node.js's built-in `crypto` module is used exclusively — no third-party crypto libraries.

---

## Roles

| Role | Purpose |
|---|---|
| **CityIssuer** | Signs all official UAV flight transactions ingested from the dataset |
| **Auditor** | Can verify transactions and countersign audit events (e.g. dispute flags) |

Each role has an independent key pair. A transaction is only considered valid if it carries a signature from a **known issuer public key**.

---

## Key Generation

```bash
node scripts/keygen.js
```

This generates both `CityIssuer` and `Auditor` key pairs and saves them under `keys/`:

```
keys/
  CityIssuer.private.pem   ← PKCS#8, keep SECRET
  CityIssuer.public.pem    ← SPKI PEM
  CityIssuer.public.hex    ← DER hex (embedded in transactions)
  Auditor.private.pem
  Auditor.public.pem
  Auditor.public.hex
```

Keys are generated idempotently by `getOrCreateKeyPair(role)` — if a keypair already exists on disk it is loaded rather than regenerated. To rotate keys, delete the relevant `keys/<role>.*` files and re-run.

---

## Signing

```
signature = ECDSA-P256-SHA256-Sign(privateKey, txHash)
```

- Input: `txHash` (64-char hex SHA-256 of canonical tx JSON) as UTF-8 bytes  
- Output: DER-encoded signature, hex-encoded  
- Algorithm: `SHA256withECDSA`, DER encoding (`dsaEncoding: 'der'`)

Code: `src/crypto/sign.js → signTransaction(txHash, privateKeyPem)`

---

## Verification

```
valid = ECDSA-P256-SHA256-Verify(publicKey, txHash, signature)
```

The verifier accepts both:
- PEM string (for human-readable key files)
- DER hex string (embedded in transactions — compact, no PEM headers)

Code: `src/crypto/sign.js → verifySignature(txHash, signatureHex, publicKey)`

Verification runs during:
1. `Blockchain.validateChain()` — full chain sweep
2. `POST /api/validate` — on-demand API call

---

## Threat Model Notes

| Threat | Mitigation |
|---|---|
| **Key compromise (CityIssuer)** | Rotate key, re-ingest and re-sign dataset, rebuild chain. Old signatures on old blocks become invalid — treat as a chain fork. |
| **Replay attack** | Each `txHash` includes `snapshot_hash` and `source_url`, binding it to a specific dataset snapshot. Replaying an old signed tx to a new chain is detectable because the `snapshot_hash` will not match the current snapshot. |
| **Unsigned transactions** | `validateChain()` rejects any transaction missing `signature` or `issuerPublicKey`. |
| **Forged signatures** | ECDSA with P-256 provides ~128-bit security. Forgery is computationally infeasible without the private key. |
| **Private key in repo** | `keys/*.private.pem` is listed in `.gitignore`. Never commit private keys. |

---

## Key Storage Security

- Private key files are created with mode `0o600` (owner read/write only on Unix).  
- In production, keys should be stored in a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault) and injected via environment variables, not flat files.  
- The `keys/` directory is listed in `.gitignore`.
