const express = require('express');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class MeetingAssistantServer {
  constructor() {
    this.clients = new Map();
    this.audioProcessor = require('./utils/audioprocessor');
    this.setupServer();
  }

  setupServer() {
    // Create HTTP server
    const server = require('http').createServer(app);
    
    // Create WebSocket server
    this.wss = new WebSocket.Server({ 
      server,
      perMessageDeflate: false 
    });

    // WebSocket connection handling
    this.wss.on('connection', (ws, request) => {
      const clientId = uuidv4();
      console.log(`New client connected: ${clientId}`);

      // Store client
      this.clients.set(clientId, {
        ws,
        audioBuffer: Buffer.alloc(0),
        lastProcessTime: Date.now(),
        processingQueue: []
      });

      ws.on('message', async (data) => {
        await this.handleAudioData(clientId, data);
      });

      ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        clientId: clientId
      }));
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`Meeting Assistant Server running on port ${PORT}`);
      console.log(`WebSocket server ready for connections`);
    });
  }

  async handleAudioData(clientId, audioData) {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      // Accumulate audio data
      client.audioBuffer = Buffer.concat([client.audioBuffer, audioData]);

      // Process audio every 3 seconds to avoid too frequent API calls
      const now = Date.now();
      if (now - client.lastProcessTime >= 3000 && client.audioBuffer.length > 0) {
        client.lastProcessTime = now;
        
        // Process accumulated audio
        const audioToProcess = client.audioBuffer;
        client.audioBuffer = Buffer.alloc(0);

        // Add to processing queue to avoid concurrent processing
        client.processingQueue.push(audioToProcess);
        
        if (client.processingQueue.length === 1) {
          await this.processAudioQueue(clientId);
        }
      }
    } catch (error) {
      console.error(`Error handling audio data for client ${clientId}:`, error);
    }
  }

  async processAudioQueue(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    while (client.processingQueue.length > 0) {
      const audioData = client.processingQueue.shift();
      
      try {
        // Process audio through our enhanced pipeline
        const result = await this.processAudioPipeline(audioData);
        
        if (result && result !== 'no-answer') {
          client.ws.send(JSON.stringify({
            type: 'answer',
            answer: result,
            timestamp: Date.now()
          }));
        }
      } catch (error) {
        console.error(`Error processing audio for client ${clientId}:`, error);
        
        // Send error to client
        client.ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process audio'
        }));
      }
    }
  }

  // Enhanced audio processing pipeline
  async processAudioPipeline(audioBuffer) {
    try {
      console.log(`Processing audio buffer of size: ${audioBuffer.length} bytes`);
      
      // Step 1: Process audio buffer (normalize, detect silence)
      const processedAudio = await this.audioProcessor.processAudioBuffer(audioBuffer);
      
      if (!processedAudio) {
        console.log('Audio processing returned null (likely silence)');
        return 'no-answer'; // Silent audio or processing failed
      }

      console.log('Audio processed successfully, attempting transcription...');

      // Step 2: Transcribe audio to text
      const transcription = await this.audioProcessor.transcribeAudio(processedAudio);
      
      if (!transcription || !transcription.text) {
        console.log('Transcription failed or returned no text');
        return 'no-answer'; // No speech detected
      }

      console.log(`Transcribed: "${transcription.text}"`);

      // Step 3: Generate intelligent response
      const response = await this.audioProcessor.generateResponse(transcription.text, {
        meetingType: 'General meeting',
        previousMessages: [] // Could store conversation history
      });

      if (response && response.suggestedResponse) {
        console.log(`Generated response: "${response.suggestedResponse}"`);
        return response.suggestedResponse;
      }

      console.log('Response generation failed');
      return 'no-answer';
    } catch (error) {
      console.error('Error in audio processing pipeline:', error);
      // Fallback to original Gemini processing
      console.log('Falling back to original Gemini processing...');
      return await this.processAudioWithGemini(audioBuffer);
    }
  }

  async processAudioWithGemini(audioBuffer) {
    try {
      // Convert WebM audio to text using Gemini
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // First, convert audio to base64 for Gemini
      const audioBase64 = audioBuffer.toString('base64');
      
      // Create the prompt for Gemini to process both speech-to-text and answer generation
      const prompt = `
You are a meeting assistant. Your task is to:

1. Convert the provided audio to text (speech-to-text)
2. Analyze if the text contains a direct question
3. If it's a question, provide a short, clear, factual answer (1-3 sentences)
4. If it's not a question, return exactly "no-answer"

Rules:
- Only respond to direct questions
- Keep answers concise and factual
- Do not repeat the question
- Return "no-answer" for statements, comments, or unclear speech
- Focus on providing helpful information quickly

Audio data provided as base64. Process the speech and respond accordingly.
`;

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "audio/webm",
            data: audioBase64
          }
        },
        prompt
      ]);

      const response = await result.response;
      const answer = response.text().trim();

      console.log('Gemini response:', answer);
      return answer;

    } catch (error) {
      console.error('Error processing with Gemini:', error);
      
      // Fallback: try text-only processing if audio fails
      if (error.message.includes('audio') || error.message.includes('format')) {
        console.log('Audio processing failed, this is expected with the current setup');
        return 'no-answer';
      }
      
      throw error;
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    clients: Array.from(meetingServer.clients.keys()).length
  });
});

// API endpoint for testing
app.post('/api/test', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
Analyze this text and determine if it contains a direct question. 
If yes, provide a short, clear, factual answer (1-3 sentences).
If no, return exactly "no-answer".

Text: "${text}"
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const answer = response.text().trim();

    res.json({ 
      answer,
      isQuestion: answer !== 'no-answer',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize server
const meetingServer = new MeetingAssistantServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  process.exit(0);
});