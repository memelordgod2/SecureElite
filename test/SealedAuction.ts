import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

async function deployFixture() {
  const [seller, alice, bob, charlie] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("SealedAuction");
  const auction = await Factory.connect(seller).deploy(3600); // 1h bidding
  const address = await auction.getAddress();
  return { seller, alice, bob, charlie, auction, address };
}

describe("SealedAuction (FHE)", function () {
  it("accepts encrypted bids, finalizes, and decrypts results", async () => {
    const { seller, alice, bob, charlie, auction, address } = await deployFixture();

    async function encBid(user: any, amount: number) {
      const input = fhevm.createEncryptedInput(address, user.address);
      input.add64(amount);
      return await input.encrypt();
    }

    // Alice bids 50
    const bAlice = await encBid(alice, 50);
    await (await auction.connect(alice).placeBid(bAlice.handles[0], bAlice.inputProof)).wait();

    // Bob bids 70
    const bBob = await encBid(bob, 70);
    await (await auction.connect(bob).placeBid(bBob.handles[0], bBob.inputProof)).wait();

    // Charlie bids 65
    const bCharlie = await encBid(charlie, 65);
    await (await auction.connect(charlie).placeBid(bCharlie.handles[0], bCharlie.inputProof)).wait();

    // End auction
    await time.increase(3600);
    await (await auction.connect(seller).finalize()).wait();

    // Seller decrypts winner & price
    const encWinner = await auction.connect(seller).winnerCipher();
    const winner = await fhevm.userDecryptEaddress(encWinner, address, seller);
    expect(winner).to.equal(bob.address);

    const encPrice = await auction.connect(seller).highestBidCipher();
    const winPrice = await fhevm.userDecryptEuint(FhevmType.euint64, encPrice, address, seller);
    expect(winPrice).to.equal(70n);

    // Grant view to winner; winner decrypts price as well
    await (await auction.connect(seller).grantView(bob.address)).wait();
    const encPriceForBob = await auction.connect(bob).highestBidCipher();
    const winPriceForBob = await fhevm.userDecryptEuint(FhevmType.euint64, encPriceForBob, address, bob);
    expect(winPriceForBob).to.equal(70n);
  });
});
