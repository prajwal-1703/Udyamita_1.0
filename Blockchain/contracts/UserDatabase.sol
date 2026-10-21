// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract UserDatabase is AccessControl {
    struct User {
        address wallet;
        string username;
        uint xp; // This will be updated by the backend via updateUserXP
        // bool hasConnectedGithub; // REMOVED
        uint8 lastRewardedLevel;
    }

    mapping(address => User) public users;
    address[] private userAddresses;
    mapping(address => uint) private userIndex;

    bytes32 public constant XP_UPDATER_ROLE = keccak256("XP_UPDATER_ROLE");
    bytes32 public constant REWARD_SYNC_ROLE = keccak256("REWARD_SYNC_ROLE");

    // --- REMOVED Constant ---
    // uint256 public constant GITHUB_CONNECTION_XP = 100;

    // --- Events ---
    event UserRegistered(address indexed userAddress, string username);
    // event UserRegisteredWithXP(address indexed userAddress, string username, uint xp); // REMOVED - Function repurposed
    event UserRemoved(address indexed userAddress);
    // event GithubXPGranted(address indexed userAddress, uint amount); // REMOVED
    event UserXPUpdated(address indexed userAddress, uint newTotalXP); // NEW/REVISED Event for updates
    event LastRewardedLevelUpdated(address indexed userAddress, uint8 newLevel);


    constructor(address _initialUpdaterAddress, address _initialRewardSyncAddress) AccessControl() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        require(_initialUpdaterAddress != address(0), "Initial updater address cannot be zero");
        _grantRole(XP_UPDATER_ROLE, _initialUpdaterAddress); // Backend wallet gets this role
        require(_initialRewardSyncAddress != address(0), "Initial reward sync address cannot be zero");
        _grantRole(REWARD_SYNC_ROLE, _initialRewardSyncAddress);
    }

    /**
     * @notice Registers a new user setting initial XP to 0.
     * @dev Can only be called once per user (msg.sender).
     * @param _username The desired username.
     */
    function setUser(string memory _username) public {
        require(users[msg.sender].wallet == address(0), "User already exists");
        // Initialize user with 0 XP, level 0. Removed hasConnectedGithub flag.
        users[msg.sender] = User(msg.sender, _username, 0, 0);
        _addUserToList(msg.sender);
        emit UserRegistered(msg.sender, _username);
    }

    /**
     * @notice Updates the total XP for an existing user. OVERWRITES previous XP value.
     * @dev Callable only by XP_UPDATER_ROLE (backend server). Username remains unchanged.
     *      The `_newTotalXP` should be calculated by the backend based on external data (e.g., GitHub).
     * @param _user The address of the user whose XP is being updated.
     * @param _newTotalXP The new total XP value calculated by the backend.
     */
    // --- RENAMED & MODIFIED from setUserWithXP ---
    function updateUserXP(address _user, uint _newTotalXP) public onlyRole(XP_UPDATER_ROLE) {
        // REMOVED: require(users[msg.sender].wallet == address(0), "User already exists");
        User storage userToUpdate = users[_user];
        require(userToUpdate.wallet != address(0), "User does not exist"); // MUST exist to update

        // Only update the XP field. Username, wallet, level are untouched here.
        userToUpdate.xp = _newTotalXP;

        // Emit event with the new total XP
        emit UserXPUpdated(_user, _newTotalXP);
    }


    // --- REMOVED FUNCTION ---
    // function grantGithubXP(address _user) public onlyRole(XP_UPDATER_ROLE) { ... }

    // --- Other functions remain the same ---
    function removeUser(address _user) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(users[_user].wallet != address(0), "User does not exist");
        _removeUserFromList(_user);
        delete users[_user];
        emit UserRemoved(_user);
    }

     function setLastRewardedLevel(address _user, uint8 _level) public onlyRole(REWARD_SYNC_ROLE) {
        User storage userToUpdate = users[_user];
        require(userToUpdate.wallet != address(0), "User does not exist");
        userToUpdate.lastRewardedLevel = _level;
        emit LastRewardedLevelUpdated(_user, _level);
    }

    function getUser(address _user) public view returns (User memory) {
        require(users[_user].wallet != address(0), "User does not exist");
        return users[_user];
    }

    function getLastRewardedLevel(address _user) public view returns (uint8) {
        return users[_user].lastRewardedLevel;
    }

    function getUserCount() public view returns (uint) {
        return userAddresses.length;
    }

    function getAllUsers() public view returns (User[] memory) {
        uint userCount = userAddresses.length;
        User[] memory allUsers = new User[](userCount);
        for (uint i = 0; i < userCount; i++) {
            allUsers[i] = users[userAddresses[i]];
        }
        return allUsers;
    }

    // --- Internal helper functions ---
    function _addUserToList(address _user) internal {
        userIndex[_user] = userAddresses.length;
        userAddresses.push(_user);
    }

     function _removeUserFromList(address _user) internal {
        uint indexToRemove = userIndex[_user];
        require(indexToRemove < userAddresses.length, "Index out of bounds");
        if (indexToRemove != userAddresses.length - 1) {
            address lastUserAddress = userAddresses[userAddresses.length - 1];
            userAddresses[indexToRemove] = lastUserAddress;
            userIndex[lastUserAddress] = indexToRemove;
        }
        userAddresses.pop();
        delete userIndex[_user];
    }
}