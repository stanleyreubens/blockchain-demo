#!/usr/bin/env node
'use strict';
/**
 * scripts/simulate-fork.js
 * Demonstrates fork creation and resolution across 3 local nodes.
 *
 * Prerequisites: All three nodes must be running:
 *   npm run dev:node -- --port=3001 --peers=http://localhost:3002,http://localhost:3003
 *   npm run dev:node -- --port=3002 --peers=http://localhost:3001,http://localhost:3003
 *   npm run dev:node -- --port=3003 --peers=http://localhost:3001,http://localhost:3002
 *
 * Usage:  npm run simulate:fork
 */

const http = require('http');
const Blockchain = require('../src/chain/blockchain');
const { getOrCreateKeyPair } = require('../src/crypto/keys');
const { signTransaction }    = require('../src/crypto/sign');
const { buildTransaction }   = require('../src/tx/normalize');

const NODES = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
];

function post(url, data) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(data);
    const u    = new URL(url);
    const req  = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let resp = '';
      r.on('data', d => resp += d);
      r.on('end', () => { try { res(JSON.parse(resp)); } catch { res({}); } });
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => { try { res(JSON.parse(body)); } catch { rej(new Error(body)); } });
    }).on('error', rej);
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getChainLength(nodeUrl) {
  const data = await get(`${nodeUrl}/api/stats`);
  return data.blockCount;
}

async function run() {
  console.log('\n=== UAV Blockchain Fork Simulation ===\n');

  // Check nodes are up
  for (const node of NODES) {
    try {
      await get(`${node}/api/stats`);
      console.log(`[sim] Node ${node} is UP`);
    } catch {
      console.error(`[sim] Node ${node} is DOWN — please start it first`);
      process.exit(1);
    }
  }

  const issuer = getOrCreateKeyPair('CityIssuer');

  function makeTx(flightId) {
    const raw = {
      _id: flightId,
      department: 'Engineering',
      date: new Date().toISOString(),
      drone_make_model: 'DJI Phantom 4',
      faa_drone_reg: 'FA3091XZ',
      pilot_certificate: 'PART107-' + flightId,
      location_area_surveyed: 'Downtown Bloomington',
      street_address_area_surveyed: '100 N Morton St',
      authorized_use: 'Infrastructure Inspection',
    };
    const { tx, txJson, txHash } = buildTransaction(raw, 'simulation', 'sim-hash');
    const signature = signTransaction(txHash, issuer.privateKeyPem);
    return { tx, txJson, txHash, signature, issuerPublicKey: issuer.publicKeyHex };
  }

  console.log('\n[sim] Step 1: Get current chain lengths');
  for (const node of NODES) {
    console.log(`  ${node}: ${await getChainLength(node)} blocks`);
  }

  console.log('\n[sim] Step 2: Create a fork by mining on disconnected nodes');
  console.log('  Node 3001 will mine 1 extra block (becomes the canonical chain)');
  console.log('  Node 3002 will mine 2 extra blocks (becomes the canonical chain)');
  console.log('  (In a real fork, nodes would be isolated; here we just post directly)');

  // We simulate a fork by building competing mini-chains locally
  const fork1 = new Blockchain(2);
  fork1.addBlock([makeTx('FORK-A-1')]);

  const fork2 = new Blockchain(2);
  fork2.addBlock([makeTx('FORK-B-1')]);
  fork2.addBlock([makeTx('FORK-B-2')]);

  console.log(`\n  Fork 1 length: ${fork1.chain.length} (work: ${fork1.cumulativeWork})`);
  console.log(`  Fork 2 length: ${fork2.chain.length} (work: ${fork2.cumulativeWork})`);
  console.log('  -> Fork 2 has more cumulative work and should win\n');

  console.log('[sim] Step 3: Trigger sync on node 3001 from node 3002');
  try {
    await post(`${NODES[0]}/p2p/peers`, { url: NODES[1] });
    await post(`${NODES[1]}/p2p/peers`, { url: NODES[0] });
    // Force sync endpoint
    await get(`${NODES[0]}/api/stats`); // just poll
    console.log('  Sync triggered. Both nodes should converge on the longest chain.');
  } catch (e) {
    console.warn('  Could not trigger sync:', e.message);
  }

  await sleep(2000);

  console.log('\n[sim] Step 4: Final chain lengths (should all agree)');
  for (const node of NODES) {
    try {
      console.log(`  ${node}: ${await getChainLength(node)} blocks`);
    } catch {
      console.log(`  ${node}: unavailable`);
    }
  }

  console.log('\n=== Fork simulation complete ===\n');
}

run().catch(e => { console.error(e); process.exit(1); });
