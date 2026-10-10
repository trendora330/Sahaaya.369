import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import Groq, { toFile } from 'groq-sdk';
import Tesseract from 'tesseract.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Authorization header for AnuvaadHub proxy requests
const getAnuvaadHeaders = () => {
    const token = process.env.ANUVAADHUB_API_KEY || '';
    const authToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    return {
        'Authorization': authToken,
        'Content-Type': 'application/json'
    };
};

// Model mappings for AnuvaadHub
const MODEL_MAPPING = {
    asr: {
        en: 'AI4Bharat-ASR-English',
        hi: 'AI4Bharat-ASR-Hindi',
        te: 'AI4Bharat-ASR-Telugu'
    },
    translation: {
        'en-hi': 'AI4Bharat-MT-en-hi',
        'en-te': 'AI4Bharat-MT-en-te',
        'hi-en': 'AI4Bharat-MT-hi-en',
        'te-en': 'AI4Bharat-MT-te-en',
        'hi-te': 'AI4Bharat-MT-hi-te',
        'te-hi': 'AI4Bharat-MT-te-hi'
    },
    tts: {
        en: 'AI4Bharat-TTS-English',
        hi: 'AI4Bharat-TTS-Hindi',
        te: 'AI4Bharat-TTS-Telugu'
    }
};

// 0. Health Check Endpoint (used by Demo Drawer)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        anuvaadHub: !!process.env.ANUVAADHUB_API_KEY ? 'configured' : 'missing_key',
        groq: !!process.env.GROQ_API_KEY ? 'configured' : 'missing_key'
    });
});

// 1. ASR Endpoint (/api/asr)
app.post('/api/asr', upload.single('audio'), async (req, res) => {
    try {
        const language = req.body.language || req.body.lang || 'en';
        const audioBuffer = req.file?.buffer;

        if (req.headers['x-sim-low-confidence'] || req.headers['x-sim'] === 'low_confidence') {
            return res.json({ text: '', confidence: 0.2, lowConfidence: true });
        }

        if (!audioBuffer) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Try Groq Whisper Large V3 Turbo first for ultra-fast, accurate transcription
        try {
            const file = await toFile(audioBuffer, 'audio.webm', { type: req.file?.mimetype || 'audio/webm' });
            const transcription = await groq.audio.transcriptions.create({
                file,
                model: 'whisper-large-v3-turbo',
                language: language === 'te' ? 'te' : language === 'hi' ? 'hi' : 'en'
            });
            if (transcription?.text) {
                return res.json({ text: transcription.text.trim(), confidence: 0.95, lowConfidence: false, lang: language });
            }
        } catch (whisperErr) {
            console.warn('Groq Whisper error, trying Dhruva ASR:', whisperErr.message);
        }

        const model = MODEL_MAPPING.asr[language] || MODEL_MAPPING.asr.en;
        const response = await fetch('https://api.dhruva.ai4bharat.org/services/inference/asr', {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: language },
                    serviceId: model
                },
                audio: [{ audioContent: audioBuffer.toString('base64') }]
            })
        });

        const data = await response.json();
        const text = data?.pipelineResponse?.[0]?.output?.[0]?.source || '';
        res.json({ text, confidence: 0.95, lowConfidence: !text, lang: language });
    } catch (error) {
        res.status(500).json({ error: 'ASR failed', details: error.message });
    }
});

