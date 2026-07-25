const jwt = require("jsonwebtoken");
const config = require("../config/config");
const User = require("../models/User");

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token provided" });

    // Explicitly pin the algorithm — without this, a library-level algorithm
    // confusion bug (e.g. accepting "none" or swapping HS256/RS256) becomes a
    // full auth bypass. Belt-and-suspenders even though jsonwebtoken defends
    // against this by default.
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    const user = await User.findById(decoded.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };

module.exports = { authenticate, requireRole };
