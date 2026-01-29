import "dotenv/config";

export type TxDigestTable = "public_tx_digest" | "relay_tx_digest";

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface PublicWsConfig {
  url: string;
  subscribeMethod: string;
}

export type RelayApiKeyMode = "header" | "query";

export interface RelayWsConfig {
  url: string;
  apiKey: string;
  apiKeyMode: RelayApiKeyMode;
}

export interface AppConfig {
  mysql: MysqlConfig;
  publicWs: PublicWsConfig;
  relayWs: RelayWsConfig;
  dbFlushIntervalMs: number;
  dbMaxBatchSize: number;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid integer env var: ${key}=${raw}`);
  }
  return value;
}

function parseRelayApiKeyMode(value: string | undefined): RelayApiKeyMode {
  if (!value) return "header";
  if (value === "header" || value === "query") return value;
  throw new Error(`Invalid RELAY_API_KEY_MODE: ${value} (expected: header|query)`);
}

export function loadConfig(): AppConfig {
  const mysqlPassword = requireEnv("MYSQL_PASSWORD");

  return {
    mysql: {
      host: process.env.MYSQL_HOST ?? "192.168.199.125",
      port: parseIntEnv("MYSQL_PORT", 3306),
      database: process.env.MYSQL_DATABASE ?? "jw-eco-stage",
      user: process.env.MYSQL_USER ?? "stage_eco",
      password: mysqlPassword
    },
    publicWs: {
      url: process.env.PUBLIC_WS_URL ?? "ws://54.36.109.38:9000/subscribe",
      subscribeMethod:
        process.env.PUBLIC_WS_SUBSCRIBE_METHOD ??
        "flashcheckpoint_subscribeFlashCheckpoints"
    },
    relayWs: {
      url: process.env.RELAY_WSS_URL ?? "wss://sui.validator.giverep.com/wss",
      apiKey: process.env.RELAY_API_KEY ?? "",
      apiKeyMode: parseRelayApiKeyMode(process.env.RELAY_API_KEY_MODE)
    },
    dbFlushIntervalMs: parseIntEnv("DB_FLUSH_INTERVAL_MS", 1000),
    dbMaxBatchSize: parseIntEnv("DB_MAX_BATCH_SIZE", 200)
  };
}
