import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

async function latestTimestamp() {
  return BigInt(await networkHelpers.time.latest());
}

async function futureTimestamp(offsetSeconds = 3600n) {
  return (await latestTimestamp()) + offsetSeconds;
}

async function deployFixture() {
  const [owner, holder, notary, recipient, stranger] = await ethers.getSigners();
  const token = await ethers.deployContract("HoldToken", [
    "Hold Token",
    "HOLD",
    1_000_000n,
  ]);

  await token.transfer(holder.address, 10_000n);

  return {
    token,
    owner,
    holder,
    notary,
    recipient,
    stranger,
  };
}

describe("HoldToken", function () {
  describe("createHold", function () {
    it("creates a hold and reduces available balance", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("create-hold-1");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 4_000n, await futureTimestamp());

      expect(await token.lockedBalanceOf(holder.address)).to.equal(4_000n);
      expect(await token.availableBalanceOf(holder.address)).to.equal(6_000n);
    });

    it("reverts if holdId already exists", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("create-hold-duplicate");
      const expiry = await futureTimestamp();

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, expiry);

      await expect(
        token
          .connect(holder)
          .createHold(holdId, holder.address, notary.address, 1_000n, expiry),
      ).to.be.revertedWith("Hold already exists");
    });

    it("reverts if holder has insufficient available balance", async function () {
      const { token, holder, notary } = await deployFixture();

      await expect(
        token
          .connect(holder)
          .createHold(
            ethers.id("create-hold-insufficient"),
            holder.address,
            notary.address,
            20_000n,
            await futureTimestamp(),
          ),
      ).to.be.revertedWith("Insufficient available balance");
    });

    it("reverts if expiry is in the past", async function () {
      const { token, holder, notary } = await deployFixture();
      const pastExpiry = (await latestTimestamp()) - 1n;

      await expect(
        token
          .connect(holder)
          .createHold(
            ethers.id("create-hold-past"),
            holder.address,
            notary.address,
            1_000n,
            pastExpiry,
          ),
      ).to.be.revertedWith("Expiry in past");
    });

    it("emits HoldCreated event with correct args", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("create-hold-event");
      const expiry = await futureTimestamp();

      await expect(
        token
          .connect(holder)
          .createHold(holdId, holder.address, notary.address, 1_500n, expiry),
      )
        .to.emit(token, "HoldCreated")
        .withArgs(holdId, holder.address, notary.address, 1_500n, expiry);
    });
  });

  describe("executeHold", function () {
    it("notary can execute hold and transfer tokens to recipient", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-1");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 2_500n, await futureTimestamp());

      await token.connect(notary).executeHold(holdId, recipient.address);

      const hold = await token.holds(holdId);
      expect(hold.status).to.equal(1n);
      expect(await token.balanceOf(recipient.address)).to.equal(2_500n);
    });

    it("executed hold reduces lockedBalance", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-locked-balance");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 3_000n, await futureTimestamp());
      await token.connect(notary).executeHold(holdId, recipient.address);

      expect(await token.lockedBalanceOf(holder.address)).to.equal(0n);
    });

    it("recipient receives correct amount", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-recipient");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_234n, await futureTimestamp());
      await token.connect(notary).executeHold(holdId, recipient.address);

      expect(await token.balanceOf(recipient.address)).to.equal(1_234n);
    });

    it("reverts if caller is not notary", async function () {
      const { token, holder, stranger } = await deployFixture();
      const holdId = ethers.id("execute-hold-notary");

      await token
        .connect(holder)
        .createHold(
          holdId,
          holder.address,
          stranger.address,
          1_000n,
          await futureTimestamp(),
        );

      await expect(
        token.connect(holder).executeHold(holdId, stranger.address),
      ).to.be.revertedWith("Caller is not the notary");
    });

    it("reverts if hold already executed", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-twice");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, await futureTimestamp());
      await token.connect(notary).executeHold(holdId, recipient.address);

      await expect(
        token.connect(notary).executeHold(holdId, recipient.address),
      ).to.be.revertedWith("Hold not executable");
    });

    it("reverts if hold already released", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-released");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, await futureTimestamp());
      await token.connect(holder).releaseHold(holdId);

      await expect(
        token.connect(notary).executeHold(holdId, recipient.address),
      ).to.be.revertedWith("Hold not executable");
    });

    it("reverts if hold is expired", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-expired");
      const expiry = await futureTimestamp(5n);

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, expiry);
      await networkHelpers.time.increaseTo(Number(expiry + 1n));

      await expect(
        token.connect(notary).executeHold(holdId, recipient.address),
      ).to.be.revertedWith("Hold expired");
    });

    it("emits HoldExecuted event", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("execute-hold-event");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 900n, await futureTimestamp());

      await expect(token.connect(notary).executeHold(holdId, recipient.address))
        .to.emit(token, "HoldExecuted")
        .withArgs(holdId, recipient.address);
    });
  });

  describe("releaseHold", function () {
    it("holder can release hold and restore available balance", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("release-hold-holder");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 3_500n, await futureTimestamp());
      await token.connect(holder).releaseHold(holdId);

      expect(await token.availableBalanceOf(holder.address)).to.equal(10_000n);
      expect((await token.holds(holdId)).status).to.equal(2n);
    });

    it("notary can release hold", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("release-hold-notary");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, await futureTimestamp());
      await token.connect(notary).releaseHold(holdId);

      expect(await token.lockedBalanceOf(holder.address)).to.equal(0n);
    });

    it("reverts if stranger tries to release", async function () {
      const { token, holder, notary, stranger } = await deployFixture();
      const holdId = ethers.id("release-hold-stranger");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, await futureTimestamp());

      await expect(token.connect(stranger).releaseHold(holdId)).to.be.revertedWith(
        "Caller cannot release hold",
      );
    });

    it("reverts if hold already executed", async function () {
      const { token, holder, notary, recipient } = await deployFixture();
      const holdId = ethers.id("release-hold-executed");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_000n, await futureTimestamp());
      await token.connect(notary).executeHold(holdId, recipient.address);

      await expect(token.connect(holder).releaseHold(holdId)).to.be.revertedWith(
        "Hold not releasable",
      );
    });

    it("emits HoldReleased event", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("release-hold-event");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 1_200n, await futureTimestamp());

      await expect(token.connect(holder).releaseHold(holdId))
        .to.emit(token, "HoldReleased")
        .withArgs(holdId);
    });
  });

  describe("reclaimHold", function () {
    it("anyone can reclaim after expiry", async function () {
      const { token, holder, notary, stranger } = await deployFixture();
      const holdId = ethers.id("reclaim-hold-anyone");
      const expiry = await futureTimestamp(5n);

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 2_000n, expiry);
      await networkHelpers.time.increaseTo(Number(expiry + 1n));

      await token.connect(stranger).reclaimHold(holdId);

      expect(await token.availableBalanceOf(holder.address)).to.equal(10_000n);
      expect((await token.holds(holdId)).status).to.equal(3n);
    });

    it("reverts if expiry not yet passed", async function () {
      const { token, holder, notary, stranger } = await deployFixture();
      const holdId = ethers.id("reclaim-hold-not-yet");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 2_000n, await futureTimestamp());

      await expect(token.connect(stranger).reclaimHold(holdId)).to.be.revertedWith(
        "Hold not expired",
      );
    });

    it("reverts if hold already executed", async function () {
      const { token, holder, notary, recipient, stranger } = await deployFixture();
      const holdId = ethers.id("reclaim-hold-executed");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 2_000n, await futureTimestamp());
      await token.connect(notary).executeHold(holdId, recipient.address);

      await expect(token.connect(stranger).reclaimHold(holdId)).to.be.revertedWith(
        "Hold not reclaimable",
      );
    });

    it("emits HoldReclaimed event", async function () {
      const { token, holder, notary, stranger } = await deployFixture();
      const holdId = ethers.id("reclaim-hold-event");
      const expiry = await futureTimestamp(5n);

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 2_000n, expiry);
      await networkHelpers.time.increaseTo(Number(expiry + 1n));

      await expect(token.connect(stranger).reclaimHold(holdId))
        .to.emit(token, "HoldReclaimed")
        .withArgs(holdId);
    });
  });

  describe("availableBalanceOf", function () {
    it("returns full balance when no holds active", async function () {
      const { token, holder } = await deployFixture();

      expect(await token.availableBalanceOf(holder.address)).to.equal(10_000n);
    });

    it("returns reduced balance when hold active", async function () {
      const { token, holder, notary } = await deployFixture();

      await token
        .connect(holder)
        .createHold(
          ethers.id("available-balance-active"),
          holder.address,
          notary.address,
          4_000n,
          await futureTimestamp(),
        );

      expect(await token.availableBalanceOf(holder.address)).to.equal(6_000n);
    });

    it("returns full balance after hold released", async function () {
      const { token, holder, notary } = await deployFixture();
      const holdId = ethers.id("available-balance-release");

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 4_000n, await futureTimestamp());
      await token.connect(holder).releaseHold(holdId);

      expect(await token.availableBalanceOf(holder.address)).to.equal(10_000n);
    });

    it("returns full balance after hold reclaimed", async function () {
      const { token, holder, notary, stranger } = await deployFixture();
      const holdId = ethers.id("available-balance-reclaim");
      const expiry = await futureTimestamp(5n);

      await token
        .connect(holder)
        .createHold(holdId, holder.address, notary.address, 4_000n, expiry);
      await networkHelpers.time.increaseTo(Number(expiry + 1n));
      await token.connect(stranger).reclaimHold(holdId);

      expect(await token.availableBalanceOf(holder.address)).to.equal(10_000n);
    });
  });

  describe("transfer restrictions", function () {
    it("holder cannot transfer locked tokens", async function () {
      const { token, holder, notary, recipient } = await deployFixture();

      await token
        .connect(holder)
        .createHold(
          ethers.id("transfer-locked"),
          holder.address,
          notary.address,
          9_000n,
          await futureTimestamp(),
        );

      await expect(
        token.connect(holder).transfer(recipient.address, 2_000n),
      ).to.be.revertedWith("Insufficient available balance");
    });

    it("holder can transfer available unlocked tokens", async function () {
      const { token, holder, notary, recipient } = await deployFixture();

      await token
        .connect(holder)
        .createHold(
          ethers.id("transfer-available"),
          holder.address,
          notary.address,
          9_000n,
          await futureTimestamp(),
        );

      await token.connect(holder).transfer(recipient.address, 1_000n);

      expect(await token.balanceOf(recipient.address)).to.equal(1_000n);
    });

    it("transferFrom also respects available balance", async function () {
      const { token, holder, notary, recipient, stranger } = await deployFixture();

      await token
        .connect(holder)
        .createHold(
          ethers.id("transfer-from-locked"),
          holder.address,
          notary.address,
          9_000n,
          await futureTimestamp(),
        );
      await token.connect(holder).approve(stranger.address, 5_000n);

      await expect(
        token.connect(stranger).transferFrom(holder.address, recipient.address, 2_000n),
      ).to.be.revertedWith("Insufficient available balance");

      await token.connect(stranger).transferFrom(holder.address, recipient.address, 1_000n);

      expect(await token.balanceOf(recipient.address)).to.equal(1_000n);
    });
  });

  describe("gas comparison", function () {
    it("measures gas for createHold, executeHold, releaseHold, and reclaimHold", async function () {
      const { token, holder, notary, recipient, stranger } = await deployFixture();

      const createHoldId = ethers.id("gas-create");
      const createTx = await token.connect(holder).createHold(
        createHoldId,
        holder.address,
        notary.address,
        500n,
        await futureTimestamp(),
      );
      const createReceipt = await createTx.wait();

      const executeHoldId = ethers.id("gas-execute");
      await token.connect(holder).createHold(
        executeHoldId,
        holder.address,
        notary.address,
        500n,
        await futureTimestamp(),
      );
      const executeTx = await token.connect(notary).executeHold(
        executeHoldId,
        recipient.address,
      );
      const executeReceipt = await executeTx.wait();

      const releaseHoldId = ethers.id("gas-release");
      await token.connect(holder).createHold(
        releaseHoldId,
        holder.address,
        notary.address,
        500n,
        await futureTimestamp(),
      );
      const releaseTx = await token.connect(holder).releaseHold(releaseHoldId);
      const releaseReceipt = await releaseTx.wait();

      const reclaimHoldId = ethers.id("gas-reclaim");
      const reclaimExpiry = await futureTimestamp(5n);
      await token.connect(holder).createHold(
        reclaimHoldId,
        holder.address,
        notary.address,
        500n,
        reclaimExpiry,
      );
      await networkHelpers.time.increaseTo(Number(reclaimExpiry + 1n));
      const reclaimTx = await token.connect(stranger).reclaimHold(reclaimHoldId);
      const reclaimReceipt = await reclaimTx.wait();

      console.log(
        `HoldToken gas snapshot: create=${createReceipt.gasUsed.toString()} execute=${executeReceipt.gasUsed.toString()} release=${releaseReceipt.gasUsed.toString()} reclaim=${reclaimReceipt.gasUsed.toString()}`,
      );

      expect(createReceipt.gasUsed).to.be.gt(0n);
      expect(executeReceipt.gasUsed).to.be.gt(0n);
      expect(releaseReceipt.gasUsed).to.be.gt(0n);
      expect(reclaimReceipt.gasUsed).to.be.gt(0n);
    });
  });
});
