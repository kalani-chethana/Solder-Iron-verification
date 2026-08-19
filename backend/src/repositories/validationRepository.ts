import { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db";

// RowDataPacket extensions describe the exact column shape returned by MySQL.
export interface UserRow extends RowDataPacket {
  system_id: number;
  user_code: string;
  user_name: string;
}

export interface IronRow extends RowDataPacket {
  system_id: number;
  iron_code: string;
  iron_name: string;
}

export interface ValidationRow extends RowDataPacket {
  validation_id: number;
  user_id: number;
  user_code: string;
  user_name: string;
  iron_id: number;
  iron_code: string;
  iron_name: string;
  temperature: number;
  unit: string;
  created_at: Date;
}

export async function findUserByCode(code: string): Promise<UserRow | null> {
  // The placeholder (?) keeps scanner data separate from SQL and prevents SQL
  // injection. The same approach is used by every write/read with parameters.
  const [rows] = await pool.execute<UserRow[]>(
    `SELECT system_id, user_code, user_name
       FROM users
      WHERE user_code = ? AND is_active = TRUE
      LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function findIronByCode(code: string): Promise<IronRow | null> {
  const [rows] = await pool.execute<IronRow[]>(
    `SELECT system_id, iron_code, iron_name
       FROM solder_irons
      WHERE iron_code = ? AND is_active = TRUE
      LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function userAndIronExist(userId: number, ironId: number): Promise<boolean> {
  // Check both foreign-key targets in one database round trip.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE system_id = ? AND is_active = TRUE) AS user_exists,
       EXISTS(SELECT 1 FROM solder_irons WHERE system_id = ? AND is_active = TRUE) AS iron_exists`,
    [userId, ironId],
  );
  return Boolean(rows[0]?.user_exists) && Boolean(rows[0]?.iron_exists);
}

export async function insertValidation(
  userId: number,
  ironId: number,
  temperature: number,
  unit: "C" | "F",
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO validation_records (user_id, iron_id, temperature, unit)
     VALUES (?, ?, ?, ?)`,
    [userId, ironId, temperature, unit],
  );
  return result.insertId;
}

export async function findValidations(): Promise<ValidationRow[]> {
  // JOINs turn stored numeric IDs into a useful history response for clients.
  const [rows] = await pool.query<ValidationRow[]>(
    `SELECT v.system_id AS validation_id,
            u.system_id AS user_id, u.user_code, u.user_name,
            i.system_id AS iron_id, i.iron_code, i.iron_name,
            v.temperature, v.unit, v.created_at
       FROM validation_records v
       JOIN users u ON u.system_id = v.user_id
       JOIN solder_irons i ON i.system_id = v.iron_id
      ORDER BY v.created_at DESC, v.system_id DESC`,
  );
  return rows;
}
