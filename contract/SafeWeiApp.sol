// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SafeWeiApp
/// @notice The safe.wei frontend, served onchain. `html()` returns the complete,
///         self-contained page (ERC-8244); `request()` serves it to ERC-4804/5219
///         web3:// gateways.
/// @dev The page is split across data contracts whose runtime code is
///      0x00 (STOP, so they cannot be executed) followed by a slice of the page.
///      Immutable: there is no owner and no setter. A new version is a new
///      deployment that `safe.wei` is pointed at.
///
///      Read it without any gateway:
///        cast call <app> "html()(string)" --rpc-url <rpc> > safe.wei.html
contract SafeWeiApp {
    struct KeyValue {
        string key;
        string value;
    }

    /// @notice keccak256 of the full page, computed at deployment.
    bytes32 public immutable contentHash;
    /// @notice Length of the page in bytes.
    uint256 public immutable size;

    address[] internal _chunks;

    error EmptyChunk(uint256 index);

    constructor(address[] memory chunks_) {
        for (uint256 i; i < chunks_.length; ++i) {
            if (chunks_[i].code.length < 2) revert EmptyChunk(i);
        }
        _chunks = chunks_;
        bytes memory page = _page();
        contentHash = keccak256(page);
        size = page.length;
    }

    /// @notice ERC-8244: the full HTML document.
    function html() external view returns (string memory) {
        return string(_page());
    }

    /// @notice ERC-5219 request handler: the same page for any path.
    function request(string[] memory, KeyValue[] memory)
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        statusCode = 200;
        body = string(_page());
        headers = new KeyValue[](2);
        headers[0] = KeyValue("Content-Type", "text/html; charset=utf-8");
        headers[1] = KeyValue("Cache-Control", "public, max-age=31536000, immutable");
    }

    /// @notice ERC-4804 resolve mode: use ERC-5219 `request()`.
    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    /// @notice The data contracts holding the page, in order.
    function chunks() external view returns (address[] memory) {
        return _chunks;
    }

    function _page() internal view returns (bytes memory page) {
        address[] memory c = _chunks;
        assembly ("memory-safe") {
            page := mload(0x40)
            let at := add(page, 0x20)
            let n := mload(c)
            for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                let a := mload(add(add(c, 0x20), shl(5, i)))
                let len := sub(extcodesize(a), 1) // skip the leading STOP byte
                extcodecopy(a, at, 1, len)
                at := add(at, len)
            }
            mstore(page, sub(at, add(page, 0x20)))
            mstore(0x40, and(add(at, 0x1f), not(0x1f)))
        }
    }
}
