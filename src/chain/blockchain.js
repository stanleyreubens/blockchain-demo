'use strict';
/**
 * src/chain/blockchain.js
 * Full blockchain: append, validate, fork resolution (longest/heaviest chain).
 *
 * Fork choice rule: "heaviest chain" = chain whose total accumulated difficulty
 * (sum of 16^difficulty per block) is highest.  Falls back to longest chain
 * (block count) when cumulative work is tied.
 */

const { mineBlock, createGenesisBlock, validateBlock, meetsTarget } = require('./block');
const { getMerkleProof, verifyMerkleProof } = require('./merkle');
const { verifySignature } = require('../crypto/sign');

class Blockchain {
  constructor(difficulty = 2) {
    this.difficulty = difficulty;
    this.chain = [createGenesisBlock(difficulty)];
    // txHash → { blockIndex, txData } lookup
    this._txIndex = new Map();
  }

  get latestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /** Cumulative work: sum of 16^difficulty for each block. */
  get cumulativeWork() {
    return this.chain.reduce((sum, b) => sum + Math.pow(16, b.difficulty), 0);
  }

  /**
   * Add a batch of signed transactions as a new block.
   * @param {Array} transactions  - [{tx, txJson, txHash, signature, issuerPublicKey}]
   * @returns {object} the newly mined block
   */
  addBlock(transactions) {
    const prevHash = this.latestBlock.blockHash;
    const index    = this.chain.length;
    const block    = mineBlock(index, prevHash, transactions, this.difficulty);

    this.chain.push(block);
    this._indexTransactions(block);
    return block;
  }

  /** Append a pre-built block (received from a peer). */
  appendBlock(block) {
    const result = validateBlock(block);
    if (!result.valid) throw new Error(result.errors.join('; '));

    const prev = this.latestBlock;
    if (block.prevHash !== prev.blockHash) {
      throw new Error(`prevHash mismatch: expected ${prev.blockHash}`);
    }
    if (block.index !== this.chain.length) {
      throw new Error(`Index mismatch: expected ${this.chain.length}, got ${block.index}`);
    }

    this.chain.push(block);
    this._indexTransactions(block);
  }

  _indexTransactions(block) {
    for (const t of (block.transactions || [])) {
      this._txIndex.set(t.txHash, { blockIndex: block.index, tx: t });
    }
  }

  /** Full chain validation: hash links + PoW + merkle + signatures. */
  validateChain() {
    const errors = [];

    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i];

      // Internal block validity
      const { valid, errors: be } = validateBlock(block);
      if (!valid) errors.push(...be);

      // prevHash link (skip genesis)
      if (i > 0) {
        const prev = this.chain[i - 1];
        if (block.prevHash !== prev.blockHash) {
          errors.push(`Block ${i}: prevHash does not match block ${i - 1} hash`);
        }
      }

      // Signature + content validation for each transaction
      for (const t of (block.transactions || [])) {
        // Re-derive txHash from txJson to catch content tampering
        if (t.txJson) {
          const { sha256 } = require('../tx/normalize');
          const recomputed = sha256(t.txJson);
          if (recomputed !== t.txHash) {
            errors.push(`Block ${i}, tx ${t.txHash}: txHash mismatch — content was tampered`);
            continue;
          }
        }
        if (!t.signature || !t.issuerPublicKey) {
          errors.push(`Block ${i}, tx ${t.txHash}: missing signature or public key`);
          continue;
        }
        const ok = verifySignature(t.txHash, t.signature, t.issuerPublicKey);
        if (!ok) errors.push(`Block ${i}, tx ${t.txHash}: invalid signature`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Find a transaction by its hash across all blocks. */
  getTransaction(txHash) {
    return this._txIndex.get(txHash) || null;
  }

  /** Return the Merkle proof for a transaction. */
  getProof(txHash) {
    const entry = this._txIndex.get(txHash);
    if (!entry) return null;

    const block = this.chain[entry.blockIndex];
    const txHashes = block.transactions.map(t => t.txHash);
    const proof = getMerkleProof(txHashes, txHash);

    return {
      txHash,
      blockIndex: entry.blockIndex,
      blockHash:  block.blockHash,
      merkleRoot: block.merkleRoot,
      proof,
    };
  }

  /** Verify a proof without needing the full chain (stateless). */
  static verifyProof(txHash, proof, merkleRoot) {
    return verifyMerkleProof(txHash, proof, merkleRoot);
  }

  /**
   * Fork resolution: replace this chain with `candidate` if candidate
   * has strictly higher cumulative work (or longer if equal work).
   *
   * @param {Array} candidateChain  - raw block array
   * @returns {boolean} true if the chain was replaced
   */
  resolveWith(candidateChain) {
    const candidateWork = candidateChain.reduce(
      (sum, b) => sum + Math.pow(16, b.difficulty), 0
    );

    const candidateLen = candidateChain.length;
    const myWork       = this.cumulativeWork;
    const myLen        = this.chain.length;

    const shouldReplace =
      candidateWork > myWork ||
      (candidateWork === myWork && candidateLen > myLen);

    if (!shouldReplace) return false;

    // Validate the candidate chain before accepting
    const temp = new Blockchain(this.difficulty);
    temp.chain = [];
    for (const block of candidateChain) {
      const { valid, errors } = validateBlock(block);
      if (!valid) {
        console.warn('[fork] Rejecting candidate chain:', errors);
        return false;
      }
      temp.chain.push(block);
      temp._indexTransactions(block);
    }

    const { valid, errors } = temp.validateChain();
    if (!valid) {
      console.warn('[fork] Candidate chain failed full validation:', errors);
      return false;
    }

    this.chain     = temp.chain;
    this._txIndex  = temp._txIndex;
    console.log(`[fork] Replaced chain (new length: ${this.chain.length}, work: ${candidateWork})`);
    return true;
  }

  /** Serialise the chain to JSON (for persistence / API). */
  toJSON() {
    return JSON.stringify(this.chain);
  }

  static fromJSON(json, difficulty) {
    const blocks = JSON.parse(json);
    const bc = new Blockchain(difficulty);
    bc.chain = blocks;
    bc._txIndex = new Map();
    for (const block of blocks) bc._indexTransactions(block);
    return bc;
  }
}

module.exports = Blockchain;
