import "dotenv/config";
import mysql from "mysql2/promise";

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

// Application database pool (users and validation_records).
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: integerEnv("DB_PORT", 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "soldering_iron_validation",
  waitForConnections: true,
  connectionLimit: integerEnv("DB_CONNECTION_LIMIT", 10),
  charset: "utf8mb4",
  decimalNumbers: true,
});

// TSFS database pool (tblsheduledserviceitems).
export const tsfsPool = mysql.createPool({
  host: process.env.TSFS_DB_HOST ?? process.env.DB_HOST ?? "127.0.0.1",
  port: integerEnv("TSFS_DB_PORT", integerEnv("DB_PORT", 3306)),
  user: process.env.TSFS_DB_USER ?? process.env.DB_USER ?? "root",
  password: process.env.TSFS_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "",
  database: process.env.TSFS_DB_NAME ?? "tsfs",
  waitForConnections: true,
  connectionLimit: integerEnv("TSFS_DB_CONNECTION_LIMIT", 10),
  charset: "utf8mb4",
  decimalNumbers: true,
});

export async function verifyDatabaseConnection(): Promise<void> {
  // Borrow a connection from both pools for startup health check.
  const [appConn, tsfsConn] = await Promise.all([
    pool.getConnection(),
    tsfsPool.getConnection(),
  ]);

  try {
    await Promise.all([appConn.ping(), tsfsConn.ping()]);
  } finally {
    appConn.release();
    tsfsConn.release();
  }
}
