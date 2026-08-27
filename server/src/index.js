import "dotenv/config";
import express from "express";
import cors from "cors";
import { getContract, loadDeployment, toNumber, NotDeployedError } from "./chain.js";

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

/** Turns a missing deployment into a 503 instead of a 500 or, worse, fake data. */
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof NotDeployedError) {
        return res.status(503).json({ error: "contract_not_deployed", message: error.message });
      }
      console.error(error);
      res.status(500).json({ error: "internal_error", message: error.message });
    }
  };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * Address + ABI, so the client can be rebuilt-free across redeploys.
 * This is the only bootstrapping the frontend needs from the server; every
 * read and write after this can go straight to the chain.
 */
app.get(
  "/api/config",
  handle(async (req, res) => {
    const { address, abi, chainId, network } = loadDeployment();
    res.json({ address, abi, chainId, network });
  })
);

app.get(
  "/api/election",
  handle(async (req, res) => {
    const { contract, deployment } = getContract();
    const [title, admin, startTime, endTime, totalVotes, registeredCount, open] = await Promise.all([
      contract.title(),
      contract.admin(),
      contract.startTime(),
      contract.endTime(),
      contract.totalVotes(),
      contract.registeredCount(),
      contract.votingOpen(),
    ]);

    res.json({
      address: deployment.address,
      title,
      admin,
      startTime: toNumber(startTime),
      endTime: toNumber(endTime),
      totalVotes: toNumber(totalVotes),
      registeredCount: toNumber(registeredCount),
      votingOpen: open,
    });
  })
);

/**
 * A convenience mirror of the on-chain tally, NOT an authority over it.
 * Anyone can verify this response by calling getResults() themselves.
 */
app.get(
  "/api/results",
  handle(async (req, res) => {
    const { contract, deployment } = getContract();
    const [names, counts] = await contract.getResults();
    const totalVotes = toNumber(await contract.totalVotes());

    res.json({
      source: "chain",
      contract: deployment.address,
      totalVotes,
      results: names.map((name, id) => ({
        id,
        name,
        votes: toNumber(counts[id]),
      })),
    });
  })
);

app.get(
  "/api/voter/:address",
  handle(async (req, res) => {
    const { address } = req.params;
    const { contract } = getContract();

    const [registered, voted] = await Promise.all([
      contract.isRegistered(address),
      contract.hasVoted(address),
    ]);

    res.json({ address, isRegistered: registered, hasVoted: voted });
  })
);

app.use((req, res) => res.status(404).json({ error: "not_found" }));

app.listen(PORT, () => {
  console.log(`DVS API listening on http://localhost:${PORT}`);
});

export default app;
