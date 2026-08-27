import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

/** Human-readable copy for each custom error the contract can revert with. */
const ERROR_MESSAGES = {
  NotRegistered: "This wallet is not on the electoral roll for this election.",
  AlreadyVoted: "This wallet has already cast its ballot. One vote per address.",
  VotingNotOpen: "Voting has not opened yet.",
  VotingClosed: "Voting has closed. Late ballots are rejected by the contract.",
  InvalidCandidate: "That candidate does not exist on this ballot.",
  NotAdmin: "Only the election admin can do that.",
  AlreadyRegistered: "That address is already registered.",
};

/** Fetches the deployed address + ABI so redeploys don't require a rebuild. */
export async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Could not load contract config (${response.status})`);
  }
  return response.json();
}

/** Read-only handle: works with no wallet connected at all. */
export function readOnlyContract(config, rpcUrl = "http://127.0.0.1:8545") {
  return new Contract(config.address, config.abi, new JsonRpcProvider(rpcUrl));
}

/** Write handle: signs with the user's own key, held only by their wallet. */
export async function signerContract(config) {
  if (!window.ethereum) throw new Error("No Ethereum wallet found. Install MetaMask to vote.");
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new Contract(config.address, config.abi, signer);
}

/**
 * Finds the 4-byte revert selector, which different providers bury at different
 * depths. Notably `hardhat node` returns `data` as an OBJECT ({ message, data })
 * rather than a hex string, so every candidate is checked for shape, not just
 * for presence — a nullish-coalescing chain would stop at the object and lose it.
 */
function extractRevertData(error) {
  const candidates = [
    error?.data,
    error?.data?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
    error?.error?.data,
    error?.error?.data?.data,
    error?.revert?.data,
  ];
  return candidates.find((value) => typeof value === "string" && value.startsWith("0x"));
}

/**
 * Turns a revert into the specific reason the contract gave, so the UI can say
 * "you already voted" instead of "transaction failed".
 */
export function decodeRevert(error, iface) {
  const data = extractRevertData(error);

  if (data) {
    try {
      const parsed = iface.parseError(data);
      if (parsed && ERROR_MESSAGES[parsed.name]) return ERROR_MESSAGES[parsed.name];
      if (parsed) return parsed.name;
    } catch {
      /* fall through to the generic paths below */
    }
  }

  if (error?.revert?.name && ERROR_MESSAGES[error.revert.name]) {
    return ERROR_MESSAGES[error.revert.name];
  }
  if (error?.code === "ACTION_REJECTED") return "You rejected the transaction in your wallet.";

  return error?.shortMessage ?? error?.message ?? "Transaction failed.";
}

export function formatAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatWindow(startTime, endTime) {
  const fmt = (s) => new Date(s * 1000).toLocaleString();
  return `${fmt(startTime)} → ${fmt(endTime)}`;
}
