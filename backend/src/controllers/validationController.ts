import { NextFunction, Request, Response } from "express";
import {
  findIronByCode,
  findUserByCode,
  findValidations,
  insertValidation,
  userAndIronExist,
} from "../repositories/validationRepository";

const MAX_CODE_LENGTH = 255;

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
      user_name: user.user_name,
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
    if (!(await userAndIronExist(userId, ironId))) {
      res.status(404).json({ success: false, message: "Active user or soldering iron not found" });
      return;
    }

    const validationId = await insertValidation(userId, ironId, temperature, unit);
    res.status(201).json({ success: true, validation_id: validationId });
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
