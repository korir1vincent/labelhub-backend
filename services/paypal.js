const axios = require("axios");
const config = require("../config/config");

async function getAccessToken() {
  const auth = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`,
  ).toString("base64");

  const { data } = await axios.post(
    `${config.paypal.baseUrl}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  return data.access_token;
}

/**
 * Send a real payout to a PayPal account by email using the Payouts API.
 * Returns PayPal's batch response. Final item status arrives via webhook
 * (PAYMENT.PAYOUTS-ITEM.SUCCEEDED / .FAILED) — see routes/webhooks.js.
 */
async function sendPayout({ email, amount, currency, note, senderItemId }) {
  const token = await getAccessToken();

  const payload = {
    sender_batch_header: {
      sender_batch_id: `labelhub_${Date.now()}`,
      email_subject: "You have a payout from LabelHub!",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: amount.toFixed(2), currency },
        note: note || "LabelHub withdrawal",
        sender_item_id: senderItemId,
        receiver: email,
      },
    ],
  };

  const { data } = await axios.post(
    `${config.paypal.baseUrl}/v1/payments/payouts`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  return data; // { batch_header: { payout_batch_id, batch_status } }
}

/**
 * Verify an inbound PayPal webhook is genuinely from PayPal, not forged.
 * Pass the raw request headers and parsed JSON body. Returns true only if
 * PayPal's own verification endpoint confirms the signature is valid.
 */
async function verifyWebhookSignature(headers, body) {
  const token = await getAccessToken();

  const payload = {
    transmission_id: headers["paypal-transmission-id"],
    transmission_time: headers["paypal-transmission-time"],
    cert_url: headers["paypal-cert-url"],
    auth_algo: headers["paypal-auth-algo"],
    transmission_sig: headers["paypal-transmission-sig"],
    webhook_id: config.paypal.webhookId,
    webhook_event: body,
  };

  const { data } = await axios.post(
    `${config.paypal.baseUrl}/v1/notifications/verify-webhook-signature`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  return data.verification_status === "SUCCESS";
}

module.exports = { getAccessToken, sendPayout, verifyWebhookSignature };