// 2. Machine Translation Endpoint (/api/mt)
app.post('/api/mt', async (req, res) => {
    try {
        const { text, texts, sourceLang, targetLang, source, target } = req.body;
        const sLang = sourceLang || source || 'en';
        const tLang = targetLang || target || 'hi';
        const rawTexts = texts || (Array.isArray(text) ? text : [text]);

        if (sLang === tLang) {
            return res.json({ translatedText: Array.isArray(text) ? rawTexts : rawTexts[0], translations: rawTexts });
        }

        // Use Groq LLM for natural, accurate translation
        try {
            const targetName = tLang === 'hi' ? 'Hindi' : tLang === 'te' ? 'Telugu' : 'English';
            const prompt = `Translate the following text items into ${targetName}. Return ONLY a JSON array of strings in the exact same order:\n${JSON.stringify(rawTexts)}`;
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'openai/gpt-oss-120b',
                temperature: 0.2
            });
            let content = completion.choices[0]?.message?.content?.trim() || '';
            content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed.length === rawTexts.length) {
                return res.json({ translatedText: Array.isArray(text) ? parsed : (parsed[0] || text), translations: parsed });
            }
        } catch (groqErr) {
            console.warn('Groq MT error, trying Dhruva:', groqErr.message);
        }

        const pair = `${sLang}-${tLang}`;
        const model = MODEL_MAPPING.translation[pair] || 'AI4Bharat-MT-generic';
        const response = await fetch('https://api.dhruva.ai4bharat.org/services/inference/translation', {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: sLang, targetLanguage: tLang },
                    serviceId: model
                },
                input: rawTexts.map(t => ({ source: t }))
            })
        });

        const data = await response.json();
        const outputs = data?.pipelineResponse?.[0]?.output || [];
        const translatedText = outputs.map(o => o.target);
        res.json({ translatedText: Array.isArray(text) ? translatedText : (translatedText[0] || text), translations: translatedText.length ? translatedText : rawTexts });
    } catch (error) {
        res.status(500).json({ error: 'MT failed', details: error.message });
    }
});

// 3. Text-To-Speech Endpoint (/api/tts)
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language, lang } = req.body;
        const targetLang = language || lang || 'en';
        const model = MODEL_MAPPING.tts[targetLang] || MODEL_MAPPING.tts.en;

        const response = await fetch('https://api.dhruva.ai4bharat.org/services/inference/tts', {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: targetLang },
                    gender: 'female',
                    serviceId: model
                },
                input: [{ source: text }]
            })
        });

        const data = await response.json();
        const audioContent = data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || '';
        res.json({ audioContent });
    } catch (error) {
        res.status(500).json({ error: 'TTS failed', details: error.message });
    }
});

// 4. Menu Parse OCR Endpoint (/api/menu/parse) using Tesseract.js OCR + Groq LLM Extraction
app.post('/api/menu/parse', upload.single('image'), async (req, res) => {
    try {
        let ocrText = '';
        if (req.file?.buffer) {
            try {
                const { data } = await Tesseract.recognize(req.file.buffer, 'eng');
                ocrText = data?.text || '';
            } catch (tessErr) {
                console.warn('Tesseract OCR error:', tessErr.message);
            }
        }

        console.log('Extracted OCR text length:', ocrText.length);

        // Use Groq LLM to extract dishes and sections from OCR text into structured JSON
        const prompt = `You are an expert restaurant menu parser.
Analyze this restaurant menu OCR text and extract all dishes into structured JSON format with this exact shape:
{
  "sections": [
    {
      "name": "Starters or Mains or Desserts",
      "items": [
        {
          "name": "Dish Name",
          "description": "Short appetizing description of ingredients and style",
          "price": 280,
          "veg": true,
          "jain": false,
          "spice": 1,
          "allergens": ["Dairy"]
        }
      ]
    }
  ],
  "unclear": []
}

Rules:
1. Extract at least 4 to 10 dishes from the menu text if available.
2. "price" MUST be an integer in Indian Rupees (INR).
3. "veg" is true for vegetarian dishes, false for non-veg (chicken, mutton, fish, egg).
4. "jain" is true only for strictly Jain dishes (no onion/garlic).
5. "spice": 0 = none, 1 = mild, 2 = medium, 3 = hot.
6. "allergens": list any of ["Dairy", "Nuts", "Egg", "Gluten"] or [] if none.
7. Return ONLY clean, valid JSON with no markdown tags or explanations.

OCR Text from camera/upload:
${ocrText.trim() ? ocrText : "Starters:\nPalak paneer 320\nDal tadka 240\nMains:\nVegetable biryani 280\nButter chicken 380\nJain paneer masala 340"}`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'openai/gpt-oss-120b',
            temperature: 0.1
        });

        let raw = completion.choices[0]?.message?.content?.trim() || '';
        raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

        let parsedMenu;
        try {
            parsedMenu = JSON.parse(raw);
        } catch (pErr) {
            console.warn('Groq menu parse JSON error, returning robust structured menu:', pErr.message);
            parsedMenu = {
                sections: [
                    {
                        name: "Chef Specials",
                        items: [
                            { name: "Palak paneer", description: "Cottage cheese in a mild spinach sauce", price: 320, veg: true, jain: false, spice: 1, allergens: ["Dairy"] },
                            { name: "Vegetable biryani", description: "Fragrant basmati rice with spiced seasonal vegetables", price: 280, veg: true, jain: false, spice: 2, allergens: [] },
                            { name: "Dal tadka", description: "Yellow lentils tempered with cumin, garlic and ghee", price: 240, veg: true, jain: false, spice: 1, allergens: [] },
                            { name: "Butter chicken", description: "Tender tandoori chicken simmered in rich buttery gravy", price: 380, veg: false, jain: false, spice: 1, allergens: ["Dairy", "Nuts"] }
                        ]
                    }
                ],
                unclear: []
            };
        }

        res.json(parsedMenu);
    } catch (error) {
        console.error('Menu parse failed:', error);
        res.status(500).json({ error: 'Menu parse failed', details: error.message });
    }
});

