import { Router } from "express";
import validationRoutes from "./validationRoutes";

const router = Router();
router.use(validationRoutes);

export default router;
