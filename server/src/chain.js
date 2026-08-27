import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NETWORK = process.env.NETWORK ?? "localhost";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYMENTS_DIR = path.resolve(__dirname, "..", "..", "deployments");

/**
 * Thrown when the API is asked for chain data before a contract exists.
 * The server deliberately has no fallback data: reporting a guess as a result
 * would make it exactly the central tallying authority this project avoids.
 */
export class NotDeployedError extends Error {
  constructor(file) {
    super(`No deployment found at ${file}. Run: npm run deploy:local`);
    this.name = "NotDeployedError";
  }
}

export function loadDeployment() {
  const file = path.join(DEPLOYMENTS_DIR, `${NETWORK}.json`);
  if (!fs.existsSync(file)) throw new NotDeployedError(file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * A read-only contract handle. There is no signer here and no private key in
 * this process: the server can read the ledger but can never cast or alter a
 * ballot. Every write goes through the voter's own wallet in the browser.
 */
export function getContract() {
  const deployment = loadDeployment();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(deployment.address, deployment.abi, provider);
  return { contract, deployment, provider };
}

/** ethers returns bigint for uint256; JSON.stringify cannot serialise those. */
export function toNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}
