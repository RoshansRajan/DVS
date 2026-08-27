const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 60 * 60;
const CANDIDATES = ["Ada Lovelace", "Grace Hopper", "Alan Turing"];

/**
 * Deploys a Voting contract whose window is relative to the current block time.
 * `offsetStart`/`offsetEnd` are seconds from now, so a test can open the poll
 * in the past, the present, or the future without touching the clock.
 */
async function deployVoting({ offsetStart = 0, offsetEnd = HOUR } = {}) {
  const [admin, alice, bob, carol, stranger] = await ethers.getSigners();
  const now = await time.latest();
  const startTime = now + offsetStart;
  const endTime = now + offsetEnd;

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy("Board Election 2026", CANDIDATES, startTime, endTime);
  await voting.waitForDeployment();

  return { voting, admin, alice, bob, carol, stranger, startTime, endTime };
}

describe("Voting", function () {
  describe("deployment", function () {
    it("records the election title, candidates and window on chain", async function () {
      const { voting, admin, startTime, endTime } = await deployVoting();

      expect(await voting.title()).to.equal("Board Election 2026");
      expect(await voting.admin()).to.equal(admin.address);
      expect(await voting.startTime()).to.equal(startTime);
      expect(await voting.endTime()).to.equal(endTime);
      expect(await voting.candidatesCount()).to.equal(CANDIDATES.length);
    });

    it("starts every candidate at zero votes", async function () {
      const { voting } = await deployVoting();

      const [names, counts] = await voting.getResults();
      expect(names).to.deep.equal(CANDIDATES);
      expect(counts.map(Number)).to.deep.equal([0, 0, 0]);
      expect(await voting.totalVotes()).to.equal(0);
    });

    it("rejects a window that ends before it starts", async function () {
      const [, ] = await ethers.getSigners();
      const now = await time.latest();
      const Voting = await ethers.getContractFactory("Voting");

      await expect(
        Voting.deploy("Bad window", CANDIDATES, now + HOUR, now + 60)
      ).to.be.revertedWithCustomError(Voting, "InvalidWindow");
    });

    it("rejects an election with no candidates", async function () {
      const now = await time.latest();
      const Voting = await ethers.getContractFactory("Voting");

      await expect(
        Voting.deploy("Empty ballot", [], now, now + HOUR)
      ).to.be.revertedWithCustomError(Voting, "NoCandidates");
    });
  });

  describe("registration", function () {
    it("lets the admin register a voter", async function () {
      const { voting, alice } = await deployVoting();

      await expect(voting.registerVoter(alice.address))
        .to.emit(voting, "VoterRegistered")
        .withArgs(alice.address);
      expect(await voting.isRegistered(alice.address)).to.equal(true);
    });

    it("registers a batch of voters in one transaction", async function () {
      const { voting, alice, bob, carol } = await deployVoting();

      await voting.registerVoters([alice.address, bob.address, carol.address]);

      expect(await voting.isRegistered(alice.address)).to.equal(true);
      expect(await voting.isRegistered(bob.address)).to.equal(true);
      expect(await voting.isRegistered(carol.address)).to.equal(true);
      expect(await voting.registeredCount()).to.equal(3);
    });

    it("blocks a non-admin from registering voters", async function () {
      const { voting, alice, bob } = await deployVoting();

      await expect(
        voting.connect(alice).registerVoter(bob.address)
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("rejects registering the same address twice", async function () {
      const { voting, alice } = await deployVoting();
      await voting.registerVoter(alice.address);

      await expect(
        voting.registerVoter(alice.address)
      ).to.be.revertedWithCustomError(voting, "AlreadyRegistered");
    });
  });

  describe("casting a ballot", function () {
    it("records the vote in contract storage and emits a receipt", async function () {
      const { voting, alice } = await deployVoting();
      await voting.registerVoter(alice.address);

      await expect(voting.connect(alice).vote(1))
        .to.emit(voting, "VoteCast")
        .withArgs(alice.address, 1);

      const [, counts] = await voting.getResults();
      expect(counts.map(Number)).to.deep.equal([0, 1, 0]);
      expect(await voting.totalVotes()).to.equal(1);
      expect(await voting.hasVoted(alice.address)).to.equal(true);
    });

    it("tallies votes from several voters independently", async function () {
      const { voting, alice, bob, carol } = await deployVoting();
      await voting.registerVoters([alice.address, bob.address, carol.address]);

      await voting.connect(alice).vote(0);
      await voting.connect(bob).vote(2);
      await voting.connect(carol).vote(0);

      const [, counts] = await voting.getResults();
      expect(counts.map(Number)).to.deep.equal([2, 0, 1]);
      expect(await voting.totalVotes()).to.equal(3);
      expect(await voting.winningCandidateId()).to.equal(0);
    });

    it("rejects a candidate id that does not exist", async function () {
      const { voting, alice } = await deployVoting();
      await voting.registerVoter(alice.address);

      await expect(
        voting.connect(alice).vote(CANDIDATES.length)
      ).to.be.revertedWithCustomError(voting, "InvalidCandidate");
    });
  });

  describe("one vote per address (enforced in the contract)", function () {
    it("reverts the second ballot from the same address", async function () {
      const { voting, alice } = await deployVoting();
      await voting.registerVoter(alice.address);
      await voting.connect(alice).vote(0);

      await expect(
        voting.connect(alice).vote(1)
      ).to.be.revertedWithCustomError(voting, "AlreadyVoted");
    });

    it("leaves the tally untouched after a rejected double vote", async function () {
      const { voting, alice } = await deployVoting();
      await voting.registerVoter(alice.address);
      await voting.connect(alice).vote(0);

      await expect(voting.connect(alice).vote(0)).to.be.reverted;

      const [, counts] = await voting.getResults();
      expect(counts.map(Number)).to.deep.equal([1, 0, 0]);
      expect(await voting.totalVotes()).to.equal(1);
    });

    it("rejects a ballot from an address that was never registered", async function () {
      const { voting, stranger } = await deployVoting();

      await expect(
        voting.connect(stranger).vote(0)
      ).to.be.revertedWithCustomError(voting, "NotRegistered");
    });

    it("does not exempt the admin from registration", async function () {
      const { voting, admin } = await deployVoting();

      await expect(
        voting.connect(admin).vote(0)
      ).to.be.revertedWithCustomError(voting, "NotRegistered");
    });
  });

  describe("time-bounded window (enforced in the contract)", function () {
    it("rejects a ballot cast before the window opens", async function () {
      const { voting, alice } = await deployVoting({ offsetStart: HOUR, offsetEnd: 2 * HOUR });
      await voting.registerVoter(alice.address);

      await expect(
        voting.connect(alice).vote(0)
      ).to.be.revertedWithCustomError(voting, "VotingNotOpen");
      expect(await voting.votingOpen()).to.equal(false);
    });

    it("accepts the ballot once the window opens", async function () {
      const { voting, alice, startTime } = await deployVoting({ offsetStart: HOUR, offsetEnd: 2 * HOUR });
      await voting.registerVoter(alice.address);

      await time.increaseTo(startTime + 1);

      await voting.connect(alice).vote(0);
      expect(await voting.totalVotes()).to.equal(1);
      expect(await voting.votingOpen()).to.equal(true);
    });

    it("rejects a ballot cast after the window closes", async function () {
      const { voting, alice, endTime } = await deployVoting();
      await voting.registerVoter(alice.address);

      await time.increaseTo(endTime + 1);

      await expect(
        voting.connect(alice).vote(0)
      ).to.be.revertedWithCustomError(voting, "VotingClosed");
      expect(await voting.votingOpen()).to.equal(false);
    });

    it("gives the admin no way to reopen a closed election", async function () {
      const { voting, endTime } = await deployVoting();
      await time.increaseTo(endTime + 1);

      expect(voting.interface.fragments.some((f) => f.name === "setEndTime")).to.equal(false);
      expect(voting.interface.fragments.some((f) => f.name === "extendVoting")).to.equal(false);
      expect(await voting.votingOpen()).to.equal(false);
    });
  });

  describe("auditability", function () {
    it("exposes every ballot as an event that reproduces the stored tally", async function () {
      const { voting, alice, bob, carol } = await deployVoting();
      await voting.registerVoters([alice.address, bob.address, carol.address]);
      await voting.connect(alice).vote(1);
      await voting.connect(bob).vote(1);
      await voting.connect(carol).vote(2);

      const events = await voting.queryFilter(voting.filters.VoteCast());
      expect(events).to.have.lengthOf(3);

      // Rebuild the tally from the log alone and compare with contract storage.
      const fromLogs = [0, 0, 0];
      for (const event of events) {
        fromLogs[Number(event.args.candidateId)] += 1;
      }
      const [, counts] = await voting.getResults();
      expect(fromLogs).to.deep.equal(counts.map(Number));
    });
  });
});
