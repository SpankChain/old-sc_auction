pragma solidity 0.4.15;
import {SafeMath} from './SafeMath.sol';
import {HumanStandardToken} from './HumanStandardToken.sol';

/*
    Two phase auction:
    1. purchase phase 
        * begins when startAuction() is executed by owner, ends when process bid phase begins
        * initial and incremental deposits must be equal or greater than the minimum deposit defined at contract deployment
        * buyers submit deposits on-chain
        * buyers submit signed bids off-chain (a total bid amount in WEI and a max price per token)
    2. process bid phase
        * ends when auction ends
        * strike price must be set before off-chain signed bids can be processed
        * when all bids have been processed, owner can call completeSuccessfulAuction to end auction
        * the auction will fail if success conditions are not met in the time allotted for the auction
    
    Auction success conditions (defined at contract deployment) : 
        * amount raised is between a minimum and maximum WEI amount
        * tokens sold are between a minimum and maximum number of tokens

    A successful auction occurs when all conditions are satisfied and the owner calls completeSuccessfulAuction() before the auction ends.
    If an auction fails, buyers can withdraw their deposit and no tokens are distributed - tokens can be returned to the token minting contract by calling returnTokens().

    Withdrawl :
        * buyers withdraw by calling withdraw()
            * a successful auction results in :
                * transfer of remaining deposit to buyer
                * transfer of sold tokens to buyer
            * a failed auction provides the buyer with a full deposit withdrawl

    Other contraints set at deployment :
        * minimum buyer deposit (applied to initial and incemental deposits)
        * maximum bonus token percentage that can be applied to a bid

    NOTES :
    * optimized for clarity and simplicity
    * blocks that represent state transitions include the definitional block
    * only one category of inequality operands is used
    * use block number to measure time
    * two types of auction state transitions - active & passive 
        * active state transitions triggered by contract owner
        * passive state transitions define auction phases as the block height increases
    * inspired by Nick Johnson's auction contract : https://gist.github.com/Arachnid/b9886ef91d5b47c31d2e3c8022eeea27
    * meant to be instructive yet practical - please improve on this!
*/
contract Auction {
    using SafeMath for uint;

    /*****
    EVENTS
    ******/
    event StartAuctionEvent(address tokenAddress, address weiWallet, address tokenWallet, uint minDepositInWei, uint minWeiToRaise, uint maxWeiToRaise, uint minTokensForSale, uint maxTokensForSale, uint maxTokenBonusPercentage, uint processingPhaseStartBlock, uint auctionEndBlock);
    event DepositEvent(address indexed buyerAddress, uint depositInWei, uint totalDepositInWei);
    event SetStrikePriceEvent(uint strikePriceInWei);
    event ProcessBidEvent(address indexed buyerAddress, uint tokensPurchased, uint purchaseAmountInWei);
    event AuctionSuccessEvent(uint strikePriceInWei, uint totalTokensSold, uint totalWeiRaised);
    event WithdrawEvent(address indexed buyerAddress, uint tokensReceived, uint unspentDepositInWei);
    event CancelAuctionEvent();

    /***********************************
    VARIABLES SET AT CONTRACT DEPLOYMENT
    ************************************/
    // ADDRESSES DEFINED AT DEPLOYMENT
    address public ownerAddress;
    address public weiWallet;
    address public tokenWallet;
    address public tokenAddress;

    // USE BLOCK NUMBER TO TRANSITION PHASES
    // NOTE : This is one type of state which represents the passage of time (block number is preferred over timestamp) - consider it "passive". The reliance on passive state guarantees the buyer that once a deposit is made, it can claimed after a predetermined amount of blocks have passed without dependency on the contract owner. This time limit forces the auction owner to take action within a certain amount of time for an auction to be success.
    uint public processingPhaseStartBlock;
    uint public auctionEndBlock;

    // GLOBAL AUCTION CONDITIONS
    uint public minWeiToRaise;
    uint public maxWeiToRaise;
    uint public minTokensForSale;
    uint public maxTokensForSale;

    // AUCTION PHASES
    uint public depositWindowInBlocks;
    uint public processingWindowInBlocks;

    // OTHER AUCTION CONSTRAINTS
    uint public maxTokenBonusPercentage;
    uint public minDepositInWei;

    /*************************************
    SET AFTER AUCTION DEPLOYMENT
    **************************************/
    uint public strikePriceInWei;

    /******************
    INTERNAL ACCOUNTING
    *******************/
    // ERC-20 BASED TOKEN WITH SOME ADDED PROPERTIES FOR HUMAN READABILITY
    // https://github.com/ConsenSys/Tokens/blob/master/contracts/HumanStandardToken.sol
    HumanStandardToken public token;

    // USE ENUM TO REPRESENT STATE UPDATES
    // NOTE : This is the second type of state - consider it "active", it requires method execution to update. The active state keeps track of owner method execution over the course of the auction putting the onus on the contract owner to interact with the contract for an auction to be successful.
    enum AuctionState { deployed, started, success, cancel }
    AuctionState public currentAuctionState = AuctionState.deployed;

    struct Buyer {
        uint depositInWei;  // running total of buyer's deposit
        uint bidWeiAmount;  // bid amount in WEI from off-chain signed bid
        uint totalTokens;   // total amount of tokens to distribute to buyer
        bool hasWithdrawn;  // bool to check if buyer has withdrawn
    }
    mapping(address => Buyer) public allBuyers; // mapping of address to buyer (Buyer struct)
    uint public totalTokensSold; // running total of tokens from processed bids
    uint public totalWeiRaised; // running total of WEI raised from processed bids
    
    /********
    MODIFIERS
    *********/
    modifier auction_deployed_waiting_to_start {
        require(currentAuctionState == AuctionState.deployed);
        _;
    }

    modifier in_purchase_phase {
        require(block.number < processingPhaseStartBlock && currentAuctionState == AuctionState.started);
        _;
    }

    modifier in_processing_phase {
        require(currentAuctionState == AuctionState.started);
        require(processingPhaseStartBlock <= block.number);
        require(block.number < auctionEndBlock);
        _;
    }

    modifier auction_complete {
        require(auctionEndBlock <= block.number || currentAuctionState == AuctionState.success || currentAuctionState == AuctionState.cancel);
        _;
    }

    modifier strike_price_set {
        require(0 < strikePriceInWei);
        _;
    }

    modifier owner_only {
        require(msg.sender == ownerAddress);
        _;
    }
    
    /*******************************************************************************************************
    * token parameters : 
        _tokenAddress : token minting contract address

    * wallets :
        _weiWallet : wallet address to transfer WEI after a successful auction
        _tokenWallet : wallet address to transfer remaining tokens after a successful auction
        
    * deposit constraint :
        _minDepositInWei : minimum deposit accepted in WEI (for an initial or incremental deposit)

    * auction constraints :
        a successful auction will raise at least the minimum and at most the maximum number of WEI 
        _minWeiToRaise : minimum WEI to raise for a successful auction
        _maxWeiToRaise : maximum WEI to raise for a successful auction

        a successful auction will sell at least the minimum and at most the maximum number of tokens
        _minTokensForSale : minimum tokens to sell for a successful auction
        _maxTokensForSale : maximum tokens to sell for a successful auction
    
    * bonus precentage cap :
        _maxTokenBonusPercentage : maximum token percentage bonus that can be applied when processing bids
    
    * auction phase constraints :
        _depositWindowInBlocks : defines the length, in blocks, of the purchase phase
        _processingWindowInBlocks : defines the length, in blocks, of the processing phase
    ******************************************************************************************************/
    function Auction(
        address _tokenAddress, address _weiWallet, address _tokenWallet, uint _minDepositInWei, uint _minWeiToRaise, uint _maxWeiToRaise, uint _minTokensForSale, uint _maxTokensForSale, uint _maxTokenBonusPercentage, uint _depositWindowInBlocks, uint _processingWindowInBlocks) {

        require(0 < _minDepositInWei);
        require(_minDepositInWei <= _minWeiToRaise);
        require(_minWeiToRaise < _maxWeiToRaise);
        require(0 < _minTokensForSale);
        require(_minTokensForSale < _maxTokensForSale);
        require(0 < _depositWindowInBlocks);
        require(0 < _processingWindowInBlocks);

        ownerAddress = msg.sender;
        tokenAddress = _tokenAddress;
        
        weiWallet = _weiWallet;
        tokenWallet = _tokenWallet;

        minDepositInWei = _minDepositInWei;
        minWeiToRaise = _minWeiToRaise;
        maxWeiToRaise = _maxWeiToRaise;
        minTokensForSale = _minTokensForSale;
        maxTokensForSale = _maxTokensForSale;
        maxTokenBonusPercentage = _maxTokenBonusPercentage;

        depositWindowInBlocks = _depositWindowInBlocks;
        processingWindowInBlocks = _processingWindowInBlocks;
    }

    /**************
    BUYER FUNCTIONS
    ***************/
    // buyers can deposit as many time as they want during the purchase phase
    function deposit() in_purchase_phase payable {
        require(minDepositInWei <= msg.value);
        
        Buyer storage buyer = allBuyers[msg.sender];
		buyer.depositInWei = SafeMath.add(buyer.depositInWei, msg.value);

        DepositEvent(msg.sender, msg.value, buyer.depositInWei);
    }

    // buyers can succefully withdraw once the auction is over
    // - if the auction ends and all conditions have been met, the auction was successful
    // - if the auction ends and any condition has not been met, the auction has failed
    // successful auction : buyers can withdraw tokens and remaining deposit
    // failed auction : buyers can only withdraw their deposit
    function withdraw() auction_complete {
        Buyer storage buyer = allBuyers[msg.sender];
        require(buyer.hasWithdrawn == false);
        
        buyer.hasWithdrawn = true;
        require(minDepositInWei <= buyer.depositInWei);

        if (currentAuctionState == AuctionState.success) {
            require(token.transfer(msg.sender, buyer.totalTokens));
            msg.sender.transfer(SafeMath.sub(buyer.depositInWei, buyer.bidWeiAmount));
            
            WithdrawEvent(msg.sender, buyer.totalTokens, SafeMath.sub(buyer.depositInWei, buyer.bidWeiAmount));
        } else {
            msg.sender.transfer(buyer.depositInWei);

            WithdrawEvent(msg.sender, 0, buyer.depositInWei);
        }
    }

    /*******************
    OWNER ONLY FUNCTIONS
    ********************/
    // ASSUMPTION : transfer of max tokens for sale happens after contract deployment but before startAuction() is called
    // startAuction() can only be called once
    // purchase phase begins once startAuction is successfully called
    function startAuction() auction_deployed_waiting_to_start owner_only {
        token = HumanStandardToken(tokenAddress);
        require(token.balanceOf(this) == maxTokensForSale);
        
        processingPhaseStartBlock = block.number + depositWindowInBlocks;
        auctionEndBlock = processingPhaseStartBlock + processingWindowInBlocks;
        currentAuctionState = AuctionState.started;

        StartAuctionEvent(tokenAddress, weiWallet, tokenWallet, minDepositInWei, minWeiToRaise, maxWeiToRaise, minTokensForSale, maxTokensForSale, maxTokenBonusPercentage, processingPhaseStartBlock, auctionEndBlock);
    }

    // the strike price can only be set during the bid processing phase
    // the strike price must be greater than zero
    // the strike price can only be set once
    function setStrikePrice(uint _strikePriceInWei) in_processing_phase owner_only {
        require(strikePriceInWei == 0);
        require(0 < _strikePriceInWei);
        
        strikePriceInWei = _strikePriceInWei;

        SetStrikePriceEvent(strikePriceInWei);
    }

    // off-chain bidding :
    // - signed off-chain bids are submitted during the deposit phase
    // - a bid states a token price in WEI and a total bid amount in WEI
    // - owner processes signed off-chain bids
    // the bid processing phase begins as soon as the deposit phase ends
    // a strike price must be set before bids can be processed
    // a bid must be greater than minimum deposit requirement
    // a bid must be equal or greater than the strike price
    // the total bid amount must be equal or greater than the bid's token price
    // a buyer address can only be associated with the first successful processed bid
    // signature verification is used to determine the buyer address
    // after a bid is successfully processed, the total WEI to collect and total tokens to sell are updated
    // check the total funds raised and number of tokens sold are equal or below the maximum auction success conditions
    function processBid(uint tokenBidPriceInWei, uint bidWeiAmount, uint tokenBonusPercentage, uint8 v, bytes32 r, bytes32 s) strike_price_set in_processing_phase owner_only {
        require(minDepositInWei <= bidWeiAmount);
        require(strikePriceInWei <= tokenBidPriceInWei);
        require(tokenBidPriceInWei <= bidWeiAmount);

        require(0 <= tokenBonusPercentage);
        require(tokenBonusPercentage <= maxTokenBonusPercentage);

        // NON EIP-712
        bytes32 bidHash = sha3(this, tokenBidPriceInWei, bidWeiAmount);
        
        // EIP-712
        // bytes32 bidHash = keccak256(
        //     keccak256("address contractAddress", "uint tokenBidPriceInWei", "uint bidWeiAmount"),
        //     keccak256(this, tokenBidPriceInWei, bidWeiAmount));

        address buyerAddress = ecrecover(bidHash, v, r, s);

        uint numTokensPurchased = SafeMath.div(bidWeiAmount, strikePriceInWei);
        uint numBonusTokens = SafeMath.div( SafeMath.mul(tokenBonusPercentage, numTokensPurchased), 100 );
        uint numTotalTokensForBid = SafeMath.add(numTokensPurchased, numBonusTokens);
        require(SafeMath.add(numTotalTokensForBid, totalTokensSold) <= maxTokensForSale);
        require(SafeMath.add(totalWeiRaised, bidWeiAmount) <= maxWeiToRaise);

        Buyer storage buyer = allBuyers[buyerAddress];
        require(bidWeiAmount <= buyer.depositInWei);
        require(buyer.bidWeiAmount == 0);

        buyer.totalTokens = numTotalTokensForBid;
        buyer.bidWeiAmount = bidWeiAmount;

        totalTokensSold = SafeMath.add(buyer.totalTokens, totalTokensSold);
        totalWeiRaised = SafeMath.add(buyer.bidWeiAmount, totalWeiRaised);

        ProcessBidEvent(buyerAddress, buyer.totalTokens, buyer.bidWeiAmount);
    }

    // called after bids have been processed to end auction
    // must be called in order for an auction to be successful
    // checks to see that the contract has enough tokens to sell
    // checks to see that auction conditions have been met
    // if all conditions are meet, auction state transitions to success
    function completeSuccessfulAuction() strike_price_set in_processing_phase owner_only {
        require(totalTokensSold <= token.balanceOf(this));
        require(minTokensForSale <= totalTokensSold); // maxTokensForSale check done in processBid
        require(minWeiToRaise <= totalWeiRaised); // maxWeiToRaise check done in processBid
        require(token.transfer(tokenWallet, SafeMath.sub( token.balanceOf(this), totalTokensSold )));
        
        weiWallet.transfer(totalWeiRaised);
        currentAuctionState = AuctionState.success;

        AuctionSuccessEvent(strikePriceInWei, totalTokensSold, totalWeiRaised);
    }

    // can only be successfully called by owner if the auction is cancellable
    // causes auction to fail
    function cancelAuction() owner_only {
        require(currentAuctionState != AuctionState.success);
        
        token.transfer(tokenWallet, token.balanceOf(this));
        currentAuctionState = AuctionState.cancel;
        
        CancelAuctionEvent();
    }
}