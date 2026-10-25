require('dotenv').config();
process.env.AWS_SDK_LOAD_CONFIG = '1';
const express = require('express');
const cors = require('cors');
const { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } = require('@aws-sdk/client-polly');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const { processCodeForSpeech, isCodeContent, escapeXml } = require('./codeSpeechEngine');

process.on('unhandledRejection', (reason) => {
  console.warn('[Protected] Caught unhandled rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.warn('[Protected] Caught uncaught exception:', err?.message || err);
});

const app = express();
const PORT = process.env.PORT || 5001;

// In-memory store for recent clips (shared with Chrome extension and macOS shortcut)
let latestClip = null;

// Middleware setup
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure file upload storage
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Ensure uploads dir exists
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

// AWS Polly configuration using AWS SDK v3
const pollyConfig = {
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2',
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  pollyConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  };
}

const polly = new PollyClient(pollyConfig);

// Helper: Convert Polly stream to Buffer
async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  if (typeof stream.transformToByteArray === 'function') {
    const bytes = await stream.transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Splits any string into safe, natural spoken segments of at most maxSegmentLen characters (default 350).
 * Respects sentence endings (. ! ?), clauses (, ; : -), words, and hard-slices oversized tokens.
 */
function splitIntoSafeSegments(text, maxSegmentLen = 350) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const segments = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxSegmentLen) {
      segments.push(trimmed);
      continue;
    }

    // Split by sentence terminators
    const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [trimmed];
    for (const sentence of sentences) {
      const sTrim = sentence.trim();
      if (!sTrim) continue;
      if (sTrim.length <= maxSegmentLen) {
        segments.push(sTrim);
        continue;
      }

      // Split by clauses / commas / colons / semicolons / dashes
      const clauses = sTrim.match(/[^,;:—\-]+[,;:—\-]+(?:\s+|$)|[^,;:—\-]+$/g) || [sTrim];
      for (const clause of clauses) {
        const cTrim = clause.trim();
        if (!cTrim) continue;
        if (cTrim.length <= maxSegmentLen) {
          segments.push(cTrim);
          continue;
        }

        // Split by words
        const words = cTrim.split(/\s+/);
        let curr = '';
        for (const w of words) {
          if (w.length > maxSegmentLen) {
            if (curr) { segments.push(curr); curr = ''; }
            for (let i = 0; i < w.length; i += maxSegmentLen) {
              segments.push(w.slice(i, i + maxSegmentLen));
            }
          } else if ((curr + ' ' + w).trim().length <= maxSegmentLen) {
            curr = curr ? curr + ' ' + w : w;
          } else {
            if (curr) segments.push(curr);
            curr = w;
          }
        }
        if (curr) segments.push(curr);
      }
    }
  }

  return segments;
}

/**
 * Splits plain text into natural semantic chunks, respecting paragraph,
 * sentence, and word boundaries, keeping each chunk under maxChunkSize (default ~1500 chars)
 * to strictly prevent AWS Polly's 3,000 character limit error.
 */
