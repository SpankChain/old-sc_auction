const CONFIG = require(`../conf/config`)
const Auction = artifacts.require(`./Auction.sol`)
const Token = artifacts.require(`./HumanStandardToken.sol`)
const fs = require(`fs`)
const HttpProvider = require(`ethjs-provider-http`)
const EthRPC = require(`ethjs-rpc`)
const ethRPC = new EthRPC(new HttpProvider(CONFIG.RPC_URL))
const EthQuery = require(`ethjs-query`)
const ethQuery = new EthQuery(new HttpProvider(CONFIG.RPC_URL))
const abi = require('ethereumjs-abi')
const { sha3, ecsign } = require('ethereumjs-util')
const format = require('ethjs-format');

const data = JSON.parse(fs.readFileSync(`${__dirname}/../conf/data.json`))

/****************
UTILITY FUNCTIONS
*****************/
const randInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const hexStringToByte = (str) => {
    if (!str) {
      return new Uint8Array();
    }

    var a = [];
    for (var i = 0, len = str.length; i < len; i+=2) {
      a.push(parseInt(str.substr(i,2),16));
    }

    return new Uint8Array(a);
  }

const sign = (msgHash, privKey) => {
  if (typeof msgHash === 'string' && msgHash.slice(0, 2) === '0x') {
    msgHash = Buffer.alloc(32, msgHash.slice(2), 'hex')
  }
  const sig = ecsign(msgHash, privKey)
  return `0x${sig.r.toString('hex')}${sig.s.toString('hex')}${sig.v.toString(16)}`
}

const mine_processPhase = () => {
    it(`mine to process phase`, async () => {
        const blockNumber = await ethQuery.blockNumber()
        const processingPhaseStartBlock = await auction.processingPhaseStartBlock.call()
        for (let i = blockNumber.toNumber(); i < processingPhaseStartBlock.toNumber(); i++) {
            await ethRPC.sendAsync({method: `evm_mine`}, (err)=> {
                assert.equal(err, null, `error force mining`)
            });
            let thisBlockNumber = await ethQuery.blockNumber()
            console.log('\t- mining block', thisBlockNumber.toNumber())
        }
    })
}

const mine_auctionEnd = () => {
    it(`mine to auction end`, async () => {
        const blockNumber = await ethQuery.blockNumber()
        const auctionEndBlock = await auction.auctionEndBlock.call()
        for (let i = blockNumber.toNumber(); i <= auctionEndBlock.toNumber(); i++) {
            await ethRPC.sendAsync({method: `evm_mine`}, (err)=> {
                assert.equal(err, null, `error force mining`)
            });
            let thisBlockNumber = await ethQuery.blockNumber()
            console.log('\t- mining block', thisBlockNumber.toNumber())
        }
    })
}

/*****
EVENTS
******/
const assertEvent = async (contractAddress, eventName, parameters) => {
    const event = contractAddress[eventName]()
    event.watch()
    await event.get((err, logs) => {
        logs.map(evt => {
            const eventName = evt.event
            parameters.map((param)=> {
                assert.notEqual(evt.args[param], null, `value not found for ${eventName}::${param}`)
            })
            console.log(`\t- EVENT : ${eventName}`)

            Object.keys(evt.args).map(payload => {
                console.log(`\t  - ${payload}`, evt.args[payload].toString())
            })
        })
        assert.equal(err, null, `did not expect error ${err}`)
    })
    event.stopWatching()
}

