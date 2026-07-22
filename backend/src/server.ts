import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { verifyDatabaseConnection } from "./db";
import apiRoutes from "./routes";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use("/api", apiRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const httpError = error as { status?: unknown; type?: unknown };
  if (httpError.status === 400 || httpError.type === "entity.parse.failed") {
    res.status(400).json({ success: false, message: "Invalid JSON request body" });
    return;
  }

  console.error(error);
  res.status(500).json({ success: false, message: "Internal server error" });
});

async function start(): Promise<void> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  await verifyDatabaseConnection();
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${port}/api`);
  });
}

start().catch((error) => {
  console.error("Backend failed to start:", error);
  process.exit(1);
});
