import { z } from "zod";

export const ConfigSchema = z.object({
  ETH_RPC: z.string(),
  ETH_CONFIRMATIONS: z.coerce.number().min(0).default(12),
  ETH_WCSRP_ADDRESS: z.string().optional(), // WrappedCSPR
  CSPR_NODE: z.string(),
  CSPR_POLL_MS: z.coerce.number().min(500).default(5000),
  CSPR_FINALITY_DEPTH: z.coerce.number().min(0).default(5),
  CSPR_CHAIN_ID: z.string(),
  CSPR_DEPLOY_HASH_PREFIX: z.string().optional(),
  
  // Relayer 私钥 (用于签名交易)
  ETH_PRIVATE_KEY: z.string().min(64), // Hex string without 0x or with 0x
  CSPR_PRIVATE_KEY_PATH: z.string(), // Path to .pem file

  //Contract Address
  BRIDGE_CONTRACT_HASH_CSPR: z.string(),
  BRIDGE_CONTRACT_HASH_EVM: z.string(),

  //Gas
  GAS_CSPR: z.coerce.number().min(0).default(1000000000), //CSPR
  GAS_EVM: z.coerce.number().min(0).default(1000000000), //ETH
});

export type RelayerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env = process.env): RelayerConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Config error: ${parsed.error.message}`);
  }
  return parsed.data;
}