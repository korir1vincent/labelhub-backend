const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["task_payout", "withdrawal"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "pending_fee",
        "processing",
        "completed",
        "failed",
        "fee_cancelled",
      ],
      default: "pending",
    },

    method: {
      type: String,
      enum: ["mpesa", "paypal", "internal"],
    },

    relatedTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
    },

    // -------------------------
    // Processing fee
    // -------------------------

    processingFee: {
      type: Number,
      default: 199,
    },

    feeStatus: {
      type: String,
      enum: ["pending", "paid", "cancelled"],
      default: "pending",
    },

    feeCheckoutRequestId: String,

    feeReceipt: String,

    feePaidAt: Date,

    // -------------------------
    // Recipient phone
    // -------------------------

    phone: String,

    // -------------------------
    // Daraja / PayPal refs
    // -------------------------

    externalRef: String,

    failureReason: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Transaction", transactionSchema);