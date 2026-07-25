// const express = require("express");
// const { body, validationResult } = require("express-validator");
// const Transaction = require("../models/Transaction");
// const { authenticate } = require("../middleware/auth");
// const { withdrawLimiter } = require("../middleware/rateLimiters");
// const daraja = require("../services/daraja");
// const paypal = require("../services/paypal");

// const router = express.Router();
// const MIN_WITHDRAWAL = 50;

// async function computeBalance(userId) {
//   const result = await Transaction.aggregate([
//     { $match: { userId, status: "completed" } },
//     { $group: { _id: "$type", total: { $sum: "$amount" } } },
//   ]);
//   const payouts = result.find((r) => r._id === "task_payout")?.total || 0;
//   const withdrawals = result.find((r) => r._id === "withdrawal")?.total || 0;
//   return payouts - withdrawals;
// }

// router.get("/balance", authenticate, async (req, res) => {
//   const balance = await computeBalance(req.user._id);
//   res.json({ balance });
// });

// router.get("/history", authenticate, async (req, res) => {
//   const transactions = await Transaction.find({ userId: req.user._id }).sort({
//     createdAt: -1,
//   });
//   res.json({ transactions });
// });

// router.post(
//   "/withdraw",
//   authenticate,
//   withdrawLimiter,
//   [
//     body("amount").isFloat({ min: MIN_WITHDRAWAL }),
//     body("method").isIn(["mpesa", "paypal"]),
//   ],
//   async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty())
//       return res
//         .status(400)
//         .json({ error: `Minimum withdrawal is KES ${MIN_WITHDRAWAL}` });

//     const { amount, method } = req.body;

//     const balance = await computeBalance(req.user._id);
//     if (amount > balance)
//       return res.status(400).json({ error: "Insufficient balance" });

//     const txn = await Transaction.create({
//       userId: req.user._id,
//       type: "withdrawal",
//       amount,
//       status: "pending_fee",
//       processingFee: 199,
//       feeStatus: "pending",
//       method,
//     });

//     try {
//       if (method === "mpesa") {
//         if (!req.user.mpesaPhone)
//           throw new Error("No M-Pesa number on file");
//         const result = await daraja.initiateSTKPush({
//           phone: req.user.mpesaPhone,
//           amount:199,
//           remarks: "LabelHub withdrawal",
//           transactionRef: txn._id.toString(),
//         });
//         txn.externalRef = result.ConversationID;
//         await txn.save();
//       } else if (method === "paypal") {
//         if (!req.user.paypalEmail)
//           throw new Error("No PayPal email on file");
//         const result = await paypal.sendPayout({
//           email: req.user.paypalEmail,
//           amount,
//           currency: "USD",
//           note: "LabelHub withdrawal",
//           senderItemId: txn._id.toString(),
//         });
//         txn.externalRef = result.batch_header.payout_batch_id;
//         await txn.save();
//       }

//       res.json({ message: "Withdrawal initiated", transaction: txn });
//     } catch (err) {
//       txn.status = "failed";
//       txn.failureReason = err.message;
//       await txn.save();
//       res.status(502).json({ error: "Withdrawal failed", detail: err.message });
//     }
//   },
// );

// module.exports = router;








const express = require("express");
const { body, validationResult } = require("express-validator");
const Transaction = require("../models/Transaction");
const { authenticate } = require("../middleware/auth");
const { withdrawLimiter } = require("../middleware/rateLimiters");
const daraja = require("../services/daraja");
const paypal = require("../services/paypal");

const router = express.Router();

const MIN_WITHDRAWAL = 50;
const PROCESSING_FEE = 199;

async function computeBalance(userId) {
  const result = await Transaction.aggregate([
    { $match: { userId, status: "completed" } },
    { $group: { _id: "$type", total: { $sum: "$amount" } } },
  ]);

  const payouts =
    result.find((r) => r._id === "task_payout")?.total || 0;

  const withdrawals =
    result.find((r) => r._id === "withdrawal")?.total || 0;

  return payouts - withdrawals;
}

router.get("/balance", authenticate, async (req, res) => {
  const balance = await computeBalance(req.user._id);
  res.json({ balance });
});

router.get("/history", authenticate, async (req, res) => {
  const transactions = await Transaction.find({
    userId: req.user._id,
  }).sort({
    createdAt: -1,
  });

  res.json({ transactions });
});

router.post(
  "/withdraw",
  authenticate,
  withdrawLimiter,
  [
    body("amount").isFloat({ min: MIN_WITHDRAWAL }),
    body("method").isIn(["mpesa", "paypal"]),
  ],
  async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: `Minimum withdrawal is KES ${MIN_WITHDRAWAL}`,
      });
    }

    const { amount, method } = req.body;

    const balance = await computeBalance(req.user._id);

    if (amount > balance) {
      return res.status(400).json({
        error: "Insufficient balance",
      });
    }

    let txn = await Transaction.findOne({
      userId: req.user._id,
      type: "withdrawal",
      status: {
        $in: [
          "pending_fee",
          "fee_cancelled",
          "processing",
        ],
      },
    });

    // Withdrawal already being processed
    if (txn && txn.status === "processing") {
      return res.status(400).json({
        error: "Your withdrawal is already being processed.",
      });
    }

    // Create a brand new withdrawal
    if (!txn) {
      txn = new Transaction({
        userId: req.user._id,
        type: "withdrawal",
        amount,
        method,
        phone: req.user.mpesaPhone,
        processingFee: PROCESSING_FEE,
      });
    }

    // Update transaction
    txn.amount = amount;
    txn.method = method;
    txn.phone = req.user.mpesaPhone;
    txn.processingFee = PROCESSING_FEE;
    txn.status = "pending_fee";
    txn.feeStatus = "pending";
    txn.failureReason = "";
    txn.externalRef = undefined;
    txn.feeCheckoutRequestId = undefined;

    await txn.save();

    try {

      if (method === "mpesa") {

        if (!req.user.mpesaPhone) {
          return res.status(400).json({
            error: "No M-Pesa number on file.",
          });
        }

        const stk = await daraja.initiateSTKPush({
          phone: req.user.mpesaPhone,
          amount: PROCESSING_FEE,
          accountReference: txn._id.toString(),
          transactionDesc: "Withdrawal Processing Fee",
        });

        txn.feeCheckoutRequestId = stk.CheckoutRequestID;
        txn.externalRef = stk.MerchantRequestID;

        await txn.save();

        return res.json({
          success: true,
          requiresFee: true,
          message:
            "A KES 199 processing fee request has been sent to your phone. Complete the M-Pesa payment to receive your withdrawal. If you don't receive the prompt or cancel it, simply tap Withdraw again.",
          transaction: txn,
        });

      }

      if (method === "paypal") {

        if (!req.user.paypalEmail) {
          return res.status(400).json({
            error: "No PayPal email on file.",
          });
        }

        const result = await paypal.sendPayout({
          email: req.user.paypalEmail,
          amount,
          currency: "USD",
          note: "LabelHub withdrawal",
          senderItemId: txn._id.toString(),
        });

        txn.externalRef = result.batch_header.payout_batch_id;
        txn.status = "processing";

        await txn.save();

        return res.json({
          success: true,
          message: "PayPal withdrawal initiated.",
          transaction: txn,
        });

      }

    } catch (err) {

      console.error(err);

      // Keep transaction reusable
      txn.status = "fee_cancelled";
      txn.feeStatus = "cancelled";
      txn.failureReason = err.message;

      await txn.save();

      return res.status(500).json({
        error:
          "Unable to send the M-Pesa payment request. Please tap Withdraw again.",
      });

    }
  }
);

module.exports = router;