function splitTextIntoChunks(text, maxChunkSize = 1500) {
  if (!text) return [];
  const safeSegments = splitIntoSafeSegments(text, 350);
  const chunks = [];
  let currentChunk = '';

  for (const seg of safeSegments) {
    const pot = currentChunk ? `${currentChunk} ${seg}` : seg;
    if (pot.length <= maxChunkSize) {
      currentChunk = pot;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = seg;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Group spoken code lines into valid SSML documents under maxLen characters (default 1500)
 */
function chunkSpokenLinesForSSML(lines, maxSSMLChars = 1500) {
  // First, break every line down into safe sub-segments under 350 chars
  const safeLines = [];
  for (const line of lines) {
    const subSegments = splitIntoSafeSegments(line, 350);
    for (const sub of subSegments) {
      safeLines.push(sub);
    }
  }

  const chunks = [];
  let currentBatch = [];
  let currentLen = 0;

  for (const line of safeLines) {
    const escaped = escapeXml(line);
    const lineTag = `<s>${escaped}</s><break time="200ms"/>`;
    if (currentLen + lineTag.length > maxSSMLChars && currentBatch.length > 0) {
      chunks.push(`<speak>\n<p>\n${currentBatch.join('\n')}\n</p>\n</speak>`);
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(lineTag);
    currentLen += lineTag.length + 1;
  }

  if (currentBatch.length > 0) {
    chunks.push(`<speak>\n<p>\n${currentBatch.join('\n')}\n</p>\n</speak>`);
  }

  return chunks.length > 0 ? chunks : [`<speak><p><s>${escapeXml(lines.join(' '))}</s></p></speak>`];
}

// Curated list of high-quality Amazon Polly voices
const FALLBACK_VOICES = [
  { id: 'Joanna', name: 'Joanna', gender: 'Female', language: 'en-US', languageName: 'US English', engines: ['neural', 'standard'], isNeural: true, description: 'Natural, warm conversational voice' },
  { id: 'Matthew', name: 'Matthew', gender: 'Male', language: 'en-US', languageName: 'US English', engines: ['neural', 'standard', 'generative'], isNeural: true, description: 'Deep, confident professional tone' },
  { id: 'Danielle', name: 'Danielle', gender: 'Female', language: 'en-US', languageName: 'US English', engines: ['neural'], isNeural: true, description: 'Crisp, articulate modern voice' },
  { id: 'Stephen', name: 'Stephen', gender: 'Male', language: 'en-US', languageName: 'US English', engines: ['neural'], isNeural: true, description: 'Clear, engaging presenter tone' },
  { id: 'Ruth', name: 'Ruth', gender: 'Female', language: 'en-US', languageName: 'US English', engines: ['neural', 'generative'], isNeural: true, description: 'Expressive and friendly' },
  { id: 'Gregory', name: 'Gregory', gender: 'Male', language: 'en-US', languageName: 'US English', engines: ['neural'], isNeural: true, description: 'Energetic, smooth delivery' },
  { id: 'Salli', name: 'Salli', gender: 'Female', language: 'en-US', languageName: 'US English', engines: ['neural', 'standard'], isNeural: true, description: 'Friendly and approachable' },
  { id: 'Joey', name: 'Joey', gender: 'Male', language: 'en-US', languageName: 'US English', engines: ['neural', 'standard'], isNeural: true, description: 'Casual, conversational' },
  { id: 'Amy', name: 'Amy', gender: 'Female', language: 'en-GB', languageName: 'British English', engines: ['neural', 'standard'], isNeural: true, description: 'Sophisticated British accent' },
  { id: 'Arthur', name: 'Arthur', gender: 'Male', language: 'en-GB', languageName: 'British English', engines: ['neural'], isNeural: true, description: 'Distinguished British voice' },
  { id: 'Brian', name: 'Brian', gender: 'Male', language: 'en-GB', languageName: 'British English', engines: ['neural', 'standard'], isNeural: true, description: 'Warm British storytelling voice' },
  { id: 'Olivia', name: 'Olivia', gender: 'Female', language: 'en-AU', languageName: 'Australian English', engines: ['neural', 'standard'], isNeural: true, description: 'Modern Australian cadence' },
  { id: 'Lupe', name: 'Lupe', gender: 'Female', language: 'es-US', languageName: 'US Spanish', engines: ['neural', 'standard'], isNeural: true, description: 'Expressive Spanish voice' },
  { id: 'Lea', name: 'Lea', gender: 'Female', language: 'fr-FR', languageName: 'French', engines: ['neural', 'standard'], isNeural: true, description: 'Elegant French tone' },
  { id: 'Vicki', name: 'Vicki', gender: 'Female', language: 'de-DE', languageName: 'German', engines: ['neural', 'standard'], isNeural: true, description: 'Clear, authentic German' },
  { id: 'Takumi', name: 'Takumi', gender: 'Male', language: 'ja-JP', languageName: 'Japanese', engines: ['neural', 'standard'], isNeural: true, description: 'Modern Japanese delivery' },
];

// Helper: Check if AWS credentials exist
function hasAwsCredentials() {
  return Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    fs.existsSync(path.join(process.env.HOME || '', '.aws', 'credentials')) ||
    fs.existsSync(path.join(process.env.HOME || '', '.aws', 'config'))
  );
}

// 1. Health and System Status Endpoint
app.get('/status', (req, res) => {
  const credentialsDetected = hasAwsCredentials();
  res.json({
    status: 'online',
    version: '3.0.0',
    sdk: 'AWS SDK for JavaScript (v3)',
    awsConfigured: credentialsDetected,
    region: pollyConfig.region,
    defaultEngine: 'neural',
    features: [
      'AWS SDK v3 Modern Client',
      'Neural AI Speech',
      'Seamless Multi-Chunk Concatenation (Unlimited Text Length)',
      'Smart Code Reader & Comprehension',
      'Browser Extension Context Menu',
      'File Upload Synthesizer',
      'SSML Prosody & Speed Controls'
    ],
    latestClipAvailable: Boolean(latestClip),
  });
});

// 2. Voices Endpoint (supports filtering by engine or language)
app.get('/voices', async (req, res) => {
  const { engine } = req.query; // 'neural' | 'standard'
  try {
    if (hasAwsCredentials()) {
      const params = engine ? { Engine: engine } : {};
      const data = await polly.send(new DescribeVoicesCommand(params));
      const mapped = (data.Voices || []).map(v => ({
        id: v.Id,
        name: v.Name,
        gender: v.Gender,
        language: v.LanguageCode,
        languageName: v.LanguageName,
        engines: v.SupportedEngines || [],
        isNeural: (v.SupportedEngines || []).includes('neural'),
      }));
      return res.json({ success: true, voices: mapped });
    }
  } catch (error) {
    console.warn('Polly describeVoices call failed, falling back to curated list:', error.message);
  }

  // Fallback to rich curated list
  let voices = FALLBACK_VOICES;
  if (engine) {
    voices = voices.filter(v => v.engines.includes(engine));
  }
  res.json({ success: true, voices });
});

// 3. Main Synthesize Speech Endpoint (with automatic chunking & seamless MP3 stitching)
app.post('/synthesize', async (req, res) => {
  const {
    text,
    voiceId = 'Joanna',
    engine = 'neural', // 'neural' (default) or 'standard'
    rate = '100%',
    pitch = 'default',
    codeMode = false, // false | true | 'natural' | 'detailed'
    includeLineNumbers = false,
  } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Text is required' });
  }

  const pollyEngine = (engine === 'standard') ? 'standard' : 'neural';

  // Instant demo fallback if requested
  if (req.body.demoFallback) {
    const sampleAudio = 'audio-eb736407-41e8-48be-b8fe-29c8506101fb.mp3';
    if (fs.existsSync(path.join(__dirname, sampleAudio))) {
      return res.json({
        success: true,
        audioUrl: `http://localhost:${PORT}/${sampleAudio}`,
        filename: sampleAudio,
        engine: pollyEngine,
        voiceId,
        isSSML: false,
        codeModeApplied: false,
        isDemoFallback: true,
        notice: 'Demonstration audio stream (AWS SSO credentials not active).',
      });
    }
  }

  // Determine if code processing should be applied
  const shouldProcessAsCode = codeMode === true || codeMode === 'natural' || codeMode === 'detailed' || (codeMode === 'auto' && isCodeContent(text));

  let payloadChunks = [];
  let isSSML = false;

  if (shouldProcessAsCode) {
    // Process code into clean spoken lines, then split into safe SSML chunks
    const spokenLines = processCodeForSpeech(text, {
      mode: codeMode === 'detailed' ? 'detailed' : 'natural',
      includeLineNumbers: Boolean(includeLineNumbers),
      returnLines: true,
    });
    payloadChunks = chunkSpokenLinesForSSML(spokenLines, 1500);
    isSSML = true;
  } else if (rate !== '100%' || pitch !== 'default') {
    // Prosody rate/pitch customization: split text, then wrap each chunk in SSML
    const textChunks = splitTextIntoChunks(text, 1500);
    payloadChunks = textChunks.map(chunk =>
      `<speak><prosody rate="${rate}" pitch="${pitch}">${escapeXml(chunk)}</prosody></speak>`
    );
    isSSML = true;
  } else {
    // Standard plain text: chunk safely into <= 1500 characters each
    payloadChunks = splitTextIntoChunks(text, 1500);
    isSSML = false;
  }

  console.log(`[Synthesis] Processing ${payloadChunks.length} chunk(s) (${isSSML ? 'SSML' : 'Text'}, Voice: ${voiceId}, Engine: ${pollyEngine}, Input: ${text.length} chars)...`);

  try {
    const audioBuffers = [];

    for (let i = 0; i < payloadChunks.length; i++) {
      const chunkText = payloadChunks[i];
      console.log(`[Synthesis] Chunk ${i + 1}/${payloadChunks.length} (${chunkText.length} chars) synthesizing...`);
      const chunkParams = {
        OutputFormat: 'mp3',
        Text: chunkText,
        VoiceId: voiceId,
        Engine: pollyEngine,
        TextType: isSSML ? 'ssml' : 'text',
      };

      const data = await polly.send(new SynthesizeSpeechCommand(chunkParams));
      const buf = await streamToBuffer(data.AudioStream);
      audioBuffers.push(buf);
    }

    // Concatenate all synthesized MP3 chunk buffers into one final seamless audio stream
    const finalAudioBuffer = Buffer.concat(audioBuffers);
    const audioFilename = `audio-${uuidv4()}.mp3`;
    const audioPath = path.join(__dirname, audioFilename);

    // Save the concatenated audio to disk
    fs.writeFileSync(audioPath, finalAudioBuffer);

    // Send back the audio file URL and metadata
    res.json({
      success: true,
      audioUrl: `http://localhost:${PORT}/${audioFilename}`,
      filename: audioFilename,
      engine: pollyEngine,
      voiceId,
      isSSML,
      codeModeApplied: shouldProcessAsCode,
      chunksCount: payloadChunks.length,
      totalCharacters: text.length,
    });

    // Clean up the file after 15 minutes
    setTimeout(() => {
      fs.unlink(audioPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error deleting audio file:', err.message);
        }
      });
    }, 15 * 60 * 1000);

  } catch (error) {
    console.error('Error synthesizing speech with AWS Polly (v3):', error.message);

    // If demo fallback is requested or if testing without active SSO credentials
    if (req.body.demoFallback) {
      const sampleAudio = 'audio-eb736407-41e8-48be-b8fe-29c8506101fb.mp3';
      if (fs.existsSync(path.join(__dirname, sampleAudio))) {
        return res.json({
          success: true,
          audioUrl: `http://localhost:${PORT}/${sampleAudio}`,
          filename: sampleAudio,
          engine: pollyEngine,
          voiceId,
          isSSML,
          codeModeApplied: shouldProcessAsCode,
          isDemoFallback: true,
          notice: 'Demonstration audio stream (AWS SSO credentials expired or not logged in).',
        });
      }
    }

    // Clear, specific diagnostic messaging
    let errorHelp = error.message;
    if (error.name === 'ExpiredToken' || error.message.includes('Token has expired')) {
      errorHelp = 'AWS SSO token has expired. Please run "aws sso login" in your terminal, or export fresh credentials.';
    } else if (error.name === 'CredentialsProviderError' || error.message.includes('Missing credentials')) {
      errorHelp = 'AWS credentials not found. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN if using SSO) in your environment or .env file.';
    } else if (error.name === 'ValidationException' && error.message.includes('engine')) {
      errorHelp = `The selected voice "${voiceId}" may not support the "${pollyEngine}" engine. Try switching engine or voice.`;
    } else if (error.name === 'TextLengthExceededException') {
      errorHelp = 'Text length exceeded single chunk limits. Please try again with shorter text or report this.';
    }

    res.status(500).json({
      success: false,
      message: errorHelp,
      code: error.name || 'SYNTHESIZE_FAILED',
      rawError: error.message,
    });
  }
});

