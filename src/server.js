
import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


async function askChatGPT(prompt) {
  let browser = null;
  let page = null;

  try {
    console.log("🚀 Launching browser...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ],
    });

    page = await browser.newPage();

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log("🌐 Navigating to ChatGPT...");
    await page.goto("https://chat.openai.com", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for page to load
    await sleep(3000);

    // Try to find textarea with multiple attempts
    console.log("🔍 Looking for input field...");
    let textareaFound = false;
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Try different selectors
        const selectors = [
          'textarea[data-id="root"]',
          "#prompt-textarea",
          'textarea[placeholder*="Message"]',
          'textarea[placeholder*="message"]',
          "textarea",
        ];

        for (const selector of selectors) {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            console.log(`✅ Found textarea with: ${selector}`);

            // Click and clear the textarea
            await page.click(selector);
            await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (element) {
                element.value = "";
                element.focus();
              }
            }, selector);

            // Type the message
            await page.type(selector, prompt);
            await sleep(1000);

            // Press Enter
            await page.keyboard.press("Enter");
            console.log("📤 Message sent!");

            textareaFound = true;
            break;
          }
        }

        if (textareaFound) break;

        console.log(
          `⏳ Attempt ${attempt}/${maxAttempts} - textarea not found, retrying...`
        );
        await sleep(2000);
      } catch (err) {
        console.log(`❌ Attempt ${attempt} failed:`, err.message);
      }
    }

    if (!textareaFound) {
      throw new Error("Could not find message input field");
    }

    // Wait for response
    console.log("⏳ Waiting for ChatGPT response...");

    // Wait for assistant message to appear
    await page.waitForSelector('[data-message-author-role="assistant"]', {
      timeout: 45000,
    });

    // Wait a bit more for the message to complete
    await sleep(5000);

    // Extract response
    console.log("📖 Extracting response...");
    const response = await page.evaluate(() => {
      // Get all assistant messages
      const assistantMessages = document.querySelectorAll(
        '[data-message-author-role="assistant"]'
      );

      if (assistantMessages.length === 0) {
        return "No response found";
      }

      // Get the last message
      const lastMessage = assistantMessages[assistantMessages.length - 1];

      // Try different content selectors
      const contentSelectors = [
        ".markdown.prose",
        "[data-message-content]",
        ".whitespace-pre-wrap",
      ];

      for (const selector of contentSelectors) {
        const content = lastMessage.querySelector(selector);
        if (content && content.innerText.trim()) {
          return content.innerText.trim();
        }
      }

      // Fallback to full text content
      return lastMessage.innerText.trim() || "Empty response";
    });

    console.log("✅ Response extracted successfully");
    const cleanedResponse = response.replace(/\n/g, " ");
    return {
      success: true,
      response: cleanedResponse,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("❌ Error:", error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// ------------------------------
// REST Endpoints
// ------------------------------

app.get("/chat", async (req, res) => {
  let { prompt } = req.query;
  prompt = `${prompt}.Enhenced Prompts: <your answer in plain text>`;

  if (!prompt) {
    return res.status(400).json({
      error: "prompt parameter is required",
      example: "/chat?prompt=Hello ChatGPT!",
    });
  }

  console.log(
    `\n🔄 New request: "${prompt.substring(0, 100)}${
      prompt.length > 100 ? "..." : ""
    }"`
  );

  const result = await askChatGPT(String(prompt));
  console.log(result.response);
  res.status(200).json(result);
});

app.post("/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({
      error: "prompt is required in request body",
    });
  }

  console.log(
    `\n🔄 New POST request: "${prompt.substring(0, 100)}${
      prompt.length > 100 ? "..." : ""
    }"`
  );

  const result = await askChatGPT(prompt);
  res.json(result);
});

// ------------------------------
// Start server
// ------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
🚀 Simple ChatGPT Bridge Started!
📡 Server: http://localhost:${PORT}

📝 Usage:
   GET  /chat?prompt=your_message
   POST /chat (with JSON: {"prompt": "your message"})
   GET  /health

🔍 Example:
   curl "http://localhost:${PORT}/chat?prompt=Hello!"

⚠️  For educational purposes only
  `);
});
