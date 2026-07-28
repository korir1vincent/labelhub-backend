const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const config = require("../config/config");
const { authenticate } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

function publicProfile(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mpesaPhone: user.mpesaPhone,
    paypalEmail: user.paypalEmail,
    accuracyScore: user.accuracyScore,
    reviewedCount: user.reviewedCount,
    approvedCount: user.approvedCount,
    cvStatus: user.cvStatus,
    cvOriginalName: user.cvOriginalName,
    cvSubmittedAt: user.cvSubmittedAt,
    cvReviewNotes: user.cvReviewNotes,
  };
}

router.post(
  "/register",
  [
    body("name").trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("mpesaPhone").matches(/^254(7|1)\d{8}$/).withMessage("Enter a valid M-Pesa number, e.g. 2547XXXXXXXX"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    try {
      const { name, email, password, mpesaPhone, paypalEmail } = req.body;
      const existing = await User.findOne({ email });
      if (existing)
        return res.status(409).json({ error: "Email already registered" });

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        name,
        email,
        passwordHash,
        mpesaPhone,
        paypalEmail,
      });

      const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
        expiresIn: config.jwtExpiry,
        algorithm: "HS256",
      });

      res.status(201).json({ token, user: publicProfile(user) });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({
          error: err.message,
        });
      }
  },
);

router.post(
  "/login",
  authLimiter,
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) return res.status(401).json({ error: "Invalid credentials" });

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match)
        return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
        expiresIn: config.jwtExpiry,
        algorithm: "HS256",
      });

      res.json({ token, user: publicProfile(user) });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  },
);

// Fetch fresh profile (used to refresh accuracy/counts/CV status after activity)
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: publicProfile(req.user) });
});

// Update editable profile fields
router.patch(
  "/me",
  authenticate,
  [
    body("mpesaPhone").optional().matches(/^254(7|1)\d{8}$/).withMessage("Enter a valid M-Pesa number, e.g. 2547XXXXXXXX"),
    body("name").optional().trim().notEmpty(),
    body("paypalEmail").optional().trim().isEmail().withMessage("Invalid PayPal email"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { name, mpesaPhone, paypalEmail } = req.body;
    if (name !== undefined) req.user.name = name;
    if (mpesaPhone !== undefined) req.user.mpesaPhone = mpesaPhone;
    if (paypalEmail !== undefined) req.user.paypalEmail = paypalEmail;
    await req.user.save();

    res.json({ user: publicProfile(req.user) });
  },
);

// Change password (requires current password)
router.post(
  "/change-password",
  authenticate,
  [
    body("currentPassword").notEmpty(),
    body("newPassword").isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: "New password must be at least 6 characters" });

    const { currentPassword, newPassword } = req.body;
    const match = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    req.user.passwordHash = await bcrypt.hash(newPassword, 12);
    await req.user.save();
    res.json({ message: "Password updated" });
  },
);

module.exports = router;
