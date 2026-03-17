'use strict';
/**
 * src/p2p/node.js
 * Minimal P2P node using HTTP polling + push.
 *
 * Each node:
 *  - Exposes its chain via GET /p2p/chain
 *  - Receives new blocks via POST /p2p/block
 *  - Maintains a list of peer URLs
 *  - Broadcasts mined blocks to all peers
 *  - Resolves forks using Blockchain.resolveWith()
 */

const http    = require('http');
const https   = require('https');
const Blockchain = require('../chain/blockchain');

class P2PNode {
  /**
   * @param {Blockchain} blockchain  - shared chain instance
   * @param {number}     port        - local port this node listens on
   * @param {string[]}   peers       - initial peer URLs e.g. ['http://localhost:3002']
   */
  constructor(blockchain, port, peers = []) {
    this.bc    = blockchain;
    this.port  = port;
    this.peers = new Set(peers);
  }

  /** Express router — attach to your Express app. */
  router() {
    const router = require('express').Router();

    /** Return this node's full chain */
    router.get('/chain', (req, res) => {
      res.json(this.bc.chain);
    });

    /** Receive a new block from a peer */
    router.post('/block', (req, res) => {
      const block = req.body;
      if (!block || block.index === undefined) {
        return res.status(400).json({ error: 'Invalid block' });
      }

      // If it's the next block, append it
      if (block.index === this.bc.chain.length) {
        try {
          this.bc.appendBlock(block);
          console.log(`[p2p:${this.port}] Accepted block ${block.index} from peer`);
          this._broadcastBlock(block);
          return res.json({ ok: true });
        } catch (e) {
          return res.status(409).json({ error: e.message });
        }
      }

      // If it's further ahead, trigger a sync
      if (block.index > this.bc.chain.length) {
        console.log(`[p2p:${this.port}] Peer is ahead, triggering sync`);
        this.syncWithPeers().catch(console.error);
      }

      res.json({ ok: true, action: 'sync_triggered' });
    });

    /** Register a new peer */
    router.post('/peers', (req, res) => {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url required' });
      this.peers.add(url);
      res.json({ peers: [...this.peers] });
    });

    /** List known peers */
    router.get('/peers', (req, res) => {
      res.json([...this.peers]);
    });

    return router;
  }

  /** Broadcast a newly mined block to all peers */
  async _broadcastBlock(block) {
    for (const peer of this.peers) {
      try {
        await this._postJson(`${peer}/p2p/block`, block);
      } catch (e) {
        console.warn(`[p2p:${this.port}] Failed to broadcast to ${peer}: ${e.message}`);
      }
    }
  }

  /** Called after this node mines a block; broadcasts to all peers */
  async broadcastBlock(block) {
    return this._broadcastBlock(block);
  }

  /** Sync with all peers; replace chain if a longer/heavier one is found */
  async syncWithPeers() {
    for (const peer of this.peers) {
      try {
        const chain = await this._getJson(`${peer}/p2p/chain`);
        const replaced = this.bc.resolveWith(chain);
        if (replaced) {
          console.log(`[p2p:${this.port}] Chain replaced from peer ${peer}`);
        }
      } catch (e) {
        console.warn(`[p2p:${this.port}] Sync failed for peer ${peer}: ${e.message}`);
      }
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  _getJson(url) {
    return new Promise((res, rej) => {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end',  () => {
          try { res(JSON.parse(body)); }
          catch (e) { rej(e); }
        });
      }).on('error', rej);
    });
  }

  _postJson(url, data) {
    return new Promise((res, rej) => {
      const body = JSON.stringify(data);
      const u    = new URL(url);
      const lib  = u.protocol === 'https:' ? https : http;
      const req  = lib.request({
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, r => {
        let resp = '';
        r.on('data', d => resp += d);
        r.on('end',  () => { try { res(JSON.parse(resp)); } catch { res({}); } });
      });
      req.on('error', rej);
      req.write(body);
      req.end();
    });
  }
}

module.exports = P2PNode;
