import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { processCodeForSpeech, isCodeContent } from './codeSpeechEngine';
import './App.css';

const SERVER_BASE = 'http://localhost:5001';

const DEFAULT_VOICES = [
  { id: 'Joanna', name: 'Joanna', gender: 'Female', languageName: 'US English', isNeural: true, desc: 'Natural & warm' },
  { id: 'Matthew', name: 'Matthew', gender: 'Male', languageName: 'US English', isNeural: true, desc: 'Confident & deep' },
  { id: 'Danielle', name: 'Danielle', gender: 'Female', languageName: 'US English', isNeural: true, desc: 'Crisp & articulate' },
  { id: 'Stephen', name: 'Stephen', gender: 'Male', languageName: 'US English', isNeural: true, desc: 'Clear presenter tone' },
  { id: 'Ruth', name: 'Ruth', gender: 'Female', languageName: 'US English', isNeural: true, desc: 'Expressive storytelling' },
  { id: 'Gregory', name: 'Gregory', gender: 'Male', languageName: 'US English', isNeural: true, desc: 'Smooth & modern' },
  { id: 'Amy', name: 'Amy', gender: 'Female', languageName: 'British English', isNeural: true, desc: 'Refined British' },
  { id: 'Brian', name: 'Brian', gender: 'Male', languageName: 'British English', isNeural: true, desc: 'Classic British' },
  { id: 'Olivia', name: 'Olivia', gender: 'Female', languageName: 'Australian English', isNeural: true, desc: 'Modern Australian' },
  { id: 'Lupe', name: 'Lupe', gender: 'Female', languageName: 'US Spanish', isNeural: true, desc: 'Bilingual Spanish' },
];

const CODE_SAMPLE = `// Asynchronous speech worker pipeline
async function synthesizeSpeech(inputText, voice = "Joanna") {
  const engine = "neural";
  if (!inputText || inputText.length === 0) {
    throw new Error("Input text is required");
  }

  const response = await fetch("http://localhost:5001/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: inputText, voiceId: voice, engine })
  });

  return response.json();
}`;

const TEXT_SAMPLE = `Welcome to My Version of Speechify, enhanced with Amazon Polly's state of the art Neural AI voice synthesis. Unlike traditional robotic text to speech engines, Neural AI delivers exceptionally realistic human intonation, expressive pacing, and smooth conversational inflection.`;

function App() {
  const [text, setText] = useState(TEXT_SAMPLE);
  const [engine, setEngine] = useState('neural'); // 'neural' | 'standard'
  const [voiceId, setVoiceId] = useState('Joanna');
  const [voices, setVoices] = useState(DEFAULT_VOICES);
  const [codeMode, setCodeMode] = useState('natural'); // 'natural' | 'detailed' | 'off'
  const [activeTab, setActiveTab] = useState('text'); // 'text' | 'code' | 'upload' | 'clips'
  const [speed, setSpeed] = useState(1.0);
  
  // Status & Audio
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [serverStatus, setServerStatus] = useState({ online: false, awsConfigured: false, region: 'us-west-2' });
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [spokenPreview, setSpokenPreview] = useState('');
  const [latestClip, setLatestClip] = useState(null);

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  // 1. Initial Load & Server Status Check
  useEffect(() => {
    // Check URL parameters for text (e.g. from Chrome extension or macOS link)
    const params = new URLSearchParams(window.location.search);
    const queryText = params.get('text');
    if (queryText) {
      setText(decodeURIComponent(queryText));
      if (isCodeContent(queryText)) {
        setActiveTab('code');
        setCodeMode('natural');
      }
    }

    // Load History from localStorage
    const saved = localStorage.getItem('speechify_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {}
    }

    // Check server status
    checkServer();
    fetchVoices();

    // Poll for clips sent from browser extension every 5 seconds
    const interval = setInterval(checkClips, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update live spoken code preview whenever text or codeMode changes
  useEffect(() => {
    if (codeMode !== 'off' && text) {
      const preview = processCodeForSpeech(text);
      setSpokenPreview(preview);
    } else {
      setSpokenPreview('');
    }
  }, [text, codeMode]);

  const checkServer = async () => {
    try {
      const res = await axios.get(`${SERVER_BASE}/status`, { timeout: 3000 });
      setServerStatus({
        online: true,
        awsConfigured: res.data.awsConfigured,
        region: res.data.region || 'us-west-2',
      });
    } catch (err) {
      setServerStatus({ online: false, awsConfigured: false, region: 'us-west-2' });
    }
  };

  const fetchVoices = async () => {
    try {
      const res = await axios.get(`${SERVER_BASE}/voices`, { timeout: 3000 });
      if (res.data.success && res.data.voices && res.data.voices.length > 0) {
        setVoices(res.data.voices);
      }
    } catch (err) {
      // Fallback already in state
    }
  };

  const checkClips = async () => {
    try {
      const res = await axios.get(`${SERVER_BASE}/api/clip/latest`, { timeout: 2000 });
      if (res.data.success && res.data.clip) {
        setLatestClip(res.data.clip);
      }
    } catch (e) {}
  };

  // 2. Synthesize Speech
  const handleSynthesize = async () => {
    if (!text || text.trim().length === 0) return;

    setLoading(true);
    setErrorMessage('');
    setIsPlaying(false);

    try {
      const payload = {
        text,
        voiceId,
        engine,
        codeMode: codeMode !== 'off' ? codeMode : false,
      };

      const response = await axios.post(`${SERVER_BASE}/synthesize`, payload);
      
      if (response.data.success) {
        const newUrl = response.data.audioUrl;
        setAudioUrl(newUrl);

        // Add to history
        const newEntry = {
          id: Date.now(),
          text: text.slice(0, 120) + (text.length > 120 ? '...' : ''),
          audioUrl: newUrl,
          voiceId,
          engine,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        const updatedHistory = [newEntry, ...history.slice(0, 9)];
        setHistory(updatedHistory);
        localStorage.setItem('speechify_history', JSON.stringify(updatedHistory));

        // Auto play
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.playbackRate = speed;
            audioRef.current.play().catch(e => console.warn('Autoplay blocked:', e));
            setIsPlaying(true);
          }
        }, 200);
      }
    } catch (error) {
      console.error('Synthesize Error:', error);
      const msg = error.response?.data?.message || error.message || 'Failed to synthesize speech';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  // 3. Audio Controls
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = speed;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleSpeedChange = (newSpeed) => {
    setSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const skipTime = (seconds) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, duration));
    }
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // 4. Waveform Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const renderWave = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 48;
      const barWidth = canvas.width / bars - 2;
      const centerY = canvas.height / 2;

      for (let i = 0; i < bars; i++) {
        let barHeight = 4;
        if (isPlaying) {
          const t = Date.now() / 200 + i * 0.3;
          barHeight = 10 + Math.sin(t) * 16 + Math.cos(t * 1.5) * 10;
        } else {
          barHeight = 6 + Math.sin(i * 0.4) * 4;
        }

        const gradient = ctx.createLinearGradient(0, centerY - barHeight, 0, centerY + barHeight);
        gradient.addColorStop(0, '#818cf8');
        gradient.addColorStop(0.5, '#6366f1');
        gradient.addColorStop(1, '#a855f7');

        ctx.fillStyle = gradient;
        ctx.fillRect(i * (barWidth + 2), centerY - barHeight / 2, barWidth, barHeight);
      }

      animationFrameRef.current = requestAnimationFrame(renderWave);
    };

    renderWave();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying]);

  // 5. File Upload Handler
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      setText(content);
      if (isCodeContent(content) || file.name.match(/\.(js|ts|py|json|html|css|cpp|java)$/)) {
        setActiveTab('code');
        setCodeMode('natural');
      } else {
        setActiveTab('text');
      }
    };
    reader.readAsText(file);
  };

  // Word count & estimate
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.ceil(words / 2.5); // ~150 wpm

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">🎙️</div>
          <div>
            <h1 className="brand-title">
              MyVersionOfSpeechify Studio
              <span className="version-pill">v2.0 Neural</span>
            </h1>
            <p className="brand-subtitle">
              AWS Polly Neural AI Text-to-Speech & Smart Code Comprehension Engine
            </p>
          </div>
        </div>

        <div className="header-badges">
          <div className="status-pill">
            <span className={`status-indicator ${serverStatus.online ? 'online' : 'offline'}`} />
            <span>{serverStatus.online ? 'Server Port 5001' : 'Server Offline'}</span>
          </div>
          <div className="status-pill">
            <span className={`status-indicator ${serverStatus.awsConfigured ? 'online' : 'warning'}`} />
            <span>{serverStatus.awsConfigured ? 'AWS Polly Ready' : 'AWS SSO / Env Check'}</span>
          </div>
          <div className="status-pill">
            <span>🌐 {serverStatus.region}</span>
          </div>
        </div>
      </header>

      {/* Incoming Extension Clip Notification */}
      {latestClip && (
        <div className="code-mode-banner" style={{ borderLeft: '4px solid #10b981', marginBottom: 20 }}>
          <div className="code-mode-info">
            <span className="code-mode-title">🌐 Browser Extension Clip Received</span>
            <span className="code-mode-subtitle">"{latestClip.text.slice(0, 90)}..."</span>
          </div>
          <button
            className="preset-btn"
            style={{ background: '#10b981', color: '#fff', fontWeight: 600, padding: '6px 14px' }}
            onClick={() => {
              setText(latestClip.text);
              if (isCodeContent(latestClip.text)) {
                setActiveTab('code');
                setCodeMode('natural');
              }
              setLatestClip(null);
            }}
          >
            Load into Studio
          </button>
        </div>
      )}

      {/* Main Studio Grid */}
      <div className="studio-grid">
        <div className="main-panel">
          
          {/* Engine & Voice Studio Card */}
          <div className="glass-card">
            <div className="card-header">
              <span className="card-title">✨ Engine & Voice Studio</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {engine === 'neural' ? 'Neural AI Active (Highest Quality)' : 'Standard Engine'}
              </span>
            </div>

            {/* Engine Selector */}
            <div className="engine-grid">
              <div
                className={`engine-card ${engine === 'neural' ? 'active' : ''}`}
                onClick={() => setEngine('neural')}
              >
                <div className="engine-header">
                  <span className="engine-name">✨ Neural AI Engine</span>
                  <span className="engine-badge recommended">Recommended</span>
                </div>
                <p className="engine-desc">
                  Deep learning synthesis with realistic human cadence, natural breathing, and advanced code pronunciation.
                </p>
              </div>

              <div
                className={`engine-card ${engine === 'standard' ? 'active' : ''}`}
                onClick={() => setEngine('standard')}
              >
                <div className="engine-header">
                  <span className="engine-name">📻 Standard Engine</span>
                  <span className="engine-badge legacy">Legacy Concatenative</span>
                </div>
                <p className="engine-desc">
                  Classic Amazon Polly TTS engine. Compatible with legacy setups.
                </p>
              </div>
            </div>

            {/* Voice Cards Grid */}
            <div className="voices-wrapper">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                SELECT VOICE
              </label>
              <div className="voices-grid">
                {voices.slice(0, 10).map((v) => (
                  <div
                    key={v.id}
                    className={`voice-card ${voiceId === v.id ? 'selected' : ''}`}
                    onClick={() => setVoiceId(v.id)}
                  >
                    <div className="voice-avatar">
                      {v.gender === 'Female' ? '👩' : '👨'}
                    </div>
                    <div className="voice-info">
                      <span className="voice-name">{v.name}</span>
                      <span className="voice-meta">{v.languageName || v.language}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Smart Code Mode Control */}
            <div className="code-mode-banner">
              <div className="code-mode-info">
                <span className="code-mode-title">
                  💻 Smart Code Reader
                  <span style={{ fontSize: 10, background: '#6366f1', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>
                    Polly AI
                  </span>
                </span>
                <span className="code-mode-subtitle">
                  Understands programming syntax, camelCase, arrow functions, operators, and line structure.
                </span>
              </div>
              <div className="code-mode-toggles">
                <button
                  className={`mode-btn ${codeMode === 'natural' ? 'active' : ''}`}
                  onClick={() => setCodeMode('natural')}
                >
                  Natural Flow
                </button>
                <button
                  className={`mode-btn ${codeMode === 'detailed' ? 'active' : ''}`}
                  onClick={() => setCodeMode('detailed')}
                >
                  Detailed Syntax
                </button>
                <button
                  className={`mode-btn ${codeMode === 'off' ? 'active' : ''}`}
                  onClick={() => setCodeMode('off')}
                >
                  Off
                </button>
              </div>
            </div>

            {/* Audio Tuning (Speed & Prosody) */}
            <div className="audio-tuning-row">
              <div className="tuning-group">
                <div className="tuning-label">
                  <span>Playback Speed</span>
                  <span style={{ color: '#a5b4fc' }}>{speed}x</span>
                </div>
                <div className="speed-pills-row">
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((s) => (
                    <button
                      key={s}
                      className={`tuning-pill ${speed === s ? 'active' : ''}`}
                      onClick={() => handleSpeedChange(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Text & Code Input Station */}
          <div className="glass-card">
            <div className="tabs-container">
              <button
                className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTab('text')}
              >
                📝 Text & Articles
              </button>
              <button
                className={`tab-btn ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('code');
                  setCodeMode('natural');
                  if (text === TEXT_SAMPLE) setText(CODE_SAMPLE);
                }}
              >
                💻 Code Studio
              </button>
              <button
                className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('upload')}
              >
                📁 Upload Document / Code File
              </button>
            </div>

            {/* Active Tab View */}
            {activeTab === 'upload' ? (
              <label className="file-dropzone">
                <input
                  type="file"
                  accept=".txt,.md,.js,.ts,.py,.json,.html,.css"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <div className="dropzone-icon">📁</div>
                <div className="dropzone-title">Click or Drag & Drop a File Here</div>
                <div className="dropzone-subtitle">
                  Supports .txt, .md, .js, .ts, .py, .json, and code files (up to 5MB)
                </div>
              </label>
            ) : (
              <div className="input-wrapper">
                <textarea
                  className={`main-textarea ${activeTab === 'code' ? 'code-font' : ''}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    activeTab === 'code'
                      ? 'Paste your programming code here. Smart Code Reader will pronounce operators, identifiers & structure naturally...'
                      : 'Paste articles, books, essays, or notes here for high-fidelity speech synthesis...'
                  }
                />
              </div>
            )}

            {/* Spoken Code Preview if in Code Mode */}
            {codeMode !== 'off' && spokenPreview && (
              <div className="spoken-preview-box">
                <div className="spoken-preview-header">
                  <span>🔊 How Polly Neural AI Will Read This Code:</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Smart Code Comprehension</span>
                </div>
                <div className="spoken-preview-content">
                  "{spokenPreview}"
                </div>
              </div>
            )}

            {/* Footer presets & stats */}
            <div className="input-footer">
              <div className="preset-buttons">
                <span style={{ marginRight: 6 }}>Samples:</span>
                <button
                  className="preset-btn"
                  onClick={() => {
                    setText(TEXT_SAMPLE);
                    setActiveTab('text');
                    setCodeMode('off');
                  }}
                >
                  Neural AI Intro
                </button>
                <button
                  className="preset-btn"
                  onClick={() => {
                    setText(CODE_SAMPLE);
                    setActiveTab('code');
                    setCodeMode('natural');
                  }}
                >
                  JavaScript Async Code
                </button>
                <button
                  className="preset-btn"
                  onClick={() => setText('')}
                >
                  Clear
                </button>
              </div>

              <div>
                <span>{text.length} chars</span> • <span>{words} words</span> • <span>~{estimatedSeconds}s audio</span>
              </div>
            </div>
          </div>

          {/* Synthesize Action Button */}
          <button
            className="synthesize-cta"
            disabled={loading || !text.trim()}
            onClick={handleSynthesize}
          >
            {loading ? (
              <>
                <span className="pulse-dot" />
                <span>Synthesizing with AWS Polly Neural AI...</span>
              </>
            ) : (
              <>
                <span>🎙️</span>
                <span>Generate Neural Speech</span>
              </>
            )}
          </button>

          {/* Error Message Card if any */}
          {errorMessage && (
            <div className="alert-card">
              <div className="alert-title">⚠️ Synthesis Notice</div>
              <div>{errorMessage}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#fecaca' }}>
                <strong>How to activate AWS:</strong> Run <code>aws sso login</code>, or set credentials in <code>.env</code> or environment variables.
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  className="preset-btn"
                  style={{ background: '#6366f1', color: '#fff', fontWeight: 600, padding: '6px 12px' }}
                  onClick={async () => {
                    try {
                      setLoading(true);
                      const res = await axios.post(`${SERVER_BASE}/synthesize`, {
                        text,
                        voiceId,
                        engine,
                        codeMode: codeMode !== 'off' ? codeMode : false,
                        demoFallback: true,
                      });
                      if (res.data.success) {
                        setAudioUrl(res.data.audioUrl);
                        setErrorMessage('');
                        setTimeout(() => {
                          if (audioRef.current) {
                            audioRef.current.playbackRate = speed;
                            audioRef.current.play();
                            setIsPlaying(true);
                          }
                        }, 200);
                      }
                    } catch (e) {
                      setErrorMessage('Demo audio fallback unavailable.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  ▶ Test Studio UI with Demo Audio
                </button>
              </div>
            </div>
          )}

          {/* Audio Player Studio */}
          {audioUrl && (
            <div className="player-studio">
              <div className="player-header">
                <div className="player-title">
                  <span className="pulse-dot" />
                  <div>
                    <h3>{voiceId} - {engine.toUpperCase()} Speech</h3>
                    <span>Speechify Studio Audio Output</span>
                  </div>
                </div>
                <div className="action-buttons">
                  <a
                    href={audioUrl}
                    download={`speechify-${voiceId}-${Date.now()}.mp3`}
                    className="icon-action-btn download"
                  >
                    ⬇ Download MP3
                  </a>
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(audioUrl);
                      alert('Audio URL copied to clipboard!');
                    }}
                  >
                    🔗 Copy Link
                  </button>
                </div>
              </div>

              {/* Dynamic Waveform Visualizer */}
              <div className="waveform-container">
                <canvas ref={canvasRef} className="waveform-canvas" width={800} height={64} />
              </div>

              {/* Hidden native audio element */}
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
              />

              {/* Playback Controls */}
              <div className="player-controls">
                <div className="primary-playback">
                  <button className="skip-btn" onClick={() => skipTime(-5)} title="Rewind 5 seconds">
                    ⏪ -5s
                  </button>
                  <button className="play-pause-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <button className="skip-btn" onClick={() => skipTime(5)} title="Fast forward 5 seconds">
                    +5s ⏩
                  </button>
                </div>

                <div className="timeline-section">
                  <span className="time-display">{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    className="timeline-slider"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                  />
                  <span className="time-display">{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="sidebar-panel">
          
          {/* Generation History */}
          <div className="history-card">
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🕒</span> Recent Syntheses
            </h3>
            {history.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No previous speech generated yet in this session.</p>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="history-item"
                    onClick={() => {
                      setAudioUrl(item.audioUrl);
                      setVoiceId(item.voiceId);
                      setEngine(item.engine);
                      setTimeout(() => {
                        if (audioRef.current) {
                          audioRef.current.playbackRate = speed;
                          audioRef.current.play();
                          setIsPlaying(true);
                        }
                      }, 200);
                    }}
                  >
                    <div>
                      <div className="history-text">{item.text}</div>
                      <div className="history-meta">{item.voiceId} • {item.engine} • {item.time}</div>
                    </div>
                    <span style={{ fontSize: 14 }}>▶</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chrome Extension Info */}
          <div className="integration-card">
            <div className="integration-header">
              <span>🧩 Chrome Extension</span>
            </div>
            <p className="integration-desc">
              Select text or code on any website, right click, and select <strong>"Read with Speechify (Neural AI)"</strong>!
            </p>
            <div className="code-badge">
              chrome://extensions → Load unpacked → chrome-extension/
            </div>
          </div>

          {/* macOS Shortcut Info */}
          <div className="integration-card">
            <div className="integration-header">
              <span>🍎 macOS Quick Action</span>
            </div>
            <p className="integration-desc">
              Listen to your macOS clipboard directly through your Mac speakers:
            </p>
            <div className="code-badge">
              pbpaste | ./speechify-clip.sh
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}

export default App;
