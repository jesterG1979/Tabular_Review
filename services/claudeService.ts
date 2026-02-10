import Anthropic from '@anthropic-ai/sdk';
import { DocumentFile, ExtractionCell, Column } from "../types";

// Initialize Anthropic Client
const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
  console.warn("VITE_ANTHROPIC_API_KEY is not configured. Claude models will not work.");
} else {
  console.log(`[CLAUDE] API Key configured (first 10 chars): ${apiKey.substring(0, 10)}...`);
}

const anthropic = new Anthropic({
  apiKey: apiKey || "",
  dangerouslyAllowBrowser: true // Required for browser usage
});

// Helper for delay
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        error?.error?.type === 'rate_limit_error' ||
        error?.message?.includes('429') ||
        error?.message?.includes('rate_limit');

      if (isRateLimit && currentTry <= retries) {
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, currentTry - 1) + (Math.random() * 1000);
        console.warn(`Claude API Rate Limit hit. Retrying attempt ${currentTry} in ${delay.toFixed(0)}ms...`);
        await wait(delay);
        continue;
      }

      // If not a rate limit or retries exhausted, throw
      throw error;
    }
  }
}

export const extractColumnDataWithClaude = async (
  doc: DocumentFile,
  column: Column,
  modelId: string
): Promise<ExtractionCell> => {
  console.log(`[CLAUDE EXTRACTION START] Doc: ${doc.name}, Column: ${column.name}, Model: ${modelId}`);



  // Force stricter instruction for Haiku/Sonnet
  const systemPrompt = "You are a precise data extraction agent. You must return ONLY valid JSON. Do not include any introductory text, markdown formatting, or explanations outside the JSON object.";

  // Decode Base64 to get the text - Moved to top level for accessibility
  let docText = "";
  try {
    docText = decodeURIComponent(escape(atob(doc.content)));
  } catch (e) {
    docText = atob(doc.content);
  }
  console.log(`[CLAUDE EXTRACTION] Decoded document text length: ${docText.length} chars`);

  return withRetry(async () => {





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

    const instructions = `Task: Extract specific information from the provided document.

Column Name: "${column.name}"
Extraction Instruction: ${column.prompt}

Format Requirements:
- ${formatInstruction}
- Provide a confidence score (High/Medium/Low).
- Include the exact quote from the text where the answer is found.
- Provide a brief reasoning.

Please respond with a JSON object in this exact format:
{
  "value": "the extracted answer",
  "confidence": "High/Medium/Low",
  "quote": "exact verbatim text from document",
  "page": 1,
  "reasoning": "brief explanation"
}`;

    try {
      console.log(`[CLAUDE EXTRACTION] Calling Claude API with model: ${modelId} `);

      const message = await anthropic.messages.create({
        model: modelId,
        max_tokens: 1024,
        system: systemPrompt,
        // @ts-ignore - headers is a beta feature
        headers: {
          "anthropic-beta": "prompt-caching-2024-07-31"
        },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `DOCUMENT CONTENT: \n${docText} `,
                // @ts-ignore - cache_control is a beta feature not yet in all type definitions
                cache_control: { type: 'ephemeral' }
              },
              {
                type: 'text',
                text: instructions
              }
            ]
          }
        ]
      });

      console.log(`[CLAUDE EXTRACTION] Received response from Claude`);

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      if (!responseText) {
        throw new Error("Empty response from Claude");
      }

      // Robust JSON Extraction: Find the first '{' and last '}'
      let jsonText = responseText.trim();
      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      } else {
        // Fallback cleanup if braces aren't found (unlikely for valid JSON)
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/^```json\s*\n/, '').replace(/\n```$/, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```\s*\n/, '').replace(/\n```$/, '');
        }
      }

      let json;
      try {
        json = JSON.parse(jsonText);
      } catch (e) {
        console.error("JSON Parse Error. Raw text:", responseText);
        throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`);
      }

      console.log(`[CLAUDE EXTRACTION SUCCESS] Extracted value: ${json.value}`);

      return {
        value: String(json.value || ""),
        confidence: (json.confidence as any) || "Low",
        quote: json.quote || "",
        page: json.page || 1,
        reasoning: json.reasoning || "",
        status: 'needs_review'
      };

    } catch (error: any) {
      // RETRY LOGIC FOR CACHING ERRORS
      // If the error is a 400 Invalid Request, it might be that the model doesn't support caching
      // or the model ID is invalid (though if invalid, it will fail again, which is fine).
      const isInvalidRequest = error?.status === 400 || error?.error?.type === 'invalid_request_error';

      if (isInvalidRequest) {
        console.warn(`[CLAUDE] Request failed with 400. Retrying without Prompt Caching headers...`);
        try {
          // Retry without cache_control and headers
          const message = await anthropic.messages.create({
            model: modelId,
            max_tokens: 1024,
            system: systemPrompt,
            // No headers
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `DOCUMENT CONTENT:\n${docText}` // No cache_control
                  },
                  {
                    type: 'text',
                    text: instructions
                  }
                ]
              }
            ]
          });

          const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

          // ... Process response (Duplicate logic - ideally refactor, but for stable fix inline is safe)
          // We need to parse this response exactly as above.
          // Let's refactor the parsing logic into a helper ideally, but for now copy-paste safe.

          let jsonText = responseText.trim();
          const firstBrace = jsonText.indexOf('{');
          const lastBrace = jsonText.lastIndexOf('}');

          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
          } else {
            if (jsonText.startsWith('```json')) {
              jsonText = jsonText.replace(/^```json\s*\n/, '').replace(/\n```$/, '');
            } else if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```\s*\n/, '').replace(/\n```$/, '');
            }
          }

          const json = JSON.parse(jsonText);
          return {
            value: String(json.value || ""),
            confidence: (json.confidence as any) || "Low",
            quote: json.quote || "",
            page: json.page || 1,
            reasoning: json.reasoning || "",
            status: 'needs_review'
          };

        } catch (retryError) {
          console.error("[CLAUDE] Retry without caching also failed:", retryError);
          throw retryError; // Throw the retry error (or original?)
        }
      }

      console.error("[CLAUDE EXTRACTION ERROR]", error);
      throw error;
    }
  });
};




export const generatePromptHelperWithClaude = async (
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
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    return responseText?.trim() || "";
  } catch (error) {
    console.error("Prompt generation error:", error);
    return currentPrompt || `Extract the ${name} from the document.`;
  }
};
