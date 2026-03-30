require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function list() {
  try {
    const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"];
    for (const m of models) {
      try {
        await genAI.getGenerativeModel({ model: m }).generateContent("hi");
        console.log(`${m}: OK`);
      } catch (e) {
        console.log(`${m}: FAILED - ${e.message}`);
      }
    }
  } catch (e) {
    console.log("CRITICAL FAILED:", e.message);
  }
}
list();
