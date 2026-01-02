import { z } from "zod";

export const ConfigSchema = z.object({
  ETH_RPC: z.string(),
  ETH_CONFIRMATIONS: z.coerce.number().min(0).default(12),
  ETH_VAULT_ADDRESS: z.string().optional(), // EthBridgeVault
  ETH_WCSRP_ADDRESS: z.string().optional(), // WrappedCSPR
  CSPR_NODE: z.string(),
  CSPR_POLL_MS: z.coerce.number().min(500).default(5000),
  CSPR_FINALITY_DEPTH: z.coerce.number().min(0).default(5),
  CSPR_CHAIN_ID: z.string(),
  CSPR_DEPLOY_HASH_PREFIX: z.string().optional(),
});

export type RelayerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env = process.env): RelayerConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Config error: ${parsed.error.message}`);
  }
  return parsed.data;
}