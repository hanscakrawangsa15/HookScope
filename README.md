# 🔍 HookScope

**Uniswap v4 Hook Transparency Platform**

Platform web untuk memvisualisasikan, menganalisis, dan mengkatalogkan semua Hook Uniswap v4 — termasuk yang tidak terverifikasi dan proxy. Tidak ada hook yang bisa disembunyikan.

---

## Arsitektur

```
hookscope/
├── apps/
│   ├── web/          # Next.js 14 + TypeScript + Tailwind (frontend)
│   └── api/          # Hono.js + Prisma REST API
├── packages/
│   ├── shared/       # Types, constants, hook flag decoder, Prisma schema
│   ├── indexer/      # Blockchain event indexer (viem + PoolManager)
│   ├── analyzer/     # Bytecode + source analyzer, proxy detector
│   └── scanner/      # Slither static analysis wrapper
├── docker/
│   └── docker-compose.yml  # PostgreSQL + Redis
└── .env.example
```

## Cara Kerja Ekstraksi Hook

### Layer 1 — Event Indexing (tidak bisa disembunyikan)
Semua pool dibuat via `PoolManager.Initialize` event yang wajib di-emit oleh core contract Uniswap. Field `hooks` di event ini mengandung address hook — tidak ada cara untuk membuat pool tanpa memanggil PoolManager.

### Layer 2 — Address Bitmask Decode (deterministik)
14 bit terakhir dari hook address meng-encode secara deterministik callback mana yang aktif. Ini divalidasi oleh PoolManager saat pool dibuat — tidak bisa dipalsukan.

```
Bit 13: beforeInitialize      Bit 6:  afterSwap
Bit 12: afterInitialize       Bit 5:  beforeDonate
Bit 11: beforeAddLiquidity    Bit 4:  afterDonate
Bit 10: afterAddLiquidity     Bit 3:  beforeSwapReturnsDelta
Bit  9: beforeRemoveLiquidity Bit 2:  afterSwapReturnsDelta
Bit  8: afterRemoveLiquidity  Bit 1:  afterAddLiquidityReturnsDelta
Bit  7: beforeSwap            Bit 0:  afterRemoveLiquidityReturnsDelta
```

### Layer 3 — Proxy Detection
Deteksi EIP-1967, EIP-1822, dan EIP-1167 minimal proxy untuk resolve ke implementation address yang sesungguhnya.

### Layer 4 — Bytecode Analysis
Bahkan tanpa source code terverifikasi, kita analisa:
- SELFDESTRUCT / DELEGATECALL opcode
- Function selectors via PUSH4 pattern
- Lookup ke 4byte.directory

### Layer 5 — Source + ABI (Etherscan)
Jika terverifikasi, fetch full source code dan ABI untuk analisis mendalam.

### Layer 6 — Static Analysis (Slither)
Jika ada source code, jalankan Slither untuk vulnerability detection otomatis.

---

## Quick Start

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- Docker

### Setup

```bash
# Clone dan install
git clone <repo>
cd hookscope
pnpm install

# Copy env
cp .env.example .env
# Edit .env — tambahkan RPC URL dan Etherscan API key

# Start database
pnpm docker:up

# Push schema ke database
cd packages/shared && npx prisma db push && cd ../..

# Build shared package
cd packages/shared && pnpm build && cd ../..
```

### Development

```bash
# Terminal 1: API server
cd apps/api && pnpm dev

# Terminal 2: Frontend
cd apps/web && pnpm dev

# Terminal 3: Blockchain indexer (butuh RPC URL)
cd packages/indexer && pnpm dev
```

Frontend berjalan di http://localhost:3000  
API berjalan di http://localhost:3001

### API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/hooks` | List hooks dengan filter/search/pagination |
| GET | `/api/hooks/:address` | Hook detail lengkap |
| GET | `/api/hooks/:address/source` | Source code files |
| GET | `/api/hooks/:address/security` | Security report + flags |
| GET | `/api/hooks/:address/pools` | Pools yang menggunakan hook ini |
| GET | `/api/hooks/compare?addresses=` | Side-by-side comparator |
| GET | `/api/search?q=` | Semantic search |
| GET | `/api/stats` | Platform statistics |
| GET | `/health` | Health check |

### Query Parameters untuk `/api/hooks`

| Param | Tipe | Deskripsi |
|-------|------|-----------|
| `q` | string | Full-text + semantic search |
| `chain` | number | Filter by chainId (1, 8453, 42161, 10) |
| `auditStatus` | string | AUDITED, UNAUDITED, FLAGGED |
| `riskLevel` | string | LOW, MEDIUM, HIGH, CRITICAL |
| `callbacks` | string | Comma-separated callback names |
| `sortBy` | string | tvl, newest, riskScore, poolCount |
| `page` / `limit` | number | Pagination |

---

## HookScore™

Skor keamanan 0–100 (makin tinggi = makin aman):

| Faktor | Penalti |
|--------|---------|
| Source tidak terverifikasi | −30 |
| SELFDESTRUCT opcode | −40 |
| DELEGATECALL opcode | −25 |
| Upgradeable proxy | −15 |
| Delta returns | −10 |
| Critical Slither finding | −20 per finding |
| High Slither finding | −10 per finding |
| **Audit oleh firma reputable** | **+15** |

---

## Security Scanner (Opsional)

Untuk full Slither analysis, install Python dan Slither:

```bash
pip install slither-analyzer
```

Slither akan otomatis digunakan saat source code tersedia.

---

## Chain Support

| Chain | ChainId | PoolManager Address |
|-------|---------|---------------------|
| Ethereum Mainnet | 1 | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Base | 8453 | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Arbitrum One | 42161 | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |
| Optimism | 10 | `0x9a13F98Cb987694C9F086b1F5eB990Eea8264Ec3` |
| Sepolia | 11155111 | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Base Sepolia | 84532 | `0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829` |

---

*HookScope PRD v1.0 — Juni 2025 | Tim Produk HookScope*
