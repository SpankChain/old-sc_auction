const Token = artifacts.require("./HumanStandardToken.sol")
const Auction = artifacts.require("./Auction.sol");
const fs = require(`fs`);
module.exports = function(deployer, network, accounts) {
    let conf = {}
    if (network === `development`) {
        data = JSON.parse(fs.readFileSync(`${__dirname}/../conf/data.json`))
        //console.log('data', data)
    }

    deployer.deploy(Token, data.token.totalSupply, data.token.name, data.token.decimals, data.token.symbol)
    .then(() => {
        return deployer.deploy(Auction, Token.address, data.auction.weiWallet, data.auction.tokenWallet, data.auction.minDepositInWei, data.auction.minWeiToRaise, data.auction.maxWeiToRaise, data.auction.minTokensForSale, data.auction.maxTokensForSale, data.auction.maxTokenBonusPercentage, data.auction.depositWindowInBlocks, data.auction.processingWindowInBlocks)
    })
}