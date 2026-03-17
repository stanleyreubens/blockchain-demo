'use strict';
/**
 * tests/chain.test.js
 * Unit tests using Node.js built-in test runner (node --test).
 *
 * Run:  npm test
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { buildTransaction, sha256 } = require('../src/tx/normalize');
const { computeMerkleRoot, getMerkleProof, verifyMerkleProof } = require('../src/chain/merkle');
const { mineBlock, createGenesisBlock, validateBlock } = require('../src/chain/block');
const { generateKeyPair } = require('../src/crypto/keys');
const { signTransaction, verifySignature } = require('../src/crypto/sign');
const Blockchain = require('../src/chain/blockchain');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSampleRaw(id = '1') {
  return {
    _id: id,
    date: '2024-03-15',
    department: 'Engineering',
    drone_make_model: 'DJI Phantom 4',
    faa_drone_reg: 'FA3091XZ',
    pilot_certificate: 'PART107-2024',
    location_area_surveyed: 'Downtown Bloomington',
    street_address_area_surveyed: '100 N Morton St',
    authorized_use: 'Infrastructure Inspection',
  };
}

// ── Transaction normalization ────────────────────────────────────────────────
describe('Transaction normalization', () => {
  it('builds a deterministic tx with sorted keys', () => {
    const { tx, txHash } = buildTransaction(makeSampleRaw('42'), 'http://example.com', 'snapHash');
    const keys = Object.keys(tx);
    assert.deepEqual(keys, [...keys].sort(), 'keys must be sorted');
    assert.ok(txHash.length === 64, 'txHash must be 64-char hex');
  });

  it('produces the same hash for the same input', () => {
    const a = buildTransaction(makeSampleRaw('1'), 'http://x.com', 'h1');
    const b = buildTransaction(makeSampleRaw('1'), 'http://x.com', 'h1');
    assert.equal(a.txHash, b.txHash, 'identical inputs must yield identical hashes');
  });

  it('produces different hashes for different inputs', () => {
    const a = buildTransaction(makeSampleRaw('1'), 'http://x.com', 'h1');
    const b = buildTransaction(makeSampleRaw('2'), 'http://x.com', 'h1');
    assert.notEqual(a.txHash, b.txHash);
  });
});

// ── Merkle tree ──────────────────────────────────────────────────────────────
describe('Merkle tree', () => {
  const txHashes = ['aabbcc', 'ddeeff', '112233', '445566'];

  it('computes a stable root', () => {
    const r1 = computeMerkleRoot(txHashes);
    const r2 = computeMerkleRoot([...txHashes]);
    assert.equal(r1, r2);
  });

  it('returns empty sentinel for empty list', () => {
    const r = computeMerkleRoot([]);
    assert.ok(typeof r === 'string' && r.length === 64);
  });

  it('generates and verifies a proof for each leaf', () => {
    for (const h of txHashes) {
      const root  = computeMerkleRoot(txHashes);
      const proof = getMerkleProof(txHashes, h);
      assert.ok(proof !== null, `proof must exist for ${h}`);
      const valid = verifyMerkleProof(h, proof, root);
      assert.ok(valid, `proof must be valid for ${h}`);
    }
  });

  it('rejects a tampered proof', () => {
    const root  = computeMerkleRoot(txHashes);
    const proof = getMerkleProof(txHashes, txHashes[0]);
    const valid = verifyMerkleProof('deadbeef', proof, root);
    assert.equal(valid, false);
  });

  it('handles single-element tree', () => {
    const h     = ['onlyone'];
    const root  = computeMerkleRoot(h);
    const proof = getMerkleProof(h, 'onlyone');
    assert.ok(verifyMerkleProof('onlyone', proof, root));
  });

  it('handles odd-length trees (duplicate last)', () => {
    const hs = ['a','b','c'];
    const root = computeMerkleRoot(hs);
    for (const h of hs) {
      assert.ok(verifyMerkleProof(h, getMerkleProof(hs, h), root));
    }
  });
});

// ── Block mining & validation ────────────────────────────────────────────────
describe('Block mining and validation', () => {
  let kp;
  before(() => { kp = generateKeyPair('TestIssuer'); });

  it('genesis block is valid', () => {
    const g = createGenesisBlock(1);
    const { valid, errors } = validateBlock(g);
    assert.ok(valid, errors.join('; '));
  });

  it('mined block meets difficulty target', () => {
    const block = mineBlock(1, '0'.repeat(64), [], 1);
    assert.ok(block.blockHash.startsWith('0'), `hash must start with 0: ${block.blockHash}`);
    const { valid } = validateBlock(block);
    assert.ok(valid);
  });

  it('detects tampered block hash', () => {
    const block = mineBlock(1, '0'.repeat(64), [], 1);
    block.blockHash = block.blockHash.replace(/^./, 'f'); // corrupt hash
    const { valid } = validateBlock(block);
    assert.equal(valid, false);
  });
});

// ── Signing & verification ───────────────────────────────────────────────────
describe('Signing and verification', () => {
  let kp;
  before(() => { kp = generateKeyPair('TestSigner'); });

  it('signs and verifies a tx hash', () => {
    const txHash = sha256('test transaction');
    const sig    = signTransaction(txHash, kp.privateKeyPem);
    assert.ok(sig.length > 0);
    assert.ok(verifySignature(txHash, sig, kp.publicKeyHex));
  });

  it('rejects a tampered tx hash', () => {
    const txHash = sha256('test transaction');
    const sig    = signTransaction(txHash, kp.privateKeyPem);
    const bad    = sha256('tampered transaction');
    assert.equal(verifySignature(bad, sig, kp.publicKeyHex), false);
  });

  it('rejects wrong key', () => {
    const kp2    = generateKeyPair('OtherSigner');
    const txHash = sha256('test transaction');
    const sig    = signTransaction(txHash, kp.privateKeyPem);
    assert.equal(verifySignature(txHash, sig, kp2.publicKeyHex), false);
  });
});

// ── Blockchain (integration) ─────────────────────────────────────────────────
describe('Blockchain integration', () => {
  let kp, bc;

  before(() => {
    kp = generateKeyPair('ChainTestIssuer');
    bc = new Blockchain(1); // difficulty 1 for speed
  });

  function makeTx(id) {
    const { tx, txJson, txHash } = buildTransaction(makeSampleRaw(id), 'http://x.com', 'sh');
    const signature = signTransaction(txHash, kp.privateKeyPem);
    return { tx, txJson, txHash, signature, issuerPublicKey: kp.publicKeyHex };
  }

  it('starts with genesis block', () => {
    assert.equal(bc.chain.length, 1);
    assert.equal(bc.chain[0].index, 0);
  });

  it('appends and validates blocks', () => {
    bc.addBlock([makeTx('A'), makeTx('B')]);
    bc.addBlock([makeTx('C')]);
    assert.equal(bc.chain.length, 3);
    const { valid, errors } = bc.validateChain();
    assert.ok(valid, errors.join('; '));
  });

  it('finds transactions by hash', () => {
    const tx1 = makeTx('D');
    bc.addBlock([tx1]);
    const found = bc.getTransaction(tx1.txHash);
    assert.ok(found, 'transaction must be findable');
    assert.equal(found.tx.txHash, tx1.txHash);
  });

  it('generates and verifies Merkle proofs', () => {
    const tx1 = makeTx('E');
    const tx2 = makeTx('F');
    bc.addBlock([tx1, tx2]);
    const proofData = bc.getProof(tx1.txHash);
    assert.ok(proofData, 'proof must exist');
    const ok = Blockchain.verifyProof(tx1.txHash, proofData.proof, proofData.merkleRoot);
    assert.ok(ok, 'proof verification must pass');
  });

  it('detects chain tampering', () => {
    // Tamper with a transaction
    // Mutate the txJson (canonical source) so re-derivation catches tampering
    const orig = bc.chain[1].transactions[0].txJson;
    bc.chain[1].transactions[0].txJson = orig.replace('Engineering','HACKED');
    const { valid } = bc.validateChain();
    assert.equal(valid, false, 'tampered chain must fail validation');
  });

  it('fork resolution accepts heavier chain', () => {
    const bc2 = new Blockchain(1);
    for (let i = 0; i < 5; i++) bc2.addBlock([makeTx('G' + i)]);

    const replaced = bc.resolveWith(bc2.chain);
    assert.ok(replaced, 'should accept longer chain');
    assert.equal(bc.chain.length, bc2.chain.length);
  });
});
