import { GoogleGenAI, Type, Schema } from "@google/genai";
import { DocumentFile, ExtractionCell, Column, ExtractionResult } from "../types";

// Initialize Gemini Client
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  console.error("VITE_GEMINI_API_KEY is not set in environment variables");
  alert("ERROR: VITE_GEMINI_API_KEY is not configured. Please check your .env.local file.");
} else {
  console.log(`[GEMINI] API Key configured (first 10 chars): ${apiKey.substring(0, 10)}...`);
}
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

// Helper for delay
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Cache Management ---
const cacheStore = new Map<string, { name: string, expireTime: number }>();
const cacheLocks = new Map<string, Promise<string | null>>();
const CACHE_TTL_SECONDS = 300; // 5 minutes

async function getOrCreateCache(docId: string, docText: string, modelId: string): Promise<string | null> {
  const now = Date.now();

  // 1. Check existing active cache
  const existing = cacheStore.get(docId);
  if (existing && existing.expireTime > now) {
    return existing.name;
  }

  // 2. Check if creation is in progress
  if (cacheLocks.has(docId)) {
    return cacheLocks.get(docId)!;
  }

  // 3. Create new cache
  const creationPromise = (async () => {
    try {
      console.log(`[GEMINI CACHE] Creating cache for doc ${docId} (${docText.length} chars)...`);
      const client = ai as any; // Cast to any to access beta/newer features dynamically

      if (!client.caches) {
        console.warn("[GEMINI CACHE] SDK does not appear to support caching (client.caches missing).");
        return null;
      }

      // Minimum length check (approx 4 chars per token, need > 32k tokens usually for cost benefit, 
      // but strictly > 0 for functionality. We'll skip for tiny docs to save API calls/creation latency)
      if (docText.length < 1000) {
        console.log("[GEMINI CACHE] Document too short to cache, skipping.");
        return null;
      }

      const cacheResult = await client.caches.create({
        model: modelId,
        config: {
          ttlSeconds: CACHE_TTL_SECONDS,
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: `DOCUMENT CONTENT:\n${docText}` }]
          }
        ]
      });

      const name = cacheResult.name;
      console.log(`[GEMINI CACHE] Created successfully: ${name}`);

      // Update store
      cacheStore.set(docId, {
        name,
        expireTime: Date.now() + (CACHE_TTL_SECONDS * 1000) - 5000 // Buffer 
      });

      return name;
    } catch (e) {
      console.error("[GEMINI CACHE] Creation failed:", e);
      return null;
    } finally {
      cacheLocks.delete(docId);
    }
  })();

  cacheLocks.set(docId, creationPromise);
  return creationPromise;
}

// Generic retry wrapper
async function withRetry<T>(operation: () => Promise<T>, retries = 5, initialDelay = 1000): Promise<T> {
  let currentTry = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      currentTry++;

      // Check for Rate Limit / Quota errors
      const isRateLimit =
        error?.status === 429 ||
        error?.code === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('RESOURCE_EXHAUSTED') ||
        error?.message?.includes('quota');

      if (isRateLimit && currentTry <= retries) {
        // Exponential backoff with jitter to prevent thundering herd
        const delay = initialDelay * Math.pow(2, currentTry - 1) + (Math.random() * 1000);
        console.warn(`Gemini API Rate Limit hit. Retrying attempt ${currentTry} in ${delay.toFixed(0)}ms...`);
        await wait(delay);
        continue;
      }

      // If not a rate limit or retries exhausted, throw
      throw error;
    }
  }
}

// Schema for Extraction
const extractionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    value: {
      type: Type.STRING,
      description: "The extracted answer. Keep it concise.",
    },
    confidence: {
      type: Type.STRING,
      enum: ["High", "Medium", "Low"],
      description: "Confidence level of the extraction.",
    },
    quote: {
      type: Type.STRING,
      description: "Verbatim text from the document supporting the answer. Must be exact substring.",
    },
    page: {
      type: Type.INTEGER,
      description: "The page number where the information was found (approximate if not explicit).",
    },
    reasoning: {
      type: Type.STRING,
      description: "A short explanation of why this value was selected.",
    },
  },
  required: ["value", "confidence", "quote", "reasoning"],
};

