const rateLimit = require("express-rate-limit");

// Login/register: tight limit per IP to slow down credential stuffing and
// brute-force attempts. Deliberately stricter than the general API limiter.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Withdrawals move real money through Daraja/PayPal — limit how often any
// one account can trigger them, independent of the general API limiter.
const withdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many withdrawal attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

// CV upload: prevent someone from hammering disk/storage with repeated uploads
const cvUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many upload attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

module.exports = { authLimiter, withdrawLimiter, cvUploadLimiter };
