const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const config = require("./config/config");

const authRoutes = require("./routes/auth");
const taskRoutes = require("./routes/tasks");
const walletRoutes = require("./routes/wallet");
const webhookRoutes = require("./routes/webhooks");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const cvRoutes = require("./routes/cv");

// ---- Fail fast on missing/weak secrets, before anything else runs ----
function validateEnv() {
  const problems = [];
  if (!config.mongoUri) problems.push("MONGO_URI is not set");
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    problems.push("JWT_SECRET is not set or is too short (use at least 32 random characters)");
  }
  if (config.nodeEnv === "production") {
    if (config.corsOrigin === "*") {
      problems.push("CORS_ORIGIN is '*' in production — set it to your actual frontend origin");
    }
    if (!config.daraja.webhookSecret) {
      problems.push("DARAJA_WEBHOOK_SECRET is not set — Daraja webhook endpoint cannot be verified");
    }
    if (!config.paypal.webhookId) {
      problems.push("PAYPAL_WEBHOOK_ID is not set — PayPal webhook signatures cannot be verified");
    }
  }
  if (problems.length > 0) {
    console.error("Startup blocked — fix the following before running:");
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
}
validateEnv();

const app = express();

// Helmet defaults cover most headers; CSP and HSTS are tightened explicitly
// since this API also serves as the origin for webhook callbacks.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"], // this is a JSON API — it serves no HTML/JS of its own
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" })); // small, deliberate cap — no route needs more than this
// Strip any request keys starting with "$" or containing "." before they can
// reach a Mongoose query — closes off NoSQL operator injection via req.body/query/params.
app.use(mongoSanitize());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api/", limiter);

// Task images are meant to be publicly embeddable in <img> tags from any
// origin the frontend is hosted on — override the global same-site CORP
// just for this path, so it keeps working once frontend/backend are on
// different domains (not just different localhost ports).
app.use(
  "/uploads/task-images",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads", "task-images")),
);

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cv", cvRoutes);
app.use("/webhooks", webhookRoutes); // not covered by the general limiter — Safaricom/PayPal call these; each has its own auth check

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Centralized error handler — never leak stack traces or internal details to clients
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: "Something went wrong" });
});

mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(config.port, () =>
      console.log(`LabelHub API running on port ${config.port}`),
    );
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });