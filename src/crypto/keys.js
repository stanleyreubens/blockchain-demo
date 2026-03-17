'use strict';
/**
 * src/crypto/keys.js
 * ECDSA key generation using Node.js built-in crypto (P-256 / prime256v1).
 *
 * Roles:
 *   CityIssuer  - signs official UAV flight transactions
 *   Auditor     - countersigns audit events
 *
 * Key storage format: PEM (text files under keys/)
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const KEY_DIR = path.join(__dirname, '../../keys');

/**
 * Generate a new ECDSA key pair (P-256).
 * @param {string} role - 'CityIssuer' | 'Auditor' | any label
 * @returns {{ privateKeyPem, publicKeyPem, publicKeyHex }}
 */
function generateKeyPair(role) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Compact hex public key for embedding in transactions (DER → hex)
  const pubKeyObj  = crypto.createPublicKey(publicKey);
  const publicKeyHex = pubKeyObj.export({ type: 'spki', format: 'der' }).toString('hex');

  return { role, privateKeyPem: privateKey, publicKeyPem: publicKey, publicKeyHex };
}

/** Persist a key pair to disk under keys/<role>.{private,public}.pem */
function saveKeyPair({ role, privateKeyPem, publicKeyPem, publicKeyHex }) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(path.join(KEY_DIR, `${role}.private.pem`), privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(KEY_DIR, `${role}.public.pem`),  publicKeyPem);
  fs.writeFileSync(path.join(KEY_DIR, `${role}.public.hex`),  publicKeyHex);
  console.log(`[keys] Saved keypair for ${role} → keys/${role}.*`);
}

/** Load a keypair from disk. Returns null if not found. */
function loadKeyPair(role) {
  try {
    const privateKeyPem = fs.readFileSync(path.join(KEY_DIR, `${role}.private.pem`), 'utf8');
    const publicKeyPem  = fs.readFileSync(path.join(KEY_DIR, `${role}.public.pem`),  'utf8');
    const publicKeyHex  = fs.readFileSync(path.join(KEY_DIR, `${role}.public.hex`),  'utf8').trim();
    return { role, privateKeyPem, publicKeyPem, publicKeyHex };
  } catch {
    return null;
  }
}

/**
 * Load or generate a keypair for the given role.
 * Useful for scripts that need a stable keypair without manual keygen.
 */
function getOrCreateKeyPair(role) {
  const existing = loadKeyPair(role);
  if (existing) return existing;
  const kp = generateKeyPair(role);
  saveKeyPair(kp);
  return kp;
}

module.exports = { generateKeyPair, saveKeyPair, loadKeyPair, getOrCreateKeyPair };
