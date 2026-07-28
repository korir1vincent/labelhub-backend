const express = require("express");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const User = require("../models/User");
const config = require("../config/config");
const paypal = require("../services/paypal");
const daraja = require("../services/daraja");

const router = express.Router();

async function notifyWithdrawalResult(txn) {
  try {
    await Notification.create({
      userId: txn.userId,
      type: txn.status === "completed" ? "withdrawal_completed" : "withdrawal_failed",
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
=       PAYHERO STK CALLBACK (Processing Fee)      =
==================================================*/

router.post("/payhero/:secret", express.json(), async (req, res) => {
  // PayHero doesn't sign webhooks, so gate on the secret embedded in the
  // callback_url path (same trick used for the Daraja B2C result callback).
  if (!secretMatches(req.params.secret, config.payhero.webhookSecret)) {
    return res.status(404).end();
  }

  try {
    const result = req.body?.response;

    if (!result) {
      // Nothing usable — ack anyway so PayHero doesn't keep retrying.
      return res.sendStatus(200);
    }

    // ExternalReference is whatever you passed as accountReference/
    // external_reference when calling payhero.initiateSTKPush — set that to
    // txn._id.toString() when you kick off the fee collection, so matching
    // here doesn't depend on having already saved CheckoutRequestID.
    const txn = await Transaction.findOne({
      _id: result.ExternalReference,
      status: "pending_fee",
    });

    if (!txn) return res.sendStatus(200);

    if (result.Status !== "Success" || result.ResultCode !== 0) {
      txn.feeStatus = "unpaid";
      txn.status = "fee_cancelled";
      txn.failureReason = result.ResultDesc;
      await txn.save();
      return res.sendStatus(200);
    }

    txn.feeStatus = "paid";
    txn.status = "processing";
    txn.feeCheckoutRequestId = result.CheckoutRequestID;
    if (result.MpesaReceiptNumber) txn.feeReceipt = result.MpesaReceiptNumber;
    txn.feePaidAt = new Date();
    await txn.save();

    // Fee confirmed — send the actual payout via whichever method this
    // withdrawal was for.
    if (txn.method === "mpesa") {
      const b2cResult = await daraja.sendB2CPayment({
        phone: txn.phone || txn.phoneNumber,
        amount: txn.amount,
        remarks: "LabelHub withdrawal",
        transactionRef: txn._id.toString(),
      });

      txn.externalRef = b2cResult.ConversationID;
      await txn.save();
    } else if (txn.method === "paypal") {
      const worker = await User.findById(txn.userId);

      if (!worker || !worker.paypalEmail) {
        txn.status = "failed";
        txn.failureReason = "No PayPal email on file at time of payout.";
        await txn.save();
        await notifyWithdrawalResult(txn);
        return res.sendStatus(200);
      }

      const payoutResult = await paypal.sendPayout({
        email: worker.paypalEmail,
        amount: txn.amount,
        currency: "USD",
        note: "LabelHub withdrawal",
        senderItemId: txn._id.toString(),
      });

      txn.externalRef = payoutResult.batch_header.payout_batch_id;
      await txn.save();
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200); // still ack — avoid PayHero retry storms on our own bugs
  }
});

/*==================================================
=            B2C RESULT CALLBACK (unchanged)       =
==================================================*/

router.post("/daraja/result/:secret", express.json(), async (req, res) => {
  if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
    return res.status(404).end();
  }

  const result = req.body?.Result;
  if (!result) return res.status(400).json({ error: "Malformed callback" });

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

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/*==================================================
=            B2C TIMEOUT (unchanged)               =
==================================================*/

router.post("/daraja/timeout/:secret", express.json(), async (req, res) => {
  if (!secretMatches(req.params.secret, config.daraja.webhookSecret)) {
    return res.status(404).end();
  }
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/*==================================================
=            PAYPAL CALLBACK (unchanged)           =
==================================================*/

router.post("/paypal", express.json(), async (req, res) => {
  try {
    const valid = await paypal.verifyWebhookSignature(req.headers, req.body);
    if (!valid) return res.status(400).json({ error: "Invalid webhook signature" });
  } catch (err) {
    return res.status(400).json({ error: "Webhook verification failed" });
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
      txn.status = item.transaction_status === "SUCCESS" ? "completed" : "failed";
      await txn.save();
      await notifyWithdrawalResult(txn);
    }
  }

  res.sendStatus(200);
});

module.exports = router;