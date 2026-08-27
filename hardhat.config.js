require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // `npx hardhat node` serves here; MetaMask connects to the same endpoint.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};
