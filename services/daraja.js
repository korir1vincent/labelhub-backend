// const axios = require("axios");
// const fs = require("fs");
// const crypto = require("crypto");
// const config = require("../config/config");

// // Get OAuth token from Safaricom
// async function getAccessToken() {
//   const auth = Buffer.from(
//     `${config.daraja.consumerKey}:${config.daraja.consumerSecret}`,
//   ).toString("base64");

//   const { data } = await axios.get(
//     `${config.daraja.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
//     { headers: { Authorization: `Basic ${auth}` } },
//   );
//   return data.access_token;
// }

// // Encrypt the initiator password using Safaricom's public certificate.
// // Sandbox cert: download "SandboxCertificate.cer" from the Daraja docs/portal
// // and place it at the path pointed to by DARAJA_CERT_PATH.
// function encryptSecurityCredential() {
//   const cert = fs.readFileSync(config.daraja.certPath, "utf8");
//   const buffer = Buffer.from(config.daraja.initiatorPassword, "utf8");
//   const encrypted = crypto.publicEncrypt(
//     { key: cert, padding: crypto.constants.RSA_PKCS1_PADDING },
//     buffer,
//   );
//   return encrypted.toString("base64");
// }

// /**
//  * Send money to a user's M-Pesa via B2C ("BusinessPayment").
//  * phone must be in format 2547XXXXXXXX
//  * This call only returns Safaricom's acknowledgement (ConversationID).
//  * The actual success/failure of the payment arrives asynchronously at
//  * the ResultURL webhook (see routes/webhooks.js).
//  */
// async function sendB2CPayment({ phone, amount, remarks, occasion, transactionRef }) {
//   const token = await getAccessToken();
//   const securityCredential = encryptSecurityCredential();

//   const payload = {
//     InitiatorName: config.daraja.initiatorName,
//     SecurityCredential: securityCredential,
//     CommandID: "BusinessPayment",
//     Amount: Math.round(amount),
//     PartyA: config.daraja.shortcode,
//     PartyB: phone,
//     Remarks: remarks || "LabelHub withdrawal",
//     QueueTimeOutURL: config.daraja.timeoutUrl,
//     ResultURL: config.daraja.resultUrl,
//     Occasion: occasion || transactionRef,
//   };

//   const { data } = await axios.post(
//     `${config.daraja.baseUrl}/mpesa/b2c/v1/paymentrequest`,
//     payload,
//     { headers: { Authorization: `Bearer ${token}` } },
//   );

//   return data; // { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }
// }
// async function initiateSTKPush({
//     phone,
//     amount,
//     accountReference,
//     transactionDesc,
//     callbackUrl,
//   }) {

//       // get access token

//       // generate timestamp

//       // generate password

//       // POST to

//       /mpesa/stkpush/v1/processrequest

//   }

// module.exports = { getAccessToken, sendB2CPayment, initiateSTKPush };



const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const config = require("../config/config");

// Get OAuth Token
async function getAccessToken() {
  const auth = Buffer.from(
    `${config.daraja.consumerKey}:${config.daraja.consumerSecret}`
  ).toString("base64");

  const { data } = await axios.get(
    `${config.daraja.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  return data.access_token;
}

// Encrypt Initiator Password
function encryptSecurityCredential() {
  const cert = fs.readFileSync(config.daraja.certPath, "utf8");

  const encrypted = crypto.publicEncrypt(
    {
      key: cert,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(config.daraja.initiatorPassword)
  );

  return encrypted.toString("base64");
}

// Generate Timestamp
function generateTimestamp() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  const hours = String(now.getHours()).padStart(2, "0");

  const minutes = String(now.getMinutes()).padStart(2, "0");

  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Generate STK Password
function generatePassword(timestamp) {
  return Buffer.from(
    `${config.daraja.shortcode}${config.daraja.passkey}${timestamp}`
  ).toString("base64");
}

// STK PUSH
async function initiateSTKPush({
  phone,
  amount,
  accountReference,
  transactionDesc,
}) {
  const token = await getAccessToken();

  const timestamp = generateTimestamp();

  const password = generatePassword(timestamp);

  const payload = {
    BusinessShortCode: config.daraja.shortcode,

    Password: password,

    Timestamp: timestamp,

    TransactionType: "CustomerPayBillOnline",

    Amount: Math.round(amount),

    PartyA: phone,

    PartyB: config.daraja.shortcode,

    PhoneNumber: phone,

    CallBackURL: config.daraja.stkCallbackUrl,

    AccountReference: accountReference,

    TransactionDesc: transactionDesc,
  };

  const { data } = await axios.post(
    `${config.daraja.baseUrl}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
}

// =========================
// B2C PAYMENT
// =========================
function normalizePhone(phone) {
    phone = String(phone).trim().replace(/\s+/g, "");

    if (phone.startsWith("+254")) {
        return phone.slice(1);
    }

    if (phone.startsWith("254")) {
        return phone;
    }

    if (phone.startsWith("07")) {
        return "254" + phone.slice(1);
    }

    if (phone.startsWith("7")) {
        return "254" + phone;
    }

    throw new Error("Invalid Kenyan phone number");
}

async function sendB2CPayment({
  phone,
  amount,
  remarks,
  occasion,
  transactionRef,
}) {
  const token = await getAccessToken();

  const securityCredential = encryptSecurityCredential();

  phone = normalizePhone(phone);

const payload = {
    BusinessShortCode: config.daraja.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: config.daraja.shortcode,
    PhoneNumber: phone,
    CallBackURL: config.daraja.stkCallbackUrl,
    AccountReference: accountReference,
    TransactionDesc: transactionDesc,
};

  const { data } = await axios.post(
    `${config.daraja.baseUrl}/mpesa/b2c/v1/paymentrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
}

module.exports = {
  getAccessToken,
  initiateSTKPush,
  sendB2CPayment,
};