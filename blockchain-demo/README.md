# Bloomington UAV Blockchain Audit Ledger

A blockchain-backed audit log for the City of Bloomington drone program.  
Each UAV flight record from the public dataset becomes a signed, hashed, and Merkle-provable transaction anchored to an immutable chain of blocks.

Built for **COSC890** — forked from [anders94/blockchain-demo](https://github.com/anders94/blockchain-demo), with all blockchain logic implemented from scratch.

---

## Features

- **Data pipeline** — downloads the UAV Flight Log in XML and CSV; converts each record to a deterministic canonical JSON transaction
- **SHA-256 hashing** — every transaction and block header is hashed with SHA-256
- **Proof-of-Work** — adjustable difficulty (leading hex zeros)
- **Merkle trees** — inclusion proofs for any flight record
- **ECDSA signing** — P-256 key pairs; every transaction is signed by `CityIssuer`
- **Chain validation** — checks PoW, hash links, Merkle roots, and all signatures
- **P2P networking** — 3-node simulation with fork resolution (heaviest-chain rule)
- **REST API** — chain, block, tx, proof, verify, search, stats endpoints
- **Explorer UI** — Dataset Explorer, Block Explorer, Verify Flight views

---

## Requirements

- Node.js ≥ 18
- npm ≥ 9

---

## Installation

```bash
git clone <your-fork-url>
cd blockchain-uav
npm install
cp .env.example .env
```

---

## Quick Start

### 1. Generate keys

```bash
node scripts/keygen.js
```

Creates `CityIssuer` and `Auditor` key pairs under `keys/`.

### 2. Ingest the dataset

```bash
# Download XML (default)
npm run ingest

# Or download CSV
node scripts/ingest.js --format=csv

# Download both formats
node scripts/ingest.js --format=both
```

Outputs:
- `data/raw/<timestamp>.xml` (or `.csv`) — raw snapshot
- `data/transactions.json` — canonical signed transactions

### 3. Build the blockchain

```bash
# Default: difficulty=2, batch-size=10
npm run build:chain

# Custom difficulty / batch
node scripts/build-chain.js --difficulty=3 --batch-size=20
```

Outputs `data/chain.json`.

### 4. Start a single node

```bash
npm start
# or
node src/server.js --port=3001
```

Open **http://localhost:3001** in your browser.

---

## Running 3 Nodes

```bash
# Terminal 1
npm run dev:node -- --port=3001 --peers=http://localhost:3002,http://localhost:3003

# Terminal 2
npm run dev:node -- --port=3002 --peers=http://localhost:3001,http://localhost:3003

# Terminal 3
npm run dev:node -- --port=3003 --peers=http://localhost:3001,http://localhost:3002
```

---

## Fork Simulation

With all 3 nodes running:

```bash
npm run simulate:fork
```

This demonstrates fork creation and resolution via the heaviest-chain rule.

---

## Running Tests

```bash
npm test
```

21 unit tests covering:
- Transaction normalization & determinism
- Merkle tree (proof generation, verification, odd-length, single-leaf)
- Block mining, PoW validation, tamper detection
- ECDSA signing and verification
- Full blockchain integration (append, validate, find tx, Merkle proof, tamper detection, fork resolution)

---

## REST API Reference

Base URL: `http://localhost:3001/api`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/chain` | All block headers |
| `GET` | `/block/:hash` | Full block with transactions |
| `GET` | `/block/index/:index` | Block by index |
| `GET` | `/tx/:txHash` | Single transaction |
| `GET` | `/proof/:txHash` | Merkle inclusion proof |
| `POST` | `/verify` | Verify tx + proof (stateless) |
| `GET` | `/search` | Search transactions (`location`, `drone_model`, `department`, `date_from`, `date_to`) |
| `GET` | `/stats` | Chain statistics |
| `POST` | `/validate` | Full chain validation |

### Example: verify a transaction

```bash
# Get the proof
curl http://localhost:3001/api/proof/<txHash>

# Verify it
curl -X POST http://localhost:3001/api/verify \
  -H 'Content-Type: application/json' \
  -d '{"txHash":"<txHash>","proof":[...],"merkleRoot":"<root>"}'
```

---

## Project Structure

```
blockchain-uav/
├── scripts/
│   ├── ingest.js          # Download + normalize dataset
│   ├── build-chain.js     # Mine chain from transactions
│   ├── keygen.js          # Generate key pairs
│   └── simulate-fork.js   # Fork resolution demo
├── src/
│   ├── tx/
│   │   └── normalize.js   # Canonical transaction builder
│   ├── chain/
│   │   ├── block.js       # Block structure + PoW mining
│   │   ├── blockchain.js  # Chain management + fork resolution
│   │   └── merkle.js      # Merkle tree, proof gen/verify
│   ├── crypto/
│   │   ├── keys.js        # ECDSA P-256 key management
│   │   └── sign.js        # Sign + verify transactions
│   ├── api/
│   │   └── routes.js      # REST API routes
│   ├── p2p/
│   │   └── node.js        # P2P peer networking
│   └── server.js          # Express server entry point
├── public/
│   └── index.html         # Explorer UI (Dataset / Block / Verify)
├── tests/
│   └── chain.test.js      # 21 unit tests
├── docs/
│   ├── data_dictionary.md
│   ├── key_management.md
│   └── network.md
├── data/                  # (gitignored) raw snapshots + chain
├── keys/                  # (gitignored) private keys
└── README.md
```

---

## Design Decisions

### Canonicalization
Keys are sorted lexicographically at every nesting level; compact JSON (no whitespace); timestamps normalised to ISO-8601 UTC without milliseconds; absent/empty fields stored as `null` rather than omitted. This guarantees bit-identical output for identical input regardless of insertion order or runtime environment.

### Fork Choice
Heaviest chain (sum of `16^difficulty` per block). Falls back to longest chain on tie. The candidate chain is fully validated before acceptance — a peer cannot force a chain replacement with an invalid chain.

### Crypto
ECDSA/P-256 with SHA-256. Signatures are DER-encoded and hex-stored. Public keys are stored as DER SPKI hex inside transactions (compact, no PEM headers). Node.js built-in `crypto` — no third-party crypto dependency.

### Merkle Tree
Binary tree; leaves are `SHA-256(txHash)` (single hash — domain-separated from block hashes); odd-length layers duplicate the last node. Proof paths record `{ hash, position }` for each sibling.

---

## Academic Integrity

- All blockchain logic (hashing, PoW, Merkle, signing, P2P, fork resolution) is original implementation.
- The UI visual style and layout is adapted from `anders94/blockchain-demo`.
- Standard Node.js built-ins (`crypto`, `http`, `fs`) and utility libraries (`express`, `xml2js`, `csv-parse`) are used; no full blockchain frameworks.