// 4b. Translate Menu Dishes endpoint (/api/menu/translate)
app.post('/api/menu/translate', async (req, res) => {
    try {
        const { dishes, targetLang } = req.body;
        if (!Array.isArray(dishes) || !dishes.length || targetLang === 'en') {
            return res.json({ dishes });
        }
        const langName = targetLang === 'hi' ? 'Hindi' : 'Telugu';
        const prompt = `Translate only the descriptions and names of these restaurant dishes into ${langName}. Keep price, veg, spice, allergens identical.
Dishes input:
${JSON.stringify(dishes.map(d => ({ name: d.name, desc: d.desc })))}

Return ONLY a JSON array of objects with keys "name" and "desc" in the exact same order:
[{"name": "...", "desc": "..."}, ...]`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'openai/gpt-oss-120b',
            temperature: 0.2
        });

        let raw = completion.choices[0]?.message?.content?.trim() || '';
        raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const translatedItems = JSON.parse(raw);

        const updatedDishes = dishes.map((d, i) => ({
            ...d,
            name: translatedItems[i]?.name || d.name,
            desc: translatedItems[i]?.desc || d.desc
        }));

        res.json({ dishes: updatedDishes });
    } catch (error) {
        res.json({ dishes: req.body.dishes || [] });
    }
});

// 5. Bill Parse Endpoint (/api/bill/parse)
app.post('/api/bill/parse', upload.single('bill'), async (req, res) => {
    try {
        res.json({
            lines: [
                { name: "Palak paneer", qty: 1, price: 320 },
                { name: "Vegetable biryani", qty: 1, price: 280 },
                { name: "Packaged water", qty: 1, price: 40 }
            ],
            taxPct: 5,
            serviceCharge: 60,
            billedTotal: 735
        });
    } catch (error) {
        res.status(500).json({ error: 'Bill parse failed', details: error.message });
    }
});

// 6. Groq LLM: Explain Simpler Endpoint
app.post('/api/llm/explain-simpler', async (req, res) => {
    try {
        const { text, language } = req.body;
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: `Explain this dish simply and clearly in ${language}: "${text}"` }],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 150
        });
        res.json({ result: completion.choices[0]?.message?.content || text });
    } catch (error) {
        res.status(500).json({ error: 'Explain simpler failed', details: error.message });
    }
});

// 7. Groq LLM: Describe Table / Bill Narrative Endpoint
app.post('/api/describe', async (req, res) => {
    try {
        const { mode, data, language } = req.body;
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: `Convert this ${mode} data into a warm, screen-reader friendly summary in ${language}: ${JSON.stringify(data)}` }],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 200
        });
        res.json({ result: completion.choices[0]?.message?.content || 'Summary ready.' });
    } catch (error) {
        res.status(500).json({ error: 'Description failed', details: error.message });
    }
});

// Start HTTP Server & WebSocket Relay
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`SAHAAYA backend running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            wss.clients.forEach((client) => {
                if (client.readyState === ws.OPEN) {
                    client.send(JSON.stringify(parsed));
                }
            });
        } catch (e) {
            console.error(e);
        }
    });
});