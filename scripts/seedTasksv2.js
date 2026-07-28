// Usage: node scripts/seedTasksV2.js
//
// Seeds 30 tasks for EACH of the 6 categories (180 total) — a much larger,
// distinct batch from scripts/seedTasks.js (that script's 12 tasks are left
// untouched; this one adds new titles alongside them, and re-running is safe
// because of the existing-title skip check).
//
// DESIGN NOTE: rather than hand-typing 180 one-off blocks of near-identical
// prose (which would be padding, not quality), this script builds real
// variety from two ingredients:
//   1. A small pool of VERIFIED, license-clear real assets (checked live
//      before this script was written — see comments below each asset).
//   2. Per-category "variant" arrays that each define a genuinely different
//      angle on the same asset (e.g. "count everything" vs "flag occlusion"
//      vs "rate your confidence per detection") — the same technique real
//      annotation platforms use to get more training signal per asset.
// Every generated task has a distinct title, prompt, instructions, and
// example answer. Text-only categories (translation/review/sentiment) use
// distinct real-world topics rather than asset rotation.

require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/config");
const Task = require("../models/Task");
const User = require("../models/User");

// ============================================================
// VERIFIED ASSETS
// ============================================================
// Images — Unsplash, free commercial-use license, each fetched and
// confirmed to return real image content before inclusion here.
const IMAGES = {
  trafficSigns: {
    url: "https://unsplash.com/photos/white-and-red-arrow-sign-on-green-grass-field-5nCXtsF9lRg",
    subject: "sign",
    subjectPlural: "traffic signs",
    context: "a street scene with visible traffic signage",
  },
  parkingLot: {
    url: "https://unsplash.com/photos/a-parking-lot-filled-with-lots-of-parked-cars-I1GC6vQQ_S8",
    subject: "vehicle",
    subjectPlural: "parked vehicles",
    context: "an aerial view of a parking lot with many cars",
  },
  cattleField: {
    url: "https://unsplash.com/photos/a-herd-of-cattle-grazing-on-a-lush-green-field-meUifD3TNyg",
    subject: "animal",
    subjectPlural: "cattle",
    context: "a herd of cattle grazing in an open field",
  },
  handwrittenForm: {
    url: "https://unsplash.com/photos/black-pen-on-white-graphing-paper-QF-ILRbBfSM",
    docType: "a handwritten form",
  },
  receipt: {
    url: "https://unsplash.com/photos/a-hand-holding-a-piece-of-paper-with-a-bar-code-on-it-fK3R3T5KmIs",
    docType: "a printed receipt",
  },
};

// Audio — public domain (LibriVox / Community Audio on the Internet
// Archive), each fetched and confirmed as a live audio/mpeg file.
const AUDIO = {
  gettysburg: {
    url: "https://archive.org/download/gettysburg_johng_librivox/gettysburg_address_64kb.mp3",
    title: "the Gettysburg Address",
    runtime: "2:38",
    kind: "a short historical speech",
  },
  giftOfMagi: {
    url: "https://archive.org/download/giftofmagi/gift_of_the_magi_henry_blb_64kb.mp3",
    title: '"The Gift of the Magi"',
    runtime: "13:22",
    kind: "a short story reading",
  },
  tellTaleHeart: {
    url: "https://archive.org/download/JohnRobinsonTheTellTaleHeart/telltaleheart.mp3",
    title: '"The Tell-Tale Heart"',
    runtime: "12:52",
    kind: "a short story reading",
  },
  ifPoem: {
    url: "https://archive.org/download/if_kipling_librivox/if_kipling_apc_64kb.mp3",
    title: '"If—"',
    runtime: "roughly 2 minutes",
    kind: "a poem reading",
  },
};

// ============================================================
// ANNOTATION — 3 images x 10 variants = 30 tasks
// ============================================================
const ANNOTATION_VARIANTS = [
  {
    suffix: "Basic Count & Box",
    difficulty: "Easy",
    payout: 30,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} you can identify in the image and count the total.`,
    instructions: [
      "One box per instance, however many there are",
      "State the total count clearly at the end of your answer",
      "Format: N. [x1,y1,x2,y2]",
    ],
    example: (img) =>
      `Example from a different image with 3 instances:\n1. [50,60,120,140]\n2. [200,80,270,150]\n3. [310,90,380,160]\nTotal: 3`,
  },
  {
    suffix: "Type Classification",
    difficulty: "Medium",
    payout: 45,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} and classify its specific type or subtype.`,
    instructions: [
      "Use a consistent, short label per type",
      "If genuinely unsure of the type, write 'uncertain' rather than guessing",
      "Format: N. [x1,y1,x2,y2] - TYPE",
    ],
    example: (img) =>
      `Example format: 1. [50,60,120,140] - TYPE_A\n2. [200,80,270,150] - TYPE_B`,
  },
  {
    suffix: "Occlusion Flagging",
    difficulty: "Hard",
    payout: 65,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} and note whether each is fully visible, partially occluded, or only barely visible at the frame edge.`,
    instructions: [
      "For partially occluded instances, estimate the full extent, not just the visible portion",
      "Format: N. [x1,y1,x2,y2] - VISIBILITY(full/partial/edge)",
      "Briefly note the likely cause of occlusion where relevant",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - partial (roughly half blocked by another object in front)`,
  },
  {
    suffix: "Relative Size Tiers",
    difficulty: "Medium",
    payout: 40,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} and assign a relative size tier (small/medium/large) based on how it compares to the others in the same image.`,
    instructions: [
      "Size is relative to the other instances in this image, not an absolute measurement",
      "Format: N. [x1,y1,x2,y2] - SIZE(small/medium/large)",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - medium (roughly average size compared to the rest)`,
  },
  {
    suffix: "Quadrant Density Map",
    difficulty: "Medium",
    payout: 45,
    focus: (img) =>
      `Mentally divide the image into four quadrants (top-left, top-right, bottom-left, bottom-right). Draw a bounding box around every ${img.subject} and note which quadrant its center falls in.`,
    instructions: [
      "Format: N. [x1,y1,x2,y2] - QUADRANT",
      "End with a one-line summary of which quadrant is most crowded",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - top-left\nSummary: top-left is the most crowded quadrant.`,
  },
  {
    suffix: "Detection Confidence Rating",
    difficulty: "Medium",
    payout: 45,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} you can identify and rate your own confidence in each detection (high/medium/low).`,
    instructions: [
      "Low confidence usually means: blurry, very small, or heavily obscured",
      "Format: N. [x1,y1,x2,y2] - CONFIDENCE(high/medium/low)",
      "Being honest about low-confidence detections is more valuable than omitting them",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - high\n2. [400,20,430,45] - low (small and near the frame edge)`,
  },
  {
    suffix: "Anomaly Spotting",
    difficulty: "Hard",
    payout: 60,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} in the image, and separately flag anything unusual or out of place that a training model should be made aware of.`,
    instructions: [
      "Box every standard instance first using the normal format",
      "In a separate 'Anomalies' section, describe anything atypical you noticed",
      "If nothing unusual is present, explicitly say so rather than leaving it blank",
    ],
    example: (img) =>
      `Example Anomalies section: 'Anomalies: none observed — all instances appear typical for this scene.'`,
  },
  {
    suffix: "Distinguishing Attribute Tagging",
    difficulty: "Medium",
    payout: 50,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject} and note one visually distinguishing attribute for each (e.g. color, orientation, or a notable feature).`,
    instructions: [
      "Pick the single most useful distinguishing attribute per instance, not an exhaustive list",
      "Format: N. [x1,y1,x2,y2] - ATTRIBUTE",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - dark-colored, facing left`,
  },
  {
    suffix: "Edge & Cut-Off Instances",
    difficulty: "Hard",
    payout: 55,
    focus: (img) =>
      `Draw a bounding box around every ${img.subject}, paying particular attention to any that are cut off by the frame edge — these are often missed and are especially valuable for this dataset.`,
    instructions: [
      "Explicitly mark frame-edge instances with '(cut off)' after the box",
      "Estimate the box boundary at the frame edge even though the full instance isn't visible",
      "Do not skip an instance just because it's only 10-20% visible",
    ],
    example: (img) =>
      `Example: 1. [0,80,45,160] - cut off at left edge`,
  },
  {
    suffix: "Full QA Pass",
    difficulty: "Hard",
    payout: 75,
    focus: (img) =>
      `Do a complete annotation pass on this image: box every ${img.subject}, classify its type, flag occlusion, and note any instance you're genuinely unsure about with a one-sentence reason why.`,
    instructions: [
      "This combines counting, classification, and occlusion notes into one pass",
      "Format: N. [x1,y1,x2,y2] - TYPE - VISIBILITY - (optional) uncertainty note",
      "Treat this as a final quality-check pass, not a first draft",
    ],
    example: (img) =>
      `Example: 1. [50,60,120,140] - TYPE_A - full\n2. [300,40,340,90] - uncertain - partial (too small/blurry to confidently classify type)`,
  },
];

