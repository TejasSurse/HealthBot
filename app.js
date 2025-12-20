import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";
import session from "express-session";
import pool from "./db.js";

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const PORT = process.env.PORT || 5000;

// ==================================================
// SESSION SETUP
// ==================================================
app.use(
  session({
    secret: "healthbot_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);

// ==================================================
// GEMINI SETUP
// ==================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ==================================================
// UPDATED SYSTEM PROMPT
// ==================================================
const SYSTEM_PROMPT = `
You are HealthBot, a medical triage assistant.
Your job is to analyze symptoms and return ONLY valid JSON.
Do NOT output explanations, markdown, or text outside JSON.

===========================================
⚠️ GENERAL RULES
===========================================
- Use ONLY OTC medicines commonly available in India:
  (paracetamol, ORS, cetirizine, antacid, cough syrup, ibuprofen 200mg)
- NEVER prescribe antibiotics, steroids, injections, antidepressants, or controlled drugs.
- Suggest medicines ONLY when medically necessary.
- Do NOT repeat the same medicines in every report.
- Keep language same as user's selected language.
- JSON MUST strictly follow the format below.
- ALL 7 days diet MUST be included.
- While giving data give like you are speaking to a human not like third person narration.

===========================================
📌 OUTPUT JSON FORMAT
===========================================

{
  "summary": "2–3 sentence overview of the condition.",
  "possibleCauses": ["cause 1", "cause 2"],
  "riskLevel": "Low" | "Moderate" | "High",


  "precautions": [
    "precaution 1",
    "precaution 2"
  ],

  "safeMedications": [
    "Medication name with dose"
  ],

  "tabletTiming": [
    {
      "tablet": "Name",
      "purpose": "Purpose",
      "morning": { "dose": "1 tablet", "withFood": "After meal" },
      "afternoon": { "dose": "", "withFood": "" },
      "night": { "dose": "", "withFood": "" },
      "notes": "Safety note"
    }
  ],

  "dietPlan": {
    "day1": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day2": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day3": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day4": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day5": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day6": { "breakfast": "string", "lunch": "string", "dinner": "string" },
    "day7": { "breakfast": "string", "lunch": "string", "dinner": "string" }
  },

  "nextSteps": [
    "step 1",
    "step 2"
  ]
}

===========================================
📌 MEDICAL LOGIC
===========================================
- Fever → Paracetamol only if temp > 99.5°F.
- Cold/Cough → Cetirizine or cough syrup.
- Acidity → Antacid.
- Weakness/Dehydration → ORS.
- Body pain → Mild ibuprofen if needed.
- Mild symptoms → No medicines if not necessary.

===========================================
📌 DIET RULES
===========================================
- No empty strings.
- Always fill breakfast, lunch, dinner with real food items.
- Generate a practical, simple, healthy diet.

Return ONLY the JSON object.
`;

// ==================================================
// ROUTES
// ==================================================

// HOME PAGE
app.get("/", (req, res) => res.render("home"));

// USER FORM
app.get("/form", (req, res) => res.render("form"));

// ==================================================
// ADMIN LOGIN
// ==================================================
app.get("/admin/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "123" && password === "123") {
    req.session.adminId = 1;
    return res.redirect("/admin/dashboard");
  }

  res.render("login", { error: "Invalid username or password" });
});

// LOGOUT
app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

// Middleware: Protect dashboard
function adminAuth(req, res, next) {
  if (!req.session.adminId) return res.redirect("/admin/login");
  next();
}

// ==================================================
// ADMIN DASHBOARD
// ==================================================
app.get("/admin/dashboard", adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, report_json, created_at FROM reports ORDER BY id DESC"
    );

    res.render("admin", {
      reports: rows,
      total: rows.length,
    });
  } catch (err) {
    console.error("Dashboard Fetch Error:", err);
    res.send("Failed to load dashboard");
  }
});

// ==================================================
// VIEW SINGLE REPORT
// ==================================================
app.get("/admin/report/:id", adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.execute("SELECT * FROM reports WHERE id = ?", [id]);

    if (rows.length === 0) return res.send("Report not found");

    const reportRow = rows[0];

    let parsed = {};

    try {
      parsed =
        typeof reportRow.report_json === "string"
          ? JSON.parse(reportRow.report_json)
          : reportRow.report_json;
    } catch (e) {
      parsed = { error: "Corrupted JSON data" };
    }

    res.render("admin_report", {
      name: reportRow.name,
      created: reportRow.created_at,
      report: parsed,
    });
  } catch (err) {
    console.error("View Report Error:", err);
    res.send("Error loading report");
  }
});

// ==================================================
// ANALYZE + SAVE REPORT
// ==================================================
app.post("/analyze", upload.single("previousReport"), async (req, res) => {
  const {
    name,
    age,
    gender,
    contact,
    symptoms,
    medicalHistory,
    temperature,
    pulse,
    bp,
    weight,
    language,
  } = req.body;

  if (!name || !symptoms)
    return res.status(400).json({ error: "Name and symptoms required" });

  const userPrompt = `
Patient: ${name}, ${age}, ${gender}
Symptoms: ${symptoms}
History: ${medicalHistory}
Vitals: Temp=${temperature}, Pulse=${pulse}, BP=${bp}, Weight=${weight}
Language: ${language}
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { responseMimeType: "application/json" },
    });

    let rawText =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    console.log("RAW AI OUTPUT:", rawText); // 🔥 DEBUG LOG

    let jsonResponseObj = {};

    try {
      jsonResponseObj = JSON.parse(rawText);
    } catch (err) {
      jsonResponseObj = { summary: "Failed to parse AI response", error: true };
    }

    console.log("PARSED JSON:", jsonResponseObj); // 🔥 DEBUG LOG

    const safeJsonString = JSON.stringify(jsonResponseObj);

    await pool.execute(
      "INSERT INTO reports (name, report_json) VALUES (?, ?)",
      [name, safeJsonString]
    );

    res.render("report", {
      patient: { name, age, gender, contact, language },
      input: { symptoms, medicalHistory, temperature, pulse, bp, weight },
      report: jsonResponseObj,
    });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).send("AI service failed.");
  }
});

// ==================================================
// START SERVER
// ==================================================
app.listen(PORT, () => {
  console.log(`HealthBot running at http://localhost:${PORT}`);
});
