const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "task_approved",
        "task_rejected",
        "withdrawal_completed",
        "withdrawal_failed",
        "cv_approved",
        "cv_rejected",
      ],
      required: true,
    },
    message: { type: String, required: true },
    relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    relatedTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Notification", notificationSchema);
