import { Router } from "express";
import {
  checkIron,
  checkUser,
  getIrons,
  getUsers,
  getValidations,
  saveValidation,
} from "../controllers/validationController";

const router = Router();

// All paths receive the /api prefix in server.ts.
router.post("/check-user", checkUser);
router.post("/check-iron", checkIron);
router.post("/save-validation", saveValidation);
router.get("/validations", getValidations);
router.get("/irons", getIrons);
router.get("/users", getUsers);

export default router;