/***********
VERIFY STATE
************/
const pass_auctionPhase = (phase) => {
    it(`check auction phase '${phase}'`, async () => {
        const blockNumber = await ethQuery.blockNumber()
        const currentAuctionState = await auction.currentAuctionState.call()
        const processingPhaseStartBlock = await auction.processingPhaseStartBlock.call()
        const auctionEndBlock = await auction.auctionEndBlock.call()

        switch(phase) {
            case `deployed` :
                assert.equal(processingPhaseStartBlock.toNumber(), 0, `expected auction not to have started yet`)
                assert.equal(auctionEndBlock.toNumber(), 0, `expected auction not to have started yet`)
                assert.equal(currentAuctionState.toNumber(), 0, `expected current auction state to be deployed`)
                break

            case `purchase` :
                assert.isAbove(processingPhaseStartBlock.toNumber(), blockNumber.toNumber(), `expected auction to be in purchase phase`)
                assert.isAbove(auctionEndBlock.toNumber(), blockNumber.toNumber(), `expected auction to be in purchase phase`)
                assert.equal(currentAuctionState.toNumber(), 1, `expected current auction state to be started`)
                break

            case `process` :
                assert.isBelow(processingPhaseStartBlock.toNumber(), blockNumber.toNumber(), `expected auction to be in processing phase`)
                assert.isAbove(auctionEndBlock.toNumber(), blockNumber.toNumber(), `expected auction to be in processing phase`)
                assert.equal(currentAuctionState.toNumber(), 1, `expected current auction state to be started`)
                break

            case `success` :
                assert.isBelow(processingPhaseStartBlock.toNumber(), blockNumber.toNumber(), `expected not to be in processing phase when ending successfully`)
                assert.equal(currentAuctionState.toNumber(), 2, `expected current auction state to be success`)
                break

            case `cancel` :
                assert.equal(currentAuctionState.toNumber(), 3, `expected current auction state to be cancel`)
                break
            case `end` :
                assert.isAtMost(auctionEndBlock.toNumber(), blockNumber.toNumber(), `expected auction to have ended`)
                break
        }
    })
}

/****************
PASS/FAIL METHODS

NOTE : Using throw right after the try/catch to ensure exception is raised, if not then this could mean a modifier is missing. Whatever the reason, no exception was raised when there should have been.

*****************/
// deposit
const deposit = async (account, depositAmount) => {
    const buyer = await auction.allBuyers.call(account)
    const currentDeposit = parseInt(buyer[0])
    await auction.deposit({from: account, value:depositAmount})
    const updatedBuyer = await auction.allBuyers.call(account)
    assertEvent(auction, `DepositEvent`, [`buyerAddress`, `depositInWei`, `totalDepositInWei`])
    assert.equal(parseInt(updatedBuyer[0], 10), parseInt(currentDeposit + depositAmount, 10), `deposit saved does not match minimum deposit`)
}

const pass_deposit = (accounts) => {
    for (let i=0; i <= randInt(1,3); i++) {
        it(`deposit from ${accounts[4]}`, async () => {
            await deposit(accounts[4], 1000)
        })
    }
    for (let i=0; i <= randInt(1,3); i++) {
        it(`deposit from ${accounts[5]}`, async () => {
            await deposit(accounts[5], 1000)
        })
    }
}

const fail_deposit = (accounts) => {
    it(`deposit from ${accounts[4]}, should fail`, async () => {
        try {
            await deposit(accounts[4], data.auction.minDepositInWei - 1)
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to deposit`)
            return
        }
        throw new Error(`in_buy_phase modifier did not throw`)
    })
    it(`deposit from ${accounts[5]}, should fail`, async () => {
        try {
            await deposit(accounts[5], data.auction.minDepositInWei - 1)
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to deposit`)
            return
        }
        throw new Error(`in_buy_phase modifier did not throw`)
    })
}

