pragma solidity ^0.4.18;
import "./SafeMath.sol";
import "./interfaces/IProxyStorage.sol";
import "./interfaces/IBallotsStorage.sol";
import "./interfaces/IKeysManager.sol";
import "./eternal-storage/EternalStorage.sol";


contract VotingToChangeMinThreshold is EternalStorage {
    using SafeMath for uint256;
    
    enum QuorumStates {Invalid, InProgress, Accepted, Rejected}
    enum ActionChoice {Invalid, Accept, Reject}

    uint8 constant public maxOldMiningKeysDeepCheck = 25;
    uint8 constant thresholdForKeysType = 1;

    event Vote(uint256 indexed id, uint256 decision, address indexed voter, uint256 time, address voterMiningKey);
    event BallotFinalized(uint256 indexed id, address indexed voter);
    event BallotCreated(uint256 indexed id, uint256 indexed ballotType, address indexed creator);

    modifier onlyOwner() {
        require(msg.sender == addressStorage[keccak256("owner")]);
        _;
    }

    modifier onlyValidVotingKey(address _votingKey) {
        IKeysManager keysManager = IKeysManager(getKeysManager());
        require(keysManager.isVotingActive(_votingKey));
        _;
    }

    modifier isValidProposedValue(uint256 _proposedValue) {
        IBallotsStorage ballotsStorage = IBallotsStorage(getBallotsStorage());
        if (demoMode()) {
            require(_proposedValue >= 1 && _proposedValue != getGlobalMinThresholdOfVoters());
        } else {
            require(_proposedValue >= 3 && _proposedValue != getGlobalMinThresholdOfVoters());
        }
        require(_proposedValue <= ballotsStorage.getProxyThreshold());
        _;
    }

    function proxyStorage() public view returns(address) {
        return addressStorage[keccak256("proxyStorage")];
    }

    function nextBallotId() public view returns(uint256) {
        return uintStorage[keccak256("nextBallotId")];
    }

    function activeBallotsLength() public view returns(uint256) {
        return uintStorage[keccak256("activeBallotsLength")];
    }

    function activeBallots(uint256 _index) public view returns(uint256) {
        return uintArrayStorage[keccak256("activeBallots")][_index];
    }

    function validatorActiveBallots(address _miningKey) public view returns(uint256) {
        return uintStorage[keccak256("validatorActiveBallots", _miningKey)];
    }

    function demoMode() public view returns(bool) {
        return boolStorage[keccak256("demoMode")];
    }

    function init(bool _demoMode) public onlyOwner {
        bytes32 initDisabledHash = keccak256("initDisabled");
        require(!boolStorage[initDisabledHash]);
        boolStorage[keccak256("demoMode")] = _demoMode;
        boolStorage[initDisabledHash] = true;
    }

    function createBallotToChangeThreshold(
        uint256 _startTime,
        uint256 _endTime,
        uint256 _proposedValue,
        string memo
    ) public onlyValidVotingKey(msg.sender) isValidProposedValue(_proposedValue) {
        require(_startTime > 0 && _endTime > 0);
        require(_endTime > _startTime && _startTime > getTime());
        uint256 diffTime = _endTime.sub(_startTime);
        if (!demoMode()) {
            require(diffTime > 2 days);
        }
        require(diffTime <= 14 days);
        address creatorMiningKey = getMiningByVotingKey(msg.sender);
        require(withinLimit(creatorMiningKey));
        
        bytes32 nextBallotIdHash = keccak256("nextBallotId");
        uint256 _nextBallotId = uintStorage[nextBallotIdHash];

        bytes32 activeBallotsHash = keccak256("activeBallots");

        uintStorage[keccak256("votingState", _nextBallotId, "startTime")] = _startTime;
        uintStorage[keccak256("votingState", _nextBallotId, "endTime")] = _endTime;
        uintStorage[keccak256("votingState", _nextBallotId, "totalVoters")] = 0;
        intStorage[keccak256("votingState", _nextBallotId, "progress")] = 0;
        boolStorage[keccak256("votingState", _nextBallotId, "isFinalized")] = false;
        uintStorage[keccak256("votingState", _nextBallotId, "quorumState")] = uint8(QuorumStates.InProgress);
        uintStorage[keccak256("votingState", _nextBallotId, "index")] = uintArrayStorage[activeBallotsHash].length;
        uintStorage[keccak256("votingState", _nextBallotId, "proposedValue")] = _proposedValue;
        uintStorage[keccak256("votingState", _nextBallotId, "minThresholdOfVoters")] = getGlobalMinThresholdOfVoters();
        addressStorage[keccak256("votingState", _nextBallotId, "creator")] = creatorMiningKey;
        stringStorage[keccak256("votingState", _nextBallotId, "memo")] = memo;

        uintArrayStorage[activeBallotsHash].push(_nextBallotId);
        uintStorage[keccak256("activeBallotsLength")] =
            uintArrayStorage[activeBallotsHash].length;
        _increaseValidatorLimit();
        BallotCreated(_nextBallotId, 4, msg.sender);
        uintStorage[nextBallotIdHash] = uintStorage[nextBallotIdHash].add(1);
    }

    function vote(uint256 _id, uint8 _choice) public onlyValidVotingKey(msg.sender) {
        require(!getIsFinalized(_id));
        address miningKey = getMiningByVotingKey(msg.sender);
        require(isValidVote(_id, msg.sender));
        if (_choice == uint(ActionChoice.Accept)) {
            intStorage[keccak256("votingState", _id, "progress")]++;
        } else if (_choice == uint(ActionChoice.Reject)) {
            intStorage[keccak256("votingState", _id, "progress")]--;
        } else {
            revert();
        }
        uintStorage[keccak256("votingState", _id, "totalVoters")]++;
        boolStorage[keccak256("votingState", _id, "voters", miningKey)] = true;
        Vote(_id, _choice, msg.sender, getTime(), miningKey);
    }

    function finalize(uint256 _id) public onlyValidVotingKey(msg.sender) {
        require(_id < nextBallotId());
        require(getStartTime(_id) <= getTime());
        require(!isActive(_id));
        require(!getIsFinalized(_id));
        finalizeBallot(_id);
        _decreaseValidatorLimit(_id);
        boolStorage[keccak256("votingState", _id, "isFinalized")] = true;
        BallotFinalized(_id, msg.sender);
    }

    function getBallotsStorage() public view returns(address) {
        return IProxyStorage(proxyStorage()).getBallotsStorage();
    }

    function getKeysManager() public view returns(address) {
        return IProxyStorage(proxyStorage()).getKeysManager();
    }

    function getBallotLimitPerValidator() public view returns(uint256) {
        IBallotsStorage ballotsStorage = IBallotsStorage(getBallotsStorage());
        return ballotsStorage.getBallotLimitPerValidator();
    }

    function getProposedValue(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "proposedValue")];
    }

    function getGlobalMinThresholdOfVoters() public view returns(uint256) {
        IBallotsStorage ballotsStorage = IBallotsStorage(getBallotsStorage());
        return ballotsStorage.getBallotThreshold(thresholdForKeysType);
    }

    function getProgress(uint256 _id) public view returns(int) {
        return intStorage[keccak256("votingState", _id, "progress")];
    }

    function getTotalVoters(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "totalVoters")];
    }

    function getMinThresholdOfVoters(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "minThresholdOfVoters")];
    }

    function getMiningByVotingKey(address _votingKey) public view returns(address) {
        IKeysManager keysManager = IKeysManager(getKeysManager());
        return keysManager.getMiningKeyByVoting(_votingKey);
    }

    function getStartTime(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "startTime")];
    }

    function getEndTime(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "endTime")];
    }

    function getIsFinalized(uint256 _id) public view returns(bool) {
        return boolStorage[keccak256("votingState", _id, "isFinalized")];
    }

    function getQuorumState(uint256 _id) public view returns(uint8) {
        return uint8(uintStorage[keccak256("votingState", _id, "quorumState")]);
    }

    function getIndex(uint256 _id) public view returns(uint256) {
        return uintStorage[keccak256("votingState", _id, "index")];
    }

    function getCreator(uint256 _id) public view returns(address) {
        return addressStorage[keccak256("votingState", _id, "creator")];
    }

    function getTime() public view returns(uint256) {
        return now;
    }

    function getMemo(uint256 _id) public view returns(string) {
        return stringStorage[keccak256("votingState", _id, "memo")];
    }

    function isActive(uint256 _id) public view returns(bool) {
        bool withinTime = getStartTime(_id) <= getTime() && getTime() <= getEndTime(_id);
        return withinTime;
    }

    function hasMiningKeyAlreadyVoted(uint256 _id, address _miningKey) public view returns(bool) {
        return boolStorage[keccak256("votingState", _id, "voters", _miningKey)];
    }

    function hasAlreadyVoted(uint256 _id, address _votingKey) public view returns(bool) {
        address miningKey = getMiningByVotingKey(_votingKey);
        return hasMiningKeyAlreadyVoted(_id, miningKey);
    }
    
    function isValidVote(uint256 _id, address _votingKey) public view returns(bool) {
        address miningKey = getMiningByVotingKey(_votingKey);
        bool notVoted = !hasAlreadyVoted(_id, _votingKey);
        bool oldKeysNotVoted = !areOldMiningKeysVoted(_id, miningKey);
        return notVoted && isActive(_id) && oldKeysNotVoted;
    }

    function areOldMiningKeysVoted(uint256 _id, address _miningKey) public view returns(bool) {
        IKeysManager keysManager = IKeysManager(getKeysManager());
        for (uint8 i = 0; i < maxOldMiningKeysDeepCheck; i++) {
            address oldMiningKey = keysManager.getMiningKeyHistory(_miningKey);
            if (oldMiningKey == address(0)) {
                return false;
            }
            if (hasMiningKeyAlreadyVoted(_id, oldMiningKey)) {
                return true;
            } else {
                _miningKey = oldMiningKey;
            }
        }
        return false;
    }

    function withinLimit(address _miningKey) public view returns(bool) {
        return validatorActiveBallots(_miningKey) <= getBallotLimitPerValidator();
    }

    function finalizeBallot(uint256 _id) private {
        IBallotsStorage ballotsStorage = IBallotsStorage(getBallotsStorage());
        if (getProgress(_id) > 0 && getTotalVoters(_id) >= getMinThresholdOfVoters(_id)) {
            updateBallot(_id, uint8(QuorumStates.Accepted));
            ballotsStorage.setThreshold(getProposedValue(_id), thresholdForKeysType);
        } else {
            updateBallot(_id, uint8(QuorumStates.Rejected));
        }
        deactiveBallot(_id);
    }

    function updateBallot(uint256 _id, uint8 _quorumState) private {
        uintStorage[keccak256("votingState", _id, "quorumState")] = _quorumState;
    }

    function deactiveBallot(uint256 _id) private {
        bytes32 activeBallotsHash = keccak256("activeBallots");
        uint256 removedIndex = uintStorage[keccak256("votingState", _id, "index")];
        uint256 lastIndex = uintArrayStorage[activeBallotsHash].length - 1;
        uint256 lastBallotId = uintArrayStorage[activeBallotsHash][lastIndex];
        // Override the removed ballot with the last one.
        uintArrayStorage[activeBallotsHash][removedIndex] = lastBallotId;
        // Update the index of the last validator.
        uintStorage[keccak256("votingState", lastBallotId, "index")] = removedIndex;
        delete uintArrayStorage[activeBallotsHash][lastIndex];
        if (uintArrayStorage[activeBallotsHash].length > 0) {
            uintArrayStorage[activeBallotsHash].length--;
        }
        uintStorage[keccak256("activeBallotsLength")] =
            uintArrayStorage[activeBallotsHash].length;
    }

    function _increaseValidatorLimit() private {
        address miningKey = getMiningByVotingKey(msg.sender);
        uintStorage[keccak256("validatorActiveBallots", miningKey)] = 
            uintStorage[keccak256("validatorActiveBallots", miningKey)].add(1);
    }

    function _decreaseValidatorLimit(uint256 _id) private {
        address miningKey = getCreator(_id);
        uintStorage[keccak256("validatorActiveBallots", miningKey)] = 
            uintStorage[keccak256("validatorActiveBallots", miningKey)].sub(1);
    }
}
