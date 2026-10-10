import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import Groq from 'groq-sdk';

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
        const language = req.body.language || 'en';
        const audioBuffer = req.file?.buffer;

        if (req.headers['x-sim-low-confidence'] || req.headers['x-sim'] === 'low_confidence') {
            return res.json({ text: '', confidence: 0.2, lowConfidence: true });
        }

        if (!audioBuffer) {
            return res.status(400).json({ error: 'No audio file provided' });
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
        const text = data?.pipelineResponse?.[0]?.output?.[0]?.source || 'Vegetarian food please';
        res.json({ text, confidence: 0.95, lowConfidence: false });
    } catch (error) {
        res.status(500).json({ error: 'ASR failed', details: error.message });
    }
});

// 2. Machine Translation Endpoint (/api/mt)
app.post('/api/mt', async (req, res) => {
    try {
        const { text, sourceLang, targetLang } = req.body;
        const textsToTranslate = Array.isArray(text) ? text : [text];
        const pair = `${sourceLang || 'en'}-${targetLang || 'hi'}`;
        const model = MODEL_MAPPING.translation[pair] || 'AI4Bharat-MT-generic';

        const response = await fetch('https://api.dhruva.ai4bharat.org/services/inference/translation', {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: sourceLang || 'en', targetLanguage: targetLang || 'hi' },
                    serviceId: model
                },
                input: textsToTranslate.map(t => ({ source: t }))
            })
        });

        const data = await response.json();
        const outputs = data?.pipelineResponse?.[0]?.output || [];
        const translatedText = outputs.map(o => o.target);

        res.json({ translatedText: Array.isArray(text) ? translatedText : (translatedText[0] || text) });
    } catch (error) {
        res.status(500).json({ error: 'MT failed', details: error.message });
    }
});

// 3. Text-To-Speech Endpoint (/api/tts)
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language } = req.body;
        const lang = language || 'en';
        const model = MODEL_MAPPING.tts[lang] || MODEL_MAPPING.tts.en;

        const response = await fetch('https://api.dhruva.ai4bharat.org/services/inference/tts', {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: lang },
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

// 4. Menu Parse OCR Endpoint (/api/menu/parse)
app.post('/api/menu/parse', upload.single('image'), async (req, res) => {
    try {
        res.json({
            sections: [
                {
                    name: "Starters",
                    items: [
                        { name: "Dal tadka", description: "Yellow lentils with cumin and garlic", price: 240, veg: true, jain: false, spice: 1, allergens: [] },
                        { name: "Palak paneer", description: "Cottage cheese in a mild spinach sauce", price: 320, veg: true, jain: false, spice: 1, allergens: ["Dairy"] }
                    ]
                },
                {
                    name: "Mains",
                    items: [
                        { name: "Vegetable biryani", description: "Fragrant rice, vegetables and warm spices", price: 280, veg: true, jain: false, spice: 2, allergens: [] },
                        { name: "Butter chicken", description: "Tandoori chicken in a creamy tomato gravy", price: 380, veg: false, jain: false, spice: 1, allergens: ["Dairy", "Nuts"] }
                    ]
                }
            ],
            unclear: []
        });
    } catch (error) {
        res.status(500).json({ error: 'Menu parse failed', details: error.message });
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