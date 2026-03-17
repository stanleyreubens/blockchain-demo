'use strict';
/**
 * src/server.js
 * Main Express server. Loads chain from disk if available, otherwise
 * starts with genesis only.
 *
 * Usage:
 *   node src/server.js [--port 3001] [--peers http://localhost:3002,http://localhost:3003]
 */

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const Blockchain = require('./chain/blockchain');
const createApiRouter = require('./api/routes');
const P2PNode = require('./p2p/node');

// ── CLI args ──────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const portArg     = args.find(a => a.startsWith('--port='))?.split('=')[1];
const peersArg    = args.find(a => a.startsWith('--peers='))?.split('=')[1];
const diffArg     = args.find(a => a.startsWith('--difficulty='))?.split('=')[1];

const PORT        = parseInt(portArg || process.env.PORT || '3001', 10);
const PEERS       = peersArg ? peersArg.split(',').filter(Boolean) : [];
const DIFFICULTY  = parseInt(diffArg || process.env.DIFFICULTY || '2', 10);

const CHAIN_FILE  = path.join(__dirname, '../data/chain.json');
const PUBLIC_DIR  = path.join(__dirname, '../public');

// ── Bootstrap blockchain ──────────────────────────────────────────────────
let bc;
if (fs.existsSync(CHAIN_FILE)) {
  bc = Blockchain.fromJSON(fs.readFileSync(CHAIN_FILE, 'utf8'), DIFFICULTY);
  console.log(`[server:${PORT}] Loaded chain from disk (${bc.chain.length} blocks)`);
} else {
  bc = new Blockchain(DIFFICULTY);
  console.log(`[server:${PORT}] Started fresh blockchain (difficulty=${DIFFICULTY})`);
}

// ── P2P node ──────────────────────────────────────────────────────────────
const p2p = new P2PNode(bc, PORT, PEERS);

// ── Express app ───────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

// API routes
app.use('/api', createApiRouter(bc));

// P2P routes
app.use('/p2p', p2p.router());

// Serve UI for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n[server:${PORT}] UAV Blockchain node running at http://localhost:${PORT}`);
  console.log(`[server:${PORT}] Peers: ${PEERS.length > 0 ? PEERS.join(', ') : 'none'}`);
  console.log(`[server:${PORT}] API:   http://localhost:${PORT}/api`);
  console.log(`[server:${PORT}] UI:    http://localhost:${PORT}/\n`);

  // Initial sync
  if (PEERS.length > 0) {
    setTimeout(() => p2p.syncWithPeers().catch(console.error), 2000);
  }
});

module.exports = { app, bc, p2p };
