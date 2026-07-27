// Usage: node scripts/seedTasks.js
// Seeds the database with real, license-clear tasks:
// - Images from Unsplash (free commercial-use license, verified live)
// - Audio from Internet Archive / LibriVox (public domain, verified live)
// - Text prompts written originally for this platform (not copied from any source)
//
// This replaces placeholder/sketch data with content workers can actually
// do meaningful, real work against. Run once after your backend is up.

require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/config");
const Task = require("../models/Task");
const User = require("../models/User");

const REAL_TASKS = [
  // ---- ANNOTATION: Easy → Hard ladder ----
  {
    type: "annotation",
    title: "Bounding Box: Traffic Signs (Single Sign)",
    difficulty: "Easy",
    payoutAmount: 30,
    assetUrl:
      "https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?auto=format&fit=crop&w=1200&q=80",
    prompt:
      "Draw a bounding box around the single most prominent traffic sign in the image. Note the approximate pixel coordinates and classify the sign type.",
    instructions: [
      "Focus only on the clearest, most prominent sign",
      "Box should tightly hug the sign — avoid excess background",
      "Format: [x1,y1,x2,y2] - SIGN_TYPE",
    ],
    exampleAnswer:
      "Example of good format from a different image: [142,88,210,160] - STOP. The box coordinates should trace the sign's outer edge, and the type should be one of the standard categories (STOP, YIELD, SPEED_LIMIT, WARNING, INFORMATIONAL).",
  },
  {
    type: "annotation",
    title: "Bounding Box: Traffic Signs (Full Scene)",
    difficulty: "Medium",
    payoutAmount: 45,
    assetUrl:
      "https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?auto=format&fit=crop&w=1200&q=80",
    prompt:
      "Draw a bounding box around every traffic sign visible in the image, however many there are. For each box, note the approximate pixel coordinates and classify the sign type (e.g. STOP, YIELD, SPEED_LIMIT, WARNING, INFORMATIONAL). Write your answer as a numbered list, one line per sign.",
    instructions: [
      "Include every sign, even partially visible ones at the frame edge",
      "Boxes should tightly hug each sign — avoid excess background",
      "If a sign's text is unreadable, note [ILLEGIBLE] instead of guessing",
      "Format: 1. [x1,y1,x2,y2] - SIGN_TYPE",
    ],
    exampleAnswer:
      "Example format (from a different image with 2 signs):\n1. [142,88,210,160] - STOP\n2. [340,95,398,150] - SPEED_LIMIT\nNote how each sign gets its own numbered line with tight coordinates and a single category label.",
  },
  {
    type: "annotation",
    title: "Bounding Box: Traffic Signs (With Occlusion Notes)",
    difficulty: "Hard",
    payoutAmount: 70,
    assetUrl:
      "https://images.unsplash.com/photo-1566241440091-ec10de8db2e1?auto=format&fit=crop&w=1200&q=80",
    prompt:
      "Draw a bounding box around every traffic sign in the image, classify each, AND note whether it is fully visible, partially occluded (e.g. by a tree or pole), or damaged/faded. This distinction matters for training models to handle real-world imperfect visibility.",
    instructions: [
      "Format: N. [x1,y1,x2,y2] - SIGN_TYPE - VISIBILITY(full/partial/damaged)",
      "For partial occlusion, estimate the full sign's boundary, not just the visible portion",
      "Note the likely cause of occlusion if visible (e.g. 'partially blocked by branch')",
    ],
    exampleAnswer:
      "Example: 1. [200,60,265,130] - YIELD - partial (bottom third blocked by street pole). The estimated box still traces where the full sign would be, not just what's visible.",
  },

  // ---- OCR: Easy → Medium ----
  {
    type: "ocr",
    title: "OCR Correction: Handwritten Form (Single Field)",
    difficulty: "Easy",
    payoutAmount: 25,
    assetUrl:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80",
    prompt:
      "Transcribe just the topmost handwritten field visible in this form image. Mark it [ILLEGIBLE] if you genuinely cannot read it.",
    instructions: [
      "Only transcribe the single topmost field",
      "Preserve original spelling and capitalization exactly",
    ],
    exampleAnswer: "Example: Full Name: Jane Wanjiku Mwangi",
  },
  {
    type: "ocr",
    title: "OCR Correction: Handwritten Form (All Fields)",
    difficulty: "Medium",
    payoutAmount: 65,
    assetUrl:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80",
    prompt:
      "Transcribe all handwritten and printed text visible in this form image field by field. Preserve the original field labels exactly as shown, and write the corresponding value next to each one. Mark anything you cannot read with [ILLEGIBLE] rather than guessing.",
    instructions: [
      "Go field by field, in reading order (top to bottom, left to right)",
      "Preserve original spelling and capitalization exactly as written",
      "Flag anything ambiguous rather than guessing at a value",
      "Do not skip partially visible or cut-off fields",
    ],
    exampleAnswer:
      "Example format:\nFull Name: Jane Wanjiku Mwangi\nDate of Birth: 14/03/1995\nID Number: [ILLEGIBLE]\nSignature: [present, not transcribable]",
  },

  // ---- TRANSCRIPTION: short → long ----
  {
    type: "transcription",
    title: "Transcribe: Historical Speech (Short, 2:38)",
    difficulty: "Easy",
    payoutAmount: 55,
    assetUrl:
      "https://archive.org/download/gettysburg_johng_librivox/gettysburg_address_64kb.mp3",
    prompt:
      "Transcribe this 2-minute 38-second audio recording word for word. Include a timestamp at the start of every new sentence. This is a single continuous reading with no other speakers.",
    instructions: [
      "Timestamp format: [MM:SS] at the start of each sentence",
      "Transcribe exactly what is said, including any verbal stumbles",
      "Mark unclear audio with [INAUDIBLE] instead of guessing",
      "No paraphrasing — this needs to be a literal transcript",
    ],
    exampleAnswer:
      "Example opening line format: [00:00] Four score and seven years ago our fathers brought forth on this continent a new nation...",
  },
  {
    type: "transcription",
    title: "Transcribe: Short Story Reading (Long, 13:22)",
    difficulty: "Hard",
    payoutAmount: 180,
    assetUrl:
      "https://archive.org/download/giftofmagi/gift_of_the_magi_henry_blb_64kb.mp3",
    prompt:
      "Transcribe this 13-minute 22-second audio recording of a short story reading. Include a timestamp every 30 seconds, and use quotation marks for any dialogue between characters.",
    instructions: [
      "Timestamp every 30 seconds: [MM:SS]",
      "Use quotation marks around all spoken dialogue",
      "Mark unclear audio with [INAUDIBLE]",
      "Punctuate naturally based on the reader's pacing and pauses",
    ],
    exampleAnswer:
      "Example snippet format: [02:30] Della counted her money for the third time. \"One dollar and eighty-seven cents,\" she whispered, \"and that was all.\"",
  },

  // ---- TRANSLATION ----
  {
    type: "translation",
    title: "EN → SW: Farm Equipment Safety Notice",
    difficulty: "Medium",
    payoutAmount: 90,
    prompt:
      "Translate the following safety notice from English to Swahili, preserving technical accuracy:\n\n\"Before operating this equipment, inspect all safety guards and ensure they are properly fastened. Do not remove or bypass any safety mechanism. Wear protective eyewear and gloves at all times during operation. In case of malfunction, switch off the power supply immediately and report the issue to your supervisor before attempting any repair. Keep all bystanders at a safe distance of at least three meters while the equipment is running.\"\n\nProvide a short glossary at the end for any technical terms you translated (e.g. \"safety guard\", \"power supply\").",
    instructions: [
      "Use formal Swahili suitable for a workplace safety document",
      "Preserve the exact meaning of safety-critical instructions — do not simplify",
      "Include a glossary of technical terms at the end",
      "Keep the numbered/structured format if you restructure sentences",
    ],
    exampleAnswer:
      "Example glossary entry format: \"safety guard\" → \"kifuniko cha usalama\". Your full translation should read naturally in Swahili, not as a word-for-word crib.",
  },
  {
    type: "translation",
    title: "EN → SW: Community Health Announcement",
    difficulty: "Easy",
    payoutAmount: 50,
    prompt:
      "Translate the following short community health announcement into Swahili:\n\n\"The free health clinic will be open every Tuesday and Thursday from 9am to 3pm. Bring your health card if you have one. Children under five receive priority. For emergencies, call the number posted at the clinic entrance.\"",
    instructions: [
      "Use plain, accessible Swahili suitable for a general community audience",
      "Keep the schedule details (days/times) precise and unambiguous",
    ],
    exampleAnswer:
      "Aim for a tone a community health worker would actually use when posting a notice — clear and direct, not overly formal.",
  },

  // ---- REVIEW ----
  {
    type: "review",
    title: "Quality Review: Machine-Translated Product Descriptions",
    difficulty: "Medium",
    payoutAmount: 55,
    prompt:
      "Below are three English product descriptions and their Swahili machine translations. For each pair, mark the translation as Accurate, Minor Issues, or Major Issues, and list any specific mistranslated phrases with a corrected version.\n\n1. EN: \"Durable phone case with shock protection.\" SW: \"Kifuniko cha simu chenye ubora na kinga dhidi ya mshtuko.\"\n2. EN: \"Free delivery on orders over KES 2,000.\" SW: \"Utoaji bure kwa maagizo zaidi ya bidhaa 2,000.\"\n3. EN: \"Machine washable, do not tumble dry.\" SW: \"Inaweza kuoshwa kwa mkono, usikaushe kwa mashine.\"",
    instructions: [
      "Judge meaning, not just literal word matching",
      "For each mistranslated phrase, give both what's wrong and a corrected version",
      "Consider whether a native Swahili speaker would find the phrasing natural, not just technically correct",
    ],
    exampleAnswer:
      "Example: Item 2 — Minor Issues. \"maagizo\" (orders/instructions) is used loosely for \"orders\" here which works, but \"zaidi ya bidhaa 2,000\" reads as \"more than 2,000 products\" rather than \"orders over KES 2,000\" — the currency/amount meaning is lost. Corrected: \"Utoaji bure kwa maagizo ya zaidi ya KES 2,000.\"",
  },

  // ---- SENTIMENT: a real batch, not 3 items ----
  {
    type: "sentiment",
    title: "Sentiment Analysis: Customer Feedback Batch (10 items)",
    difficulty: "Medium",
    payoutAmount: 60,
    prompt:
      "Classify each of the following ten customer feedback snippets by sentiment (Positive, Negative, or Neutral) and identify the main aspect being discussed (Price, Quality, Delivery, or Service):\n\n1. \"The delivery took over two weeks and no one responded to my calls.\"\n2. \"Good value for the price, though the packaging could be sturdier.\"\n3. \"Excellent customer service — they resolved my issue within an hour.\"\n4. \"It arrived on time but the product didn't match the description at all.\"\n5. \"Average experience overall, nothing particularly good or bad to report.\"\n6. \"Way too expensive for what you actually get.\"\n7. \"Fast shipping, well packaged, exactly as described. Very happy.\"\n8. \"Support kept transferring me between departments and never solved the issue.\"\n9. \"Quality is decent but I've seen better at a lower price elsewhere.\"\n10. \"Arrived a day early, which was a nice surprise.\"\n\nFor each item, write: [number] - Sentiment: ___ - Aspect: ___ - One-sentence justification.",
    instructions: [
      "Read each snippet fully before classifying",
      "Choose exactly one sentiment and one aspect per item",
      "Justify your classification in one sentence",
      "Flag any snippet that genuinely mixes multiple sentiments",
    ],
    exampleAnswer:
      "Example: 1 - Sentiment: Negative - Aspect: Delivery - Justification: The two-week delay and unanswered calls both point to a delivery/service failure, with delivery being the more specific complaint.",
  },
];

async function main() {
  await mongoose.connect(config.mongoUri);

  const admin = await User.findOne({ role: "admin" });
  if (!admin) {
    console.error(
      "No admin user found. Register an account and run scripts/makeAdmin.js first.",
    );
    process.exit(1);
  }

  let created = 0;
  for (const taskData of REAL_TASKS) {
    const exists = await Task.findOne({ title: taskData.title });
    if (exists) {
      console.log(`Skipping "${taskData.title}" — already exists`);
      continue;
    }
    await Task.create({ ...taskData, createdBy: admin._id });
    created += 1;
    console.log(`Created: ${taskData.title}`);
  }

  console.log(`\nDone. ${created} new task(s) created.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});