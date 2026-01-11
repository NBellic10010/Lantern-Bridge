import * as dotenv from 'dotenv';
import { Relayer } from "./relayServer";
import { loadConfig } from "./config";
import { HttpServer } from "./HttpServer";

dotenv.config();

async function main() {
  const cfg = loadConfig();
  const relayer = new Relayer(cfg);
  const http = new HttpServer(3001);

  http.start();
  await relayer.start();
}

main().catch((err) => {
  console.error("Relayer failed to start", err);
  process.exit(1);
});

