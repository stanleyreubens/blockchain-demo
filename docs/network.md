# Network & Consensus

## Architecture

The system runs as a **multi-node HTTP network** — each node is an independent Express server that:

- Maintains its own in-memory blockchain (optionally persisted to `data/chain.json`)
- Exposes a `/p2p` sub-router for peer-to-peer communication
- Broadcasts newly accepted blocks to all known peers
- Syncs and resolves forks on startup and when a peer is ahead

There is no DHT or gossip protocol. Peer lists are configured at startup via `--peers=`.

---

## Starting 3 Nodes

Open three terminals (or use a process manager):

```bash
# Node 1
node src/server.js --port=3001 --peers=http://localhost:3002,http://localhost:3003

# Node 2
node src/server.js --port=3002 --peers=http://localhost:3001,http://localhost:3003

# Node 3
node src/server.js --port=3003 --peers=http://localhost:3001,http://localhost:3002
```

Or using the npm alias:

```bash
npm run dev:node -- --port=3001 --peers=http://localhost:3002,http://localhost:3003
```

---

## P2P API Endpoints

These endpoints are used by nodes to communicate with each other. They are **not part of the public REST API**.

| Method | Path | Description |
|---|---|---|
| `GET` | `/p2p/chain` | Return this node's full chain as JSON array |
| `POST` | `/p2p/block` | Receive a new block from a peer |
| `GET` | `/p2p/peers` | List known peers |
| `POST` | `/p2p/peers` | Register a new peer URL |

---

## Fork Resolution

### Rule: Heaviest Chain (most cumulative work)

```
cumulativeWork = sum over all blocks of: 16^block.difficulty
```

When a peer's chain is received, the node replaces its own chain if and only if:

```
peerWork > myWork
OR
(peerWork === myWork AND peerLength > myLength)
```

Before accepting, the candidate chain is fully validated (PoW, hash links, Merkle roots, signatures).

### Fork Simulation

```bash
npm run simulate:fork
```

This script demonstrates fork creation and resolution:

1. Verifies all 3 nodes are reachable.
2. Constructs two competing fork chains locally.
3. Shows which fork wins based on cumulative work.
4. Triggers a sync between nodes and reports final chain lengths.

**Prerequisite:** all 3 nodes must be running before executing the simulation.

---

## Consensus Properties

| Property | Implementation |
|---|---|
| **Safety** | A node never accepts a block that fails validation. Forks are resolved deterministically by cumulative work. |
| **Liveness** | Any node can mine a block and broadcast it. Nodes sync on startup and on receiving a block with a higher index than expected. |
| **Finality** | Probabilistic — a block is considered final after 6 confirmations (convention; not enforced in code). |
| **Sybil resistance** | Proof-of-Work makes it expensive to produce a competing chain. |

---

## Block Broadcast Flow

```
Node A mines block N
  └─► POST /p2p/block → Node B
        └─► validates block
        └─► appends to chain
        └─► broadcasts to its peers (excluding Node A)
  └─► POST /p2p/block → Node C
        └─► validates block
        └─► appends to chain
```

If a node receives a block at index > chain.length (i.e., it is behind), it triggers `syncWithPeers()` to fetch and resolve the full chain.