// withdraw
const withdraw = async (account) => {
    let currentAuctionState = await auction.currentAuctionState.call()
    const buyerBeforeWithdraw = await auction.allBuyers.call(account)
    const beforeWithdrawn = buyerBeforeWithdraw[3]
    const buyerTotalTokens = buyerBeforeWithdraw[2]
    const beforeWithdrawBalance = web3.eth.getBalance(account)
    const buyerTokensBeforeWithdraw = await token.balanceOf(account)

    const transaction = await auction.withdraw({from: account, gasPrice: web3.eth.gasPrice})

    const buyerAfterWithdraw = await auction.allBuyers.call(account)
    const hasWithdrawn = buyerAfterWithdraw[3]
    const depositInWei = buyerAfterWithdraw[0]
    const bidWeiAmount = buyerAfterWithdraw[1]

    assertEvent(auction, `WithdrawEvent`, [`buyerAddress`, `tokensReceived`, `unspentDepositInWei`])
    assert.equal(beforeWithdrawn, false, `buyer beforeWithdrawn should be false`)
    assert.equal(hasWithdrawn, true, `buyer hasWithdrawn should be true`)

    // Get current auction state again
    currentAuctionState = await auction.currentAuctionState.call()
    if (currentAuctionState.toNumber() == 2) {
        verify_weiTransfer(transaction.receipt.gasUsed, account, beforeWithdrawBalance, depositInWei - bidWeiAmount)
    } else {
        verify_weiTransfer(transaction.receipt.gasUsed, account, beforeWithdrawBalance, depositInWei)
    }

    if (currentAuctionState.toNumber() == 2) {
        const buyerTokensAfterWithdraw = await token.balanceOf(account)
        const tokensReceived = buyerTokensAfterWithdraw.toNumber() - buyerTokensBeforeWithdraw.toNumber()

        assert.equal(tokensReceived, buyerTotalTokens.toNumber(), `tokens received should equal buyer struct on successful auction`)
    }
}

const pass_withdraw = (accounts) => {
    it(`withdraw`, async () => {
        await withdraw(accounts[4])
    })
    it(`withdraw`, async () => {
        await withdraw(accounts[5])
    })
}

const fail_withdraw = (accounts) => {
    it(`withdraw from ${accounts[4]}, should fail`, async () => {
        try {
           await withdraw(accounts[4])
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to call withdraw`)
            return
        }
        throw new Error(`auction_complete modifier did not throw`)
    })
    it(`withdraw from ${accounts[5]}, should fail`, async () => {
        try {
           await withdraw(accounts[5])
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to call withdraw`)
            return
        }
        throw new Error(`auction_complete modifier did not throw`)
    })
}

// startAuction
const startAuction = async () => {
    const maxTokensForSale = await auction.maxTokensForSale.call()
    await token.transfer(auction.address, maxTokensForSale.toNumber())
    await auction.startAuction()
    const currentAuctionState = await auction.currentAuctionState.call()

    assertEvent(auction, `StartAuctionEvent`, [`tokenAddress`, `weiWallet`, `tokenWallet`, `minDepositInWei`, `minWeiToRaise`, `maxWeiToRaise`, `minTokensForSale`, `maxTokensForSale`, `maxTokenBonusPercentage`, `processingPhaseStartBlock`, `auctionEndBlock`])
    assert.equal(currentAuctionState.toNumber(), 1, `expecting currentAuctionState to be started enum`)
}

const pass_startAuction = () => {
    it(`transfer tokens`, async () => {
        await startAuction()
    })
}

const fail_startAuction = () => {
    it(`start auction, should fail`, async () => {
        try {
            await startAuction()
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to start auction`)
            return
        }
        throw new Error(`owner_only modifier did not throw`)
    })
}

// setStrikePrice
const setStrikePrice = async (amount) => {
    await auction.setStrikePrice(amount)
    const strikePriceInWei = await auction.strikePriceInWei.call()

    assertEvent(auction, `SetStrikePriceEvent`, [`strikePriceInWei`])
    assert.equal(amount, strikePriceInWei, `expecting strikePriceInWei to be ${amount}`)
}

const pass_setStrikePrice = () => {
    it(`setStrikePrice`, async () => {
        await setStrikePrice(1)
    })
}

const fail_setStrikePrice = () => {
    it(`setStrikePrice, should fail`, async () => {
        try {
            await setStrikePrice(1)
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to setStrikePrice`)
            return
        }
        throw new Error(`in_bid_processing_phase modifier did not throw`)
    })
}

