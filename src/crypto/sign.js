'use strict';
/**
 * src/crypto/sign.js
 * ECDSA sign and verify using Node.js built-in crypto.
 *
 * sign()   - takes a txHash (hex string) and a private key PEM → DER-encoded
 *            signature as hex string.
 * verify() - takes txHash, hex signature, and public key hex → boolean.
 */

const crypto = require('crypto');

/**
 * Sign a txHash with the CityIssuer (or any role's) private key.
 *
 * @param {string} txHash         - hex string (SHA-256 of canonical tx JSON)
 * @param {string} privateKeyPem  - PKCS#8 PEM private key
 * @returns {string} DER signature as hex
 */
function signTransaction(txHash, privateKeyPem) {
  const sign = crypto.createSign('SHA256');
  sign.update(txHash, 'utf8');
  sign.end();
  return sign.sign({ key: privateKeyPem, dsaEncoding: 'der' }, 'hex');
}

/**
 * Verify a transaction signature.
 *
 * @param {string} txHash       - hex string
 * @param {string} signatureHex - DER signature hex
 * @param {string} publicKey    - PEM or DER hex public key
 * @returns {boolean}
 */
function verifySignature(txHash, signatureHex, publicKey) {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(txHash, 'utf8');
    verify.end();

    // Accept both PEM strings and DER hex
    let keyObj;
    if (typeof publicKey === 'string' && publicKey.startsWith('-----')) {
      keyObj = crypto.createPublicKey(publicKey);
    } else {
      // Treat as DER hex
      const derBuf = Buffer.from(publicKey, 'hex');
      keyObj = crypto.createPublicKey({ key: derBuf, format: 'der', type: 'spki' });
    }

    return verify.verify(
      { key: keyObj, dsaEncoding: 'der' },
      Buffer.from(signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = { signTransaction, verifySignature };
