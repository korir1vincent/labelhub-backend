const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { authenticate, requireRole } = require("../middleware/auth");
const { cvUploadLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "cvs");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Only ever use a whitelisted extension in the stored filename, regardless
    // of what the client claims — the original name is never used verbatim
    // for the on-disk path, which also rules out path traversal via filename.
    const ext = ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())
      ? path.extname(file.originalname).toLowerCase()
      : ".bin";
    cb(null, `${req.user._id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase());
    const mimeOk = ALLOWED_TYPES.includes(file.mimetype);
    // Both the declared MIME type AND the extension must be on the whitelist —
    // MIME type alone is client-supplied and trivially spoofable.
    if (!extOk || !mimeOk) {
      return cb(new Error("Only PDF, DOC, or DOCX files are accepted"));
    }
    cb(null, true);
  },
});

// Worker: upload or re-upload a CV
router.post("/me", authenticate, cvUploadLimiter, (req, res) => {
  upload.single("cv")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Clean up a previous CV file on disk if re-uploading
    if (req.user.cvFilename) {
      const oldPath = path.join(UPLOAD_DIR, req.user.cvFilename);
      fs.unlink(oldPath, () => {}); // best-effort, ignore errors
    }

    req.user.cvFilename = req.file.filename;
    req.user.cvOriginalName = req.file.originalname;
    req.user.cvStatus = "pending";
    req.user.cvSubmittedAt = new Date();
    req.user.cvReviewedAt = undefined;
    req.user.cvReviewNotes = undefined;
    await req.user.save();

    res.json({
      cvStatus: req.user.cvStatus,
      cvOriginalName: req.user.cvOriginalName,
      cvSubmittedAt: req.user.cvSubmittedAt,
    });
  });
});

// Worker: check own CV status (also included in /auth/me, this is a convenience alias)
router.get("/me", authenticate, (req, res) => {
  res.json({
    cvStatus: req.user.cvStatus,
    cvOriginalName: req.user.cvOriginalName,
    cvSubmittedAt: req.user.cvSubmittedAt,
    cvReviewNotes: req.user.cvReviewNotes,
  });
});

// Admin: list workers with a CV pending review
router.get("/queue", authenticate, requireRole("admin"), async (req, res) => {
  const users = await User.find({ cvStatus: "pending" })
    .select("name email cvOriginalName cvSubmittedAt")
    .sort({ cvSubmittedAt: 1 });
  res.json({ users });
});

// Admin (or the worker themselves): download/view a CV file
router.get("/:userId/file", authenticate, async (req, res) => {
  if (req.user.role !== "admin" && req.user._id.toString() !== req.params.userId) {
    return res.status(403).json({ error: "Not authorized to view this file" });
  }
  const target = await User.findById(req.params.userId);
  if (!target || !target.cvFilename) {
    return res.status(404).json({ error: "No CV on file" });
  }
  const filePath = path.join(UPLOAD_DIR, target.cvFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on server" });
  }
  res.download(filePath, target.cvOriginalName || "cv");
});

// Admin: approve or reject a worker's CV
router.post(
  "/:userId/review",
  authenticate,
  requireRole("admin"),
  [body("verdict").isIn(["approved", "rejected"])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "Invalid verdict" });

    const { verdict, notes } = req.body;
    const target = await User.findById(req.params.userId);
    if (!target || target.cvStatus !== "pending") {
      return res.status(400).json({ error: "User has no CV pending review" });
    }

    target.cvStatus = verdict;
    target.cvReviewedAt = new Date();
    target.cvReviewedBy = req.user._id;
    target.cvReviewNotes = notes;
    await target.save();

    try {
      await Notification.create({
        userId: target._id,
        type: verdict === "approved" ? "cv_approved" : "cv_rejected",
        message:
          verdict === "approved"
            ? "Your CV has been approved. You can now claim tasks."
            : `Your CV was not approved.${notes ? ` Reviewer note: ${notes}` : ""} You can upload a new one from your profile.`,
      });
    } catch (err) {
      // non-fatal
    }

    res.json({
      user: {
        id: target._id,
        cvStatus: target.cvStatus,
        cvReviewNotes: target.cvReviewNotes,
      },
    });
  },
);

module.exports = router;
