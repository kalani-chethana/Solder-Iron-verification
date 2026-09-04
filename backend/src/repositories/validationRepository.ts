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

export interface ProfileRow extends RowDataPacket {
  profile_id: number;
  profile_name: string;
  department: string | null;
  target_temp: number;
  tolerance: number;
  min_temp: number;
  max_temp: number;
  unit: string;
  is_active: boolean;
  created_at: Date;
}

export interface IronRow extends RowDataPacket {
  system_id: number;
  iron_code: string;
  iron_name: string;
  serial_number: string | null;
  use_department: string | null;
  profile?: {
    profile_id: number;
    profile_name: string;
    target_temp: number;
    tolerance: number;
    min_temp: number;
    max_temp: number;
    unit: string;
  } | null;
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
  target_temp: number | null;
  tolerance: number | null;
  status: "PASS" | "FAIL";
  profile_name?: string | null;
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

export async function findAllProfiles(): Promise<ProfileRow[]> {
  const [rows] = await pool.query<ProfileRow[]>(
    `SELECT profile_id, profile_name, department, target_temp, tolerance, min_temp, max_temp, unit, is_active, created_at
       FROM temperature_profiles
      WHERE is_active = TRUE
      ORDER BY profile_id ASC`,
  );
  return rows;
}

export async function getProfileForIron(ironId: number, department: string | null): Promise<ProfileRow | null> {
  // 1. Check explicit mapping in iron_profiles
  const [mappedRows] = await pool.execute<ProfileRow[]>(
    `SELECT p.profile_id, p.profile_name, p.department, p.target_temp, p.tolerance, p.min_temp, p.max_temp, p.unit, p.is_active, p.created_at
       FROM iron_profiles ip
       JOIN temperature_profiles p ON p.profile_id = ip.profile_id
      WHERE ip.iron_id = ? AND p.is_active = TRUE
      LIMIT 1`,
    [ironId],
  );
  if (mappedRows.length > 0 && mappedRows[0]) {
    return mappedRows[0];
  }

  // 2. Fallback to matching department
  if (department) {
    const [deptRows] = await pool.execute<ProfileRow[]>(
      `SELECT profile_id, profile_name, department, target_temp, tolerance, min_temp, max_temp, unit, is_active, created_at
         FROM temperature_profiles
        WHERE (department = ? OR profile_name LIKE ?) AND is_active = TRUE
        LIMIT 1`,
      [department, `${department}%`],
    );
    if (deptRows.length > 0 && deptRows[0]) {
      return deptRows[0];
    }
  }

  return null;
}

export async function assignIronProfile(ironId: number, profileId: number): Promise<void> {
  await pool.execute(
    `INSERT INTO iron_profiles (iron_id, profile_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE profile_id = VALUES(profile_id)`,
    [ironId, profileId],
  );
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
  const iron = rows[0] ?? null;
  if (!iron) return null;

  const profile = await getProfileForIron(iron.system_id, iron.use_department);
  if (profile) {
    iron.profile = {
      profile_id: profile.profile_id,
      profile_name: profile.profile_name,
      target_temp: Number(profile.target_temp),
      tolerance: Number(profile.tolerance),
      min_temp: Number(profile.min_temp),
      max_temp: Number(profile.max_temp),
      unit: profile.unit,
    };
  } else {
    iron.profile = null;
  }
  return iron;
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
): Promise<{
  validationId: number;
  status: "PASS" | "FAIL";
  targetTemp: number | null;
  tolerance: number | null;
  minTemp: number | null;
  maxTemp: number | null;
}> {
  let targetTemp: number | null = null;
  let tolerance: number | null = null;
  let minTemp: number | null = null;
  let maxTemp: number | null = null;
  let profileId: number | null = null;
  let status: "PASS" | "FAIL" = "PASS";

  const [ironRows] = await tsfsPool.execute<RowDataPacket[]>(
    `SELECT UseDepartment FROM tblsheduledserviceitems WHERE SysID = ? LIMIT 1`,
    [ironId],
  );
  const dept = (ironRows[0]?.UseDepartment as string) ?? null;
  const profile = await getProfileForIron(ironId, dept);

  if (profile) {
    profileId = profile.profile_id;
    targetTemp = Number(profile.target_temp);
    tolerance = Number(profile.tolerance);
    minTemp = Number(profile.min_temp);
    maxTemp = Number(profile.max_temp);
    status = temperature >= minTemp && temperature <= maxTemp ? "PASS" : "FAIL";
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO validation_records (user_id, iron_id, temperature, target_temp, tolerance, unit, status, profile_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, ironId, temperature, targetTemp, tolerance, unit, status, profileId],
  );

  return {
    validationId: result.insertId,
    status,
    targetTemp,
    tolerance,
    minTemp,
    maxTemp,
  };
}

export async function findValidations(): Promise<ValidationRow[]> {
  // Fetch validation history from the application database.
  const [records] = await pool.query<RowDataPacket[]>(
    `SELECT v.system_id AS validation_id,
            v.user_id,
            v.iron_id,
            v.temperature,
            v.target_temp,
            v.tolerance,
            v.status,
            v.profile_id,
            p.profile_name,
            v.unit,
            v.created_at
       FROM validation_records v
       LEFT JOIN temperature_profiles p ON p.profile_id = v.profile_id
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
      target_temp: r.target_temp != null ? Number(r.target_temp) : null,
      tolerance: r.tolerance != null ? Number(r.tolerance) : null,
      status: (r.status as "PASS" | "FAIL") ?? "PASS",
      profile_name: (r.profile_name as string) ?? null,
      unit: String(r.unit),
      created_at: r.created_at as Date,
    } as ValidationRow;
  });
}
