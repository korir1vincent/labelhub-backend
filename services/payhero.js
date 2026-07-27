const axios = require("axios");
const config = require("../config/config");

function authHeader() {
  const token = Buffer.from(
    `${config.payhero.apiUsername}:${config.payhero.apiPassword}`
  ).toString("base64");
  return `Basic ${token}`;
}

function normalizePhone(phone) {
  phone = String(phone).trim().replace(/\s+/g, "");
  if (phone.startsWith("+254")) phone = phone.slice(1);
  else if (phone.startsWith("07") || phone.startsWith("01")) phone = "254" + phone.slice(1);
  else if (phone.startsWith("7") || phone.startsWith("1")) phone = "254" + phone;

  if (!/^254(7|1)\d{8}$/.test(phone)) {
    throw new Error("Invalid Kenyan phone number");
  }
  return phone;
}

async function initiateSTKPush({ phone, amount, accountReference, transactionDesc, customerName }) {
  const payload = {
    amount: Math.round(amount),
    phone_number: normalizePhone(phone),
    channel_id: config.payhero.channelId,
    provider: "m-pesa",
    external_reference: accountReference,
    customer_name: customerName || undefined,
    callback_url: config.payhero.callbackUrl,
  };

  const { data } = await axios.post(
    `${config.payhero.baseUrl}/payments`,
    payload,
    { headers: { Authorization: authHeader(), "Content-Type": "application/json" } }
  );

  return data; // { success, status: "QUEUED", reference, CheckoutRequestID }
}

async function getTransactionStatus(reference) {
  const { data } = await axios.get(
    `${config.payhero.baseUrl}/transaction-status`,
    { params: { reference }, headers: { Authorization: authHeader() } }
  );
  return data;
}

module.exports = { initiateSTKPush, getTransactionStatus, normalizePhone };