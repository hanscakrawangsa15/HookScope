# HookScope

**The Uniswap v4 Hook Transparency Platform**

HookScope is an open-source analytics and transparency platform for Uniswap v4 hooks. It indexes, analyzes, and exposes every hook deployed across Ethereum, Base, Arbitrum, and Optimism — including unverified contracts and upgradeable proxies. No hook can hide.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-API-orange?logo=hono)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?logo=pnpm)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [HookScore™ Scoring System](#hookscore-scoring-system)
- [Supported Chains](#supported-chains)
- [Pages & Features](#pages--features)
- [Contributing](#contributing)

---

## Overview

Uniswap v4 introduces **hooks** — smart contracts that plug into pool lifecycle events (swaps, liquidity additions, donations). Hooks can implement MEV protection, dynamic fees, limit orders, TWAP oracles, and more. But they also introduce new risk vectors: a malicious or buggy hook can manipulate trades, drain liquidity, or steal funds.

HookScope solves this by providing:
- A **searchable registry** of all v4 hooks across 4 chains
- **Automated security analysis** — bytecode inspection, proxy detection, static analysis
- A **HookScore™** risk model to surface dangerous hooks
- A **real-time arbitrage tracker** showing ETH/USDC price spreads across chains
- A **developer toolkit** with callback documentation and ABI explorer

---

## Features

| Feature | Description |
|---|---|
| Hook Explorer | Search and filter all indexed v4 hooks by chain, risk level, callbacks, TVL |
| Hook Detail | Full breakdown — callbacks, pools, TVL, ABI, source code, security flags |
| Security Scanner | Automated detection of SELFDESTRUCT, DELEGATECALL, proxy patterns, Slither findings |
| Arbitrage Tracker | Real-time multi-chain ETH/USDC price comparison with live TVL from The Graph & DeFiLlama |
| Hook Comparator | Side-by-side comparison of two hook addresses |
| Developer Tools | Hook callback documentation, ABI explorer, code snippets |
| Stats Dashboard | Platform-wide statistics — total hooks, pools, TVL, risk distribution |
| 3D Hero Canvas | Three.js animated hook callback constellation on the landing page |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Client                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP / fetch
┌───────────────────────────────▼─────────────────────────────────┐
│              apps/web  (Next.js 15 App Router)                  │
│  /            Explorer     Hook search, filter, pagination      │
│  /hooks/:addr Detail       Callbacks, pools, source, security   │
│  /arbitrage   Arbitrage    Multi-chain ETH/USDC price tracker   │
│  /compare     Compare      Side-by-side hook comparison         │
│  /security    Security     Risk leaderboard                     │
│  /developer   Dev Tools    Callback docs, ABI explorer          │
│  /stats       Stats        Platform statistics                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST API
┌───────────────────────────────▼─────────────────────────────────┐
│              apps/api  (Hono.js on Node.js)                     │
│  /api/hooks            CRUD + search + compare                  │
│  /api/analytics/*      Global stats, hook analytics, arbitrage  │
│  /api/search           Full-text semantic search                │
│  /api/stats            Platform KPIs                            │
└────────┬─────────────────────────────────────┬──────────────────┘
         │ Prisma ORM                           │ viem / fetch
┌────────▼────────┐               ┌────────────▼──────────────────┐
│   PostgreSQL    │               │   External Data Sources        │
│   (Docker)      │               │   • Uniswap v4 PoolManager    │
│                 │               │   • Etherscan API             │
│  Hooks          │               │   • The Graph (subgraphs)     │
│  Pools          │               │   • DeFiLlama coins/protocol  │
│  HookAnalytics  │               │   • 4byte.directory           │
│  Transactions   │               └───────────────────────────────┘
└─────────────────┘
         ▲
         │ writes
┌────────┴────────────────────────────────────────────────────────┐
│              packages/indexer  (background worker)              │
│  pool-indexer        Listen to PoolManager.Initialize events    │
│  batch-analyze       Run analyzer on all unanalyzed hooks       │
│  enrich-etherscan    Fetch verified source code & ABI           │
│  volume-indexer      Update TVL and volume per pool             │
│  threat-intel        Cross-reference known malicious addresses  │
└─────────────────────────────────────────────────────────────────┘
         ▲
         │
┌────────┴────────────────────────────────────────────────────────┐
│              packages/analyzer                                  │
│  hook-analyzer       Orchestrates full analysis pipeline        │
│  bytecode-analyzer   Opcodes: SELFDESTRUCT, DELEGATECALL, PUSH4 │
│  proxy-detector      EIP-1967, EIP-1822, EIP-1167 minimal proxy │
│  etherscan-client    Fetches source, ABI, creation tx           │
│  score-calculator    Computes HookScore™ (0–100)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
hookscope/
├── apps/
│   ├── api/                        # REST API server
│   │   └── src/
│   │       ├── index.ts            # Hono app entry point
│   │       ├── db.ts               # Prisma client singleton
│   │       ├── cache.ts            # In-memory cache helpers
│   │       └── routes/
│   │           ├── hooks.ts        # Hook CRUD + compare + security
│   │           ├── analytics.ts    # Analytics + arbitrage endpoint
│   │           ├── search.ts       # Full-text search
│   │           └── stats.ts        # Platform statistics
│   │
│   └── web/                        # Next.js 15 frontend
│       └── src/
│           ├── app/
│           │   ├── page.tsx                  # Explorer (home)
│           │   ├── hooks/[address]/page.tsx  # Hook detail
│           │   ├── arbitrage/page.tsx        # Arbitrage tracker
│           │   ├── compare/page.tsx          # Hook comparator
│           │   ├── security/page.tsx         # Security leaderboard
│           │   ├── developer/page.tsx        # Dev tools
│           │   └── stats/page.tsx            # Statistics
│           ├── components/
│           │   ├── analytics/        # Live analytics bar, LP metrics
│           │   ├── hooks/            # Hook card, search bar, ABI explorer
│           │   ├── layout/           # Navbar
│           │   ├── three/            # Three.js hero canvas + constellation
│           │   └── ui/               # Risk badge, callback grid
│           └── lib/
│               ├── api.ts            # API client (typed fetch wrappers)
│               ├── utils.ts          # Formatting, flag decoding helpers
│               ├── callback-docs.ts  # Hook callback documentation
│               └── hook-descriptor.ts # Human-readable hook descriptions
│
├── packages/
│   ├── shared/                       # Shared across all packages
│   │   ├── src/
│   │   │   ├── constants.ts          # PoolManager addresses, HOOK_FLAGS bitmask
│   │   │   └── index.ts
│   │   └── prisma/
│   │       └── schema.prisma         # Database schema
│   │
│   ├── analyzer/                     # Static analysis engine
│   │   └── src/
│   │       ├── hook-analyzer.ts      # Main analysis orchestrator
│   │       ├── bytecode-analyzer.ts  # EVM opcode inspection
│   │       ├── proxy-detector.ts     # EIP-1967/1822/1167 detection
│   │       ├── etherscan-client.ts   # Etherscan API wrapper
│   │       └── score-calculator.ts  # HookScore™ algorithm
│   │
│   ├── indexer/                      # Blockchain data pipeline
│   │   └── src/
│   │       ├── index.ts              # Main indexer entry point
│   │       ├── pool-indexer.ts       # PoolManager.Initialize event listener
│   │       ├── batch-analyze.ts      # Bulk analysis runner
│   │       ├── enrich-etherscan.ts   # Source code enrichment
│   │       ├── volume-indexer.ts     # TVL and volume updater
│   │       ├── threat-intel.ts       # Threat intelligence cross-reference
│   │       ├── thegraph-client.ts    # The Graph subgraph queries
│   │       └── analytics-service.ts  # On-chain analytics computation
│   │
│   └── scanner/                      # Slither static analysis wrapper
│       └── src/
│           ├── index.ts
│           └── slither-scanner.ts
│
├── docker/
│   └── docker-compose.yml            # PostgreSQL 16 + Redis 7
├── start.sh                          # One-command startup script
├── stop.sh                           # Graceful shutdown
├── turbo.json                        # Turborepo pipeline config
└── pnpm-workspace.yaml               # pnpm workspace definition
```

---

## How It Works

### Step 1 — Event Indexing (Tamper-Proof)

Every Uniswap v4 pool is created via `PoolManager.Initialize`, which emits an event containing the hook address. Since this event is emitted by the core Uniswap contract, it cannot be faked. The indexer listens to these events across all supported chains using **viem** and stores each hook address in PostgreSQL.

### Step 2 — Callback Bitmask Decoding (Deterministic)

The lower 14 bits of every hook address deterministically encode which lifecycle callbacks the hook implements. This is enforced by `PoolManager.validateHookPermissions()` at pool creation time — the address itself IS the permission manifest.

```
Bit 13: beforeInitialize            Bit  6: afterSwap
Bit 12: afterInitialize             Bit  5: beforeDonate
Bit 11: beforeAddLiquidity          Bit  4: afterDonate
Bit 10: afterAddLiquidity           Bit  3: beforeSwapReturnsDelta
Bit  9: beforeRemoveLiquidity       Bit  2: afterSwapReturnsDelta
Bit  8: afterRemoveLiquidity        Bit  1: afterAddLiquidityReturnsDelta
Bit  7: beforeSwap                  Bit  0: afterRemoveLiquidityReturnsDelta
```

HookScope decodes these flags at index time and makes them searchable/filterable.

### Step 3 — Proxy Detection

Many production hooks are deployed behind upgradeable proxies. HookScope detects:
- **EIP-1967** — standard transparent/UUPS proxy (reads `_IMPLEMENTATION_SLOT`)
- **EIP-1822** — UUPS legacy (`_PROXIABLE_UUID` slot)
- **EIP-1167** — Minimal clone proxy (bytecode pattern `0x363d3d...`)

When a proxy is detected, the analyzer recurses to the implementation address for further analysis.

### Step 4 — Bytecode Analysis

Even without verified source code, the EVM bytecode reveals critical information:
- **SELFDESTRUCT** (opcode `0xFF`) — hook can be destroyed, wiping pool logic
- **DELEGATECALL** (opcode `0xF4`) — can forward execution to arbitrary contracts
- **Function selectors** via `PUSH4` pattern matching → looked up in 4byte.directory

### Step 5 — Source & ABI Enrichment

If the contract is verified on Etherscan, HookScope fetches:
- Full Solidity source code (all files for multi-file projects)
- Contract ABI
- Constructor arguments and creation transaction

### Step 6 — Slither Static Analysis

When source code is available, HookScope optionally runs **Slither** (Python static analyzer) to detect common vulnerability classes: reentrancy, integer overflow, access control issues, and more.

### Step 7 — HookScore™ Computation

All signals are combined into a single 0–100 security score. See [HookScore™ Scoring System](#hookscore-scoring-system).

### Step 8 — Real-Time Arbitrage Tracking

The arbitrage page fetches ETH/USDC prices per chain using a priority waterfall:

```
1. Direct on-chain RPC (Alchemy/Infura)  → source: "onchain"
2. The Graph sqrtPrice from subgraph     → source: "graph"
3. DeFiLlama spot + chain noise sim      → source: "estimated"
```

TVL per chain follows a separate waterfall:

```
1. DeFiLlama api.llama.fi/protocol/uniswap-v4   (2-min cache)
2. Database aggregated ETH/USDC pool TVL         (fallback)
```

Price conversion from `sqrtPriceX96`:
```
price = (sqrtPriceX96 / 2^96)² × 10^(decimals0 − decimals1)
```
For ETH(18)/USDC(6): multiply by `10^12`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS v4 |
| 3D Graphics | Three.js, @react-three/fiber, @react-three/drei |
| Charts | Recharts |
| Icons | Lucide React |
| API | Hono.js (runs on Node.js) |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Cache | Redis 7 (optional) |
| Blockchain | viem 2 |
| Monorepo | pnpm workspaces + Turborepo |
| Indexer | viem event listeners + Bull queue |
| Analysis | Custom bytecode parser + Slither |
| External APIs | Etherscan, The Graph, DeFiLlama, 4byte.directory |

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Docker** (for PostgreSQL and Redis)

### 1. Clone and Install

```bash
git clone https://github.com/hanscakrawangsa15/HookScope.git
cd HookScope
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#environment-variables)).

### 3. Start Infrastructure

```bash
# Start PostgreSQL + Redis
pnpm docker:up

# Push Prisma schema to database
cd packages/shared && npx prisma db push && cd ../..

# Build shared package
pnpm --filter @hookscope/shared build
```

### 4. Run Everything

#### Option A — One command (recommended)

```bash
./start.sh
```

This starts Docker, syncs the DB schema, and launches both API and web.

#### Option B — Manual (three terminals)

```bash
# Terminal 1: API server (port 3001)
pnpm --filter @hookscope/api dev

# Terminal 2: Web frontend (port 3000)
pnpm --filter @hookscope/web dev

# Terminal 3: Indexer (optional — to index live hook data)
pnpm --filter @hookscope/indexer dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Seed Data (Optional)

```bash
# Seed with real hooks from blockchain
pnpm --filter @hookscope/indexer seed

# Backfill analytics (TVL, pool count, etc.)
pnpm --filter @hookscope/indexer backfill
```

### 6. Stop

```bash
./stop.sh
```

---

## Environment Variables

Create a `.env` file at the project root:

```env
# ── Database ──────────────────────────────────────────────────────
DATABASE_URL="postgresql://hookscope:hookscope@localhost:5432/hookscope"
REDIS_URL="redis://localhost:6379"

# ── Blockchain RPC ────────────────────────────────────────────────
# Recommended: Alchemy (free 300M CU/month) — https://dashboard.alchemy.com/
ETHEREUM_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
ARBITRUM_RPC_URL="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"
OPTIMISM_RPC_URL="https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Or use public fallbacks (may timeout for eth_call):
# ETHEREUM_RPC_URL="https://eth.llamarpc.com"

# ── The Graph ─────────────────────────────────────────────────────
# Get free API key at https://thegraph.com/studio
# Required for real-time ETH/USDC prices on Ethereum + Arbitrum
GRAPH_API_KEY="your_32_char_hex_key"

# ── Etherscan ─────────────────────────────────────────────────────
# For verified source code + ABI fetching
ETHERSCAN_API_KEY="your_etherscan_api_key"

# ── Server ────────────────────────────────────────────────────────
API_PORT=3001
CORS_ORIGIN="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
NODE_ENV="development"
```

> **Note:** Never commit your `.env` file. It is listed in `.gitignore`.

---

## API Reference

Base URL: `http://localhost:3001`

### Hooks

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hooks` | List hooks with filtering, sorting, and pagination |
| `GET` | `/api/hooks/:address` | Full hook detail (callbacks, pools, source, security) |
| `GET` | `/api/hooks/:address/source` | Verified source code files |
| `GET` | `/api/hooks/:address/security` | Security report + risk flags |
| `GET` | `/api/hooks/:address/pools` | All pools using this hook |
| `GET` | `/api/hooks/compare?addresses=` | Side-by-side hook comparison |

**Query parameters for `/api/hooks`:**

| Param | Type | Description |
|---|---|---|
| `q` | `string` | Full-text search (name, address, description) |
| `chain` | `number` | Filter by chainId: `1`, `8453`, `42161`, `10` |
| `auditStatus` | `string` | `AUDITED`, `UNAUDITED`, `FLAGGED` |
| `riskLevel` | `string` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `callbacks` | `string` | Comma-separated callback names (e.g. `beforeSwap,afterSwap`) |
| `sortBy` | `string` | `tvl`, `newest`, `riskScore`, `poolCount` |
| `page` | `number` | Page number (default: `1`) |
| `limit` | `number` | Results per page (default: `20`, max: `100`) |

### Analytics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/global` | Platform-wide KPIs |
| `GET` | `/api/analytics/hook/:address` | Per-hook analytics (TVL, fee APY, pool state) |
| `GET` | `/api/analytics/pool-state/:address` | Live on-chain pool state (sqrtPrice, liquidity, fees) |
| `GET` | `/api/analytics/arbitrage` | Multi-chain ETH/USDC price + TVL snapshot |

### Other

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q=` | Semantic search across hooks |
| `GET` | `/api/stats` | Statistics (counts, TVL, chain distribution) |
| `GET` | `/health` | Health check |

### Example: Arbitrage Response

```json
{
  "timestamp": "2026-06-07T19:00:00Z",
  "chains": [
    {
      "chainId": 1,
      "name": "Ethereum",
      "price": 1629.64,
      "source": "graph",
      "tvlUsd": 477226832,
      "tvlSource": "defillama",
      "fee": 500
    },
    {
      "chainId": 42161,
      "name": "Arbitrum",
      "price": 1631.77,
      "source": "graph",
      "tvlUsd": 29700581,
      "tvlSource": "defillama",
      "fee": 500
    }
  ],
  "maxSpread": 2.13,
  "maxSpreadPercent": 0.13,
  "feeThreshold": 0.05,
  "aboveFeeThreshold": true,
  "avgPrice": 1632.13
}
```

---

## HookScore™ Scoring System

HookScore™ is a 0–100 safety score where **higher is safer**. It starts at 100 and applies penalties based on risk signals detected during analysis.

| Signal | Penalty |
|---|---|
| Source code not verified | −30 |
| `SELFDESTRUCT` opcode present | −40 |
| `DELEGATECALL` opcode present | −25 |
| Upgradeable proxy pattern detected | −15 |
| Delta return callbacks active | −10 |
| Critical Slither finding | −20 per finding |
| High Slither finding | −10 per finding |
| Medium Slither finding | −5 per finding |
| **Bonus: Audited by reputable firm** | **+15** |

**Risk Levels:**

| Score | Level | Color |
|---|---|---|
| 80–100 | LOW | Green |
| 60–79 | MEDIUM | Yellow |
| 40–59 | HIGH | Orange |
| 0–39 | CRITICAL | Red |

---

## Supported Chains

| Chain | Chain ID | PoolManager Address |
|---|---|---|
| Ethereum Mainnet | `1` | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Base | `8453` | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Arbitrum One | `42161` | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |
| Optimism | `10` | `0x9a13F98Cb987694C9F086b1F5eB990Eea8264Ec3` |
| Sepolia (testnet) | `11155111` | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Base Sepolia (testnet) | `84532` | `0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829` |

---

## Pages & Features

### Explorer (`/`)
The main hook directory. Search by name or address, filter by chain / risk level / callbacks, sort by TVL or newest. Each hook card shows its callbacks, risk badge, pool count, and TVL.

### Hook Detail (`/hooks/:address`)
Full analysis report for a single hook:
- **Callbacks panel** — which lifecycle events it intercepts, with documentation
- **Pools table** — all pools using this hook, with TVL and fee
- **Security report** — bytecode flags, proxy detection, Slither findings, HookScore™
- **Source viewer** — verified Solidity source files with syntax highlighting
- **ABI Explorer** — browse and interact with the contract ABI
- **Live pool state** — real-time on-chain `sqrtPrice`, `tick`, `liquidity`, fee APY

### Arbitrage Tracker (`/arbitrage`)
Real-time multi-chain ETH/USDC price comparison:
- **Line chart** — price history per chain (zigzag style with bubble dots sized by swap volume)
- **TVL bar chart** — relative TVL per chain, updated every 6 seconds
- **Chain table** — auto-sorted by TVL (highest first), with real-time ▲/▼ change badges
- **Max spread** — largest price difference across chains at each moment

Data sources:
- **Ethereum & Arbitrum**: real `sqrtPriceX96` from The Graph subgraphs (source: `graph`)
- **Base & Optimism**: DeFiLlama spot price + chain-specific sine-wave simulation (source: `estimated`)
- **TVL**: DeFiLlama `api.llama.fi/protocol/uniswap-v4` with 2-minute cache

### Compare (`/compare`)
Side-by-side comparison of two hook addresses. Highlights differences in callbacks, risk signals, TVL, and pool count.

### Security (`/security`)
Leaderboard of the highest-risk hooks across all chains. Flags hooks with SELFDESTRUCT, DELEGATECALL, unverified source, or critical Slither findings.

### Developer Tools (`/developer`)
- Hook callback reference guide with parameter descriptions and use cases
- Code snippets for integrating hooks in Solidity
- Callback event flow diagram

### Stats (`/stats`)
Platform-wide metrics: total hooks indexed, pools, TVL across all chains, hook distribution by risk level and chain.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/HookScope.git

# Create a feature branch
git checkout -b feat/your-feature

# Make changes, then commit
git add .
git commit -m "feat: describe your change"

# Push and open a PR
git push origin feat/your-feature
```

Please follow the existing code style (TypeScript strict mode, no `any`).

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

*Built for the Uniswap v4 ecosystem. HookScope is not affiliated with Uniswap Labs.*
