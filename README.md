# DVS — Decentralized Voting System

An election where every ballot is an on-chain transaction. Eligibility and the
voting window are enforced inside the smart contract, and the tally lives in
contract storage — there is no server, admin, or database that counts votes.

**Stack:** Solidity 0.8.24 · Hardhat · ethers v6 · Express (Node.js) · React + Vite

---

## Why it's decentralized

| Property | How it's enforced |
|---|---|
| One vote per address | `mapping(address => bool) hasVoted`, checked in `vote()` before the tally is touched |
| Only eligible voters | `mapping(address => bool) isRegistered`, checked in `vote()` |
| Time-bounded voting | `block.timestamp` compared against immutable `startTime` / `endTime` |
| No central tallying authority | Counts live in `Candidate.voteCount`; no function can set, adjust, or clear a count |
| Independently auditable | Every ballot emits `VoteCast`; replaying the log reproduces the stored tally |

These are **protocol-level** guarantees, not UI validation. Someone who ignores
this React app and calls the contract directly from Etherscan or a script is
subject to exactly the same rules — which is the point. The frontend's checks
exist only to save the voter a wasted gas fee on a transaction that would revert.

The backend holds **no private key** and never writes to the chain. Its
`/api/results` endpoint is a convenience mirror of contract storage that anyone
can verify by calling `getResults()` themselves.

---

## Quick start

```bash
npm install

# terminal 1 — local chain (prints 20 funded dev accounts)
npm run chain

# terminal 2 — deploy, then start the API
npm run deploy:local
npm run dev:server        # http://localhost:4000

# terminal 3 — the web app
npm run dev:client        # http://localhost:5173
```

`deploy:local` writes `deployments/localhost.json` (address + ABI + window) and
pre-registers the first five dev accounts so the UI is usable immediately.

**To vote in the browser:** add the local network to MetaMask
(RPC `http://127.0.0.1:8545`, chain ID `31337`), import one of the private keys
printed by `npm run chain`, then connect the wallet and pick a candidate.

---

## Tests

```bash
npm test          # Solidity behaviour, 20 tests
npm run test:client   # revert decoding, 6 tests
npm run test:all
```

The contract suite is written against the claims above rather than against the
implementation. It proves, among other things, that:

- a second `vote()` from the same address reverts with `AlreadyVoted`, and the tally is unchanged
- a ballot before `startTime` reverts with `VotingNotOpen`, and the same ballot succeeds after the clock advances
- a ballot after `endTime` reverts with `VotingClosed`
- an unregistered address reverts with `NotRegistered` — including the admin, who gets no exemption
- no `setEndTime` / `extendVoting` function exists, so a closed election cannot be reopened
- the tally rebuilt from `VoteCast` logs alone matches contract storage

---

## Layout

```
contracts/Voting.sol     the election: registration, window, ballots, tally
test/Voting.test.js      behavioural suite for the guarantees above
scripts/deploy.js        deploys and writes deployments/<network>.json
server/                  Express read-only API (config, election, results, voter)
client/                  React + ethers wallet UI
```

### API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/config` | contract address + ABI, so redeploys need no frontend rebuild |
| `GET /api/election` | title, admin, window, open/closed, totals |
| `GET /api/results` | the tally, read from chain |
| `GET /api/voter/:address` | `isRegistered` / `hasVoted` for one address |

Returns `503 contract_not_deployed` when no deployment exists — it reports
nothing rather than guessing, since a guess would make it the authority this
design avoids.

---

## Known limitations

Honest scope notes, not oversights:

- **Registration is centralized.** The admin controls the electoral roll, so
  eligibility is trusted even though tallying is not. A Merkle-root allowlist or
  token-gated eligibility would remove this; it's out of scope here.
- **Ballots are public.** `VoteCast` is indexed by voter, so the chain reveals
  who voted for whom. Secret ballots need commit–reveal or zk proofs.
- **`block.timestamp` is proposer-influenceable** by a few seconds. Harmless for
  hour- or day-scale windows; don't reuse this pattern for second-precision timing.
- **One election per deployment.** Running a second election means deploying a
  second contract (or adding a factory).
- **Local network only** so far — no testnet deploy config or gas tuning yet.

## License

MIT
