const express = require("express");
const User = require("../models/User");
const Task = require("../models/Task");
const Transaction = require("../models/Transaction");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/stats", authenticate, requireRole("admin"), async (req, res) => {
  const [
    totalWorkers,
    pendingReviewCount,
    openTaskCount,
    approvedTaskCount,
    rejectedTaskCount,
    payoutAgg,
    withdrawalAgg,
    pendingCvCount,
  ] = await Promise.all([
    User.countDocuments({ role: "worker" }),
    Task.countDocuments({ status: "in_review" }),
    Task.countDocuments({ status: "open" }),
    Task.countDocuments({ status: "approved" }),
    Task.countDocuments({ status: "rejected" }),
    Transaction.aggregate([
      { $match: { type: "task_payout", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate([
      { $match: { type: "withdrawal", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    User.countDocuments({ cvStatus: "pending" }),
  ]);

  res.json({
    totalWorkers,
    pendingReviewCount,
    openTaskCount,
    approvedTaskCount,
    rejectedTaskCount,
    totalPaidToWorkers: payoutAgg[0]?.total || 0,
    totalWithdrawn: withdrawalAgg[0]?.total || 0,
    outstandingBalance: (payoutAgg[0]?.total || 0) - (withdrawalAgg[0]?.total || 0),
    pendingCvCount,
  });
});

module.exports = router;
