// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint);
    function balanceOf(address account) external view returns (uint);
    function transfer(address recipient, uint amount) external returns (bool);
    function approve(address spender, uint amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint);

    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);
}

contract UCoin is IERC20 {
    string public constant symbol = "UCN";
    string public constant name = "UCoin";
    uint8 public constant decimals = 18;
    uint public immutable _totalSupply;

    address public immutable owner;
    address public immutable rewardTreasury;  // ✅ Store rewards separately
    address public immutable devWallet;

    mapping(address => uint) private balances;
    mapping(address => mapping(address => uint)) private allowances;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }

    constructor(address _rewardTreasury, address _devWallet) {
        require(_rewardTreasury != address(0), "Invalid reward treasury address");
        require(_devWallet != address(0), "Invalid dev wallet address");

        owner = msg.sender;
        rewardTreasury = _rewardTreasury;
        devWallet = _devWallet;

        _totalSupply = 1_000_001 * (10 ** uint(decimals));

        uint rewardSupply = (_totalSupply * 70) / 100;  // 70% for rewards
        uint devSupply = _totalSupply - rewardSupply;   // 30% for dev wallet

        balances[rewardTreasury] = rewardSupply;
        balances[devWallet] = devSupply;

        emit Transfer(address(0), rewardTreasury, rewardSupply);
        emit Transfer(address(0), devWallet, devSupply);
    }

    function totalSupply() public view override returns (uint) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint) {
        return balances[account];
    }

    function transfer(address recipient, uint amount) public override returns (bool) {
        require(recipient != address(0), "Invalid recipient");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        unchecked {
            balances[msg.sender] -= amount;
            balances[recipient] += amount;
        }

        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint amount) public override returns (bool) {
        require(spender != address(0), "Invalid spender");

        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint amount) public override returns (bool) {
        require(recipient != address(0), "Invalid recipient");
        require(balances[sender] >= amount, "Insufficient balance");
        require(allowances[sender][msg.sender] >= amount, "Allowance exceeded");

        unchecked {
            balances[sender] -= amount;
            allowances[sender][msg.sender] -= amount;
            balances[recipient] += amount;
        }

        emit Transfer(sender, recipient, amount);
        return true;
    }

    function allowance(address _owner, address spender) public view override returns (uint) {
        return allowances[_owner][spender];
    }

    function increaseAllowance(address spender, uint addedValue) public returns (bool) {
        require(spender != address(0), "Invalid spender");

        allowances[msg.sender][spender] += addedValue;
        emit Approval(msg.sender, spender, allowances[msg.sender][spender]);
        return true;
    }

    function decreaseAllowance(address spender, uint subtractedValue) public returns (bool) {
        require(spender != address(0), "Invalid spender");
        require(allowances[msg.sender][spender] >= subtractedValue, "Decreased allowance below zero");

        unchecked {
            allowances[msg.sender][spender] -= subtractedValue;
        }

        emit Approval(msg.sender, spender, allowances[msg.sender][spender]);
        return true;
    }
}
