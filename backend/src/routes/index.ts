import { Router } from "express";
import validationRoutes from "./validationRoutes";

const router = Router();
// Additional groups of API routes can be mounted here later.
router.use(validationRoutes);

export default router;
