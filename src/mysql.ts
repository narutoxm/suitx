import type { Pool } from "mysql2/promise";
import { createPool } from "mysql2/promise";
import type { MysqlConfig } from "./config";

export function createMysqlPool(config: MysqlConfig): Pool {
  return createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    charset: "utf8mb4"
  });
}

