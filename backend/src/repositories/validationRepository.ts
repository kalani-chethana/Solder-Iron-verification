import { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool, tsfsPool } from "../db";

// RowDataPacket extensions describe the exact column shape returned by MySQL.
export interface UserRow extends RowDataPacket {
  system_id: number;
  user_code: string;
  user_name: string;
  department?: string | null;
  designation?: string | null;
}

export interface IronRow extends RowDataPacket {
  system_id: number;
  iron_code: string;
  iron_name: string;
  serial_number: string | null;
  use_department: string | null;
}

export interface ValidationRow extends RowDataPacket {
  validation_id: number;
  user_id: number;
  user_code: string;
  user_name: string;
  iron_id: number;
  iron_code: string;
  iron_name: string;
  serial_number: string | null;
  use_department: string | null;
  temperature: number;
  unit: string;
  created_at: Date;
}

export async function findUserByCode(code: string): Promise<UserRow | null> {
  // Query tblemployee in TSFS. Matches either exact EmpNo (e.g. "0004") or zero-padded ("4" -> "0004").
  // Strictly requires IsDelete = 0 for active accounts.
  const [rows] = await tsfsPool.execute<UserRow[]>(
    `SELECT sysID AS system_id,
            EmpNo AS user_code,
            InitialWithName AS user_name,
            Department AS department,
            Designation AS designation
       FROM tblemployee
      WHERE (EmpNo = ? OR EmpNo = LPAD(?, 4, '0'))
        AND IsDelete = 0
      LIMIT 1`,
    [code, code],
  );
  return rows[0] ?? null;
}

export async function findAllUsers(): Promise<UserRow[]> {
  const [rows] = await tsfsPool.query<UserRow[]>(
    `SELECT sysID AS system_id,
            EmpNo AS user_code,
            InitialWithName AS user_name,
            Department AS department,
            Designation AS designation
       FROM tblemployee
      WHERE IsDelete = 0
      ORDER BY EmpNo ASC`,
  );
  return rows;
}

export async function findIronByCode(code: string): Promise<IronRow | null> {
  const [rows] = await tsfsPool.execute<IronRow[]>(
    `SELECT t.SysID AS system_id,
            t.ItemNumber AS iron_code,
            t.ItemName AS iron_name,
            t.SerialNumber AS serial_number,
            t.UseDepartment AS use_department
       FROM tblsheduledserviceitems t
      WHERE t.ItemNumber = ? AND t.CategotyID = '55' AND t.InstrumentStatus = 1
      LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function findAllIrons(): Promise<IronRow[]> {
  const [rows] = await tsfsPool.query<IronRow[]>(
    `SELECT t.SysID AS system_id,
            t.ItemNumber AS iron_code,
            t.ItemName AS iron_name,
            t.SerialNumber AS serial_number,
            t.UseDepartment AS use_department
       FROM tblsheduledserviceitems t
      WHERE t.CategotyID = '55' AND t.InstrumentStatus = 1
      ORDER BY t.ItemNumber ASC`,
  );
  return rows;
}

export async function userAndIronExist(userId: number, ironId: number): Promise<boolean> {
  // Query tsfsPool concurrently for both user and equipment records.
  // Enforces IsDelete = 0 for the employee and InstrumentStatus = 1 for the iron.
  const [userResult, ironResult] = await Promise.all([
    tsfsPool.execute<RowDataPacket[]>(
      `SELECT 1 FROM tblemployee WHERE sysID = ? AND IsDelete = 0 LIMIT 1`,
      [userId],
    ),
    tsfsPool.execute<RowDataPacket[]>(
      `SELECT 1 FROM tblsheduledserviceitems WHERE SysID = ? AND CategotyID = '55' AND InstrumentStatus = 1 LIMIT 1`,
      [ironId],
    ),
  ]);
  return userResult[0].length > 0 && ironResult[0].length > 0;
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
  // Fetch validation history from the application database.
  const [records] = await pool.query<RowDataPacket[]>(
    `SELECT v.system_id AS validation_id,
            v.user_id,
            v.iron_id,
            v.temperature, v.unit, v.created_at
       FROM validation_records v
      ORDER BY v.created_at DESC, v.system_id DESC`,
  );

  if (records.length === 0) {
    return [];
  }

  // Fetch corresponding employee and equipment details from the TSFS database.
  const distinctUserIds = Array.from(
    new Set(records.map((r) => Number(r.user_id)).filter((id) => id > 0)),
  );
  const distinctIronIds = Array.from(
    new Set(records.map((r) => Number(r.iron_id)).filter((id) => id > 0)),
  );

  const [usersResult, ironsResult] = await Promise.all([
    distinctUserIds.length > 0
      ? tsfsPool.query<UserRow[]>(
          `SELECT sysID AS system_id,
                  EmpNo AS user_code,
                  InitialWithName AS user_name,
                  Department AS department,
                  Designation AS designation
             FROM tblemployee
            WHERE sysID IN (?)`,
          [distinctUserIds],
        )
      : Promise.resolve([[]]),
    distinctIronIds.length > 0
      ? tsfsPool.query<IronRow[]>(
          `SELECT SysID AS system_id,
                  ItemNumber AS iron_code,
                  ItemName AS iron_name,
                  SerialNumber AS serial_number,
                  UseDepartment AS use_department
             FROM tblsheduledserviceitems
            WHERE SysID IN (?)`,
          [distinctIronIds],
        )
      : Promise.resolve([[]]),
  ]);

  const userMap = new Map((usersResult[0] as UserRow[]).map((item) => [item.system_id, item]));
  const ironMap = new Map((ironsResult[0] as IronRow[]).map((item) => [item.system_id, item]));

  return records.map((r) => {
    const user = userMap.get(Number(r.user_id));
    const iron = ironMap.get(Number(r.iron_id));
    return {
      validation_id: Number(r.validation_id),
      user_id: Number(r.user_id),
      user_code: user?.user_code ?? "UNKNOWN",
      user_name: user?.user_name ?? "Unknown User",
      iron_id: Number(r.iron_id),
      iron_code: iron?.iron_code ?? "UNKNOWN",
      iron_name: iron?.iron_name ?? "Unknown Iron",
      serial_number: iron?.serial_number ?? null,
      use_department: iron?.use_department ?? null,
      temperature: Number(r.temperature),
      unit: String(r.unit),
      created_at: r.created_at as Date,
    } as ValidationRow;
  });
}
