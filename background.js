let requestCounter = 0;

async function fetchWithBackoff(url, options, retries = 5, initialDelay = 2000) {
    try {
        const response = await fetch(url, options);

        if (response.ok) return response;

        if (response.status === 429 || response.status === 503) {
            if (retries > 0) {
                console.warn(`API busy (${response.status}). Retrying in ${initialDelay / 1000}s...`);
                
                await new Promise(resolve => setTimeout(resolve, initialDelay));
                
                return fetchWithBackoff(url, options, retries - 1, initialDelay * 2);
            }
        }
        
        throw new Error(`API Error: ${response.status} ${response.statusText}`);

    } catch (error) {
        if (retries > 0) {
            console.warn(`Network error: ${error.message}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, initialDelay));
            return fetchWithBackoff(url, options, retries - 1, initialDelay * 2);
        }
        throw error;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "SAVE_API_KEY") {
        return true; 
    }

    if (request.action === "SOLVE_SINGLE_QUESTION") {
        
        chrome.storage.local.get(['geminiApiKey', 'geminiApiKeys'], async (result) => {
            try {
                let keys = [];
                if (result.geminiApiKeys && Array.isArray(result.geminiApiKeys) && result.geminiApiKeys.length > 0) {
                    keys = result.geminiApiKeys;
                } else if (result.geminiApiKey) {
                    keys = [result.geminiApiKey];
                }

                if (keys.length === 0) {
                    sendResponse({ success: false, error: "No API keys configured. Please add keys in the extension popup." });
                    return;
                }

                const currentKey = keys[requestCounter % keys.length];
                requestCounter++; 
                
                console.log(`Using key ${(requestCounter % keys.length) || keys.length} of ${keys.length}`);

                const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${currentKey}`;
                
                const q = request.data;
                
                const optionsText = q.choices && q.choices.length > 0 
                    ? `AVAILABLE OPTIONS (Select EXACTLY one):\n${q.choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
                    : 'NO OPTIONS PROVIDED. Provide a concise text answer.';

                const promptText = `You are an expert AI assistant filling out a form.

QUESTION: "${q.question}"
TYPE: ${q.type}
${optionsText}

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object. No markdown formatting.
2. If options are provided, you MUST use the EXACT text from the list above.
3. Do not invent new options.

RESPONSE FORMAT:
{"answer": "exact text of option"}

Now respond with ONLY the JSON object:`;

                const response = await fetchWithBackoff(API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }]
                    })
                });

                const data = await response.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!rawText) throw new Error("No response text from AI");

                let cleanJson = rawText.replace(/```json|```/g, '').trim();
                
                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                
                if (!jsonMatch) throw new Error("Could not find valid JSON in response");

                const parsedResult = JSON.parse(jsonMatch[0]);
                const answer = String(parsedResult.answer).trim();

                console.log("AI Answer:", answer);
                sendResponse({ success: true, answer: answer });

            } catch (error) {
                console.error("Error:", error.message);
                sendResponse({ success: false, error: error.message });
            }
        });

        return true;
    }
});