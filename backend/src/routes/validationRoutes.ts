import { Router } from "express";
import {
  checkIron,
  checkUser,
  getValidations,
  saveValidation,
} from "../controllers/validationController";

const router = Router();

router.post("/check-user", checkUser);
router.post("/check-iron", checkIron);
router.post("/save-validation", saveValidation);
router.get("/validations", getValidations);

export default router;
