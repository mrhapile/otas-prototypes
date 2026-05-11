import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

function asciiToFixedBytes(value, expectedSize) {
  const bytes = ethers.toUtf8Bytes(value);

  if (bytes.length !== expectedSize) {
    throw new Error(
      `Expected "${value}" to be ${expectedSize} bytes, received ${bytes.length}`,
    );
  }

  return ethers.hexlify(bytes);
}

async function deployFixture() {
  const [owner, issuer, holder, other, anotherHolder] = await ethers.getSigners();
  const complianceModule = await ethers.deployContract("ComplianceModule", [
    owner.address,
  ]);

  await complianceModule.authorizeIssuer(issuer.address);

  return {
    complianceModule,
    owner,
    issuer,
    holder,
    other,
    anotherHolder,
  };
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
      ethers.toUtf8Bytes("holder-kyc-attestation"),
    ),
    attestationExpiry: BigInt(latestBlock.timestamp + 3600),
    customRestrictionFlags: ethers.ZeroHash,
    ...overrides,
  };
}

describe("ComplianceModule", function () {
  it("returns true for a holder with valid metadata in the expected jurisdiction and category", async function () {
    const { complianceModule, issuer, holder } = await deployFixture();
    const metadata = await buildMetadata();

    await expect(
      complianceModule.connect(issuer).storeAttestation(holder.address, metadata),
    )
      .to.emit(complianceModule, "AttestationStored")
      .withArgs(holder.address, metadata.kycAttestationHash);

    expect(
      await complianceModule.isEligible(
        holder.address,
        metadata.jurisdiction,
        metadata.investorCategory,
      ),
    ).to.equal(true);
  });

  it("returns false when the attestation has expired", async function () {
    const { complianceModule, issuer, holder } = await deployFixture();
    const metadata = await buildMetadata({
      attestationExpiry: 1n,
    });

    await complianceModule.connect(issuer).storeAttestation(holder.address, metadata);

    expect(
      await complianceModule.isEligible(holder.address, metadata.jurisdiction, 1),
    ).to.equal(false);
  });

  it("returns false when the jurisdiction does not match", async function () {
    const { complianceModule, issuer, holder } = await deployFixture();
    const metadata = await buildMetadata();

    await complianceModule.connect(issuer).storeAttestation(holder.address, metadata);

    expect(
      await complianceModule.isEligible(
        holder.address,
        asciiToFixedBytes("GB", 2),
        1,
      ),
    ).to.equal(false);
  });

  it("returns false when the investor category is below the minimum", async function () {
    const { complianceModule, issuer, holder } = await deployFixture();
    const metadata = await buildMetadata({
      investorCategory: 0,
    });

    await complianceModule.connect(issuer).storeAttestation(holder.address, metadata);

    expect(
      await complianceModule.isEligible(holder.address, metadata.jurisdiction, 1),
    ).to.equal(false);
  });

  it("reverts when an unauthorized account tries to store an attestation", async function () {
    const { complianceModule, holder, other } = await deployFixture();
    const metadata = await buildMetadata();

    await expect(
      complianceModule.connect(other).storeAttestation(holder.address, metadata),
    ).to.be.revertedWith("Unauthorized issuer");
  });

  it("revokes attestation data and makes the holder ineligible", async function () {
    const { complianceModule, issuer, holder } = await deployFixture();
    const metadata = await buildMetadata();

    await complianceModule.connect(issuer).storeAttestation(holder.address, metadata);
    await expect(complianceModule.connect(issuer).revokeAttestation(holder.address))
      .to.emit(complianceModule, "AttestationRevoked")
      .withArgs(holder.address);

    expect(
      await complianceModule.isEligible(holder.address, metadata.jurisdiction, 1),
    ).to.equal(false);
  });

  it("stores less gas when persisting only a hash instead of the full metadata struct", async function () {
    const { complianceModule, issuer, holder, anotherHolder } = await deployFixture();
    const metadata = await buildMetadata();

    const fullTx = await complianceModule
      .connect(issuer)
      .storeAttestation(holder.address, metadata);
    const fullReceipt = await fullTx.wait();

    const hashOnlyTx = await complianceModule
      .connect(issuer)
      .storeAttestationHash(
        anotherHolder.address,
        metadata.kycAttestationHash,
        metadata.attestationExpiry,
      );
    const hashOnlyReceipt = await hashOnlyTx.wait();

    console.log(
      `ComplianceModule gas snapshot: full=${fullReceipt.gasUsed.toString()} hashOnly=${hashOnlyReceipt.gasUsed.toString()}`,
    );

    expect(fullReceipt.gasUsed).to.be.gt(hashOnlyReceipt.gasUsed);
  });
});
