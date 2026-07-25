// const express = require("express");
// const crypto = require("crypto");
// const Transaction = require("../models/Transaction");
// const Notification = require("../models/Notification");
// const config = require("../config/config");
// const paypal = require("../services/paypal");

// const router = express.Router();

// async function notifyWithdrawalResult(txn) {
//   try {
//     await Notification.create({
//       userId: txn.userId,
//       type: txn.status === "completed" ? "withdrawal_completed" : "withdrawal_failed",
//       message:
//         txn.status === "completed"
//           ? `Your withdrawal of KES ${txn.amount} via ${txn.method} has been sent.`
//           : `Your withdrawal of KES ${txn.amount} via ${txn.method} failed${txn.failureReason ? `: ${txn.failureReason}` : "."}`,
//       relatedTransactionId: txn._id,
//     });
//   } catch (err) {
//     // non-fatal
//   }
// }

// // Constant-time secret comparison to avoid timing attacks on the webhook secret
// function secretMatches(provided, expected) {
//   if (!provided || !expected) return false;
//   const a = Buffer.from(provided);
//   const b = Buffer.from(expected);
//   if (a.length !== b.length) return false;
//   return crypto.timingSafeEqual(a, b);
// }

// // Daraja does not sign B2C result callbacks, so authenticity is verified via
// // a secret segment in the URL path (set DARAJA_B2C_RESULT_URL to include it,
// // e.g. https://yourdomain.com/webhooks/daraja/result/<DARAJA_WEBHOOK_SECRET>).
// router.post("/daraja/result/:secret", express.json(), async (req, res) => {
//   if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
//     return res.status(404).end(); // 404, not 401 — don't reveal the endpoint exists
//   }

//   const result = req.body?.Result;
//   if (!result) return res.status(400).json({ error: "Malformed callback" });

//   const txn = await Transaction.findOne({
//     externalRef: result.ConversationID,
//     method: "mpesa",
//     status: "pending", // only ever transition a pending withdrawal — never re-process
//   });
//   if (txn) {
//     txn.status = result.ResultCode === 0 ? "completed" : "failed";
//     if (result.ResultCode !== 0) txn.failureReason = result.ResultDesc;
//     await txn.save();
//     await notifyWithdrawalResult(txn);
//   }

//   res.json({ ResultCode: 0, ResultDesc: "Accepted" });
// });

// router.post("/daraja/timeout/:secret", express.json(), async (req, res) => {
//   if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
//     return res.status(404).end();
//   }
//   res.json({ ResultCode: 0, ResultDesc: "Accepted" });
// });

// // PayPal payout webhook — signature is cryptographically verified against
// // PayPal's own verification endpoint before any transaction is trusted.
// router.post("/paypal", express.json(), async (req, res) => {
//   try {
//     const valid = await paypal.verifyWebhookSignature(req.headers, req.body);
//     if (!valid) {
//       return res.status(400).json({ error: "Invalid webhook signature" });
//     }
//   } catch (err) {
//     return res.status(400).json({ error: "Webhook verification failed" });
//   }

//   const event = req.body;
//   if (event.event_type?.startsWith("PAYMENT.PAYOUTS-ITEM")) {
//     const item = event.resource;
//     const txn = await Transaction.findOne({
//       externalRef: item.payout_batch_id,
//       method: "paypal",
//       status: "pending",
//     });
//     if (txn) {
//       txn.status = item.transaction_status === "SUCCESS" ? "completed" : "failed";
//       await txn.save();
//       await notifyWithdrawalResult(txn);
//     }
//   }
//   res.sendStatus(200);
// });

// module.exports = router;


const express = require("express");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const config = require("../config/config");
const paypal = require("../services/paypal");
const daraja = require("../services/daraja");

const router = express.Router();

async function notifyWithdrawalResult(txn) {
  try {
    await Notification.create({
      userId: txn.userId,
      type:
        txn.status === "completed"
          ? "withdrawal_completed"
          : "withdrawal_failed",
      message:
        txn.status === "completed"
          ? `Your withdrawal of KES ${txn.amount} via ${txn.method} has been sent.`
          : `Your withdrawal of KES ${txn.amount} via ${txn.method} failed${
              txn.failureReason ? `: ${txn.failureReason}` : "."
            }`,
      relatedTransactionId: txn._id,
    });
  } catch (err) {
    console.error(err);
  }
}

function secretMatches(provided, expected) {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/*==================================================
=            STK CALLBACK (Processing Fee)         =
==================================================*/

router.post("/daraja/stk", express.json(), async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted",
      });
    }

    const checkoutId = callback.CheckoutRequestID;

    const txn = await Transaction.findOne({
      feeCheckoutRequestId: checkoutId,
      status: "pending_fee",
    });

    if (!txn) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Accepted",
      });
    }

    if (callback.ResultCode !== 0) {

    txn.feeStatus = "unpaid";
    txn.status = "fee_cancelled";
    txn.failureReason = callback.ResultDesc;

    await txn.save();

    return res.json({
        ResultCode:0,
        ResultDesc:"Accepted"
    });
    }

    txn.feeStatus = "paid";
    txn.status = "processing";

    const receiptItem = callback.CallbackMetadata?.Item?.find(
      (i) => i.Name === "MpesaReceiptNumber"
    );

    if (receiptItem) {
      txn.feeReceipt = receiptItem.Value;
    }

    txn.feePaidAt = new Date();

    await txn.save();

    // Automatically send withdrawal

    const result = await daraja.sendB2CPayment({
      phone: txn.phone || txn.phoneNumber,
      amount: txn.amount,
      remarks: "LabelHub withdrawal",
      transactionRef: txn._id.toString(),
    });

    txn.externalRef = result.ConversationID;

    await txn.save();

    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (err) {
    console.error(err);

    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  }
});

/*==================================================
=            B2C RESULT CALLBACK                   =
==================================================*/

router.post("/daraja/result/:secret", express.json(), async (req, res) => {
  if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
    return res.status(404).end();
  }

  const result = req.body?.Result;

  if (!result) {
    return res.status(400).json({
      error: "Malformed callback",
    });
  }

  const txn = await Transaction.findOne({
    externalRef: result.ConversationID,
    method: "mpesa",
    status: "processing",
  });

  if (txn) {
    if (result.ResultCode === 0) {
      txn.status = "completed";
    } else {
      txn.status = "failed";
      txn.failureReason = result.ResultDesc;
    }

    await txn.save();

    await notifyWithdrawalResult(txn);
  }

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
});

/*==================================================
=            B2C TIMEOUT                           =
==================================================*/

router.post("/daraja/timeout/:secret", express.json(), async (req, res) => {
  if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
    return res.status(404).end();
  }

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
});

/*==================================================
=            PAYPAL CALLBACK                       =
==================================================*/

router.post("/paypal", express.json(), async (req, res) => {
  try {
    const valid = await paypal.verifyWebhookSignature(
      req.headers,
      req.body
    );

    if (!valid) {
      return res.status(400).json({
        error: "Invalid webhook signature",
      });
    }
  } catch (err) {
    return res.status(400).json({
      error: "Webhook verification failed",
    });
  }

  const event = req.body;

  if (event.event_type?.startsWith("PAYMENT.PAYOUTS-ITEM")) {
    const item = event.resource;

    const txn = await Transaction.findOne({
      externalRef: item.payout_batch_id,
      method: "paypal",
      status: "processing",
    });

    if (txn) {
      txn.status =
        item.transaction_status === "SUCCESS"
          ? "completed"
          : "failed";

      await txn.save();

      await notifyWithdrawalResult(txn);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
