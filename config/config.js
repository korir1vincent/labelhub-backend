require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY || "12h",
  corsOrigin: process.env.CORS_ORIGIN || "*",

  daraja: {
    env: process.env.DARAJA_ENV || "sandbox",
    consumerKey: process.env.DARAJA_CONSUMER_KEY,
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET,
    shortcode: process.env.DARAJA_SHORTCODE,
    passkey: process.env.DARAJA_PASSKEY,
    stkCallbackUrl: process.env.DARAJA_STK_CALLBACK_URL,
    initiatorName: process.env.DARAJA_INITIATOR_NAME,
    initiatorPassword: process.env.DARAJA_INITIATOR_PASSWORD,
    resultUrl: process.env.DARAJA_B2C_RESULT_URL,
    timeoutUrl: process.env.DARAJA_B2C_TIMEOUT_URL,
    certPath: process.env.DARAJA_CERT_PATH,
    // Safaricom does not sign B2C result callbacks, so we verify authenticity
    // via a secret segment embedded in the ResultURL/TimeoutURL path instead.
    // DARAJA_B2C_RESULT_URL should be set to something like:
    //   https://yourdomain.com/webhooks/daraja/result/<this secret>
    webhookSecret: process.env.DARAJA_WEBHOOK_SECRET,
    baseUrl:
      process.env.DARAJA_ENV === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke",
  },

  paypal: {
    env: process.env.PAYPAL_ENV || "sandbox",
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    // Webhook ID from the PayPal Developer Dashboard (Apps & Credentials > your
    // app > Webhooks). Required to verify inbound webhook signatures.
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
    baseUrl:
      process.env.PAYPAL_ENV === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com",
  },
};
