'use strict';
/**
 * src/chain/block.js
 * Block structure, hashing, and proof-of-work mining.
 *
 * Block header fields (all are hashed):
 *   index        - sequential block number (genesis = 0)
 *   timestamp    - ISO-8601 UTC string, set at mine time
 *   prevHash     - blockHash of the previous block
 *   nonce        - integer, incremented during PoW
 *   difficulty   - number of required leading hex zeros
 *   merkleRoot   - Merkle root of included txHashes
 *   txCount      - number of transactions in this block
 *
 * blockHash = SHA-256(JSON.stringify(headerFields, sortedKeys))
 *
 * The genesis block uses prevHash = "0".repeat(64).
 */

const crypto = require('crypto');
const { computeMerkleRoot } = require('./merkle');
const { sortKeysDeep } = require('../tx/normalize');

const GENESIS_PREV_HASH = '0'.repeat(64);

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Build the canonical header string used for hashing */
function headerString(index, timestamp, prevHash, nonce, difficulty, merkleRoot, txCount) {
  const header = sortKeysDeep({
    difficulty,
    index,
    merkleRoot,
    nonce,
    prevHash,
    timestamp,
    txCount,
  });
  return JSON.stringify(header);
}

function computeBlockHash(index, timestamp, prevHash, nonce, difficulty, merkleRoot, txCount) {
  return sha256(headerString(index, timestamp, prevHash, nonce, difficulty, merkleRoot, txCount));
}

/** Check whether a hash satisfies the difficulty target (leading zeros). */
function meetsTarget(hash, difficulty) {
  return hash.startsWith('0'.repeat(difficulty));
}

/**
 * Mine a block: find a nonce such that the blockHash meets difficulty.
 *
 * @param {number}   index
 * @param {string}   prevHash
 * @param {Array}    transactions  - array of { tx, txJson, txHash, signature, issuerPublicKey }
 * @param {number}   difficulty
 * @returns {object} mined block
 */
function mineBlock(index, prevHash, transactions, difficulty) {
  const merkleRoot = computeMerkleRoot(transactions.map(t => t.txHash));
  const txCount = transactions.length;
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let nonce = 0;
  let blockHash;

  do {
    nonce++;
    blockHash = computeBlockHash(index, timestamp, prevHash, nonce, difficulty, merkleRoot, txCount);
  } while (!meetsTarget(blockHash, difficulty));

  return {
    index,
    timestamp,
    prevHash,
    nonce,
    difficulty,
    merkleRoot,
    txCount,
    blockHash,
    transactions, // stored separately from header
  };
}

/** Create the genesis block (no transactions). */
function createGenesisBlock(difficulty = 2) {
  return mineBlock(0, GENESIS_PREV_HASH, [], difficulty);
}

/**
 * Validate a single block's internal consistency.
 * Does NOT check prevHash linkage (that's the chain's job).
 */
function validateBlock(block) {
  const errors = [];

  // Recompute hash
  const recomputed = computeBlockHash(
    block.index, block.timestamp, block.prevHash,
    block.nonce, block.difficulty, block.merkleRoot, block.txCount
  );
  if (recomputed !== block.blockHash) {
    errors.push(`Block ${block.index}: blockHash mismatch (got ${recomputed})`);
  }

  // Check PoW
  if (!meetsTarget(block.blockHash, block.difficulty)) {
    errors.push(`Block ${block.index}: does not meet difficulty ${block.difficulty}`);
  }

  // Check merkle root
  if (block.transactions && block.transactions.length > 0) {
    const recomputedMerkle = computeMerkleRoot(block.transactions.map(t => t.txHash));
    if (recomputedMerkle !== block.merkleRoot) {
      errors.push(`Block ${block.index}: merkleRoot mismatch`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  mineBlock,
  createGenesisBlock,
  validateBlock,
  computeBlockHash,
  meetsTarget,
  GENESIS_PREV_HASH,
};
