import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Mount DOSK Dashboard Routes
try {
  const dashServer = require("../../../src/dashboard/server.js");
  if (dashServer && typeof dashServer.setupDashboardRoutes === "function") {
    dashServer.setupDashboardRoutes(app);
  }
} catch (e) {
  logger.warn({ err: e }, "Failed to mount dashboard server routes");
}

app.use("/api", router);

// Serve Static Dashboard Assets
const publicCandidates = [
  path.resolve(__dirname, "../public"),
  path.resolve(__dirname, "../../../src/dashboard/public"),
  path.resolve(process.cwd(), "src/dashboard/public"),
  path.resolve(process.cwd(), "public")
];

for (const p of publicCandidates) {
  if (fs.existsSync(p)) {
    app.use(express.static(p));
  }
}

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  for (const p of publicCandidates) {
    const idx = path.join(p, "index.html");
    if (fs.existsSync(idx)) {
      return res.sendFile(idx);
    }
  }
  next();
});

export default app;
