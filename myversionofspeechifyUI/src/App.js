import React, { useState } from 'react';
import axios from 'axios';

function PollyApp() {
  const [text, setText] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTextChange = (e) => setText(e.target.value);

  const handleSynthesize = async () => {
    setLoading(true);
    setAudioUrl(''); // Clear any previous audio URL

    try {
      const response = await axios.post('http://localhost:5001/synthesize', { text });
      if (response.data.success) {
        setAudioUrl(response.data.audioUrl); // Set audio URL to play and download
      }
    } catch (error) {
      console.error('Error generating audio:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>My Version of Speechify</h1>
      <textarea value={text} onChange={handleTextChange} placeholder="Enter text to synthesize" />
      <button onClick={handleSynthesize}>Submit</button>

      {loading && <p>Processing...</p>}
      
      {audioUrl && (
        <div>
          <p>👍 Audio is ready!</p>
          <audio controls src={audioUrl}>
            Your browser does not support the audio element.
          </audio>
          <div>
            <a href={audioUrl} download="output.mp3">Download Audio</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default PollyApp;
