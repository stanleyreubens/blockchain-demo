'use strict';
/**
 * src/api/routes.js
 * REST API for the UAV blockchain audit system.
 *
 * Routes:
 *   GET  /chain              - all block headers (no tx bodies)
 *   GET  /block/:hash        - full block with transactions
 *   GET  /tx/:txHash         - single transaction
 *   GET  /proof/:txHash      - Merkle inclusion proof
 *   POST /verify             - verify tx + proof (stateless)
 *   GET  /search             - search transactions
 *   GET  /stats              - chain statistics
 *   POST /validate           - full chain validation
 */

const express    = require('express');
const Blockchain = require('../chain/blockchain');

function createRouter(bc) {
  const router = express.Router();

  // ── GET /chain ─────────────────────────────────────────────────────────────
  router.get('/chain', (req, res) => {
    const headers = bc.chain.map(b => ({
      index:      b.index,
      blockHash:  b.blockHash,
      prevHash:   b.prevHash,
      merkleRoot: b.merkleRoot,
      txCount:    b.txCount,
      difficulty: b.difficulty,
      nonce:      b.nonce,
      timestamp:  b.timestamp,
    }));
    res.json({ length: bc.chain.length, blocks: headers });
  });

  // ── GET /block/:hash ───────────────────────────────────────────────────────
  router.get('/block/:hash', (req, res) => {
    const block = bc.chain.find(b => b.blockHash === req.params.hash);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
  });

  // ── GET /block/index/:index ────────────────────────────────────────────────
  router.get('/block/index/:index', (req, res) => {
    const idx = parseInt(req.params.index, 10);
    const block = bc.chain[idx];
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
  });

  // ── GET /tx/:txHash ───────────────────────────────────────────────────────
  router.get('/tx/:txHash', (req, res) => {
    const entry = bc.getTransaction(req.params.txHash);
    if (!entry) return res.status(404).json({ error: 'Transaction not found' });
    res.json(entry);
  });

  // ── GET /proof/:txHash ────────────────────────────────────────────────────
  router.get('/proof/:txHash', (req, res) => {
    const proofData = bc.getProof(req.params.txHash);
    if (!proofData) return res.status(404).json({ error: 'Transaction not found' });
    res.json(proofData);
  });

  // ── POST /verify ──────────────────────────────────────────────────────────
  // Body: { txHash, proof, merkleRoot }
  router.post('/verify', (req, res) => {
    const { txHash, proof, merkleRoot } = req.body || {};
    if (!txHash || !proof || !merkleRoot) {
      return res.status(400).json({ error: 'txHash, proof, and merkleRoot are required' });
    }

    const valid = Blockchain.verifyProof(txHash, proof, merkleRoot);
    res.json({
      txHash,
      merkleRoot,
      result: valid ? 'PASS' : 'FAIL',
      reason: valid ? 'Proof is valid - transaction is included in the block' :
                      'Proof is invalid - transaction may have been tampered with or is not in this block',
    });
  });

  // ── GET /search ───────────────────────────────────────────────────────────
  // Query params: location, drone_model, date_from, date_to, department
  router.get('/search', (req, res) => {
    const { location, drone_model, date_from, date_to, department } = req.query;

    let results = [];
    for (const block of bc.chain) {
      for (const t of (block.transactions || [])) {
        const tx = t.tx;
        let match = true;

        if (location && !JSON.stringify(tx).toLowerCase().includes(location.toLowerCase())) match = false;
        if (drone_model && !String(tx.drone_make_model || '').toLowerCase().includes(drone_model.toLowerCase())) match = false;
        if (department && !String(tx.department || '').toLowerCase().includes(department.toLowerCase())) match = false;
        if (date_from && tx.timestamp && tx.timestamp < date_from) match = false;
        if (date_to   && tx.timestamp && tx.timestamp > date_to)   match = false;

        if (match) {
          results.push({
            txHash:     t.txHash,
            blockIndex: block.index,
            blockHash:  block.blockHash,
            tx,
          });
        }
      }
    }

    res.json({ count: results.length, results: results.slice(0, 200) });
  });

  // ── GET /stats ────────────────────────────────────────────────────────────
  router.get('/stats', (req, res) => {
    const txCount = bc.chain.reduce((s, b) => s + (b.txCount || 0), 0);
    res.json({
      blockCount:     bc.chain.length,
      txCount,
      difficulty:     bc.difficulty,
      cumulativeWork: bc.cumulativeWork,
      latestBlock:    bc.latestBlock?.blockHash,
      latestIndex:    bc.latestBlock?.index,
    });
  });

  // ── POST /validate ────────────────────────────────────────────────────────
  router.post('/validate', (req, res) => {
    const { valid, errors } = bc.validateChain();
    res.json({ valid, errors });
  });

  return router;
}

module.exports = createRouter;
