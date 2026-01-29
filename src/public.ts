import WebSocket from "ws";
import { loadConfig } from "./config";
import { createMysqlPool } from "./mysql";
import { TxDigestInserter } from "./txDigestInserter";

function safeToString(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString();
}

function extractPublicTxDigests(message: unknown): string[] {
  const txEvents = (message as any)?.params?.result?.tx_events;
  if (!Array.isArray(txEvents) || txEvents.length === 0) return [];

  const digests: string[] = [];
  for (const txEvent of txEvents) {
    const digest = (txEvent as any)?.tx_digest;
    if (typeof digest === "string" && digest.trim()) digests.push(digest);
  }
  return digests;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createMysqlPool(config.mysql);
  console.log(
    `[public] mysql: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database} table=public_tx_digest`
  );
  const inserter = new TxDigestInserter(pool, "public_tx_digest", {
    flushIntervalMs: config.dbFlushIntervalMs,
    maxBatchSize: config.dbMaxBatchSize
  });
  inserter.start();

  let reconnectAttempt = 0;
  let ws: WebSocket | null = null;

  const subscribePayload = {
    jsonrpc: "2.0",
    id: 1,
    method: config.publicWs.subscribeMethod,
    params: []
  };

  const connect = () => {
    const url = config.publicWs.url;
    console.log(`[public] connecting: ${url}`);

    ws = new WebSocket(url);

    ws.on("open", () => {
      reconnectAttempt = 0;
      console.log("[public] connected; subscribing...");
      ws?.send(JSON.stringify(subscribePayload));
    });

    ws.on("message", (data) => {
      const raw = safeToString(data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const digests = extractPublicTxDigests(parsed);
      for (const digest of digests) inserter.enqueue(digest);
    });

    ws.on("error", (error) => {
      console.error("[public] websocket error", error);
    });

    ws.on("close", (code, reason) => {
      const reasonText = reason.toString("utf8");
      console.warn(`[public] closed: code=${code} reason=${reasonText}`);
      ws = null;
      scheduleReconnect();
    });

    ws.on("ping", () => ws?.pong());
  };

  const scheduleReconnect = () => {
    const baseDelay = 1000;
    const maxDelay = 30_000;
    const delay = Math.min(maxDelay, baseDelay * 2 ** reconnectAttempt);
    reconnectAttempt = Math.min(reconnectAttempt + 1, 30);
    console.log(`[public] reconnecting in ${delay}ms...`);
    setTimeout(connect, delay);
  };

  const shutdown = async (signal: string) => {
    console.log(`[public] received ${signal}; shutting down...`);
    ws?.close(1000, "shutdown");
    await inserter.stop();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  connect();
}

main().catch((error) => {
  console.error("[public] fatal error", error);
  process.exit(1);
});
