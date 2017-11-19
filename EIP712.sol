pragma solidity 0.4.15;

contract EIP712 {
 address public addr;
 event EIP712Event(address recoveredAddress);
 
 function EIP712(){}
 
 function process(address contractAddress, uint tokenBidPriceInWei, uint bidWeiAmount, uint8 v, bytes32 r, bytes32 s) {
    bytes32 bidHash = keccak256(
        keccak256("address contractAddress", "uint256 tokenBidPriceInWei", "uint256 bidWeiAmount"),
        keccak256(contractAddress, tokenBidPriceInWei, bidWeiAmount));

    addr = ecrecover(bidHash, v, r, s);
    EIP712Event(addr);
 }   
}