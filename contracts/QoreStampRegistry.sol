// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title QoreStampRegistry
/// @notice Tiny on-chain registry for QoreStamp attestations on QoreChain's
///         EVM engine (testnet qorechain-diana, chain id 9800).
///
/// A stamp records, under the attestation digest (bytes32):
///   - who stamped it (the EVM caller),
///   - the agent label,
///   - the hash of the agent's ML-DSA-87 public key,
///   - the hash of the hybrid-signed native tx that anchors the attestation
///     on the post-quantum path, and
///   - when it was stamped.
///
/// The digest itself commits to the full attestation (label + statement hash
/// + PQC key hash + chain id, see src/lib/attestation.ts), so the registry
/// stays minimal while remaining publicly verifiable.
contract QoreStampRegistry {
    struct Stamp {
        address stamper;
        string label;
        bytes32 pqcKeyHash;
        string nativeTxHash;
        uint256 timestamp;
    }

    mapping(bytes32 => Stamp) private _stamps;
    bytes32[] private _digests;

    event Stamped(
        bytes32 indexed digest,
        address indexed stamper,
        string label,
        bytes32 pqcKeyHash,
        string nativeTxHash,
        uint256 timestamp
    );

    error AlreadyStamped(bytes32 digest);
    error EmptyLabel();
    error EmptyNativeTxHash();

    /// @notice Record an attestation. One stamp per digest, first writer wins.
    function stamp(
        bytes32 digest,
        string calldata label,
        bytes32 pqcKeyHash,
        string calldata nativeTxHash
    ) external {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (bytes(nativeTxHash).length == 0) revert EmptyNativeTxHash();
        if (_stamps[digest].timestamp != 0) revert AlreadyStamped(digest);

        _stamps[digest] = Stamp({
            stamper: msg.sender,
            label: label,
            pqcKeyHash: pqcKeyHash,
            nativeTxHash: nativeTxHash,
            timestamp: block.timestamp
        });
        _digests.push(digest);

        emit Stamped(digest, msg.sender, label, pqcKeyHash, nativeTxHash, block.timestamp);
    }

    /// @notice Read a stamp back. A zero timestamp means "not stamped".
    function getStamp(bytes32 digest)
        external
        view
        returns (
            address stamper,
            string memory label,
            bytes32 pqcKeyHash,
            string memory nativeTxHash,
            uint256 timestamp
        )
    {
        Stamp storage s = _stamps[digest];
        return (s.stamper, s.label, s.pqcKeyHash, s.nativeTxHash, s.timestamp);
    }

    /// @notice Whether a digest has been stamped.
    function isStamped(bytes32 digest) external view returns (bool) {
        return _stamps[digest].timestamp != 0;
    }

    /// @notice Total number of stamps recorded.
    function stampCount() external view returns (uint256) {
        return _digests.length;
    }

    /// @notice The digest recorded at `index` (insertion order).
    function digestAt(uint256 index) external view returns (bytes32) {
        return _digests[index];
    }
}
