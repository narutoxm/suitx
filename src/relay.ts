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

function extractRelayTxDigestIfHasEvents(message: unknown): string | null {
  const relayStarted = (message as any)?.relayStarted;
  if (!relayStarted) return null;

  const txDigest = relayStarted?.txDigest;
  if (typeof txDigest !== "string" || !txDigest.trim()) return null;

  const events = relayStarted?.sideEffects?.events;
  if (!Array.isArray(events) || events.length === 0) return null;

  return txDigest;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.relayWs.apiKey) {
    throw new Error("Missing required env var: RELAY_API_KEY");
  }

  const pool = createMysqlPool(config.mysql);
  console.log(
    `[relay] mysql: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database} table=relay_tx_digest`
  );
  const inserter = new TxDigestInserter(pool, "relay_tx_digest", {
    flushIntervalMs: config.dbFlushIntervalMs,
    maxBatchSize: config.dbMaxBatchSize
  });
  inserter.start();

  let reconnectAttempt = 0;
  let ws: WebSocket | null = null;

  const connect = () => {
    const baseUrl = config.relayWs.url;
    const apiKey = config.relayWs.apiKey;
    const apiKeyMode = config.relayWs.apiKeyMode;

    const url =
      apiKeyMode === "query"
        ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
        : baseUrl;

    const wsOptions: WebSocket.ClientOptions =
      apiKeyMode === "header"
        ? { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10_000 }
        : { handshakeTimeout: 10_000 };

    console.log(`[relay] connecting: ${url} (mode=${apiKeyMode})`);
    ws = new WebSocket(url, wsOptions);

    ws.on("open", () => {
      reconnectAttempt = 0;
      console.log("[relay] connected");
    });

    ws.on("message", (data) => {
      const raw = safeToString(data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const txDigest = extractRelayTxDigestIfHasEvents(parsed);
      if (txDigest) inserter.enqueue(txDigest);
    });

    ws.on("error", (error) => {
      console.error("[relay] websocket error", error);
    });

    ws.on("close", (code, reason) => {
      const reasonText = reason.toString("utf8");
      console.warn(`[relay] closed: code=${code} reason=${reasonText}`);
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
    console.log(`[relay] reconnecting in ${delay}ms...`);
    setTimeout(connect, delay);
  };

  const shutdown = async (signal: string) => {
    console.log(`[relay] received ${signal}; shutting down...`);
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
  console.error("[relay] fatal error", error);
  process.exit(1);
});
