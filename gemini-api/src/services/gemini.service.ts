import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'YOUR_API_KEY') {
      throw new Error('GEMINI_API_KEY is not configured. Please set it in .env file.');
    }

    genAI = new GoogleGenerativeAI(apiKey);
  }

  return genAI;
}

export async function generatePlaywrightScript(prompt: string): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text || text.trim().length === 0) {
    throw new Error('Gemini returned an empty response.');
  }

  return text.trim();
}
