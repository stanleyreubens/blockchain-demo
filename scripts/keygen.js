#!/usr/bin/env node
'use strict';
/**
 * scripts/keygen.js
 * Generate CityIssuer and Auditor keypairs.
 *
 * Usage:  node scripts/keygen.js
 */

const { generateKeyPair, saveKeyPair } = require('../src/crypto/keys');

for (const role of ['CityIssuer', 'Auditor']) {
  const kp = generateKeyPair(role);
  saveKeyPair(kp);
  console.log(`${role} public key (hex): ${kp.publicKeyHex}`);
}

console.log('\nKeys saved to keys/ directory.');
console.log('Keep *.private.pem files secret and never commit them to git.');
