# Auction

This repo contains the on-chain contracts for an hybrid on/off-chain auction.

## Getting Started
Auction.sol is the on-chain contract for a two phase hybrid on/off-chain auction. The auction consists of :
* purchase phase
* process bid phase

There are two contracts that get deployed, the `token contract` and the `auction contract`. The token contract is ConsenSys' [HumanStandardToken](https://github.com/ConsenSys/Tokens/blob/master/contracts/HumanStandardToken.sol) which is ERC-20 compliant (it adds some properties for easier human readability, hence the name). 

For Auction.sol, [SafeMath](https://github.com/OpenZeppelin/zeppelin-solidity/blob/master/contracts/math/SafeMath.sol) is used to check for uint256 overflow (an [example](https://gist.github.com/aquabu/30378c5375f388a28572dd18d58f787f) ). 

Please see comments in contract for more details. Values can be configured using `conf/data.json` and `conf/config.js`


### Prerequisites

If not already installed, get [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com). Node.js version 8+ required.

This project uses the [Truffle Framework](http://truffleframework.com) and [testrpc](https://github.com/ethereumjs/testrpc)

At the time of this writing, the latest supported version of truffle uses Solidity 0.4.15. The contracts only compile using solc version 0.4.15.

```
npm install -g truffle 
```

```
npm install -g ethereumjs-testrpc
```

### Installing

```
1. npm install
```

2. copy and pase the testrpc command in a terminal window (from any directory) :

```
testrpc --gasPrice 3 --account="0x99a53a700f6cc2a5890e45fe7dced2d94b720df8596f67ce2503d1fec86a1d23, 500000000000000000000000000000000000000000000000000000000000000000000000000000000" --account="0xa36bddfa1f57d0ffb0c83e382b9879f8387935178e8e819e6ee6038764f10d59, 500000000000000000000000000000000000000000000000000000000000000000000000000000000" --account="0x0a96aff0b2582b2637fa0e9b3a56c0dc7e4ad952fd3e2432bcbe996ca268473a, 0" --account="0xc5e51e235e3a6de5060b9abafd64b9a87dab42f5c5c00d634e8953096825dd1c, 0" --account="0x74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63, 50000000000000000000000000000000000000000" --account="0xac2f0b857247cc0c57dcc6b7e697c2b3a05b80361264fcaeab851599e92cf59f, 50000000000000000000000000000000000000000"
```
dervied from (`pubkey` `prikey`)
```
0x0bCAA9d3aE0e85D8774CdBE5991985CeFb8f0EAa 0x99a53a700f6cc2a5890e45fe7dced2d94b720df8596f67ce2503d1fec86a1d23 // token contract owner
0x0Ab182C0A3346bF5c569Db03321533b45dfd30ff 0xa36bddfa1f57d0ffb0c83e382b9879f8387935178e8e819e6ee6038764f10d59 // auction contract owner
0xc92F8E8E0b6c0a1036C290cEC9C9C3Ad6233ada0 0x0a96aff0b2582b2637fa0e9b3a56c0dc7e4ad952fd3e2432bcbe996ca268473a // wei wallet
0x6FD77f00449cAA1d22698b3D92731e186924b76a 0xc5e51e235e3a6de5060b9abafd64b9a87dab42f5c5c00d634e8953096825dd1c // token wallet
0x1fF2ae37ce02d20c32141F92aE79ce90E37a73f1 0x74dfae24d3792ecf85a4a708dbcd6c555f463d674922612302a1531d5cd94f63 // buyer
0x82147345a8Bb84Ae13a0c8f4aa8954B69e9022c1 0xac2f0b857247cc0c57dcc6b7e697c2b3a05b80361264fcaeab851599e92cf59f // buyer
```

3. In a new terminal window, get back to this repo's top level directory and type :

```
truffle test
```

## Acknowledgments
* inspired by Nick Johnson's auction contract : https://gist.github.com/Arachnid/b9886ef91d5b47c31d2e3c8022eeea27
* many extremely helpful code reviews with [Ameen](https://github.com/ameensol) and [Yogesh](https://github.com/yogeshgo05)
* please improve on this and make it better, pull requests welcome! 🚀
* toward better and more efficient token sales - ENJOY!

![](https://i.pinimg.com/736x/7f/1f/4d/7f1f4dc4c3fe6f1385e4abe541cb1df4--so-funny-funny-shit.jpg)


## Contact me!
* [github](https://github.com/jamesyoung)
* [twitter](https://twitter.com/jamesyoung)
