import "dotenv/config";
import mysql from "mysql2/promise";

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

// A pool reuses database connections across requests. Every setting can be
// supplied in a .env file; the defaults are suitable for a local MySQL install.
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

export async function verifyDatabaseConnection(): Promise<void> {
  // Borrow one connection for a startup health check, then always return it.
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
