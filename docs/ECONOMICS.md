# Reward economics

Level L needs `XP_L = 50·L·(L+1)` XP, i.e. `L·(L+1)` counted contributions.
Reaching level L pays `R(L) = 5·1.08^L` UCN, so the cumulative reward is
`S(L) = 67.5·(1.08^L − 1)` UCN. `S(20) = 247.1`, `S(100) = 148,416.4`.

How many contributors can the treasury carry to a given level?

| Level | Contributions | S(L) UCN | v1.0 treasury (700,000.7) | v1.1 treasury (70,000,000) |
|---:|---:|---:|---:|---:|
| 1 | 2 | 5.4 | 129,630 | 12,962,963 |
| 5 | 30 | 31.7 | 22,096 | 2,209,621 |
| 10 | 110 | 78.2 | 8,948 | 894,827 |
| 20 | 420 | 247.1 | 2,833 | 283,269 |
| 50 | 2,550 | 3,098.4 | 226 | 22,593 |
| 100 | 10,100 | 148,416.4 | 4.7 | 471.6 |

UserDatabase tracks `totalEarned` against `rewardBudget` (= the treasury) and pays a partial
reward when the remainder runs short, so promised rewards never exceed tokens held.

Per-contribution yield while climbing to level L is `R(L)/(2L) = 2.5·1.08^L/L` UCN; it falls
from 2.7 at level 1 to a minimum of 0.52 at level 13 and rises to 55 at level 100. The tail
rewards very high volume, which is the main gaming risk (see paper, Sec. V).
