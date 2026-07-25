const express = require("express");
const Notification = require("../models/Notification");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  const unreadCount = await Notification.countDocuments({
    userId: req.user._id,
    read: false,
  });
  res.json({ notifications, unreadCount });
});

router.post("/:id/read", authenticate, async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { read: true },
    { new: true },
  );
  if (!notification) return res.status(404).json({ error: "Not found" });
  res.json({ notification });
});

router.post("/read-all", authenticate, async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, read: false },
    { read: true },
  );
  res.json({ message: "All notifications marked as read" });
});

module.exports = router;
