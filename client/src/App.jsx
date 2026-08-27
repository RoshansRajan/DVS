import { useCallback, useEffect, useMemo, useState } from "react";
import { Interface } from "ethers";
import { useWallet } from "./useWallet.js";
import {
  fetchConfig,
  signerContract,
  decodeRevert,
  formatAddress,
  formatWindow,
} from "./contract.js";

export default function App() {
  const { account, chainId, connect, connecting, error: walletError, hasWallet } = useWallet();

  const [config, setConfig] = useState(null);
  const [election, setElection] = useState(null);
  const [results, setResults] = useState([]);
  const [voter, setVoter] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const iface = useMemo(() => (config ? new Interface(config.abi) : null), [config]);

  /** Everything here is a read of public chain state — no wallet required. */
  const refresh = useCallback(async () => {
    try {
      const [electionRes, resultsRes] = await Promise.all([
        fetch("/api/election"),
        fetch("/api/results"),
      ]);
      if (!electionRes.ok) {
        const body = await electionRes.json().catch(() => ({}));
        throw new Error(body.message ?? "Could not load the election.");
      }
      setElection(await electionRes.json());
      setResults((await resultsRes.json()).results ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchConfig().then(setConfig).catch((err) => setLoadError(err.message));
    refresh();
  }, [refresh]);

  // Eligibility is read straight from the contract, so a voter can verify their
  // own standing before spending gas on a ballot that would revert.
  useEffect(() => {
    if (!account) return setVoter(null);
    fetch(`/api/voter/${account}`)
      .then((r) => r.json())
      .then(setVoter)
      .catch(() => setVoter(null));
  }, [account, election?.totalVotes]);

  async function castVote(candidateId) {
    setStatus(null);
    setPendingId(candidateId);
    try {
      const contract = await signerContract(config);
      // Simulate first: a revert surfaces here as a decodable error rather than
      // as a failed transaction the voter has already paid for.
      await contract.vote.staticCall(candidateId);
      const tx = await contract.vote(candidateId);
      setStatus({ kind: "pending", message: `Ballot submitted. Awaiting confirmation…`, hash: tx.hash });
      const receipt = await tx.wait();
      setStatus({
        kind: "success",
        message: `Ballot recorded on chain in block ${receipt.blockNumber}.`,
        hash: tx.hash,
      });
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", message: decodeRevert(err, iface) });
    } finally {
      setPendingId(null);
    }
  }

  const totalVotes = election?.totalVotes ?? 0;
  const canVote = Boolean(account && election?.votingOpen && voter?.isRegistered && !voter?.hasVoted);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Decentralized Voting System</h1>
          <p className="subtitle">
            Every ballot is an on-chain transaction. No server tallies the result.
          </p>
        </div>
        <WalletButton
          account={account}
          chainId={chainId}
          connect={connect}
          connecting={connecting}
          hasWallet={hasWallet}
        />
      </header>

      {walletError && <Banner kind="error">{walletError}</Banner>}
      {loadError && (
        <Banner kind="error">
          {loadError} <span className="hint">Start the chain, deploy, then start the API.</span>
        </Banner>
      )}

      {election && (
        <section className="card">
          <h2>{election.title}</h2>
          <dl className="meta">
            <div>
              <dt>Contract</dt>
              <dd className="mono">{election.address}</dd>
            </div>
            <div>
              <dt>Voting window</dt>
              <dd>{formatWindow(election.startTime, election.endTime)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className={election.votingOpen ? "open" : "closed"}>
                {election.votingOpen ? "Open" : "Closed"}
              </dd>
            </div>
            <div>
              <dt>Ballots cast</dt>
              <dd>
                {totalVotes} of {election.registeredCount} registered
              </dd>
            </div>
          </dl>
        </section>
      )}

      {account && <EligibilityNotice voter={voter} election={election} />}
      {status && (
        <Banner kind={status.kind}>
          {status.message}
          {status.hash && <span className="mono hash"> {formatAddress(status.hash)}</span>}
        </Banner>
      )}

      <section className="card">
        <h2>Ballot</h2>
        {results.length === 0 && <p className="muted">No candidates loaded.</p>}
        <ul className="candidates">
          {results.map((candidate) => {
            const share = totalVotes > 0 ? (candidate.votes / totalVotes) * 100 : 0;
            return (
              <li key={candidate.id} className="candidate">
                <div className="candidate-row">
                  <span className="candidate-name">{candidate.name}</span>
                  <span className="candidate-count">
                    {candidate.votes} {candidate.votes === 1 ? "vote" : "votes"}
                  </span>
                  <button
                    type="button"
                    onClick={() => castVote(candidate.id)}
                    disabled={!canVote || pendingId !== null}
                  >
                    {pendingId === candidate.id ? "Confirming…" : "Vote"}
                  </button>
                </div>
                <div className="bar" aria-hidden="true">
                  <div className="bar-fill" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="footer">
        <p>
          Results here mirror contract storage. Verify them yourself by calling{" "}
          <code>getResults()</code> on the contract — this app is a convenience, not an authority.
        </p>
      </footer>
    </main>
  );
}

function WalletButton({ account, chainId, connect, connecting, hasWallet }) {
  if (!hasWallet) {
    return (
      <a className="wallet" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install a wallet
      </a>
    );
  }
  if (account) {
    return (
      <div className="wallet connected">
        <span className="mono">{formatAddress(account)}</span>
        <span className="chain">chain {chainId ?? "?"}</span>
      </div>
    );
  }
  return (
    <button type="button" className="wallet" onClick={connect} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

/** Tells the voter what the contract would do before they spend gas finding out. */
function EligibilityNotice({ voter, election }) {
  if (!voter) return null;
  if (!voter.isRegistered) {
    return <Banner kind="warn">This wallet is not registered for this election.</Banner>;
  }
  if (voter.hasVoted) {
    return <Banner kind="info">Your ballot is already recorded. One vote per address.</Banner>;
  }
  if (election && !election.votingOpen) {
    return <Banner kind="warn">You are eligible, but the voting window is not open.</Banner>;
  }
  return <Banner kind="success">You are registered and have not voted yet.</Banner>;
}

function Banner({ kind, children }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}
