 import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// === Gemini Setup ===
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


// === System Prompt (Structured JSON Output) ===
const SYSTEM_PROMPT = `
You are HealthBot, an AI medical assistant. Generate a JSON response with this exact structure:

{
  "summary": "Brief 2-3 sentence health overview.",
  "possibleCauses": ["cause 1", "cause 2", "cause 3"],
  "riskLevel": "Low" | "Moderate" | "High",
  "precautions": ["precaution 1", "precaution 2"],
  "safeMedications": ["generic name 1", "generic name 2"], // only common, safe, non-prescription
  "dietPlan": {
    "day1": { "breakfast": "...", "lunch": "...", "dinner": "..." },
    "day2": { ... },
    ...
    "day7": { ... }
  },
  "nextSteps": ["Consult GP", "Monitor symptoms", "Hydrate well"]
}

Respond in the requested language (English, Hindi, Marathi).
Use simple, empathetic tone. NEVER prescribe strong drugs.
Return ONLY valid JSON. No extra text.
`;

// === Home ===
app.get("/", (req, res) => {
  res.render("home.ejs");
});

// === Analyze ===
app.post("/analyze", async (req, res) => {
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

  if (!name || !symptoms) {
    return res.status(400).json({ error: "Name and symptoms required" });
  }

  const userPrompt = `
Patient: ${name}, ${age}, ${gender}
Symptoms: ${symptoms}
History: ${medicalHistory || "None"}
Vitals: Temp=${temperature || "?"}, Pulse=${pulse || "?"}, BP=${bp || "?"}, Weight=${weight || "?"}
Language: ${language}
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { responseMimeType: "application/json" },
    });

    let jsonResponse;
    try {
      const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      jsonResponse = JSON.parse(text);
    } catch (e) {
      console.error("JSON parse failed:", e);
      jsonResponse = { summary: "Error parsing AI response.", error: true };
    }

    // Send full data to frontend
    res.render("report", {
      patient: { name, age, gender, contact, language },
      input: { symptoms, medicalHistory, temperature, pulse, bp, weight },
      report: jsonResponse,
    });
  } catch (error) {
    console.error("Gemini Error:", error.message);
    res.status(500).send("AI service failed. Try again.");
  }
});

app.listen(PORT, () => {
  console.log(`HealthBot running at http://localhost:${PORT}`);
});  