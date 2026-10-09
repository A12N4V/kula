pragma solidity ^0.8.0;
import "./Util.sol";
contract Greeter {
    function greet() public returns (uint) { return helper(1); }
    function helper(uint x) internal returns (uint) { return x; }
}
interface IShape { function area() external returns (uint); }
