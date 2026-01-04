import {
  CasperClient,
  Contracts,
  DeployUtil,
  Keys,
  RuntimeArgs,
  CLValueBuilder,
  CLKey,
  CLAccountHash,
    CLU8,
    CLList
} from "casper-js-sdk";
import * as fs from "fs";
import * as path from "path";

// 配置
console.log(__dirname)
const NODE_URL = "https://node.testnet.casper.network/rpc";
const CHAIN_NAME = "casper-test";
const KEY_PATH = path.resolve(__dirname, "../../../contracts/bridge_core/1_secret_key.pem"); // 假设 keys 在根目录或上级
const WASM_PATH = path.resolve(__dirname, "../../../contracts/bridge_core/bin/bridge_core.wasm");
const PAYMENT_AMOUNT = 400000000000; // 150 CSPR

const client = new CasperClient(NODE_URL);

// 自定义 Guardian 类型构建器
// 对应 Rust: struct Guardian { key: Key, weight: u8 }
// 注意：如果 Rust 端使用的是 derive(CLTyped)，它可能被视为一个 Tuple2(Key, U8) 或者自定义结构体。
// 在 Casper 中，自定义结构体通常很难直接通过 SDK 构造，除非我们确切知道它的 CLType 布局。
// 最通用的方式是作为 Tuple 传递，或者如果 Rust 侧有特殊解析逻辑。
// 假设 Rust 的 derive(CLTyped) 将 struct Guardian 映射为 (Key, U8) 的布局。
const createGuardian = (accountHex: string, weight: number) => {
  const accountHash = new CLAccountHash(Uint8Array.from(Buffer.from(accountHex, "hex")));
  const key = new CLKey(accountHash);
  // 使用 Tuple2 来模拟结构体
  return CLValueBuilder.tuple2([key, CLValueBuilder.u8(weight)]);
};

async function main() {
  // 1. 加载密钥
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`Error: Secret key not found at ${KEY_PATH}`);
    process.exit(1);
  }
  const keys = Keys.Secp256K1.loadKeyPairFromPrivateFile(KEY_PATH);
  console.log(`Deploying from account: ${keys.publicKey.toHex()}`);

  // 2. 准备参数
  // 模拟一些 guardians
  const adminHex = keys.publicKey.toAccountHashStr().replace("account-hash-", "");
  const guardianList = [
    createGuardian(adminHex, 1), // 自己作为 guardian
    // 可以添加更多: createGuardian("...other_hex...", 1)
  ];

  const args = RuntimeArgs.fromMap({
    admin: CLValueBuilder.key(
      new CLAccountHash(Uint8Array.from(Buffer.from(adminHex, "hex")))
    ),
    guardians: new CLList(guardianList), // Vec<Guardian>
    threshold: CLValueBuilder.u32(1),    // 阈值
    base_apr_bps: CLValueBuilder.u32(500) // 5%
  });

  // 3. 构建 Deploy
  if (!fs.existsSync(WASM_PATH)) {
    console.error(`Error: WASM file not found at ${WASM_PATH}`);
    process.exit(1);
  }
  const wasm = new Uint8Array(fs.readFileSync(WASM_PATH));

  const deploy = DeployUtil.makeDeploy(
    new DeployUtil.DeployParams(keys.publicKey, CHAIN_NAME),
    DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, args),
    DeployUtil.standardPayment(PAYMENT_AMOUNT)
  );

  // 4. 签名
  const signedDeploy = DeployUtil.signDeploy(deploy, keys);

  // 5. 发送
  console.log("Sending deploy...");
  try {
    const deployHash = await client.putDeploy(signedDeploy);
    console.log(`Deploy sent! Hash: ${deployHash}`);
    console.log(`Check status: https://testnet.cspr.live/deploy/${deployHash}`);
  } catch (err) {
    console.error("Deploy failed:", err);
  }
}

main();

