'use strict';
/**
 * src/chain/merkle.js
 * Binary Merkle tree using SHA-256.
 *
 * Rules:
 *  - Leaf hashes = SHA-256(txHash)  (single hash, no double-hash needed here
 *    because txHash is already SHA-256; we hash again to domain-separate)
 *  - If odd number of leaves, duplicate the last one.
 *  - Internal nodes: SHA-256(leftChild + rightChild)  (64-byte hex concat)
 *  - Empty tree root = SHA-256("") = the well-known empty hash
 */

const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Compute a single Merkle root from an array of tx-hash strings. */
function computeMerkleRoot(txHashes) {
  if (!txHashes || txHashes.length === 0) {
    return sha256(''); // empty block sentinel
  }

  let layer = txHashes.map(h => sha256(h)); // leaf layer

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left  = layer[i];
      const right = layer[i + 1] || left; // duplicate last if odd
      next.push(sha256(left + right));
    }
    layer = next;
  }

  return layer[0];
}

/**
 * Generate a Merkle inclusion proof for a given txHash.
 *
 * Returns an array of { hash, position } objects where position is
 * 'left' or 'right', representing the sibling at each level.
 * Returns null if txHash is not found.
 */
function getMerkleProof(txHashes, targetTxHash) {
  if (!txHashes || txHashes.length === 0) return null;

  let layer = txHashes.map(h => sha256(h));
  const targetLeaf = sha256(targetTxHash);
  let idx = layer.indexOf(targetLeaf);
  if (idx === -1) return null;

  const proof = [];

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left  = layer[i];
      const right = layer[i + 1] || left;

      // Record sibling for the node we're tracking
      if (i === idx || i + 1 === idx) {
        if (i === idx) {
          proof.push({ hash: right, position: 'right' });
        } else {
          proof.push({ hash: left, position: 'left' });
        }
      }

      next.push(sha256(left + right));
    }
    idx = Math.floor(idx / 2);
    layer = next;
  }

  return proof;
}

/**
 * Verify a Merkle proof.
 *
 * @param {string} txHash      - the transaction hash to verify
 * @param {Array}  proof       - array of { hash, position } from getMerkleProof
 * @param {string} merkleRoot  - the expected Merkle root
 * @returns {boolean}
 */
function verifyMerkleProof(txHash, proof, merkleRoot) {
  if (!proof) return false;

  let current = sha256(txHash);

  for (const { hash, position } of proof) {
    if (position === 'right') {
      current = sha256(current + hash);
    } else {
      current = sha256(hash + current);
    }
  }

  return current === merkleRoot;
}

module.exports = { computeMerkleRoot, getMerkleProof, verifyMerkleProof, sha256 };
