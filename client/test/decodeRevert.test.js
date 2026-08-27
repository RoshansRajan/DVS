import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { decodeRevert } from "../src/contract.js";

const iface = new Interface([
  "error NotRegistered()",
  "error AlreadyVoted()",
  "error VotingNotOpen()",
  "error VotingClosed()",
]);

// Selector for AlreadyVoted(), as returned by the node.
const ALREADY_VOTED = iface.getError("AlreadyVoted").selector;
const VOTING_CLOSED = iface.getError("VotingClosed").selector;

test("decodes a revert whose data is a plain hex string", () => {
  const message = decodeRevert({ data: ALREADY_VOTED }, iface);
  assert.match(message, /already cast its ballot/i);
});

test("decodes a Hardhat node revert, where data is an object wrapping the selector", () => {
  // This is the shape `hardhat node` actually returns over JSON-RPC:
  // error.data is an object, not a string.
  const error = {
    code: -32603,
    data: {
      message: "Error: VM Exception while processing transaction: reverted with custom error 'AlreadyVoted()'",
      data: ALREADY_VOTED,
    },
  };
  const message = decodeRevert(error, iface);
  assert.match(message, /already cast its ballot/i);
});

test("decodes a MetaMask-style revert nested under info.error.data", () => {
  const message = decodeRevert({ info: { error: { data: VOTING_CLOSED } } }, iface);
  assert.match(message, /voting has closed/i);
});

test("reports a user-rejected transaction distinctly", () => {
  const message = decodeRevert({ code: "ACTION_REJECTED" }, iface);
  assert.match(message, /rejected the transaction/i);
});

test("falls back to the error message when nothing is decodable", () => {
  const message = decodeRevert({ message: "network unreachable" }, iface);
  assert.equal(message, "network unreachable");
});

test("never throws on an unrecognised selector", () => {
  assert.doesNotThrow(() => decodeRevert({ data: "0xdeadbeef" }, iface));
});
