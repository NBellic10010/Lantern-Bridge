import http from "http";
import pino from "pino";

export class HttpServer {
  private server: http.Server | null = null;
  private readonly log = pino({ name: "relayer-http", level: "info" });
  constructor(private readonly port: number = 3000) {}

  start() {
    if (this.server) return;
    this.server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    this.server.listen(this.port, () => {
      this.log.info({ port: this.port }, "HTTP server started");
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }
}

