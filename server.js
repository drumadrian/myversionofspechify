const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5001;

// Middleware setup
app.use(cors());
app.use(express.json());

// AWS configuration
AWS.config.update({
  region: 'us-west-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
});

const polly = new AWS.Polly();

// Endpoint to synthesize speech
app.post('/synthesize', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, message: 'Text is required' });
  }

  const params = {
    OutputFormat: 'mp3',
    Text: text,
    VoiceId: 'Joanna', // Example voice; you can change this to any other supported voice.
  };

  try {
    const data = await polly.synthesizeSpeech(params).promise();
    const audioFilename = `audio-${uuidv4()}.mp3`;
    const audioPath = path.join(__dirname, audioFilename);

    // Save the audio to a file
    fs.writeFileSync(audioPath, data.AudioStream);

    // Send back the audio file URL
    res.json({
      success: true,
      audioUrl: `http://localhost:${PORT}/${audioFilename}`,
    });

    // Clean up the file after some time (e.g., 1 minute)
    setTimeout(() => {
      fs.unlink(audioPath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }, 60000);

  } catch (error) {
    console.error('Error synthesizing speech:', error);
    res.status(500).json({ success: false, message: 'Failed to synthesize speech' });
  }
});

// Serve static files (audio files)
app.use(express.static(__dirname));

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
