// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract BallGame {
    struct Game {
        uint256 startTime;
        uint16[10] xs;
        uint16[10] ys;
        address[10] claimedBy;
        uint8 claimedCount;
    }

    uint256 public currentGameId;
    mapping(uint256 => Game) public games;

    event GameStarted(uint256 indexed gameId, uint256 startTime, uint16[10] xs, uint16[10] ys);
    event BallClaimed(uint256 indexed gameId, uint8 index, address player);

    function startGame() external {
        if (currentGameId > 0) {
            require(games[currentGameId].claimedCount == 10, "Current game still active");
        }

        currentGameId++;
        Game storage g = games[currentGameId];
        g.startTime = block.timestamp;

        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, currentGameId)));
        for (uint8 i = 0; i < 10; i++) {
            uint256 hash = uint256(keccak256(abi.encodePacked(seed, i)));
            g.xs[i] = uint16(hash % 801) + 100;
            g.ys[i] = uint16((hash >> 16) % 801) + 100;
        }

        emit GameStarted(currentGameId, g.startTime, g.xs, g.ys);
    }

    function claimBall(uint8 index) external {
        require(currentGameId > 0, "No active game");
        require(index < 10, "Invalid ball index");

        Game storage g = games[currentGameId];
        require(g.claimedCount < 10, "Game already finished");
        require(g.claimedBy[index] == address(0), "Ball already claimed");

        g.claimedBy[index] = msg.sender;
        g.claimedCount++;

        emit BallClaimed(currentGameId, index, msg.sender);
    }

    function getGamePositions(uint256 gameId) external view returns (uint16[10] memory xs, uint16[10] memory ys) {
        Game storage g = games[gameId];
        return (g.xs, g.ys);
    }

    function getGameClaims(uint256 gameId) external view returns (address[10] memory claimedBy, uint8 claimedCount) {
        Game storage g = games[gameId];
        return (g.claimedBy, g.claimedCount);
    }

    function getGameStartTime(uint256 gameId) external view returns (uint256) {
        return games[gameId].startTime;
    }

    function isGameActive() external view returns (bool) {
        if (currentGameId == 0) return false;
        return games[currentGameId].claimedCount < 10;
    }
}