// processBid
const processBid = async (pubKey, privKey, tokenBidPriceInWei, bidWeiAmount, tokenBonusPercentage) => {
    const privKeyBuffer = Buffer.alloc(32, privKey, 'hex')
    const hash = `0x${abi.soliditySHA3(['address', 'uint', 'uint'], [auction.address, tokenBidPriceInWei, bidWeiAmount]).toString('hex')}`
    const signature = sign(hash, privKeyBuffer)
    const r = signature.slice(0, 66)
    const s = '0x' + signature.slice(66, 130)
    const v = parseInt(String('0x' + signature.slice(130, 132)), 16)

    const strikePriceInWei = await auction.strikePriceInWei.call()
    await auction.processBid(tokenBidPriceInWei, bidWeiAmount, tokenBonusPercentage, v, r, s)
    const buyer = await auction.allBuyers.call(pubKey)
    const numTokensPurchased = bidWeiAmount / strikePriceInWei
    const numBonusTokens = (bidWeiAmount * tokenBonusPercentage) / 100
    const numTotalTokensForBid = numTokensPurchased + numBonusTokens
    /*
    struct Buyer {
        uint depositInWei;  // buyer[0]
        uint bidWeiAmount;  // buyer[1]
        uint totalTokens;   // buyer[2]
        bool hasWithdrawn;  // buyer[3]
    }
    */

    assert.equal(parseInt(buyer[1], 10), bidWeiAmount, `expected buyer bidWeiAmount to be ${bidWeiAmount}`)
    assert.equal(parseInt(buyer[2], 10), numTotalTokensForBid, `expected buyer totalTokens to be numTotalTokensForBid`)
    assertEvent(auction, `ProcessBidEvent`, [`buyerAddress`, `tokensPurchased`, `purchaseAmountInWei`])
}
/*
    NOTE : bids are the complex to test for - there are valid bids, vaild bids that fail because they are called during the wrong phase and many types of bids that will always be invalid (even when called during the bid processing phase) because there are restrictions on what makes a bid valid (signature and auction constraint validation).

    The pass/fail pattern requires an extra level of indirection to ensure that the same code path processes
*/
const validBid = async () => {
    await processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 100, 1000, 2)
}

const pass_valid_processBid = (accounts) => {
    it(`processBid from ${accounts[4]}`, async () => {
        await validBid()
    })
}

const fail_valid_processBid = () => {
    it(`processBid, should fail`, async () => {
        try {
            await validBid()
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to processBid`)
            return
        }
        throw new Error(`strike_price_set and in_bid_processing_phase modifier did not throw`)
    })
}

const fail_invalid_processBid = (pubKey, privKey, tokenBidPriceInWei, bidWeiAmount, tokenBonusPercentage) => {
    it(`processBid, should fail`, async () => {
        try {
            await processBid(pubKey, privKey, tokenBidPriceInWei, bidWeiAmount, tokenBonusPercentage)
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to processBid`)
            return
        }
        throw new Error(`strike_price_set and in_bid_processing_phase modifier did not throw`)
    })
}

const fail_processBid = () => {
    // valid bid should fail
    fail_valid_processBid()
    // fails require(minDepositInWei <= bidWeiAmount)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 1, 1, 2)

    // fails require(strikePriceInWei <= tokenBidPriceInWei)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 0, 1000, 2)

    // fails require(tokenBidPriceInWei <= bidWeiAmount);
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 10000, 100, 2)

    // fails require(0 <= tokenBonusPercentage)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 100, 1000, -1)

    // fails require(tokenBonusPercentage <= maxTokenBonusPercentage)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 100, 1000, 41)

    // fails require(SafeMath.add(numTotalTokensForBid, totalTokensSold) <= maxTokensForSale)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 100, 1000000000, 2)

    // require(SafeMath.add(totalWeiRaised, bidWeiAmount) <= maxWeiToRaise)
    fail_invalid_processBid('0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1', '74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63', 100, 2000, 30)

    // fails hash, incorrrect private key
    fail_invalid_processBid('0x0000000000000000000000000000000000000000', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 100, 1000, 2)
}

