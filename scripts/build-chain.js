#!/usr/bin/env node
'use strict';
/**
 * scripts/build-chain.js
 * Read data/transactions.json, batch into blocks, mine, validate, and persist.
 *
 * Usage:
 *   node scripts/build-chain.js [--difficulty 2] [--batch-size 10]
 */

const fs   = require('fs');
const path = require('path');

const Blockchain = require('../src/chain/blockchain');

const DATA_DIR   = path.join(__dirname, '../data');
const TX_FILE    = path.join(DATA_DIR, 'transactions.json');
const CHAIN_FILE = path.join(DATA_DIR, 'chain.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const difficulty = parseInt(args.find(a => a.startsWith('--difficulty='))?.split('=')[1] || '2', 10);
  const batchSize  = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1]  || '10', 10);
  return { difficulty, batchSize };
}

async function buildChain() {
  const { difficulty, batchSize } = parseArgs();

  if (!fs.existsSync(TX_FILE)) {
    console.error(`[build-chain] Missing ${TX_FILE}. Run: npm run ingest`);
    process.exit(1);
  }

  const signedTxs = JSON.parse(fs.readFileSync(TX_FILE, 'utf8'));
  console.log(`[build-chain] Loaded ${signedTxs.length} transactions (difficulty=${difficulty}, batch=${batchSize})`);

  const bc = new Blockchain(difficulty);
  let blockCount = 0;
  const t0 = Date.now();

  for (let i = 0; i < signedTxs.length; i += batchSize) {
    const batch = signedTxs.slice(i, i + batchSize);
    const block = bc.addBlock(batch);
    blockCount++;
    if (blockCount % 5 === 0 || i + batchSize >= signedTxs.length) {
      console.log(`[build-chain] Block ${block.index} mined (nonce=${block.nonce}, hash=${block.blockHash.slice(0,16)}...)`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[build-chain] Mined ${blockCount} blocks in ${elapsed}s`);

  // Validate
  const { valid, errors } = bc.validateChain();
  if (!valid) {
    console.error('[build-chain] Chain validation FAILED:', errors);
    process.exit(1);
  }
  console.log('[build-chain] Chain validation PASSED');

  fs.writeFileSync(CHAIN_FILE, bc.toJSON(), 'utf8');
  console.log(`[build-chain] Persisted → ${CHAIN_FILE}`);

  return bc;
}

if (require.main === module) {
  buildChain().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { buildChain };
