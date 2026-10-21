# BlockSource 1.0 — audit and what v1.1 changes

Scope: `Blockchain/contracts/*.sol`, `Frontend/server.js`, `Frontend/src/**` at commit `22c0442`,
and the three contracts deployed on Sepolia in April 2025:

| Contract | Address | Activity (snapshot 21 Oct 2026) |
|---|---|---|
| UserDatabase | `0xe92cFff8436007F804F2ec05AF83851AD3dA9945` | 9 txs, all `setUser` (selector `0xd0020fad`); `updateUserXP` never called |
| RewardMechanism | `0xaF6b1E1A7A7A7D94FE7d571E269582e8F94EC561` | 36 txs (request/approve withdrawals); holds 699,974.7 UCN |
| UCoin | `0x383125a9312fbc54a62d08e1638628C6BB7B77f7` | supply 1,000,001 UCN, 6 holders |

Every contract finding below is reproduced by a passing test in
`Blockchain/test/legacy-audit.test.js`, which runs the v1.0 sources compiled exactly as deployed
(solc 0.8.20, optimizer off). Local gas for those sources matches Sepolia receipts within 0.6%
(`scripts/legacy-gas.js`).

## Findings

| # | Severity | Finding | Evidence | v1.1 fix |
|---|---|---|---|---|
| S1 | **Critical** | GitHub OAuth **client secret committed** in `Frontend/server.js` | source | Secret removed; read from env. **Revoke the old secret in GitHub settings.** |
| S2 | High | OAuth requests scope `repo` (read/write to all private repos) | `server.js` | `read:user` only |
| S3 | High | No OAuth `state` parameter (login CSRF) | `server.js` | random `state` in a signed session cookie |
| S4 | High | Access token returned to the browser in a URL query string and kept in `localStorage`; users can also paste any PAT | `server.js`, `Dashboard.jsx` | token used once server-side to read the account id, then discarded |
| F2 | **Critical** | `requestWithdrawal` accepts any amount from any wallet; only the owner's manual check prevents draining the treasury | test F2 | request capped at on-chain `earned - claimed` |
| F3 | High | `setUser(string)` lets any wallet claim any GitHub login | test F3 | EIP-712 attestation binds numeric GitHub id ↔ wallet one-to-one |
| F5 | High | XP, level and rewards are computed in the browser; on-chain XP is never updated (no backend calls `updateUserXP`) | test F5, Sepolia history | backend `syncXP`; level and earned UCN computed on chain |
| F6 | High | "Claimed" amount lives in `localStorage`, so clearing storage or using another browser re-opens the full allowance | `Dashboard.jsx`, test F6 | `claimed[user]` stored on chain |
| F4 | Medium | `updateUserXP` overwrites XP, so XP can fall | test F4 | monotonic `syncXP` |
| X1 | Medium | XP source is `contributionCalendar.totalContributions`: last 12 months only (XP decays), includes private contributions visible to the viewer's token | `Dashboard.jsx` | all-time public commits, PRs, issues and reviews, one server token |
| X2 | Medium | Leaderboard recomputes XP per viewer; without a token it substitutes `repos*10 + followers*5` | `Leaderboard.jsx` | ranking by on-chain XP |
| X3 | Medium | On-chain usernames are interpolated into a GraphQL query string | `Leaderboard.jsx` | login passed as a GraphQL variable |
| F7 | Medium | `removeUser` deletes history; the wallet can re-register from zero | test F7 | `setSuspended` keeps history |
| F8 | Low | `getAllUsers` is unbounded: ~13,470 gas per user, so `eth_call` hits a 50M RPC gas cap at ~3,700 users | test F8 | paginated `getUsers` |
| F1 | Low | Supply 1,000,001 UCN; 700,000.7 UCN treasury funds only 4.7 users to level 100 | test F1, ECONOMICS.md | 100,000,000 UCN (as specified in the paper) |
| M1 | Low | Role in the UI uses contribution counts (>50 Reviewer, >100 Maintainer); README says 15,000 XP; paper says 21,000 XP | sources | single rule on chain: Reviewer at 21,000 XP (level 20) |
| M2 | Low | Hand-written ERC-20; `ReentrancyGuard` on a token without hooks; no chain-id check in the UI | sources | OpenZeppelin ERC-20, checks-effects-interactions, wallet chain switch |
| M3 | Info | README says contracts are "upgradeable"; they are not | README | README corrected |

## Unchanged by design
- XP rule: 50 XP per contribution, `XP_n = 50·n·(n+1)`, 100 levels.
- Reward rule: `5 · 1.08^L` UCN on reaching level L (as in v1.0's `Dashboard.jsx`).
- 70% treasury / 30% developer split, owner review of withdrawals (now optional below `instantLimit`).
- The 21 titles of v1.0 (Apprentice … Legendary, Supreme), title index `floor(level/5)`.