// completeSuccessfulAuction
const completeSuccessfulAuction = async (accounts) => {
    const ownerBalance = web3.eth.getBalance(accounts[0])
    const transaction = await auction.completeSuccessfulAuction({gasPrice: web3.eth.gasPrice})
    const currentAuctionState = await auction.currentAuctionState.call()
    const tokenWalletBalance = await token.balanceOf(accounts[3])
    const maxTokensForSale = await auction.maxTokensForSale.call()
    const totalTokensSold = await auction.totalTokensSold.call()
    const totalRemainingTokens = maxTokensForSale.sub(totalTokensSold)

    assert.equal(tokenWalletBalance.toNumber(), totalRemainingTokens.toNumber(), `total tokens transferred to token wallet does not equal total tokens remaining after auction`)
    assertEvent(auction, `AuctionSuccessEvent`, [`strikePriceInWei`, `totalTokensSold`, `totalWeiRaised` ])
    assert.equal(currentAuctionState.toNumber(), 2, `expected currentAuctionState equal to AuctionState.success enum`)
    verify_weiTransfer(transaction.receipt.gasUsed, accounts[0], ownerBalance, 0)
}

const pass_completeSuccessfulAuction = (accounts) => {
    it(`completeSuccessfulAuction`, async () => {
        await completeSuccessfulAuction(accounts)
    })
}

