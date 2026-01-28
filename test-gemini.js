const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config({ path: ".env.local" });

async function test() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent("Hello");
        console.log("SUCCESS with gemini-flash-latest:", result.response.text());
    } catch (e) {
        console.log("FAILED with gemini-flash-latest:", e.message);
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
            const result = await model.generateContent("Hello");
            console.log("SUCCESS with gemini-1.5-flash-latest:", result.response.text());
        } catch (e2) {
            console.log("FAILED with gemini-1.5-flash-latest:", e2.message);
        }
    }
}

test();
