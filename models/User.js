const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    mpesaPhone: { type: String }, // e.g. 2547XXXXXXXX
    paypalEmail: { type: String },
    role: {
      type: String,
      enum: ["worker", "reviewer", "admin"],
      default: "worker",
    },
    // Derived fields — recalculated after each review, never set directly by client
    accuracyScore: { type: Number, default: 100 },
    reviewedCount: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },

    // CV gate — a worker must have an approved CV before claiming tasks
    cvStatus: {
      type: String,
      enum: ["not_submitted", "pending", "approved", "rejected"],
      default: "not_submitted",
    },
    cvFilename: { type: String }, // stored filename on disk
    cvOriginalName: { type: String }, // original upload filename, for display
    cvSubmittedAt: { type: Date },
    cvReviewedAt: { type: Date },
    cvReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cvReviewNotes: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