const fail_completeSuccessfulAuction = (accounts) => {
    it(`completeSuccessfulAuction, should fail`, async () => {
        try {
            await completeSuccessfulAuction(accounts)
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to call completeSuccessfulAuction`)
            return
        }
        throw new Error(`strike_price_set and in_bid_processing_phase modifier did not throw`)
    })
}

// cancelAuction
const cancelAuction = async () => {
    await auction.cancelAuction()
    const currentAuctionState = await auction.currentAuctionState.call()

    assertEvent(auction, `CancelAuctionEvent`, [])
    assert.equal(currentAuctionState.toNumber(), 3, `expecting currentAuctionState to equal AuctionState.cancel enum`)
}
const pass_cancelAuction = () => {
    it(`cancelling auction`, async () => {
        await cancelAuction()
    })
}

const fail_cancelAuction = () => {
    it(`cancelling auction, should fail`, async () => {
        try {
            await cancelAuction()
        } catch (e) {
            assert.equal(e, `Error: VM Exception while processing transaction: invalid opcode`, `should not be able to cancelAuction`)
            return
        }
        throw new Error(`owner_only modifier did not throw`)
    })
}

/***********
VERIFY TESTS
************/
const verify_deployment = () => {
    it(`verify deployment`, async () => {
        auction = await Auction.deployed()
        const tokenAddress = await auction.tokenAddress.call()
        token = await Token.at(tokenAddress)

        assert.notEqual(token, null, "Token did not deploy successfully")
        assert.notEqual(auction, null, "Auction did not deploy successfully")
    })
}

const verify_parameters = () => {
    // ALL CONSTRUCTOR PARAMETERS ARE PUBLIC
    Object.keys(data.auction).map(key => {
        it(`auction:${key}`, async () => {
            await Auction.deployed()
            let resp = await auction[key].call()

            assert.equal(resp.toString().toLowerCase(), data.auction[key].toString().toLowerCase(), `auction : ${key}`)
        })
    })
    Object.keys(data.token).map(key => {
        it(`token:${key}`, async () => {
            await Token.deployed()
            let resp = await token[key].call()

            assert.equal(resp.toString().toLowerCase(), data.token[key].toString().toLowerCase(), `token : ${key}`)
        })
    })

}

const verify_defaults = () => {
    it(`strikePriceInWei should be 0`, async () => {
        const strikePriceInWei = await auction.strikePriceInWei.call()

        assert.equal(strikePriceInWei, 0, `expecting strikePriceInWei to be 0`)
    })

    it(`currentAuctionState should be 0 (enum AuctionState.deployed)`, async () => {
        const currentAuctionState = await auction.currentAuctionState.call()

        assert.equal(currentAuctionState.toNumber(), 0, `expecting currentAuctionState to be AuctionState.deployed enum`)
    })

    it(`totalTokensSold should be 0`, async () => {
        const totalTokensSold = await auction.totalTokensSold.call()

        assert.equal(totalTokensSold, 0, `expecting totalTokensSold to be 0`)
    })

    it(`totalWeiRaised should be 0`, async () => {
        const totalWeiRaised = await auction.totalWeiRaised.call()

        assert.equal(totalWeiRaised, 0, `expecting totalWeiRaised to be 0`)
    })

    it(`token should not be null`, async () => {
        const token = await auction.token.call()

        assert.notEqual(token, null, `expecting token to be defined`)
    })

}

const verify_cancelAuction = (accounts) => {
    pass_cancelAuction()
    pass_auctionPhase('cancel')
    fail_startAuction()
    fail_deposit(accounts)
    fail_setStrikePrice()
    fail_processBid()
    fail_completeSuccessfulAuction(accounts)
}

const verify_auctionExpire = (accounts) => {
    mine_auctionEnd()
    pass_auctionPhase(`end`)
    fail_startAuction()
    fail_deposit(accounts)
    fail_setStrikePrice()
    fail_processBid()
    fail_completeSuccessfulAuction(accounts)
}

const verify_weiTransfer = (gasUsed , userAccount, initialBalance, unspentDepositInWei) => {
    const calculatedGasCost = gasUsed * web3.eth.gasPrice.toNumber()
    const finalBalance = web3.eth.getBalance(userAccount)
    const actualGasCost  = initialBalance.sub(finalBalance.sub(unspentDepositInWei))
  
    assert.equal(actualGasCost.toString(), calculatedGasCost.toString(), "Actual gas cost should be equal to calculated gas cost")
  }

// /*****
//  TESTS
//  ****/
let auction, token, accounts
contract('verify up to deployed', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('verify auction state', () => {
        pass_auctionPhase(`deployed`)
    })

    describe('verify constructor parameters', () => {
        verify_parameters()
    })

    describe('verify default parameters', () => {
        verify_defaults()
    })

    describe('call out of phase functions before cancelling', () => {
        fail_deposit(accounts)
        fail_setStrikePrice()
        fail_processBid()
        fail_completeSuccessfulAuction(accounts)
        fail_withdraw(accounts)
    })
    /* 
        NOTE : CANCEL NOT TESTED IN DEPLOYED STATE
    */
})

contract('verify up to started', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('start auction', () => {
        pass_startAuction()
    })

    describe('verify purchase phase', () => {
        pass_auctionPhase(`started`)
    })

    describe('call out of phase functions before cancelling', () => {
        fail_startAuction()
        fail_setStrikePrice()
        fail_processBid()
        fail_completeSuccessfulAuction(accounts)
        fail_withdraw(accounts)
    })

    describe('verify all methods after auction cancelled', () => {
        verify_cancelAuction(accounts)
        fail_withdraw(accounts) // no deposits, should fail
    })
})

contract('verify up to deposit', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('start auction', () => {
        pass_startAuction()
    })

    describe(`deposit`, () => {
        pass_deposit(accounts)
    })

    describe('call out of phase functions before cancelling', () => {
        fail_startAuction()
        fail_setStrikePrice()
        fail_processBid()
        fail_completeSuccessfulAuction(accounts)
        fail_withdraw(accounts)
    })

    describe('verify all methods after auction cancelled', () => {
        verify_cancelAuction(accounts)
        pass_withdraw(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('verify up to process bid', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('start auction', () => {
        pass_startAuction()
    })

    describe('deposit', () => {
        pass_deposit(accounts)
    })

    describe('set strike price', () => {
        mine_processPhase()
        pass_setStrikePrice()
    })

    describe('verify methods in purchase phase - process bid', () => {
        pass_valid_processBid(accounts)
        fail_processBid()
    })

    describe('call out of phase functions before cancelling', () => {
        fail_startAuction()
        fail_deposit(accounts)
        fail_setStrikePrice()
        fail_completeSuccessfulAuction(accounts)
    })

    describe('verify all methods after auction cancelled', () => {
        verify_cancelAuction(accounts)
        pass_withdraw(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('verify up to auction success', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('start auction', () => {
        pass_startAuction()
    })

    describe('deposit', () => {
        pass_deposit(accounts)
    })

    describe('auction success', () => {
        mine_processPhase()
        pass_setStrikePrice()
        pass_valid_processBid(accounts)
        pass_completeSuccessfulAuction(accounts)
        pass_auctionPhase(`success`)
    })

    describe('verify methods in auction over - auction success', () => {
        pass_withdraw(accounts)
    })

    describe('verify all functions should fail after auction success', () => {
        fail_startAuction()
        fail_deposit(accounts)
        fail_setStrikePrice()
        fail_processBid()
        fail_completeSuccessfulAuction(accounts)
        fail_withdraw(accounts)
        fail_cancelAuction()
    })
})

describe('Verify deposit, cancelAuction, withdraw', () => {
  contract('verify deposit => cancelAuction => withdraw', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })
    describe('start auction', () => {
        pass_startAuction()
        pass_deposit(accounts)
        pass_cancelAuction()
        pass_withdraw(accounts)
    })
  })
})


describe('Verify deposit, mine_processPhase, processBid, withdraw', () => {
  contract('verify deposit => mine_processPhase => processBid => withdraw', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })
    describe('start auction', () => {
        pass_startAuction()
        pass_deposit(accounts)
        mine_processPhase()
        pass_setStrikePrice()
        pass_valid_processBid(accounts)
        pass_completeSuccessfulAuction(accounts)
        pass_withdraw(accounts)
    })
  })
})


contract('up to deposit, expire auction', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('deposit', () => {
        pass_startAuction()
        pass_deposit(accounts)
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('verify success methods after expire before cancel', () => {
        pass_withdraw(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('up to deposit, expire auction', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('deposit', () => {
        pass_startAuction()
        pass_deposit(accounts)
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify success methods after expire after cancel', () => {
        pass_withdraw(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('up to set strike price, expire auction', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('set strike price', () => {
        pass_startAuction()
        pass_deposit(accounts)
        mine_processPhase()
        pass_auctionPhase(`processing`)
        pass_setStrikePrice()
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('verify withdraw after expire before cancel', () => {
        pass_withdraw(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('up to set strike price, expire auction', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('set strike price', () => {
        pass_startAuction()
        pass_deposit(accounts)
        mine_processPhase()
        pass_auctionPhase(`processing`)
        pass_setStrikePrice()
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify withdraw after expire and after cancel', () => {
        pass_withdraw(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('up to process bid, expire auction, withdraw after expire', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('process bid', () => {
        pass_startAuction()
        pass_deposit(accounts)
        mine_processPhase()
        pass_auctionPhase(`processing`)
        pass_setStrikePrice()
        pass_valid_processBid(accounts)
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('verify withdraw after auction expire before cancel', () => {
        pass_withdraw(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})

contract('up to process bid, expire auction, withdraw after cancel', (accounts) => {
    describe('verify contract deployment', () => {
        verify_deployment()
    })

    describe('process bid', () => {
        pass_startAuction()
        pass_deposit(accounts)
        mine_processPhase()
        pass_auctionPhase(`processing`)
        pass_setStrikePrice()
        pass_valid_processBid(accounts)
    })

    describe('expire auction and verify that methods fail', () => {
        verify_auctionExpire(accounts)
    })

    describe('cancel auction and verify that methods fail', () => {
        verify_cancelAuction(accounts)
    })

    describe('verify withdraw after expire and after cancel', () => {
        pass_withdraw(accounts)
    })

    describe('verify withdraw can only happen once', () => {
        fail_withdraw(accounts)
    })
})