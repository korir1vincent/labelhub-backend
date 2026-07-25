const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "annotation",
        "transcription",
        "translation",
        "review",
        "ocr",
        "sentiment",
      ],
      required: true,
    },
    title: { type: String, required: true },
    prompt: { type: String, required: true },
    instructions: [{ type: String }],
    assetUrl: { type: String }, // real image/audio/doc uploaded by admin
    // Optional worked example shown to the worker BEFORE they submit, so they
    // know what a good answer looks like. This is guidance, not a graded key —
    // it should illustrate format/quality, not literally solve this exact task.
    exampleAnswer: { type: String },
    payoutAmount: { type: Number, required: true },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Easy",
    },

    status: {
      type: String,
      enum: ["open", "assigned", "in_review", "approved", "rejected"],
      default: "open",
    },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date },
    claimExpiresAt: { type: Date }, // if not submitted by this time, task reopens

    submission: {
      content: { type: String },
      submittedAt: { type: Date },
    },

    review: {
      reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      verdict: { type: String, enum: ["approved", "rejected"] },
      notes: { type: String },
      reviewedAt: { type: Date },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

taskSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("Task", taskSchema);
