# BlockSource: Code to Crypto (Udyamita)

Rewards open-source contributors with on-chain XP, levels and UCoin (UCN), an ERC-20 token on
Ethereum Sepolia. A contributor proves who they are on GitHub, binds that account to a wallet,
and earns XP for their all-time public GitHub contributions; levels pay UCN from a fixed treasury.

> **v1.1** fixes the problems found in v1.0 — see [`docs/AUDIT.md`](docs/AUDIT.md).
> If you ran v1.0, **revoke the GitHub OAuth client secret** that was committed in `Frontend/server.js`.

## How it works

1. **Connect MetaMask** and **sign in with GitHub** (`read:user` scope only).
2. The backend signs an EIP-712 attestation `Bind(wallet, githubId, login, deadline)`;
   you submit `UserDatabase.register(...)` from your wallet. One GitHub account ↔ one wallet.
3. The backend counts your **all-time public** commits, pull requests, issues and reviews and calls
   `syncXP` (on demand and every 6 h in batches). XP = 50 × count and never decreases.
4. The contract computes your level (`XP_n = 50·n·(n+1)`, 100 levels, 21 titles) and credits
   `5 · 1.08^L` UCN for every level reached. Reviewer role from 21,000 XP (level 20).
5. Withdraw up to what you have earned; `RewardMechanism` enforces the limit on chain.
   Requests above `instantLimit` wait for owner review.

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind, shadcn/ui, ethers v6 |
| Backend | Node.js, Express, ethers v6 (OAuth, attestation, XP sync) |
| Contracts | Solidity 0.8.26, OpenZeppelin 5, Hardhat |
| Network | Ethereum Sepolia |

## Repository layout

```
Blockchain/   contracts (v1.1) + contracts/legacy (v1.0 as deployed), tests, deploy & gas scripts
Backend/      OAuth + attestation + XP sync service (replaces Frontend/server.js)
Frontend/     React app
docs/         AUDIT.md, ECONOMICS.md
```

## Setup

```bash
# 1. Contracts
cd Blockchain && npm install
npx hardhat test                      # 71 tests (add SOLC_FROM_NPM=1 when offline)
cp .env.example .env                  # SEPOLIA_RPC_URL, PRIVATE_KEY, DEV_WALLET, ATTESTER_ADDRESS, XP_UPDATER_ADDRESS
npm run deploy:sepolia                # writes deployments/sepolia.json and Frontend/src/abis/*

# 2. Backend
cd ../Backend && npm install && npm test
cp .env.example .env                  # GitHub OAuth app, API token, keys, USER_DATABASE_ADDRESS
npm start                             # :5000

# 3. Frontend
cd ../Frontend && npm install
cp .env.example .env                  # contract addresses from deployments/sepolia.json
npm run dev                           # :8080 (proxies /auth and /api to :5000)
```

GitHub OAuth app callback URL: `http://localhost:8080/auth/github/callback` (through the Vite proxy).

## Tokenomics

- 100,000,000 UCN, fixed, minted once: 70% to the RewardMechanism treasury, 30% to the dev wallet.
- Contracts are **not** upgradeable; changing rules means deploying new contracts.
- v1.0 on Sepolia used 1,000,001 UCN; see [`docs/ECONOMICS.md`](docs/ECONOMICS.md) for why that was too small.

## License

MIT
