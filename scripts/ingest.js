#!/usr/bin/env node
'use strict';
/**
 * scripts/ingest.js
 * Download the City of Bloomington UAV Flight Log dataset and convert each
 * record to a signed canonical transaction.
 *
 * Usage:
 *   node scripts/ingest.js [--format xml|csv] [--sign CityIssuer]
 *
 * Output:
 *   data/raw/<timestamp>.<format>      raw snapshot
 *   data/transactions.json             canonical signed transactions
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const fetch   = require('node-fetch');
const { parse: parseCsv } = require('csv-parse/sync');
const xml2js  = require('xml2js');

const { buildTransaction } = require('../src/tx/normalize');
const { getOrCreateKeyPair } = require('../src/crypto/keys');
const { signTransaction }    = require('../src/crypto/sign');

const DATA_DIR = path.join(__dirname, '../data');
const RAW_DIR  = path.join(DATA_DIR, 'raw');

const URLS = {
  xml: 'https://data.bloomington.in.gov/api/views/3a7f6kb4/rows.xml?accessType=DOWNLOAD',
  csv: 'https://data.bloomington.in.gov/api/views/3a7f6kb4/rows.csv?accessType=DOWNLOAD',
  json: 'https://data.bloomington.in.gov/api/views/3a7f6kb4/rows.json?accessType=DOWNLOAD',
};

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function downloadRaw(format) {
  const url = URLS[format];
  if (!url) throw new Error(`Unsupported format: ${format}`);

  console.log(`[ingest] Downloading ${format.toUpperCase()} from:\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const body = await res.text();

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RAW_DIR, `uav-flight-log-${ts}.${format}`);
  fs.writeFileSync(file, body, 'utf8');
  console.log(`[ingest] Saved raw snapshot → ${file}`);

  return { body, file, url, snapshotHash: sha256(body) };
}

function parseXml(body) {
  return new Promise((res, rej) => {
    xml2js.parseString(body, { explicitArray: true, mergeAttrs: false }, (err, result) => {
      if (err) return rej(err);
      // Bloomington Open Data XML wraps rows in response/row/row
      try {
        const rows = result?.response?.row?.[0]?.row || [];
        const records = rows.map(r => {
          const out = {};
          for (const [k, v] of Object.entries(r)) {
            if (k === '$') { Object.assign(out, v); continue; }
            out[k] = Array.isArray(v) ? v[0] : v;
          }
          return out;
        });
        res(records);
      } catch (e) {
        rej(e);
      }
    });
  });
}

function parseCsvBody(body) {
  return parseCsv(body, { columns: true, skip_empty_lines: true, trim: true });
}

async function parseJson(body) {
  const data = JSON.parse(body);
  // Socrata JSON format: { meta: {...}, data: [[...], ...] }
  // or simply an array
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data)) {
    const cols = data.meta?.view?.columns?.map(c => c.fieldName) || [];
    return data.data.map(row => {
      const obj = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }
  throw new Error('Unrecognised JSON structure from dataset');
}

async function ingest(format = 'xml') {
  // Ensure both XML and CSV are downloaded (requirement: support 2+ formats)
  const formats = format === 'both' ? ['xml', 'csv'] : [format];
  let records = [];
  let primaryUrl, snapshotHash;

  for (const fmt of formats) {
    try {
      const { body, url, snapshotHash: sh } = await downloadRaw(fmt);
      if (fmt === formats[0]) {
        primaryUrl   = url;
        snapshotHash = sh;
      }

      let parsed;
      if (fmt === 'xml')  parsed = await parseXml(body);
      else if (fmt === 'csv') parsed = parseCsvBody(body);
      else if (fmt === 'json') parsed = await parseJson(body);

      if (fmt === formats[0]) records = parsed;
      console.log(`[ingest] Parsed ${parsed.length} records from ${fmt.toUpperCase()}`);
    } catch (e) {
      console.error(`[ingest] Failed to fetch ${fmt.toUpperCase()}: ${e.message}`);
      if (fmt === formats[0]) throw e;
    }
  }

  // Load or create CityIssuer keypair
  const issuer = getOrCreateKeyPair('CityIssuer');
  console.log(`[ingest] Signing with CityIssuer key (${issuer.publicKeyHex.slice(0, 20)}...)`);

  // Build and sign transactions
  const signedTxs = [];
  let skipped = 0;

  for (const raw of records) {
    try {
      const { tx, txJson, txHash } = buildTransaction(raw, primaryUrl, snapshotHash);
      const signature = signTransaction(txHash, issuer.privateKeyPem);

      signedTxs.push({
        tx,
        txJson,
        txHash,
        signature,
        issuerPublicKey: issuer.publicKeyHex,
      });
    } catch (e) {
      skipped++;
      if (skipped <= 3) console.warn(`[ingest] Skipped record: ${e.message}`);
    }
  }

  if (skipped > 3) console.warn(`[ingest] ... and ${skipped - 3} more skipped`);
  console.log(`[ingest] Built ${signedTxs.length} signed transactions (${skipped} skipped)`);

  // Write transactions file
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, 'transactions.json');
  fs.writeFileSync(outFile, JSON.stringify(signedTxs, null, 2), 'utf8');
  console.log(`[ingest] Wrote → ${outFile}`);

  return signedTxs;
}

// ── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const args   = process.argv.slice(2);
  const fmtArg = args.find(a => a.startsWith('--format=')) || '--format=xml';
  const format = fmtArg.split('=')[1] || 'xml';

  ingest(format)
    .then(txs => console.log(`[ingest] Done. ${txs.length} transactions ready.`))
    .catch(e  => { console.error('[ingest] FATAL:', e.message); process.exit(1); });
}

module.exports = { ingest };