// 4. File Upload Synthesize Endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf-8');

    // Clean up uploaded temp file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      filename: req.file.originalname,
      size: req.file.size,
      text: content,
      isCode: isCodeContent(content),
    });
  } catch (err) {
    console.error('Error reading uploaded file:', err);
    res.status(500).json({ success: false, message: 'Failed to read file' });
  }
});

// 5. Browser Extension & macOS Shortcut Clipping API
app.post('/api/clip', (req, res) => {
  const { text, source, title } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, message: 'No text provided' });
  }

  latestClip = {
    id: uuidv4(),
    text,
    source: source || 'Browser Context Menu',
    title: title || 'Clipped Text',
    timestamp: new Date().toISOString(),
  };

  console.log(`[Clip Received] ${latestClip.title} (${text.length} chars)`);
  res.json({ success: true, message: 'Clip received', clip: latestClip });
});

app.get('/api/clip/latest', (req, res) => {
  res.json({ success: true, clip: latestClip });
});

// Serve static audio files
app.use(express.static(__dirname));

// Start server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎙️  MyVersionOfSpeechify Server running on http://localhost:${PORT}`);
  console.log(`🚀 Default Engine: Neural AI (AWS SDK v3)`);
  console.log(`🔑 AWS Configured: ${hasAwsCredentials() ? 'YES' : 'NO (Check .env or AWS CLI SSO)'}`);
  console.log(`===============================================`);
});