export const extractColumnData = async (
  doc: DocumentFile,
  column: Column,
  modelId: string
): Promise<ExtractionCell> => {
  console.log(`[EXTRACTION START] Doc: ${doc.name}, Column: ${column.name}, Model: ${modelId}`);
  return withRetry(async () => {
    try {
      const parts = [];

      // We assume doc.content is now ALWAYS text/markdown because we converted it locally on upload.
      // Decode Base64 to get the text
      let docText = "";
      try {
        docText = decodeURIComponent(escape(atob(doc.content)));
      } catch (e) {
        // Fallback
        docText = atob(doc.content);
      }
      console.log(`[EXTRACTION] Decoded document text length: ${docText.length} chars`);

      parts.push({
        text: `DOCUMENT CONTENT:\n${docText}`,
      });

      // Format instruction based on column type
      let formatInstruction = "";
      switch (column.type) {
        case 'date':
          formatInstruction = "Format the date as YYYY-MM-DD.";
          break;
        case 'boolean':
          formatInstruction = "Return 'true' or 'false' as the value string.";
          break;
        case 'number':
          formatInstruction = "Return a clean number string, removing currency symbols if needed.";
          break;
        case 'list':
          formatInstruction = "Return the items as a comma-separated string.";
          break;
        default:
          formatInstruction = "Keep the text concise.";
      }

      const prompt = `Task: Extract specific information from the provided document.
      
      Column Name: "${column.name}"
      Extraction Instruction: ${column.prompt}
      
      Format Requirements:
      - ${formatInstruction}
      - Provide a confidence score (High/Medium/Low).
      - Include the exact quote from the text where the answer is found.
      - Provide a brief reasoning.
      `;

      parts.push({ text: prompt });

      let modelConfig: any = {
        model: modelId,
        config: {
          responseMimeType: 'application/json',
          responseSchema: extractionSchema,
          systemInstruction: "You are a precise data extraction agent. You must extract data exactly as requested."
        }
      };

      // Check for cache
      const cacheName = await getOrCreateCache(doc.id, docText, modelId);

      if (cacheName) {
        console.log(`[GEMINI] Using Cached Content: ${cacheName}`);
        modelConfig.cachedContent = cacheName;
        // When using cache, we DO NOT send the document text again.
        // We only send the prompt.
        modelConfig.contents = {
          role: 'user',
          parts: [{ text: prompt }]
        };
      } else {
        // No cache, send full context
        console.log(`[GEMINI] Using standard context (no cache)`);
        modelConfig.contents = {
          role: 'user',
          parts: parts
        };
      }

      console.log(`[GEMINI] Calling API with model: ${modelId}`);
      const response = await ai.models.generateContent(modelConfig);

      console.log(`[EXTRACTION] Received response from Gemini`);
      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response from model");
      }

      const json = JSON.parse(responseText);
      console.log(`[EXTRACTION SUCCESS] Extracted value: ${json.value}`);

      return {
        value: String(json.value || ""),
        confidence: (json.confidence as any) || "Low",
        quote: json.quote || "",
        page: json.page || 1,
        reasoning: json.reasoning || "",
        status: 'needs_review'
      };

    } catch (error) {
      console.error("Extraction error:", error);
      throw error;
    }
  });
};

export const generatePromptHelper = async (
  name: string,
  type: string,
  currentPrompt: string | undefined,
  modelId: string
): Promise<string> => {
  const prompt = `I need to configure a Large Language Model to extract a specific data field from business documents.
    
    Field Name: "${name}"
    Field Type: "${type}"
    ${currentPrompt ? `Draft Prompt: "${currentPrompt}"` : ""}
    
    Please write a clear, effective prompt that I can send to the LLM to get the best extraction results for this field. 
    The prompt should describe what to look for and how to handle edge cases if applicable.
    Return ONLY the prompt text, no conversational filler.`;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt
    });
    return response.text?.trim() || "";
  } catch (error) {
    console.error("Prompt generation error:", error);
    return currentPrompt || `Extract the ${name} from the document.`;
  }
};

export const analyzeDataWithChat = async (
  message: string,
  context: { documents: DocumentFile[], columns: Column[], results: ExtractionResult },
  history: any[],
  modelId: string
): Promise<string> => {
  let dataContext = "CURRENT EXTRACTION DATA:\n";
  dataContext += `Documents: ${context.documents.map(d => d.name).join(", ")}\n`;
  dataContext += `Columns: ${context.columns.map(c => c.name).join(", ")}\n\n`;
  dataContext += "DATA TABLE (CSV Format):\n";

  const headers = ["Document Name", ...context.columns.map(c => c.name)].join(",");
  dataContext += headers + "\n";

  context.documents.forEach(doc => {
    const row = [doc.name];
    context.columns.forEach(col => {
      const cell = context.results[doc.id]?.[col.id];
      const val = cell ? cell.value.replace(/,/g, ' ') : "N/A";
      row.push(val);
    });
    dataContext += row.join(",") + "\n";
  });

  const systemInstruction = `You are an intelligent data analyst assistant. 
    You have access to a dataset extracted from documents (provided in context).
    
    User Query: ${message}
    
    ${dataContext}
    
    Instructions:
    1. Answer the user's question based strictly on the provided data table.
    2. If comparing documents, mention them by name.
    3. If the data is missing or N/A, state that clearly.
    4. Keep answers professional and concise.`;

  try {
    const chat = ai.chats.create({
      model: modelId,
      config: {
        systemInstruction: systemInstruction
      },
      history: history
    });

    const response = await chat.sendMessage({ message: message });
    return response.text || "No response generated.";
  } catch (error) {
    console.error("Chat analysis error:", error);
    return "I apologize, but I encountered an error while analyzing the data. Please try again.";
  }
};