// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DearmersDAO} from "./DearmersDAO.sol";

contract DearmersRegistry {
    struct DAORecord {
        bytes32 daoId;
        address admin;
        address dao;
        address treasury;
        DearmersDAO.DaoMode mode;
        string name;
        string metadataUri;
        bool active;
    }

    error InvalidInput();
    error AlreadyExists();
    error Unauthorized();

    address public owner;
    mapping(address => bool) public creationRelayers;

    constructor() {
        owner = msg.sender;
        creationRelayers[msg.sender] = true;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyCreationRelayer() {
        if (!creationRelayers[msg.sender]) revert Unauthorized();
        _;
    }

    uint256 public daoCount;
    mapping(bytes32 => DAORecord) private daos;
    mapping(address => bytes32[]) private adminDaos;
    bytes32[] private daoIds;

    event DAOCreated(bytes32 indexed daoId, address indexed dao, address indexed admin, DearmersDAO.DaoMode mode, string name);
    event DAOStatusChanged(bytes32 indexed daoId, bool active);
    event CreationRelayerChanged(address indexed relayer, bool allowed);

    function setCreationRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert InvalidInput();
        creationRelayers[relayer] = allowed;
        emit CreationRelayerChanged(relayer, allowed);
    }

    function createDAO(
        bytes32 daoId,
        address treasury,
        DearmersDAO.DaoMode mode,
        address reviewOracle,
        address executor,
        string calldata name,
        string calldata metadataUri
    ) external returns (address daoAddress) {
        return _createDAO(msg.sender, daoId, treasury, mode, reviewOracle, executor, name, metadataUri);
    }

    function createDAOFor(
        address admin,
        bytes32 daoId,
        address treasury,
        DearmersDAO.DaoMode mode,
        address reviewOracle,
        address executor,
        string calldata name,
        string calldata metadataUri
    ) external onlyCreationRelayer returns (address daoAddress) {
        return _createDAO(admin, daoId, treasury, mode, reviewOracle, executor, name, metadataUri);
    }

    function _createDAO(
        address admin,
        bytes32 daoId,
        address treasury,
        DearmersDAO.DaoMode mode,
        address reviewOracle,
        address executor,
        string calldata name,
        string calldata metadataUri
    ) internal returns (address daoAddress) {
        if (admin == address(0) || daoId == bytes32(0) || treasury == address(0) || reviewOracle == address(0) || executor == address(0) || bytes(name).length == 0) revert InvalidInput();
        if (daos[daoId].dao != address(0)) revert AlreadyExists();
        DearmersDAO dao = new DearmersDAO(admin, daoId, mode, treasury, reviewOracle, executor, address(this));
        daoAddress = address(dao);
        daos[daoId] = DAORecord(daoId, admin, daoAddress, treasury, mode, name, metadataUri, true);
        adminDaos[admin].push(daoId);
        daoIds.push(daoId);
        daoCount++;
        emit DAOCreated(daoId, daoAddress, msg.sender, mode, name);
    }

    function setDAOStatus(bytes32 daoId, bool active) external {
        DAORecord storage record = daos[daoId];
        if (record.dao == address(0)) revert InvalidInput();
        if (msg.sender != record.admin) revert Unauthorized();
        record.active = active;
        emit DAOStatusChanged(daoId, active);
    }

    function getDAO(bytes32 daoId) external view returns (DAORecord memory) { return daos[daoId]; }
    function getAdminDAOs(address admin) external view returns (bytes32[] memory) { return adminDaos[admin]; }
    function getDAOIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory result) {
        if (offset >= daoIds.length) return new bytes32[](0);
        uint256 end = offset + limit;
        if (end > daoIds.length) end = daoIds.length;
        result = new bytes32[](end - offset);
        for (uint256 index = offset; index < end; index++) result[index - offset] = daoIds[index];
    }
}
