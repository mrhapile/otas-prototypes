import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

function asciiToFixedBytes(value, expectedSize) {
  const bytes = ethers.toUtf8Bytes(value);

  if (bytes.length !== expectedSize) {
    throw new Error(
      `Expected "${value}" to be ${expectedSize} bytes, received ${bytes.length}`,
    );
  }

  return ethers.hexlify(bytes);
}

async function buildMetadata(overrides = {}) {
  const latestBlock = await ethers.provider.getBlock("latest");

  return {
    lei: asciiToFixedBytes("7H6GLXDRUGQFU57RNE97", 20),
    isin: asciiToFixedBytes("US0378331005", 12),
    cfi: asciiToFixedBytes("ESVUFR", 6),
    jurisdiction: asciiToFixedBytes("US", 2),
    investorCategory: 1,
    kycAttestationHash: ethers.keccak256(
      ethers.toUtf8Bytes(`kyc-${Math.random().toString(16).slice(2)}`),
    ),
    attestationExpiry: BigInt(latestBlock.timestamp + 3600),
    customRestrictionFlags: ethers.ZeroHash,
    ...overrides,
  };
}

async function deployFixture() {
  const [owner, buyer, seller, stranger] = await ethers.getSigners();
  const complianceModule = await ethers.deployContract("ComplianceModule", [
    owner.address,
  ]);
  const assetToken = await ethers.deployContract("HoldToken", [
    "Asset Token",
    "ASSET",
    1_000_000n,
  ]);
  const paymentToken = await ethers.deployContract("HoldToken", [
    "Payment Token",
    "CASH",
    1_000_000n,
  ]);
  const manager = await ethers.deployContract("DvPSettlementManager", [
    complianceModule.target,
    asciiToFixedBytes("US", 2),
    1,
  ]);

  await assetToken.transfer(seller.address, 10_000n);
  await paymentToken.transfer(buyer.address, 20_000n);

  await complianceModule.storeAttestation(buyer.address, await buildMetadata());
  await complianceModule.storeAttestation(seller.address, await buildMetadata());

  return {
    complianceModule,
    assetToken,
    paymentToken,
    manager,
    owner,
    buyer,
    seller,
    stranger,
  };
}

async function createSettlement(fixture, overrides = {}) {
  const {
    assetToken,
    paymentToken,
    manager,
    buyer,
    seller,
  } = fixture;
  const assetAmount = overrides.assetAmount ?? 1_000n;
  const paymentAmount = overrides.paymentAmount ?? 2_000n;
  const expiryBlock =
    overrides.expiryBlock ?? BigInt((await ethers.provider.getBlockNumber()) + 20);

  await assetToken.connect(seller).approve(manager.target, assetAmount);
  await paymentToken.connect(buyer).approve(manager.target, paymentAmount);

  const tx = await manager.createDvP(
    assetToken.target,
    assetAmount,
    paymentToken.target,
    paymentAmount,
    buyer.address,
    seller.address,
    expiryBlock,
  );
  const receipt = await tx.wait();
  const event = receipt.logs.find((log) => log.fragment?.name === "DvPCreated");

  return {
    settlementId: event.args.settlementId,
    assetAmount,
    paymentAmount,
    expiryBlock,
  };
}

