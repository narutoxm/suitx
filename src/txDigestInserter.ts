import type { Pool, ResultSetHeader } from "mysql2/promise";
import type { TxDigestTable } from "./config";

function uniqNonEmptyStrings(values: readonly string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set);
}

async function insertIgnoreTxDigests(
  pool: Pool,
  table: TxDigestTable,
  digests: readonly string[]
): Promise<number> {
  const unique = uniqNonEmptyStrings(digests);
  if (unique.length === 0) return 0;

  const placeholders = unique.map(() => "(?)").join(",");
  const sql = `INSERT IGNORE INTO \`${table}\` (\`tx_digest\`) VALUES ${placeholders}`;
  const [result] = await pool.execute<ResultSetHeader>(sql, unique);
  return result.affectedRows ?? 0;
}

function summarizeMysqlError(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object") {
    const e = error as any;
    return {
      code: e.code,
      errno: e.errno,
      sqlState: e.sqlState,
      message: e.sqlMessage ?? e.message
    };
  }
  return { message: String(error) };
}

export class TxDigestInserter {
  private pending = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private pool: Pool,
    private table: TxDigestTable,
    private options: {
      flushIntervalMs: number;
      maxBatchSize: number;
    }
  ) {}

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  enqueue(digest: string): void {
    const trimmed = digest.trim();
    if (!trimmed) return;
    this.pending.add(trimmed);

    if (this.pending.size >= this.options.maxBatchSize) {
      void this.flush();
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.size === 0) return;

    this.flushing = true;
    const batch = Array.from(this.pending);
    this.pending.clear();

    try {
      const inserted = await insertIgnoreTxDigests(this.pool, this.table, batch);
      if (inserted > 0) {
        console.log(`[${this.table}] inserted_rows=${inserted} batch=${batch.length}`);
      }
    } catch (error) {
      const summary = summarizeMysqlError(error);
      console.error(`[${this.table}] insert failed; will retry`, summary);
      if ((summary as any).code === "ER_NO_SUCH_TABLE" || (summary as any).errno === 1146) {
        console.error(
          `[${this.table}] table not found; check MYSQL_DATABASE and confirm the table exists in that schema`
        );
      }
      for (const digest of batch) this.pending.add(digest);
    } finally {
      this.flushing = false;
    }
  }
}
