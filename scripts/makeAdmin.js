// Usage: node scripts/makeAdmin.js user@example.com
// Promotes an existing registered user to the "admin" role so they can
// create tasks and review submissions. Run this once after your first
// registration to bootstrap yourself as admin.

require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/config");
const User = require("../models/User");

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/makeAdmin.js user@example.com");
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { role: "admin" },
    { new: true },
  );

  if (!user) {
    console.error(`No user found with email ${email}`);
  } else {
    console.log(`${user.name} (${user.email}) is now an admin.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
