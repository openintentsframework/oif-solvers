// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import { Script } from "../lib/forge-std/forge-std/src/Script.sol";
import { console } from "../lib/forge-std/forge-std/src/console.sol";
import { TheCompact } from "../lib/the-compact/src/TheCompact.sol";
import { MandateOutput } from "../src/libs/MandateOutputEncodingLib.sol";
import { StandardOrder } from "../src/settlers/types/StandardOrderType.sol";

contract GenerateSignature is Script {
    function run() external view {
        // Read parameters from environment variables
        uint256 privateKey = vm.envUint("SIGNATURE_PRIVATE_KEY");
        address arbiter = vm.envAddress("SIGNATURE_ARBITER");
        address sponsor = vm.envAddress("SIGNATURE_SPONSOR");
        uint256 nonce = vm.envUint("SIGNATURE_NONCE");
        uint256 expires = vm.envUint("SIGNATURE_EXPIRES");
        uint256 tokenId = vm.envUint("SIGNATURE_TOKEN_ID");
        uint256 inputAmount = vm.envUint("SIGNATURE_INPUT_AMOUNT");
        uint256 outputAmount = vm.envUint("SIGNATURE_OUTPUT_AMOUNT");
        uint32 fillDeadline = uint32(vm.envUint("SIGNATURE_FILL_DEADLINE"));
        address localOracle = vm.envAddress("SIGNATURE_LOCAL_ORACLE");
        bytes32 remoteOracle = vm.envBytes32("SIGNATURE_REMOTE_ORACLE");
        bytes32 remoteFiller = vm.envBytes32("SIGNATURE_REMOTE_FILLER");
        uint256 chainId = vm.envUint("SIGNATURE_CHAIN_ID");
        bytes32 outputToken = vm.envBytes32("SIGNATURE_OUTPUT_TOKEN");
        bytes32 recipient = vm.envBytes32("SIGNATURE_RECIPIENT");
        bytes32 domainSeparator = vm.envBytes32("SIGNATURE_DOMAIN_SEPARATOR");
        
        // Create order structure
        uint256[2][] memory inputs = new uint256[2][](1);
        inputs[0] = [tokenId, inputAmount];
        
        MandateOutput[] memory outputs = new MandateOutput[](1);
        outputs[0] = MandateOutput({
            remoteOracle: remoteOracle,
            remoteFiller: remoteFiller,
            chainId: chainId,
            token: outputToken,
            amount: outputAmount,
            recipient: recipient,
            remoteCall: hex"",
            fulfillmentContext: hex""
        });
        
        StandardOrder memory order = StandardOrder({
            user: sponsor,
            nonce: nonce,
            originChainId: 31337, // Fixed for this setup
            expires: uint32(expires),
            fillDeadline: fillDeadline,
            localOracle: localOracle,
            inputs: inputs,
            outputs: outputs
        });
        
        // Generate witness hash
        bytes32 witnessHash = _witnessHash(order);
        
        // Generate signature
        bytes memory signature = _getCompactBatchWitnessSignature(
            privateKey,
            arbiter,
            sponsor,
            nonce,
            expires,
            inputs,
            witnessHash,
            domainSeparator
        );
        
        // Output just the signature hex string for easy consumption
        console.log(vm.toString(signature));
    }
    
    function _getCompactBatchWitnessSignature(
        uint256 privateKey,
        address arbiter,
        address sponsor,
        uint256 nonce,
        uint256 expires,
        uint256[2][] memory idsAndAmounts,
        bytes32 witness,
        bytes32 domainSeparator
    ) internal pure returns (bytes memory sig) {
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(
                    abi.encode(
                        keccak256(
                            bytes(
                                "BatchCompact(address arbiter,address sponsor,uint256 nonce,uint256 expires,uint256[2][] idsAndAmounts,Mandate mandate)Mandate(uint32 fillDeadline,address localOracle,MandateOutput[] outputs)MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
                            )
                        ),
                        arbiter,
                        sponsor,
                        nonce,
                        expires,
                        keccak256(abi.encodePacked(idsAndAmounts)),
                        witness
                    )
                )
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, msgHash);
        return bytes.concat(r, s, bytes1(v));
    }

    function _witnessHash(StandardOrder memory order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    bytes(
                        "Mandate(uint32 fillDeadline,address localOracle,MandateOutput[] outputs)MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
                    )
                ),
                order.fillDeadline,
                order.localOracle,
                _outputsHash(order.outputs)
            )
        );
    }

    function _outputsHash(MandateOutput[] memory outputs) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](outputs.length);
        for (uint256 i = 0; i < outputs.length; ++i) {
            MandateOutput memory output = outputs[i];
            hashes[i] = keccak256(
                abi.encode(
                    keccak256(
                        bytes(
                            "MandateOutput(bytes32 remoteOracle,bytes32 remoteFiller,uint256 chainId,bytes32 token,uint256 amount,bytes32 recipient,bytes remoteCall,bytes fulfillmentContext)"
                        )
                    ),
                    output.remoteOracle,
                    output.remoteFiller,
                    output.chainId,
                    output.token,
                    output.amount,
                    output.recipient,
                    keccak256(output.remoteCall),
                    keccak256(output.fulfillmentContext)
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }
} 