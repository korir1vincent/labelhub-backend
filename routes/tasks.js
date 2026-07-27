const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { body, validationResult } = require("express-validator");
const Task = require("../models/Task");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
const CLAIM_WINDOW_MINUTES = 30;

// ---------------------------------------------------------
// Task image upload (admin only)
// ---------------------------------------------------------

const TASK_IMAGE_DIR = path.join(__dirname, "..", "uploads", "task-images");
fs.mkdirSync(TASK_IMAGE_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TASK_IMAGE_DIR),
  filename: (req, file, cb) => {
    // Same rule as CV uploads: never trust the client's filename for the
    // on-disk name — pick from a whitelist ourselves, closing off path
    // traversal and extension-spoofing in one move.
    const ext = ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())
      ? path.extname(file.originalname).toLowerCase()
      : ".bin";
    cb(null, `${req.user._id}_${Date.now()}${ext}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase());
    const mimeOk = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
    if (!extOk || !mimeOk) {
      return cb(new Error("Only JPG, PNG, WEBP, or GIF images are accepted"));
    }
    cb(null, true);
  },
});

// Admin: upload a task image, get back a public URL to use as assetUrl.
// Deliberately a separate step from task creation — the admin can preview
// the image before committing to the full task form.
router.post(
  "/upload-image",
  authenticate,
  requireRole("admin"),
  (req, res) => {
    uploadImage.single("image")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      // PUBLIC_URL should be your backend's externally reachable base URL
      // (e.g. your ngrok URL in dev, your real domain in prod) — set via env,
      // since the server itself doesn't know what hostname clients reach it on.
      const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
      const assetUrl = `${base}/uploads/task-images/${req.file.filename}`;

      res.json({ assetUrl });
    });
  },
);

// ---------------------------------------------------------
// Worker: list open tasks (auto-release expired claims first)
// ---------------------------------------------------------
router.get("/available", authenticate, async (req, res) => {
  await Task.updateMany(
    { status: "assigned", claimExpiresAt: { $lt: new Date() } },
    {
      $set: { status: "open" },
      $unset: { assignedTo: "", assignedAt: "", claimExpiresAt: "" },
    },
  );

  const tasks = await Task.find({ status: "open" })
    .sort({ createdAt: 1 })
    .limit(200);
  res.json({ tasks });
});

// Worker: claim a task
router.post("/:id/claim", authenticate, async (req, res) => {
  if (req.user.role === "worker" && req.user.cvStatus !== "approved") {
    return res.status(403).json({
      error:
        req.user.cvStatus === "pending"
          ? "Your CV is still under review. You'll be able to claim tasks once it's approved."
          : req.user.cvStatus === "rejected"
          ? "Your CV was not approved. Upload a new one from your profile to continue."
          : "Upload your CV from your profile before claiming tasks.",
    });
  }

  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, status: "open" },
    {
      status: "assigned",
      assignedTo: req.user._id,
      assignedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + CLAIM_WINDOW_MINUTES * 60 * 1000),
    },
    { new: true },
  );
  if (!task) return res.status(409).json({ error: "Task no longer available" });
  res.json({ task });
});

// Worker: view my currently claimed task (useful on reconnect/refresh)
router.get("/mine/active", authenticate, async (req, res) => {
  const task = await Task.findOne({
    assignedTo: req.user._id,
    status: "assigned",
  });
  res.json({ task: task || null });
});

// Worker: submit work
router.post(
  "/:id/submit",
  authenticate,
  [body("content").trim().isLength({ min: 10 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "Submission too short" });

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, status: "assigned", assignedTo: req.user._id },
      {
        status: "in_review",
        "submission.content": req.body.content,
        "submission.submittedAt": new Date(),
      },
      { new: true },
    );
    if (!task)
      return res.status(404).json({ error: "Task not found or not yours" });
    res.json({ task });
  },
);

// Worker: full submission history (any status), most recent first
router.get("/mine", authenticate, async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const filter = { assignedTo: req.user._id };
  const total = await Task.countDocuments(filter);
  const tasks = await Task.find(filter)
    .sort({ updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({ tasks, page, totalPages: Math.ceil(total / limit), total });
});

// Reviewer/Admin: list items waiting for review
router.get(
  "/review-queue",
  authenticate,
  requireRole("reviewer", "admin"),
  async (req, res) => {
    const tasks = await Task.find({ status: "in_review" })
      .populate("assignedTo", "name email")
      .sort({ "submission.submittedAt": 1 });
    res.json({ tasks });
  },
);

// Reviewer/Admin: approve or reject — the ONLY place payouts get created
router.post(
  "/:id/review",
  authenticate,
  requireRole("reviewer", "admin"),
  [body("verdict").isIn(["approved", "rejected"])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "Invalid verdict" });

    const { verdict, notes } = req.body;

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const task = await Task.findOne({
        _id: req.params.id,
        status: "in_review",
      }).session(session);
      if (!task) throw new Error("Task not found or not in review");

      task.status = verdict;
      task.review = {
        reviewerId: req.user._id,
        verdict,
        notes,
        reviewedAt: new Date(),
      };
      await task.save({ session });

      const worker = await User.findById(task.assignedTo).session(session);
      worker.reviewedCount += 1;
      if (verdict === "approved") worker.approvedCount += 1;
      worker.accuracyScore =
        Math.round((worker.approvedCount / worker.reviewedCount) * 1000) / 10;
      await worker.save({ session });

      if (verdict === "approved") {
        await Transaction.create(
          [
            {
              userId: task.assignedTo,
              type: "task_payout",
              amount: task.payoutAmount,
              status: "completed",
              method: "internal",
              relatedTaskId: task._id,
            },
          ],
          { session },
        );
      }

      await session.commitTransaction();

      // Notification is best-effort — a failure here shouldn't undo the review
      try {
        await Notification.create({
          userId: task.assignedTo,
          type: verdict === "approved" ? "task_approved" : "task_rejected",
          message:
            verdict === "approved"
              ? `Your submission for "${task.title}" was approved. KES ${task.payoutAmount} added to your balance.`
              : `Your submission for "${task.title}" was rejected.${notes ? ` Reviewer note: ${notes}` : ""}`,
          relatedTaskId: task._id,
        });
      } catch (notifyErr) {
        // non-fatal
      }

      res.json({ task });
    } catch (err) {
      await session.abortTransaction();
      res.status(400).json({ error: err.message });
    } finally {
      session.endSession();
    }
  },
);

// Admin: create a real task (asset should be a URL to a real uploaded image/audio/doc)
router.post(
  "/",
  authenticate,
  requireRole("admin"),
  [
    body("type").isIn([
      "annotation",
      "transcription",
      "translation",
      "review",
      "ocr",
      "sentiment",
    ]),
    body("title").trim().notEmpty(),
    body("prompt").trim().notEmpty(),
    body("payoutAmount").isFloat({ min: 1 }),
    body("exampleAnswer").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    // Explicit whitelist — never spread req.body directly into a model create.
    // Otherwise a request could smuggle in fields like `status: "approved"` or
    // `assignedTo` and bypass the intended task lifecycle from the start.
    const task = await Task.create({
      type: req.body.type,
      title: req.body.title,
      prompt: req.body.prompt,
      instructions: req.body.instructions,
      assetUrl: req.body.assetUrl,
      exampleAnswer: req.body.exampleAnswer,
      payoutAmount: req.body.payoutAmount,
      difficulty: req.body.difficulty,
      createdBy: req.user._id,
    });
    res.status(201).json({ task });
  },
);

// Admin: list all tasks regardless of status (for management dashboard)
router.get("/", authenticate, requireRole("admin"), async (req, res) => {
  const { status, search } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    // Escape regex metacharacters — an unescaped user string here could build
    // a catastrophic-backtracking pattern (ReDoS) or match unintended records.
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.title = { $regex: escaped, $options: "i" };
  }

  const total = await Task.countDocuments(filter);
  const tasks = await Task.find(filter)
    .populate("assignedTo", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({ tasks, page, totalPages: Math.ceil(total / limit), total });
});

// Admin: delete an unassigned task
router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  const task = await Task.findOneAndDelete({
    _id: req.params.id,
    status: "open",
  });
  if (!task)
    return res
      .status(400)
      .json({ error: "Can only delete tasks that are still open" });
  res.json({ message: "Task deleted" });
});

module.exports = router;