describe("DvPSettlementManager", function () {
  describe("createDvP", function () {
    it("creates settlement when both parties are eligible", async function () {
      const fixture = await deployFixture();

      const { settlementId } = await createSettlement(fixture);
      const settlement = await fixture.manager.settlements(settlementId);

      expect(settlement.buyer).to.equal(fixture.buyer.address);
      expect(settlement.seller).to.equal(fixture.seller.address);
      expect(settlement.status).to.equal(0n);
    });

    it("locks seller asset tokens via HoldModule", async function () {
      const fixture = await deployFixture();

      const { assetAmount } = await createSettlement(fixture);

      expect(await fixture.assetToken.lockedBalanceOf(fixture.seller.address)).to.equal(
        assetAmount,
      );
    });

    it("reverts if buyer not eligible from jurisdiction mismatch", async function () {
      const fixture = await deployFixture();

      await fixture.complianceModule.storeAttestation(
        fixture.buyer.address,
        await buildMetadata({
          jurisdiction: asciiToFixedBytes("GB", 2),
        }),
      );

      await fixture.assetToken.connect(fixture.seller).approve(fixture.manager.target, 1_000n);
      await fixture.paymentToken.connect(fixture.buyer).approve(fixture.manager.target, 2_000n);

      await expect(
        fixture.manager.createDvP(
          fixture.assetToken.target,
          1_000n,
          fixture.paymentToken.target,
          2_000n,
          fixture.buyer.address,
          fixture.seller.address,
          BigInt((await ethers.provider.getBlockNumber()) + 20),
        ),
      ).to.be.revertedWith("Buyer not eligible");
    });

    it("reverts if seller not eligible from expired attestation", async function () {
      const fixture = await deployFixture();

      await fixture.complianceModule.storeAttestation(
        fixture.seller.address,
        await buildMetadata({
          attestationExpiry: 1n,
        }),
      );

      await fixture.assetToken.connect(fixture.seller).approve(fixture.manager.target, 1_000n);
      await fixture.paymentToken.connect(fixture.buyer).approve(fixture.manager.target, 2_000n);

      await expect(
        fixture.manager.createDvP(
          fixture.assetToken.target,
          1_000n,
          fixture.paymentToken.target,
          2_000n,
          fixture.buyer.address,
          fixture.seller.address,
          BigInt((await ethers.provider.getBlockNumber()) + 20),
        ),
      ).to.be.revertedWith("Seller not eligible");
    });

    it("emits DvPCreated with correct args", async function () {
      const fixture = await deployFixture();

      await fixture.assetToken.connect(fixture.seller).approve(fixture.manager.target, 1_000n);
      await fixture.paymentToken.connect(fixture.buyer).approve(fixture.manager.target, 2_000n);

      const tx = await fixture.manager.createDvP(
        fixture.assetToken.target,
        1_000n,
        fixture.paymentToken.target,
        2_000n,
        fixture.buyer.address,
        fixture.seller.address,
        BigInt((await ethers.provider.getBlockNumber()) + 20),
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => log.fragment?.name === "DvPCreated");

      expect(event.args.buyer).to.equal(fixture.buyer.address);
      expect(event.args.seller).to.equal(fixture.seller.address);
      expect(event.args.assetAmount).to.equal(1_000n);
      expect(event.args.paymentAmount).to.equal(2_000n);
    });
  });

  describe("commit", function () {
    it("buyer commit transfers payment tokens to contract", async function () {
      const fixture = await deployFixture();
      const { settlementId, paymentAmount } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);

      expect(await fixture.paymentToken.balanceOf(fixture.manager.target)).to.equal(
        paymentAmount,
      );
    });

    it("seller commit marks sellerCommitted true", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.seller).commit(settlementId);

      expect((await fixture.manager.settlements(settlementId)).sellerCommitted).to.equal(
        true,
      );
    });

    it("both committed sets status to BothCommitted", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);

      expect((await fixture.manager.settlements(settlementId)).status).to.equal(1n);
    });

    it("reverts if stranger tries to commit", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await expect(
        fixture.manager.connect(fixture.stranger).commit(settlementId),
      ).to.be.revertedWith("Caller is not a party");
    });

    it("reverts if already finalised", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);

      await expect(
        fixture.manager.connect(fixture.buyer).commit(settlementId),
      ).to.be.revertedWith("Settlement not committable");
    });
  });

  describe("finalise", function () {
    it("finalise transfers asset tokens to buyer via executeHold", async function () {
      const fixture = await deployFixture();
      const { settlementId, assetAmount } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);

      expect(await fixture.assetToken.balanceOf(fixture.buyer.address)).to.equal(assetAmount);
    });

    it("finalise transfers payment tokens to seller", async function () {
      const fixture = await deployFixture();
      const { settlementId, paymentAmount } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);

      expect(await fixture.paymentToken.balanceOf(fixture.seller.address)).to.equal(
        paymentAmount,
      );
    });

    it("both transfers happen in same transaction and leave no escrow residue", async function () {
      const fixture = await deployFixture();
      const { settlementId, assetAmount, paymentAmount } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      const tx = await fixture.manager.finalise(settlementId);
      await tx.wait();

      expect(await fixture.assetToken.balanceOf(fixture.buyer.address)).to.equal(assetAmount);
      expect(await fixture.paymentToken.balanceOf(fixture.seller.address)).to.equal(
        paymentAmount,
      );
      expect(await fixture.paymentToken.balanceOf(fixture.manager.target)).to.equal(0n);
    });

    it("reverts if not both committed", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);

      await expect(fixture.manager.finalise(settlementId)).to.be.revertedWith(
        "Settlement not ready",
      );
    });

    it("reverts if already finalised", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);

      await expect(fixture.manager.finalise(settlementId)).to.be.revertedWith(
        "Settlement not ready",
      );
    });

    it("emits DvPFinalised", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);

      await expect(fixture.manager.finalise(settlementId))
        .to.emit(fixture.manager, "DvPFinalised")
        .withArgs(settlementId);
    });
  });

  describe("abort", function () {
    it("abort after expiry releases asset hold back to seller", async function () {
      const fixture = await deployFixture();
      const { settlementId, assetAmount, expiryBlock } = await createSettlement(fixture);

      await networkHelpers.mineUpTo(Number(expiryBlock + 1n));
      await fixture.manager.abort(settlementId);

      expect(await fixture.assetToken.lockedBalanceOf(fixture.seller.address)).to.equal(0n);
      expect(await fixture.assetToken.availableBalanceOf(fixture.seller.address)).to.equal(
        10_000n,
      );
      expect(await fixture.assetToken.balanceOf(fixture.seller.address)).to.equal(10_000n);
      expect(assetAmount).to.equal(1_000n);
    });

    it("abort returns payment tokens to buyer if committed", async function () {
      const fixture = await deployFixture();
      const { settlementId, paymentAmount, expiryBlock } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await networkHelpers.mineUpTo(Number(expiryBlock + 1n));
      await fixture.manager.abort(settlementId);

      expect(await fixture.paymentToken.balanceOf(fixture.buyer.address)).to.equal(20_000n);
      expect(paymentAmount).to.equal(2_000n);
    });

    it("reverts if expiry not reached", async function () {
      const fixture = await deployFixture();
      const { settlementId } = await createSettlement(fixture);

      await expect(fixture.manager.abort(settlementId)).to.be.revertedWith(
        "Settlement not expired",
      );
    });

    it("reverts if already finalised", async function () {
      const fixture = await deployFixture();
      const { settlementId, expiryBlock } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);
      await networkHelpers.mineUpTo(Number(expiryBlock + 1n));

      await expect(fixture.manager.abort(settlementId)).to.be.revertedWith(
        "Settlement not abortable",
      );
    });

    it("emits DvPAborted", async function () {
      const fixture = await deployFixture();
      const { settlementId, expiryBlock } = await createSettlement(fixture);

      await networkHelpers.mineUpTo(Number(expiryBlock + 1n));

      await expect(fixture.manager.abort(settlementId))
        .to.emit(fixture.manager, "DvPAborted")
        .withArgs(settlementId);
    });
  });

  describe("end-to-end flow", function () {
    it("full happy path leaves buyer with asset, seller with payment, and no manager residue", async function () {
      const fixture = await deployFixture();
      const { settlementId, assetAmount, paymentAmount } = await createSettlement(fixture);

      await fixture.manager.connect(fixture.buyer).commit(settlementId);
      await fixture.manager.connect(fixture.seller).commit(settlementId);
      await fixture.manager.finalise(settlementId);

      expect(await fixture.assetToken.balanceOf(fixture.buyer.address)).to.equal(assetAmount);
      expect(await fixture.paymentToken.balanceOf(fixture.seller.address)).to.equal(
        paymentAmount,
      );
      expect(await fixture.paymentToken.balanceOf(fixture.manager.target)).to.equal(0n);
      expect(await fixture.assetToken.lockedBalanceOf(fixture.seller.address)).to.equal(0n);
    });
  });

  describe("gas comparison", function () {
    it("measures gas for createDvP, buyer commit, seller commit, finalise, and abort", async function () {
      const finaliseFixture = await deployFixture();
      const createTx = await finaliseFixture.assetToken
        .connect(finaliseFixture.seller)
        .approve(finaliseFixture.manager.target, 1_000n);
      await createTx.wait();
      await finaliseFixture.paymentToken
        .connect(finaliseFixture.buyer)
        .approve(finaliseFixture.manager.target, 2_000n);

      const createSettlementTx = await finaliseFixture.manager.createDvP(
        finaliseFixture.assetToken.target,
        1_000n,
        finaliseFixture.paymentToken.target,
        2_000n,
        finaliseFixture.buyer.address,
        finaliseFixture.seller.address,
        BigInt((await ethers.provider.getBlockNumber()) + 20),
      );
      const createReceipt = await createSettlementTx.wait();
      const createdEvent = createReceipt.logs.find(
        (log) => log.fragment?.name === "DvPCreated",
      );
      const settlementId = createdEvent.args.settlementId;

      const buyerCommitTx = await finaliseFixture.manager
        .connect(finaliseFixture.buyer)
        .commit(settlementId);
      const buyerCommitReceipt = await buyerCommitTx.wait();

      const sellerCommitTx = await finaliseFixture.manager
        .connect(finaliseFixture.seller)
        .commit(settlementId);
      const sellerCommitReceipt = await sellerCommitTx.wait();

      const finaliseTx = await finaliseFixture.manager.finalise(settlementId);
      const finaliseReceipt = await finaliseTx.wait();

      const abortFixture = await deployFixture();
      const abortSettlement = await createSettlement(abortFixture);
      await abortFixture.manager.connect(abortFixture.buyer).commit(abortSettlement.settlementId);
      await networkHelpers.mineUpTo(Number(abortSettlement.expiryBlock + 1n));
      const abortTx = await abortFixture.manager.abort(abortSettlement.settlementId);
      const abortReceipt = await abortTx.wait();

      console.log(
        `DvPSettlementManager gas snapshot: create=${createReceipt.gasUsed.toString()} buyerCommit=${buyerCommitReceipt.gasUsed.toString()} sellerCommit=${sellerCommitReceipt.gasUsed.toString()} finalise=${finaliseReceipt.gasUsed.toString()} abort=${abortReceipt.gasUsed.toString()}`,
      );

      expect(createReceipt.gasUsed).to.be.gt(0n);
      expect(buyerCommitReceipt.gasUsed).to.be.gt(0n);
      expect(sellerCommitReceipt.gasUsed).to.be.gt(0n);
      expect(finaliseReceipt.gasUsed).to.be.gt(0n);
      expect(abortReceipt.gasUsed).to.be.gt(0n);
    });
  });
});
