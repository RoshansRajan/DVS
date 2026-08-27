const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

const TITLE = "DVS Demo Election 2026";
const CANDIDATES = ["Ada Lovelace", "Grace Hopper", "Alan Turing"];
const WINDOW_SECONDS = 7 * 24 * 60 * 60; // one week

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  const latestBlock = await ethers.provider.getBlock("latest");
  const startTime = latestBlock.timestamp;
  const endTime = startTime + WINDOW_SECONDS;

  console.log(`Deploying Voting to "${network.name}" as ${deployer.address}`);

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(TITLE, CANDIDATES, startTime, endTime);
  await voting.waitForDeployment();
  const address = await voting.getAddress();
  console.log(`  Voting deployed at ${address}`);

  // On a local chain, pre-register the built-in dev accounts so the UI is usable
  // immediately. On a real network the admin would register real addresses.
  const roll = signers.slice(0, 5).map((s) => s.address);
  if (network.name === "localhost" || network.name === "hardhat") {
    await (await voting.registerVoters(roll)).wait();
    console.log(`  Registered ${roll.length} demo voters`);
  }

  const { abi } = await artifacts.readArtifact("Voting");
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    admin: deployer.address,
    title: TITLE,
    candidates: CANDIDATES,
    startTime,
    endTime,
    registeredDemoVoters: network.name === "localhost" || network.name === "hardhat" ? roll : [],
    deployedAt: new Date().toISOString(),
    abi,
  };

  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log(`  Wrote ${path.relative(process.cwd(), outFile)}`);
  console.log(`  Voting window: ${new Date(startTime * 1000).toISOString()} -> ${new Date(endTime * 1000).toISOString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