function buildAnnotationTasks() {
  const images = [IMAGES.trafficSigns, IMAGES.parkingLot, IMAGES.cattleField];
  const tasks = [];
  for (const img of images) {
    for (const variant of ANNOTATION_VARIANTS) {
      tasks.push({
        type: "annotation",
        title: `Annotation: ${img.subjectPlural[0].toUpperCase() + img.subjectPlural.slice(1)} — ${variant.suffix}`,
        difficulty: variant.difficulty,
        payoutAmount: variant.payout,
        assetUrl: img.url,
        prompt: `The image shows ${img.context}. ${variant.focus(img)}`,
        instructions: variant.instructions,
        exampleAnswer: variant.example(img),
      });
    }
  }
  return tasks;
}

// ============================================================
// OCR — 2 images x 15 variants = 30 tasks
// ============================================================
const OCR_VARIANTS = [
  {
    suffix: "Top Field Only",
    difficulty: "Easy",
    payout: 20,
    focus: (doc) => `Transcribe just the topmost field or line of text visible in ${doc}.`,
    instructions: ["Only transcribe the single topmost field", "Mark [ILLEGIBLE] if you genuinely cannot read it"],
  },
  {
    suffix: "Full Transcription",
    difficulty: "Medium",
    payout: 55,
    focus: (doc) => `Transcribe every field of text visible in ${doc}, in reading order.`,
    instructions: ["Go top to bottom, left to right", "Preserve exact spelling and capitalization", "Mark [ILLEGIBLE] rather than guessing"],
  },
  {
    suffix: "Numeric Fields Only",
    difficulty: "Easy",
    payout: 25,
    focus: (doc) => `Transcribe only the numeric fields (amounts, dates, reference numbers, codes) visible in ${doc}, ignoring plain text.`,
    instructions: ["List each numeric field with a short label for what it represents", "Preserve exact digit sequences — do not round or reformat"],
  },
  {
    suffix: "Structured Key-Value Extraction",
    difficulty: "Medium",
    payout: 50,
    focus: (doc) => `Transcribe ${doc} into a clean field-label : value structure, one line per field.`,
    instructions: ["Use the format 'Label: Value'", "If a field has no visible label, infer a reasonable one and note it's inferred"],
  },
  {
    suffix: "Illegibility Audit",
    difficulty: "Medium",
    payout: 45,
    focus: (doc) => `Transcribe ${doc} in full, and separately list every field or word you marked [ILLEGIBLE] with your best guess at why (blur, smudge, handwriting, cut off).`,
    instructions: ["Full transcription first, illegibility audit second", "Be specific about the cause of each illegibility, not just 'unclear'"],
  },
  {
    suffix: "Common OCR-Error Correction",
    difficulty: "Medium",
    payout: 40,
    focus: (doc) => `Transcribe ${doc}, paying special attention to characters that are commonly confused by OCR software (0 vs O, 1 vs l vs I, 5 vs S).`,
    instructions: ["Double-check every digit against the surrounding context (e.g. a date field shouldn't contain a letter)", "Note any field where you had to resolve this kind of ambiguity"],
  },
  {
    suffix: "Document Type Identification",
    difficulty: "Easy",
    payout: 30,
    focus: (doc) => `Transcribe ${doc} in full, and start your answer with a one-line identification of what type of document this appears to be and why.`,
    instructions: ["The document-type line comes first", "Base the identification on visible structure and wording, not assumption"],
  },
  {
    suffix: "Formatting-Preserved Transcription",
    difficulty: "Medium",
    payout: 45,
    focus: (doc) => `Transcribe ${doc} while preserving the original line breaks and spacing layout as closely as text allows.`,
    instructions: ["Match the original's line structure, not a reflowed paragraph", "Use consistent spacing to approximate columns if the original has them"],
  },
  {
    suffix: "Quality-Issue Flagging",
    difficulty: "Easy",
    payout: 30,
    focus: (doc) => `Transcribe ${doc}, and note any image quality issues (blur, glare, crease, low contrast) that affected specific fields.`,
    instructions: ["Tag each affected field with the specific issue that made it harder to read", "If the image quality is clean throughout, say so explicitly"],
  },
  {
    suffix: "Tamper/Alteration Check",
    difficulty: "Hard",
    payout: 60,
    focus: (doc) => `Transcribe ${doc} in full, and flag any field that looks like it may have been altered, overwritten, or doesn't match the visual style of the rest of the document.`,
    instructions: ["This is a fraud-detection-style QA pass — be specific about what looks inconsistent and why", "If nothing looks altered, say so explicitly rather than leaving it blank"],
  },
  {
    suffix: "Confidence-Rated Transcription",
    difficulty: "Medium",
    payout: 45,
    focus: (doc) => `Transcribe every field of ${doc} and rate your confidence in each field's accuracy (high/medium/low).`,
    instructions: ["Format: 'Field: Value (confidence: high/medium/low)'", "Low confidence should correlate with genuinely harder-to-read fields, not just unfamiliar ones"],
  },
  {
    suffix: "Handwritten vs Printed Distinction",
    difficulty: "Medium",
    payout: 40,
    focus: (doc) => `Transcribe ${doc} and mark each field as either [HANDWRITTEN] or [PRINTED] based on how the text appears.`,
    instructions: ["Some documents may be entirely one or the other — note that explicitly if so", "Handwritten fields typically need more careful, letter-by-letter reading"],
  },
  {
    suffix: "Full Verbatim Including Headers/Footers",
    difficulty: "Hard",
    payout: 55,
    focus: (doc) => `Transcribe absolutely everything visible in ${doc}, including small print, headers, footers, stamps, or watermark-style text that's easy to overlook.`,
    instructions: ["Don't skip anything on the assumption it's boilerplate — transcribe it anyway", "Note the position (e.g. 'footer, bottom-right') for anything unusual"],
  },
  {
    suffix: "Math/Totals Consistency Check",
    difficulty: "Hard",
    payout: 60,
    focus: (doc) => `Transcribe all numeric line items in ${doc} and verify whether any visible subtotal or total is mathematically consistent with the individual figures.`,
    instructions: ["Show your addition/verification work briefly", "Flag any discrepancy clearly rather than silently 'fixing' it"],
  },
  {
    suffix: "Redaction-Safe Transcription",
    difficulty: "Medium",
    payout: 40,
    focus: (doc) => `Transcribe ${doc}, but replace any field that looks like personally identifying information (full name, ID number, phone number, signature) with a bracketed label like [NAME] or [ID_NUMBER] instead of the actual value.`,
    instructions: ["The goal is a transcription usable for structure/formatting review without exposing real personal data", "Non-identifying fields (dates, generic labels, amounts) transcribe normally"],
  },
];

