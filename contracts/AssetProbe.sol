// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// Simulation only: inject at an unused address, delegate through Safe.simulateAndRevert.
/// No storage writes, funding overrides, signature shortcuts, or deployed contracts.
contract AssetProbe {
    function read(address token, bytes memory data) private view returns (bool ok, uint256 amount) {
        assembly {
            let out := mload(0x40)
            ok := staticcall(75000, token, add(data, 32), mload(data), out, 32)
            ok := and(ok, eq(returndatasize(), 32))
            amount := mload(out)
        }
    }

    // [success, nativeBefore, nativeAfter, ok, before, after, ...]
    // Balance triples first, followed by allowance triples in pair order.
    function preview(address target, uint256 value, bytes memory data, uint8 operation, address[] memory tokens, address[] memory approvalTokens, address[] memory spenders)
        external returns (uint256[] memory result)
    {
        require(tokens.length <= 128 && approvalTokens.length <= 128 && approvalTokens.length == spenders.length && operation <= 1);
        result = new uint256[](3 + (tokens.length + approvalTokens.length) * 3);
        result[1] = address(this).balance;
        for (uint256 i; i < tokens.length + approvalTokens.length; ++i) {
            (bool ok, uint256 amount) = i < tokens.length
                ? read(tokens[i], abi.encodeWithSelector(bytes4(0x70a08231), address(this)))
                : read(approvalTokens[i - tokens.length], abi.encodeWithSelector(bytes4(0xdd62ed3e), address(this), spenders[i - tokens.length]));
            result[3 + i * 3] = ok ? 1 : 0;
            result[4 + i * 3] = amount;
        }
        bool success;
        // Do not copy unbounded return data from an arbitrary target.
        assembly {
            switch operation
            case 0 { success := call(gas(), target, value, add(data, 32), mload(data), 0, 0) }
            case 1 { success := delegatecall(gas(), target, add(data, 32), mload(data), 0, 0) }
        }
        result[0] = success ? 1 : 0;
        result[2] = address(this).balance;
        for (uint256 i; i < tokens.length + approvalTokens.length; ++i) {
            (bool ok, uint256 amount) = i < tokens.length
                ? read(tokens[i], abi.encodeWithSelector(bytes4(0x70a08231), address(this)))
                : read(approvalTokens[i - tokens.length], abi.encodeWithSelector(bytes4(0xdd62ed3e), address(this), spenders[i - tokens.length]));
            if (!ok) result[3 + i * 3] = 0;
            result[5 + i * 3] = amount;
        }
    }
}
