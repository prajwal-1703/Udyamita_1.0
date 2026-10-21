const { expect } = require("chai");

describe("UCoin Contract", function () {
  let UCoin, ucoin, deployer, user1;

  beforeEach(async function () {
    [deployer, user1] = await ethers.getSigners();
    const UCoinFactory = await ethers.getContractFactory("UCoin");
    ucoin = await UCoinFactory.deploy(deployer.address, deployer.address);
    await ucoin.waitForDeployment();
  });

  it("Should have correct total supply", async function () {
    const totalSupply = await ucoin.totalSupply();
    expect(totalSupply).to.equal(ethers.parseEther("1000001"));
  });

  it("Should transfer tokens", async function () {
    await ucoin.transfer(user1.address, ethers.parseEther("50"));
    expect(await ucoin.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
  });
});
    