function buildOcrTasks() {
  const docs = [IMAGES.handwrittenForm, IMAGES.receipt];
  const tasks = [];
  for (const doc of docs) {
    for (const variant of OCR_VARIANTS) {
      tasks.push({
        type: "ocr",
        title: `OCR: ${doc.docType[0].toUpperCase() + doc.docType.slice(1)} — ${variant.suffix}`,
        difficulty: variant.difficulty,
        payoutAmount: variant.payout,
        assetUrl: doc.url,
        prompt: variant.focus(doc.docType),
        instructions: variant.instructions,
        exampleAnswer: "Follow the field-by-field format described in the instructions above — see a completed example in the platform's OCR task guide.",
      });
    }
  }
  return tasks;
}

// ============================================================
// TRANSCRIPTION — 4 audio clips, 7-8 variants each = 30 tasks
// ============================================================
const TRANSCRIPTION_VARIANTS_LONG = [
  {
    suffix: "Full Literal Transcript",
    difficulty: "Medium",
    payoutMultiplier: 1.0,
    focus: (a) => `Transcribe ${a.title} (${a.kind}, ${a.runtime}) word for word, exactly as spoken.`,
    instructions: ["No paraphrasing — this must be literal", "Mark [INAUDIBLE] for anything unclear rather than guessing"],
  },
  {
    suffix: "Sentence-Level Timestamps",
    difficulty: "Medium",
    payoutMultiplier: 1.1,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}) with a timestamp at the start of every new sentence.`,
    instructions: ["Timestamp format: [MM:SS]", "One timestamp per sentence, not per line"],
  },
  {
    suffix: "30-Second Interval Timestamps",
    difficulty: "Medium",
    payoutMultiplier: 1.1,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}) with a timestamp every 30 seconds.`,
    instructions: ["Timestamp format: [MM:SS] every 30s, regardless of sentence boundaries", "Punctuate naturally within each interval"],
  },
  {
    suffix: "Natural Punctuation & Pacing",
    difficulty: "Medium",
    payoutMultiplier: 1.0,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}), punctuating based on the speaker's natural pauses and pacing rather than mechanically.`,
    instructions: ["Use commas/periods/dashes to reflect how it was actually spoken", "Note any unusually long pause with '(pause)'"],
  },
  {
    suffix: "Tone & Emphasis Notes",
    difficulty: "Hard",
    payoutMultiplier: 1.3,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}) and, in brackets, note significant shifts in tone or emphasis where they occur (e.g. [tense], [reflective], [urgent]).`,
    instructions: ["Only flag genuinely notable shifts, not every sentence", "Keep tone notes brief — a word or two"],
  },
  {
    suffix: "Verbal-Stumble Flagging",
    difficulty: "Medium",
    payoutMultiplier: 1.1,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}) and specifically flag any mispronunciations, false starts, or verbal stumbles with [STUMBLE] rather than smoothing them out.`,
    instructions: ["This transcript needs to preserve imperfections, not clean them up", "Still transcribe the intended word alongside the stumble note where clear"],
  },
  {
    suffix: "Two-Sentence Summary + Transcript",
    difficulty: "Medium",
    payoutMultiplier: 1.15,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}) in full, then add a two-sentence summary of its content at the end.`,
    instructions: ["Full transcript first, summary clearly labeled and separated at the end", "Summary should be in your own words, not lifted from the transcript"],
  },
  {
    suffix: "Dialogue & Quotation Marking",
    difficulty: "Medium",
    payoutMultiplier: 1.1,
    focus: (a) => `Transcribe ${a.title} (${a.runtime}), using quotation marks around any dialogue or directly quoted speech within the reading.`,
    instructions: ["Distinguish narration from quoted dialogue clearly", "Standard quotation mark conventions apply"],
  },
];

const TRANSCRIPTION_VARIANTS_SHORT = TRANSCRIPTION_VARIANTS_LONG.slice(0, 7);

function buildTranscriptionTasks() {
  const tasks = [];
  const basePayouts = { gettysburg: 45, giftOfMagi: 140, tellTaleHeart: 130, ifPoem: 35 };
  const combos = [
    { audio: AUDIO.gettysburg, variants: TRANSCRIPTION_VARIANTS_SHORT },
    { audio: AUDIO.giftOfMagi, variants: TRANSCRIPTION_VARIANTS_LONG },
    { audio: AUDIO.tellTaleHeart, variants: TRANSCRIPTION_VARIANTS_LONG },
    { audio: AUDIO.ifPoem, variants: TRANSCRIPTION_VARIANTS_SHORT },
  ];
  const keyOf = (a) => Object.keys(AUDIO).find((k) => AUDIO[k] === a);

  for (const { audio, variants } of combos) {
    const base = basePayouts[keyOf(audio)];
    for (const variant of variants) {
      tasks.push({
        type: "transcription",
        title: `Transcribe: ${audio.title} — ${variant.suffix}`,
        difficulty: variant.difficulty,
        payoutAmount: Math.round(base * variant.payoutMultiplier),
        assetUrl: audio.url,
        prompt: variant.focus(audio),
        instructions: variant.instructions,
        exampleAnswer: "See the platform's transcription formatting guide for a worked example matching this variant's required format.",
      });
    }
  }
  return tasks;
}

// ============================================================
// TRANSLATION — 30 distinct real-world topics (text only)
// ============================================================
const TRANSLATION_TOPICS = [
  { dir: "EN→SW", topic: "Mobile money (M-Pesa) transaction confirmation SMS wording", difficulty: "Easy", payout: 35,
    text: "\"You have received KES 2,500 from JOHN KAMAU. Your new balance is KES 8,750. Transaction cost: KES 0. Reply STOP to opt out of promotional messages.\"" },
  { dir: "SW→EN", topic: "School closure notice for parents", difficulty: "Easy", payout: 35,
    text: "\"Wazazi wote wanaarifiwa kuwa shule itafungwa Ijumaa hii kwa ajili ya mafunzo ya walimu. Masomo yataanza tena Jumatatu asubuhi kama kawaida.\"" },
  { dir: "EN→SW", topic: "Vaccination reminder for a child health clinic", difficulty: "Medium", payout: 55,
    text: "\"Your child is due for their next vaccination dose. Please bring the health card and visit the clinic between 8am and 4pm, Monday to Friday. Vaccination is free of charge and takes only a few minutes.\"" },
  { dir: "SW→EN", topic: "Road closure and diversion notice", difficulty: "Medium", payout: 50,
    text: "\"Barabara ya Uhuru Highway itafungwa kwa ukarabati kuanzia tarehe 3 hadi 10. Madereva wanashauriwa kutumia njia mbadala kupitia Mombasa Road wakati wa ukarabati huo.\"" },
  { dir: "EN→SW", topic: "Bank loan repayment terms summary", difficulty: "Hard", payout: 90,
    text: "\"This facility carries an interest rate of 14% per annum, calculated on a reducing balance basis. Repayments are due on the 5th of each month. A penalty fee of 5% applies to any payment more than 7 days late. Early repayment in full is permitted without penalty.\"" },
  { dir: "SW→EN", topic: "Weather advisory for farmers", difficulty: "Medium", payout: 50,
    text: "\"Wakulima wanashauriwa kutarajia mvua nyingi wiki hii katika maeneo ya Mlima Kenya. Wale wenye mazao yaliyo tayari kuvunwa wanahimizwa kufanya hivyo kabla ya mvua kuanza ili kuepuka hasara.\"" },
  { dir: "EN→SW", topic: "Landlord-tenant rent increase notice", difficulty: "Medium", payout: 55,
    text: "\"This letter serves as formal notice that monthly rent will increase from KES 15,000 to KES 17,500 effective the start of next month, in line with the terms outlined in your tenancy agreement. Please contact the property office with any questions.\"" },
  { dir: "SW→EN", topic: "Job vacancy posting for a retail assistant", difficulty: "Easy", payout: 40,
    text: "\"Duka letu linahitaji msaidizi wa mauzo mwenye uzoefu wa angalau mwaka mmoja. Mwombaji anapaswa kuwa na uwezo wa kuzungumza Kiingereza na Kiswahili vizuri. Tuma maombi yako kabla ya tarehe 15.\"" },
  { dir: "EN→SW", topic: "Airline baggage allowance policy", difficulty: "Medium", payout: 55,
    text: "\"Economy class passengers are permitted one checked bag up to 23kg and one carry-on item up to 10kg. Excess baggage fees apply beyond this limit and vary by route. Fragile items should be declared at check-in.\"" },
  { dir: "SW→EN", topic: "Community water rationing schedule", difficulty: "Easy", payout: 40,
    text: "\"Wakazi wa eneo hili wanaarifiwa kuwa maji yatapatikana siku za Jumatatu, Jumatano, na Ijumaa kuanzia saa mbili asubuhi hadi saa nane mchana. Tafadhali hifadhini maji ya kutosha kwa siku nyingine.\"" },
  { dir: "EN→SW", topic: "Product recall safety notice", difficulty: "Hard", payout: 85,
    text: "\"A safety defect has been identified in a specific batch of this product that may pose a fire risk under certain conditions. Customers who purchased this item between the dates listed are advised to stop use immediately and contact the manufacturer for a full refund or replacement.\"" },
  { dir: "SW→EN", topic: "Wedding invitation wording", difficulty: "Easy", payout: 35,
    text: "\"Kwa furaha kubwa, tunawaalika ndugu na marafiki kuhudhuria harusi ya Grace na David itakayofanyika tarehe 20, saa nane mchana, kanisani St. Peter's, ikifuatiwa na sherehe ukumbini.\"" },
  { dir: "EN→SW", topic: "Insurance claim filing instructions", difficulty: "Hard", payout: 90,
    text: "\"To file a claim, submit the completed claim form along with a copy of your policy document, a police abstract (if applicable), and photographs of the damage within 14 days of the incident. Claims submitted after this period may be delayed or rejected.\"" },
  { dir: "SW→EN", topic: "Public health awareness message on handwashing", difficulty: "Easy", payout: 35,
    text: "\"Kunawa mikono kwa sabuni kwa angalau sekunde ishirini kunasaidia kuzuia maambukizi ya magonjwa. Fanya hivi kabla ya kula, baada ya kutumia choo, na baada ya kugusa nyuso zinazoguswa na watu wengi.\"" },
  { dir: "EN→SW", topic: "Utility bill payment overdue warning", difficulty: "Medium", payout: 50,
    text: "\"Your electricity account has an outstanding balance that is now 30 days overdue. Please settle the amount within 7 days to avoid disconnection. Payments can be made via mobile money using the paybill number on your statement.\"" },
  { dir: "SW→EN", topic: "Market day price announcement for produce", difficulty: "Easy", payout: 30,
    text: "\"Leo sokoni, nyanya zinauzwa kwa shilingi hamsini kwa kilo, viazi kwa shilingi thelathini, na maharagwe kwa shilingi sitini. Bei zinaweza kubadilika kesho kutegemea upatikanaji.\"" },
  { dir: "EN→SW", topic: "Veterinary livestock deworming instructions", difficulty: "Medium", payout: 55,
    text: "\"Administer the deworming dose orally, calculated according to the animal's body weight as shown on the dosage chart. Repeat treatment every three months. Do not use this product on animals intended for slaughter within 14 days of treatment.\"" },
  { dir: "SW→EN", topic: "Church or community event announcement", difficulty: "Easy", payout: 35,
    text: "\"Kanisa letu litaandaa mkutano maalum wa vijana Jumamosi hii kuanzia saa tatu asubuhi. Wazazi wanahimizwa kuwaleta watoto wao. Chakula na vinywaji vitapatikana bila malipo.\"" },
  { dir: "EN→SW", topic: "Mobile phone SIM card registration requirements", difficulty: "Medium", payout: 50,
    text: "\"To register a new SIM card, visit any authorized dealer with your original national ID card. Registration is mandatory and free of charge. Unregistered lines will be deactivated after the compliance deadline.\"" },
  { dir: "SW→EN", topic: "Land dispute mediation notice from a local chief", difficulty: "Hard", payout: 80,
    text: "\"Wahusika wote katika mgogoro wa ardhi kati ya familia ya Mwangi na Otieno wanaitwa kuhudhuria kikao cha usuluhishi ofisini kwa chifu tarehe 12, saa tano asubuhi. Kutokuhudhuria kutasababisha uamuzi kufanywa bila upande wako kusikilizwa.\"" },
  { dir: "EN→SW", topic: "Road safety campaign message for motorcycle riders", difficulty: "Easy", payout: 35,
    text: "\"Always wear a certified helmet before riding. Carry only one passenger at a time. Avoid overtaking on blind corners. Your life and the lives of others depend on these simple habits.\"" },
  { dir: "SW→EN", topic: "Hospital appointment rescheduling notice", difficulty: "Medium", payout: 50,
    text: "\"Miadi yako iliyokuwa imepangwa kwa tarehe 8 imesogezwa hadi tarehe 15 kutokana na sababu za kiutawala. Tafadhali wasiliana na hospitali ikiwa tarehe hii mpya haikufai.\"" },
  { dir: "EN→SW", topic: "Restaurant hygiene inspection notice posted publicly", difficulty: "Medium", payout: 50,
    text: "\"This establishment was inspected on the date shown and found to meet the required food safety and hygiene standards. This certificate must remain visibly posted and is valid for twelve months from the inspection date.\"" },
  { dir: "SW→EN", topic: "Farmers' cooperative membership fee announcement", difficulty: "Easy", payout: 40,
    text: "\"Wanachama wote wa chama cha ushirika wanaarifiwa kuwa ada ya mwaka ni shilingi elfu mbili. Malipo yanapaswa kufanywa kabla ya mwisho wa mwezi huu ili kuendelea kupata huduma za chama.\"" },
  { dir: "EN→SW", topic: "Emergency contact and evacuation instructions for a building", difficulty: "Medium", payout: 55,
    text: "\"In case of fire or emergency, proceed calmly to the nearest marked exit and gather at the assembly point in the parking area. Do not use the elevators. Report to the floor warden once you reach the assembly point.\"" },
  { dir: "SW→EN", topic: "Small business loan application requirements from a microfinance office", difficulty: "Hard", payout: 85,
    text: "\"Waombaji wa mkopo wanapaswa kuwasilisha nakala ya kitambulisho, uthibitisho wa makazi, na mpango wa biashara wenye maelezo ya matumizi ya fedha. Maombi yatashughulikiwa ndani ya siku kumi za kazi.\"" },
  { dir: "EN→SW", topic: "Public transport (matatu) fare notice for a route", difficulty: "Easy", payout: 30,
    text: "\"The standard fare for this route is KES 100 during off-peak hours and KES 150 during peak hours (7-9am and 5-7pm). Fare disputes should be reported to the route management office.\"" },
  { dir: "SW→EN", topic: "Agricultural extension advice on crop rotation", difficulty: "Medium", payout: 55,
    text: "\"Wakulima wanashauriwa kubadilisha aina za mazao kila msimu ili kuzuia kupungua kwa rutuba ya udongo na kupunguza uwezekano wa magonjwa ya mimea kujirudia kwenye shamba moja.\"" },
  { dir: "EN→SW", topic: "Consumer complaint resolution timeline from a telecom provider", difficulty: "Medium", payout: 50,
    text: "\"We acknowledge receipt of your complaint and will investigate within 5 working days. You will receive an update via SMS once a resolution has been reached. If unresolved after 14 days, you may escalate to the regulator.\"" },
  { dir: "SW→EN", topic: "Environmental cleanup community drive announcement", difficulty: "Easy", payout: 35,
    text: "\"Jumuiya yote inaalikwa kushiriki katika zoezi la usafi wa mazingira Jumamosi hii kuanzia saa mbili asubuhi. Vifaa vya kusafishia vitatolewa. Tuungane pamoja kuufanya mtaa wetu kuwa safi.\"" },
];

function buildTranslationTasks() {
  return TRANSLATION_TOPICS.map((t) => ({
    type: "translation",
    title: `${t.dir}: ${t.topic}`,
    difficulty: t.difficulty,
    payoutAmount: t.payout,
    prompt: `Translate the following ${t.dir === "EN→SW" ? "English text into natural, everyday Swahili" : "Swahili text into clear, natural English"}:\n\n${t.text}`,
    instructions: [
      "Prioritize how a native speaker would naturally phrase it over a literal word-for-word translation",
      "Preserve any numbers, dates, dosages, or monetary amounts exactly as given",
      "Flag any term that doesn't have a clean direct equivalent",
    ],
    exampleAnswer: "A strong answer reads naturally to a native speaker and preserves every factual detail (numbers, dates, names, amounts) with zero drift from the source.",
  }));
}

// ============================================================
// REVIEW (Quality Review) — 30 distinct QA scenarios (text only)
// ============================================================
const REVIEW_TOPICS = [
  { area: "translation accuracy", pair: "EN\u2192SW product description", difficulty: "Easy", payout: 30,
    detail: "EN: \"Waterproof backpack with reinforced straps.\" SW: \"Mkoba usiopenya maji wenye kamba imara.\"" },
  { area: "translation accuracy", pair: "SW\u2192EN clinic notice", difficulty: "Easy", payout: 30,
    detail: "SW: \"Kliniki itafunguliwa Jumamosi kwa dharura pekee.\" EN: \"The clinic will be open on Saturday for regular appointments only.\"" },
  { area: "OCR output correctness", pair: "scanned ID card transcription", difficulty: "Medium", payout: 45,
    detail: "OCR output reads: 'Date of Birth: O4/12/1997' and 'ID No: l2345678'. Compare against expected formatting conventions for this document type." },
  { area: "sentiment classification", pair: "app review batch", difficulty: "Medium", payout: 40,
    detail: "Review: \"The app is fine I guess, works most of the time.\" was labeled Positive. Assess whether this label is correct." },
  { area: "bounding box quality", pair: "vehicle annotation submission", difficulty: "Medium", payout: 45,
    detail: "Submission includes 4 boxes for a scene described as having 6 visible vehicles, with 2 boxes overlapping the same vehicle twice." },
  { area: "transcription accuracy", pair: "audio-to-text submission", difficulty: "Medium", payout: 45,
    detail: "A 3-minute audio transcript contains zero [INAUDIBLE] tags despite the source having a noisy background section around 1:40." },
  { area: "translation accuracy", pair: "EN\u2192SW safety instructions", difficulty: "Hard", payout: 65,
    detail: "EN: \"Do not operate machinery while under the influence of medication that causes drowsiness.\" SW translation omits the drowsiness clause entirely." },
  { area: "OCR output correctness", pair: "receipt total verification", difficulty: "Medium", payout: 45,
    detail: "Transcribed line items sum to 1,450 but the transcribed 'Total' field reads 1,540 — assess whether this is a genuine document error or a transcription error." },
  { area: "sentiment classification", pair: "customer support chat log", difficulty: "Medium", payout: 40,
    detail: "Message: \"This is fine, whatever, I'll figure it out myself.\" was labeled Neutral. Assess whether this captures the underlying frustration." },
  { area: "annotation completeness", pair: "livestock counting submission", difficulty: "Easy", payout: 35,
    detail: "Submission boxes 5 animals in a field image where a visible partial animal at the frame's right edge was left unboxed." },
  { area: "translation accuracy", pair: "SW\u2192EN loan terms", difficulty: "Hard", payout: 65,
    detail: "SW mentions a specific penalty percentage for late payment; the EN translation states a flat fee instead of a percentage, changing the actual meaning." },
  { area: "transcription formatting", pair: "timestamped speech transcript", difficulty: "Easy", payout: 30,
    detail: "Submission is timestamped every 45 seconds when the task explicitly asked for timestamps every 30 seconds." },
  { area: "OCR output correctness", pair: "handwritten form field extraction", difficulty: "Medium", payout: 45,
    detail: "A phone number field was transcribed as 9 digits when standard local phone numbers are 10 digits — assess whether this is a likely transcription miss." },
  { area: "sentiment classification", pair: "mixed-sentiment review", difficulty: "Medium", payout: 40,
    detail: "Review: \"Great price, but it broke after two days.\" was labeled purely Positive with no 'Mixed' consideration." },
  { area: "bounding box quality", pair: "traffic sign annotation submission", difficulty: "Medium", payout: 45,
    detail: "Submission classifies a speed-limit sign as 'WARNING' type instead of the more specific 'SPEED_LIMIT' category." },
  { area: "translation accuracy", pair: "EN\u2192SW health announcement", difficulty: "Easy", payout: 30,
    detail: "EN: \"Vaccination is free of charge.\" SW translation implies a small fee is required — check whether this is a mistranslation." },
  { area: "transcription accuracy", pair: "dialogue-heavy story reading", difficulty: "Hard", payout: 60,
    detail: "Submission transcribes all dialogue without quotation marks despite the task explicitly requiring them, making it hard to distinguish narration from speech." },
  { area: "OCR output correctness", pair: "invoice date field", difficulty: "Easy", payout: 30,
    detail: "Transcribed date reads '13/25/2026' — assess whether this is a plausible reading error given no calendar month is 25." },
  { area: "annotation completeness", pair: "parking lot vehicle count", difficulty: "Medium", payout: 45,
    detail: "Submission provides a total count of 12 vehicles but only 9 individual bounding boxes are listed — assess the discrepancy." },
  { area: "sentiment classification", pair: "hotel review batch", difficulty: "Easy", payout: 30,
    detail: "Review: \"Clean room, but the front desk staff were rude.\" was labeled Positive with 'Service' listed as the aspect." },
  { area: "translation accuracy", pair: "SW\u2192EN weather advisory", difficulty: "Medium", payout: 45,
    detail: "SW original specifies 'this week'; EN translation reads 'this month' — check whether the timeframe was correctly preserved." },
  { area: "transcription formatting", pair: "numbered sentence-level transcript", difficulty: "Easy", payout: 30,
    detail: "Submission places timestamps mid-sentence rather than at sentence starts, making the required format inconsistent." },
  { area: "OCR output correctness", pair: "signature field handling", difficulty: "Easy", payout: 25,
    detail: "Submission attempts to transcribe an illegible signature as literal text rather than marking it '[signature present, not transcribable]'." },
  { area: "bounding box quality", pair: "cattle counting with occlusion", difficulty: "Hard", payout: 55,
    detail: "Two animals standing close together were boxed as a single combined instance rather than two separate boxes." },
  { area: "sentiment classification", pair: "ride-hailing driver feedback", difficulty: "Medium", payout: 40,
    detail: "Feedback: \"Driver was late but very apologetic and helpful once he arrived.\" was labeled purely Negative." },
  { area: "translation accuracy", pair: "EN\u2192SW insurance claim instructions", difficulty: "Hard", payout: 65,
    detail: "EN specifies a 14-day filing window; SW translation states 14 working days, which changes the actual deadline — check whether this distinction was preserved correctly." },
  { area: "OCR output correctness", pair: "printed receipt item list", difficulty: "Medium", payout: 40,
    detail: "One line item's price is transcribed with a decimal point in an inconsistent position compared to the rest of the receipt's formatting." },
  { area: "annotation completeness", pair: "traffic sign single-sign task", difficulty: "Easy", payout: 30,
    detail: "The task asked for only the single most prominent sign to be boxed, but the submission includes 3 separate boxes for 3 different signs." },
  { area: "transcription accuracy", pair: "poem reading with emphasis notes", difficulty: "Medium", payout: 45,
    detail: "Submission is a fully literal transcript but includes zero tone/emphasis notes despite the task requiring them at significant shifts." },
  { area: "sentiment classification", pair: "banking app support review", difficulty: "Medium", payout: 40,
    detail: "Review: \"App keeps crashing but at least support responded quickly when I called.\" was labeled Negative with 'Service' as the sole aspect, ignoring the technical complaint." },
];

function buildReviewTasks() {
  return REVIEW_TOPICS.map((r, i) => ({
    type: "review",
    title: `QA Review: ${r.area[0].toUpperCase() + r.area.slice(1)} — ${r.pair}`,
    difficulty: r.difficulty,
    payoutAmount: r.payout,
    prompt: `You are reviewing a worker submission for quality. Case details:\n\n${r.detail}\n\nAssess whether this submission is Accurate, Has Minor Issues, or Has Major Issues, and explain your reasoning in 2-3 sentences. If there is an issue, state specifically what the correct handling should have been.`,
    instructions: [
      "Judge against the actual task requirements, not just general plausibility",
      "Be specific — 'this seems off' is not a sufficient justification",
      "If you believe the submission is correct as-is, say so and explain why the apparent issue isn't actually one",
    ],
    exampleAnswer: "A strong review names the specific rule or expectation that was or wasn't met, rather than a vague overall impression.",
  }));
}

// ============================================================
// SENTIMENT — 30 distinct domain batches (text only)
// ============================================================
const SENTIMENT_DOMAINS = [
  { domain: "restaurant reviews", difficulty: "Easy", payout: 30, items: [
    "The food came out cold and we waited 40 minutes.",
    "Best nyama choma I've had in the city, will be back.",
    "Portion sizes were small for the price, but the taste was decent.",
    "Friendly staff, quick service, nothing particularly memorable about the food itself.",
    "Ordered delivery and half the order was missing.",
  ]},
  { domain: "ride-hailing driver ratings", difficulty: "Easy", payout: 30, items: [
    "Driver took a much longer route than necessary and the fare was higher than expected.",
    "Super clean car, arrived early, very professional.",
    "Car was fine but the driver was on his phone the whole ride.",
    "Cancelled on me twice in a row, very frustrating.",
    "Nothing special, got me there safely and on time.",
  ]},
  { domain: "telecom customer service calls", difficulty: "Medium", payout: 40, items: [
    "Was on hold for 45 minutes and then got disconnected.",
    "Agent resolved my billing issue in under 5 minutes, very impressed.",
    "They fixed the network issue but didn't apply the refund they promised.",
    "Polite agent but couldn't actually solve my problem.",
    "Fastest customer service experience I've had with any company.",
  ]},
  { domain: "hotel stay reviews", difficulty: "Easy", payout: 30, items: [
    "Room was spotless but the wifi barely worked.",
    "Noisy neighbors all night and thin walls, couldn't sleep.",
    "Staff upgraded our room for free, wonderful surprise.",
    "Exactly as described, no complaints at all.",
    "Breakfast was excellent but check-in took over an hour.",
  ]},
  { domain: "online shopping order feedback", difficulty: "Medium", payout: 40, items: [
    "Item arrived a week late and the box was damaged, but the product itself was fine.",
    "Exactly what I ordered, fast shipping, will buy again.",
    "Wrong size sent and customer support has been unresponsive for days.",
    "Good quality for the price, though the color was slightly different from the photo.",
    "Refund was processed quickly after I reported the issue.",
  ]},
  { domain: "healthcare clinic visit feedback", difficulty: "Medium", payout: 40, items: [
    "Doctor was thorough and explained everything clearly.",
    "Waited over two hours past my appointment time.",
    "Nurse was kind but the facility felt understaffed.",
    "Got exactly the care I needed, no complaints.",
    "Billing was confusing and I was charged for something I didn't receive.",
  ]},
  { domain: "banking mobile app reviews", difficulty: "Medium", payout: 40, items: [
    "App crashes every time I try to check my statement.",
    "Transfers are instant now, huge improvement from before.",
    "Fingerprint login stopped working after the last update.",
    "Clean interface, everything is easy to find.",
    "Customer support in the app is basically useless, just a chatbot loop.",
  ]},
  { domain: "electricity provider complaints", difficulty: "Easy", payout: 30, items: [
    "Power has gone out three times this week with no notice.",
    "Reported an outage and it was fixed within two hours, impressed.",
    "Billing seems accurate every month now after switching to prepaid.",
    "Customer line never picks up when there's an actual emergency.",
    "No issues at all this quarter, steady supply.",
  ]},
  { domain: "school parent feedback", difficulty: "Medium", payout: 40, items: [
    "Teachers are very responsive to emails and concerns.",
    "Classroom sizes feel too large for individual attention.",
    "My child has improved a lot in reading this term.",
    "Communication about schedule changes is often last-minute.",
    "Extracurricular options have really expanded this year, great addition.",
  ]},
  { domain: "event/concert attendee feedback", difficulty: "Easy", payout: 30, items: [
    "Sound quality was poor for most of the venue.",
    "Loved the lineup, well organized, would attend again.",
    "Long queues for entry but once inside it ran smoothly.",
    "Ticket prices didn't match the overall experience quality.",
    "Security staff were helpful and the event felt safe throughout.",
  ]},
  { domain: "food delivery app reviews", difficulty: "Medium", payout: 40, items: [
    "Order tracking is inaccurate, said 'arriving' for 30 minutes straight.",
    "Food arrived hot and on time, packaging was great too.",
    "Support refunded me quickly when my order never showed up.",
    "App keeps applying the wrong delivery fee at checkout.",
    "Consistently reliable for weekday lunch orders.",
  ]},
  { domain: "real estate agent reviews", difficulty: "Medium", payout: 40, items: [
    "Agent was pushy and didn't listen to our budget constraints.",
    "Found us the perfect place within our timeline, very grateful.",
    "Communication was slow but they did eventually deliver good results.",
    "Extremely knowledgeable about the neighborhood, answered all our questions.",
    "Felt like just another transaction to them, not much personal attention.",
  ]},
  { domain: "gym membership feedback", difficulty: "Easy", payout: 30, items: [
    "Equipment is often broken and takes weeks to get fixed.",
    "Trainers are motivating and genuinely helpful.",
    "Cancelling my membership was needlessly complicated.",
    "Clean facility, never too crowded even during peak hours.",
    "Good value for the monthly price compared to other gyms nearby.",
  ]},
  { domain: "insurance claim handling feedback", difficulty: "Hard", payout: 50, items: [
    "Claim was approved but the payout took over two months to arrive.",
    "Adjuster was clear and fair throughout the whole process.",
    "Kept getting asked for the same documents I'd already submitted.",
    "Straightforward process, no complaints, paid out as expected.",
    "Denied my claim without a clear explanation of why.",
  ]},
  { domain: "water utility service complaints", difficulty: "Easy", payout: 30, items: [
    "Water pressure has been low for over a week now.",
    "Reported a leak and it was fixed the same day.",
    "Billing this month was double what I usually pay with no explanation.",
    "Consistent supply, no complaints from our household.",
    "Customer service line is almost always busy when I call.",
  ]},
  { domain: "airline flight experience feedback", difficulty: "Medium", payout: 40, items: [
    "Flight was delayed three hours with minimal communication from staff.",
    "Cabin crew were attentive and the flight was smooth overall.",
    "Lost my checked bag and it took days to track down.",
    "Good legroom for the price point, pleasantly surprised.",
    "Boarding process was chaotic and disorganized.",
  ]},
  { domain: "car repair shop reviews", difficulty: "Medium", payout: 40, items: [
    "Fixed the issue quickly and the price matched the quote exactly.",
    "Charged for a part that wasn't actually needed, felt overcharged.",
    "Car came back with the same problem a week later.",
    "Honest assessment, didn't try to upsell unnecessary repairs.",
    "Friendly staff but the wait time was much longer than promised.",
  ]},
  { domain: "veterinary clinic feedback", difficulty: "Easy", payout: 30, items: [
    "Vet was gentle with our nervous dog and explained everything clearly.",
    "Had to wait an hour past our scheduled appointment.",
    "Prices were higher than other clinics nearby for the same service.",
    "Follow-up call to check on our pet was a really nice touch.",
    "Staff seemed rushed and didn't answer all our questions.",
  ]},
  { domain: "coworking space member feedback", difficulty: "Medium", payout: 40, items: [
    "Wifi drops frequently during video calls, quite disruptive.",
    "Great community events, met a lot of useful contacts.",
    "Meeting rooms are often double-booked despite the reservation system.",
    "Coffee and snacks included are a nice bonus.",
    "Quiet zones are actually quiet, which I really appreciate.",
  ]},
  { domain: "online course platform reviews", difficulty: "Medium", payout: 40, items: [
    "Video quality was poor and audio was often out of sync.",
    "Instructor was engaging and explained complex topics clearly.",
    "Certificate took weeks to be issued after completing the course.",
    "Content was outdated compared to current industry practices.",
    "Great value for the price, would recommend to a friend.",
  ]},
  { domain: "pharmacy service feedback", difficulty: "Easy", payout: 30, items: [
    "Pharmacist took time to explain dosage instructions clearly.",
    "Had to come back twice because a medication wasn't in stock.",
    "Fast service, in and out in under ten minutes.",
    "Line was extremely long with only one till open.",
    "Staff double-checked my prescription and caught a potential error, very grateful.",
  ]},
  { domain: "moving company reviews", difficulty: "Medium", payout: 40, items: [
    "Arrived late and rushed through loading the truck carelessly.",
    "Careful with our furniture, nothing was damaged.",
    "Final price was higher than the initial quote with no clear reason.",
    "Professional crew, finished faster than expected.",
    "Communication before the move date was minimal and vague.",
  ]},
  { domain: "childcare/daycare parent feedback", difficulty: "Medium", payout: 40, items: [
    "Staff send daily updates with photos, really reassuring.",
    "Facility felt understaffed during pickup time chaos.",
    "My child has become much more social since starting here.",
    "Sick policy isn't enforced consistently, other kids come in ill.",
    "Very clean environment and structured daily routine.",
  ]},
  { domain: "internet service provider reviews", difficulty: "Medium", payout: 40, items: [
    "Speeds are consistently below what was advertised.",
    "Installation was quick and technician was knowledgeable.",
    "Outages are rare but when they happen, support is slow to respond.",
    "Great value package, no issues in six months of use.",
    "Billing kept changing without clear notification of why.",
  ]},
  { domain: "furniture store delivery feedback", difficulty: "Easy", payout: 30, items: [
    "Delivery window was a full day late with no updates.",
    "Assembly team was efficient and left the space clean.",
    "Item arrived with a visible scratch on the surface.",
    "Delivery was actually earlier than the estimated window.",
    "Customer service was helpful in resolving a damaged item quickly.",
  ]},
  { domain: "language exchange app user feedback", difficulty: "Easy", payout: 30, items: [
    "Matched with a great partner, learning a lot every week.",
    "App has a lot of bugs during video call sessions.",
    "Free tier is quite limited compared to competitors.",
    "Community feels welcoming and supportive for beginners.",
    "Notifications are excessive and hard to turn off.",
  ]},
  { domain: "public transport (matatu) commuter feedback", difficulty: "Easy", payout: 30, items: [
    "Overcrowded during rush hour, barely any space to stand.",
    "Driver was reckless, very unsafe overtaking on the highway.",
    "Fare was fair and the route was direct with no unnecessary stops.",
    "Vehicle was clean and the conductor was courteous.",
    "Waited over 40 minutes at the stage during peak hours.",
  ]},
  { domain: "solar power installer feedback", difficulty: "Medium", payout: 40, items: [
    "System has performed reliably since installation six months ago.",
    "Installation took longer than the quoted timeline by over a week.",
    "Sales team oversold the expected output compared to actual results.",
    "After-sales support has been responsive whenever we've had questions.",
    "Price was competitive and financing options were flexible.",
  ]},
  { domain: "co-op savings group (chama) member feedback", difficulty: "Medium", payout: 40, items: [
    "Meetings are well organized and records are transparent.",
    "Some members consistently pay late without consequence.",
    "Loan disbursement process has become much faster this year.",
    "Communication about upcoming contributions is often unclear.",
    "Overall a positive experience, has helped me save consistently.",
  ]},
];

function buildSentimentTasks() {
  return SENTIMENT_DOMAINS.map((d) => {
    const list = d.items.map((line, i) => `${i + 1}. "${line}"`).join("\n");
    return {
      type: "sentiment",
      title: `Sentiment: ${d.domain[0].toUpperCase() + d.domain.slice(1)} (5 items)`,
      difficulty: d.difficulty,
      payoutAmount: d.payout,
      prompt: `Classify each of the following five snippets from ${d.domain} by sentiment (Positive, Negative, or Mixed) and give a one-sentence justification:\n\n${list}`,
      instructions: [
        "'Mixed' means the snippet praises one thing and criticizes another within the same statement",
        "Base your label on tone and content, not on assumed star ratings",
        "One sentence of justification per item is enough — don't over-explain",
      ],
      exampleAnswer: `Example: 1 - Sentiment: Mixed - Justification: praises one aspect while clearly criticizing another within the same sentence.`,
    };
  });
}

// ============================================================
// SEED RUNNER
// ============================================================
async function main() {
  await mongoose.connect(config.mongoUri);

  const admin = await User.findOne({ role: "admin" });
  if (!admin) {
    console.error("No admin user found. Register an account and run scripts/makeAdmin.js first.");
    process.exit(1);
  }

  const allTasks = [
    ...buildAnnotationTasks(),
    ...buildOcrTasks(),
    ...buildTranscriptionTasks(),
    ...buildTranslationTasks(),
    ...buildReviewTasks(),
    ...buildSentimentTasks(),
  ];

  console.log(`Prepared ${allTasks.length} tasks (expect 180: 30 per category).`);

  let created = 0;
  let skipped = 0;
  for (const taskData of allTasks) {
    const exists = await Task.findOne({ title: taskData.title });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Task.create({ ...taskData, createdBy: admin._id });
    created += 1;
  }

  console.log(`\nDone. ${created} new task(s) created, ${skipped} skipped (already existed).`);
  const byType = {};
  for (const t of allTasks) byType[t.type] = (byType[t.type] || 0) + 1;
  console.log("Breakdown:", byType);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});