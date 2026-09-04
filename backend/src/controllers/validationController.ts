import { NextFunction, Request, Response } from "express";
import {
  assignIronProfile,
  findAllIrons,
  findAllProfiles,
  findAllUsers,
  findIronByCode,
  findUserByCode,
  findValidations,
  insertValidation,
  userAndIronExist,
} from "../repositories/validationRepository";

const MAX_CODE_LENGTH = 255;

// Scanner input is normalized here as well as on the ESP32. Server-side
// validation is still required because any client can call these endpoints.
function normalizedCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code.length > 0 && code.length <= MAX_CODE_LENGTH ? code : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

export async function checkUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = normalizedCode(req.body?.user_code);
    if (!code) {
      res.status(400).json({ valid: false, message: "user_code is required" });
      return;
    }

    const user = await findUserByCode(code);
    if (!user) {
      res.status(404).json({ valid: false, message: "User not found" });
      return;
    }

    res.json({
      valid: true,
      user_id: user.system_id,
      user_code: user.user_code,
      user_name: user.user_code,
      full_name: user.user_name,
      department: user.department ?? null,
      designation: user.designation ?? null,
    });
  } catch (error) {
    next(error);
  }
}

export async function checkIron(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = normalizedCode(req.body?.iron_code);
    if (!code) {
      res.status(400).json({ valid: false, message: "iron_code is required" });
      return;
    }

    const iron = await findIronByCode(code);
    if (!iron) {
      res.status(404).json({ valid: false, message: "Soldering iron not found" });
      return;
    }

    res.json({
      valid: true,
      iron_id: iron.system_id,
      iron_code: iron.iron_code,
      iron_name: iron.iron_name,
      serial_number: iron.serial_number,
      use_department: iron.use_department,
      profile: iron.profile ?? null,
    });
  } catch (error) {
    next(error);
  }
}

export async function saveValidation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = positiveInteger(req.body?.user_id);
    const ironId = positiveInteger(req.body?.iron_id);
    const temperature = Number(req.body?.temperature);
    const unit = String(req.body?.unit ?? "F").trim().toUpperCase();

    if (!userId || !ironId) {
      res.status(400).json({ success: false, message: "Valid user_id and iron_id are required" });
      return;
    }
    if (!Number.isFinite(temperature) || temperature < -100 || temperature > 2000) {
      res.status(400).json({ success: false, message: "temperature must be between -100 and 2000" });
      return;
    }
    if (unit !== "C" && unit !== "F") {
      res.status(400).json({ success: false, message: "unit must be C or F" });
      return;
    }
    // Only active database records may be linked to a new measurement.
    if (!(await userAndIronExist(userId, ironId))) {
      res.status(404).json({ success: false, message: "Active user or soldering iron not found" });
      return;
    }

    const result = await insertValidation(userId, ironId, temperature, unit);
    res.status(201).json({
      success: true,
      validation_id: result.validationId,
      status: result.status,
      temperature,
      target_temp: result.targetTemp,
      tolerance: result.tolerance,
      min_temp: result.minTemp,
      max_temp: result.maxTemp,
    });
  } catch (error) {
    next(error);
  }
}

export async function getValidations(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, validations: await findValidations() });
  } catch (error) {
    next(error);
  }
}

export async function getIrons(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const irons = await findAllIrons();
    res.json({ success: true, count: irons.length, irons });
  } catch (error) {
    next(error);
  }
}

export async function getUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await findAllUsers();
    res.json({ success: true, count: users.length, users });
  } catch (error) {
    next(error);
  }
}

export async function getProfiles(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profiles = await findAllProfiles();
    res.json({ success: true, count: profiles.length, profiles });
  } catch (error) {
    next(error);
  }
}

export async function setIronProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ironId = positiveInteger(req.body?.iron_id);
    const profileId = positiveInteger(req.body?.profile_id);
    if (!ironId || !profileId) {
      res.status(400).json({ success: false, message: "Valid iron_id and profile_id are required" });
      return;
    }
    await assignIronProfile(ironId, profileId);
    res.json({ success: true, message: "Profile assigned to iron successfully" });
  } catch (error) {
    next(error);
  }
}
