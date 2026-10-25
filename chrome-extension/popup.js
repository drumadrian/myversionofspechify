// Popup Script for MyVersionOfSpeechify Chrome Extension

const SERVER_URL = 'http://localhost:5001';
const WEBAPP_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const serverStatusBadge = document.getElementById('server-status');
  const statusText = document.getElementById('status-text');
  const engineNeuralBtn = document.getElementById('engine-neural');
  const engineStandardBtn = document.getElementById('engine-standard');
  const voiceSelect = document.getElementById('voice-select');
  const codeModeCheck = document.getElementById('code-mode');
  const textInput = document.getElementById('text-input');
  const grabSelectionBtn = document.getElementById('grab-selection-btn');
  const synthesizeBtn = document.getElementById('synthesize-btn');
  const btnText = document.getElementById('btn-text');
  const playerContainer = document.getElementById('player-container');
  const playerVoice = document.getElementById('player-voice');
  const downloadLink = document.getElementById('download-link');
  const popupAudio = document.getElementById('popup-audio');
  const openAppBtn = document.getElementById('open-app-btn');
  const speedPills = document.querySelectorAll('.speed-pill');

  let currentEngine = 'neural';
  let currentSpeed = 1.0;

  // 1. Check Server Status
  try {
    const res = await fetch(`${SERVER_URL}/status`);
    if (res.ok) {
      const data = await res.json();
      serverStatusBadge.className = 'status-badge online';
      statusText.textContent = data.awsConfigured ? 'Polly Ready' : 'Server Online';
    } else {
      throw new Error();
    }
  } catch (e) {
    serverStatusBadge.className = 'status-badge offline';
    statusText.textContent = 'Server Offline';
  }

  // 2. Load Saved Preferences
  const stored = await chrome.storage.local.get(['voiceId', 'engine', 'speed', 'codeMode', 'lastText']);
  if (stored.engine) {
    currentEngine = stored.engine;
    updateEngineUI(currentEngine);
  }
  if (stored.voiceId) {
    voiceSelect.value = stored.voiceId;
  }
  if (stored.codeMode !== undefined) {
    codeModeCheck.checked = stored.codeMode;
  }
  if (stored.speed) {
    currentSpeed = parseFloat(stored.speed);
    updateSpeedUI(currentSpeed);
  }

  // 3. Try to Grab Selection from Active Tab (safely guarding against restricted chrome:// pages)
  async function grabSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && tab.url) {
        const isRestrictedUrl = 
          tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') || 
          tab.url.startsWith('edge://') || 
          tab.url.startsWith('devtools://') || 
          tab.url.startsWith('view-source:') || 
          tab.url.startsWith('about:') ||
          tab.url.includes('chromewebstore.google.com');

        if (!isRestrictedUrl) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection().toString(),
          });
          if (results && results[0] && results[0].result && results[0].result.trim()) {
            textInput.value = results[0].result.trim();
            return;
          }
        }
      }
    } catch (err) {
      // Silently fall back - do not console.warn as Chrome records warnings as extension errors
    }

    if (stored.lastText && !textInput.value) {
      textInput.value = stored.lastText;
    }
  }

  await grabSelection();
  grabSelectionBtn.addEventListener('click', grabSelection);

  // 4. Engine Toggle Listeners
  function updateEngineUI(engine) {
    currentEngine = engine;
    if (engine === 'neural') {
      engineNeuralBtn.classList.add('active');
      engineStandardBtn.classList.remove('active');
    } else {
      engineStandardBtn.classList.add('active');
      engineNeuralBtn.classList.remove('active');
    }
    chrome.storage.local.set({ engine });
  }

  engineNeuralBtn.addEventListener('click', () => updateEngineUI('neural'));
  engineStandardBtn.addEventListener('click', () => updateEngineUI('standard'));

  // 5. Voice Selector
  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ voiceId: voiceSelect.value });
  });

  // 6. Code Mode Checkbox
  codeModeCheck.addEventListener('change', () => {
    chrome.storage.local.set({ codeMode: codeModeCheck.checked });
  });

  // 7. Speed Controls
  function updateSpeedUI(speed) {
    currentSpeed = speed;
    speedPills.forEach(pill => {
      if (parseFloat(pill.dataset.speed) === speed) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
    if (popupAudio) {
      popupAudio.playbackRate = speed;
    }
    chrome.storage.local.set({ speed: String(speed) });
  }

  speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      updateSpeedUI(parseFloat(pill.dataset.speed));
    });
  });

  // 8. Synthesize Speech
  synthesizeBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
      alert('Please enter or select text to synthesize.');
      return;
    }

    synthesizeBtn.disabled = true;
    btnText.textContent = '⏳ Generating Neural Audio...';

    // Save text
    await chrome.storage.local.set({ lastText: text });

    try {
      const response = await fetch(`${SERVER_URL}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: voiceSelect.value,
          engine: currentEngine,
          codeMode: codeModeCheck.checked ? 'natural' : false,
        }),
      });

      const data = await response.json();

      if (!data.success || !data.audioUrl) {
        throw new Error(data.message || 'Synthesis failed');
      }

      // Display Player
      playerContainer.classList.remove('hidden');
      playerVoice.textContent = `${voiceSelect.value} (${data.engine.toUpperCase()})`;
      downloadLink.href = data.audioUrl;
      popupAudio.src = data.audioUrl;
      popupAudio.playbackRate = currentSpeed;
      popupAudio.play();

    } catch (err) {
      console.error(err);
      alert(`Synthesis Error: ${err.message}`);
    } finally {
      synthesizeBtn.disabled = false;
      btnText.textContent = '🎙️ Synthesize & Listen';
    }
  });

  // 9. Open Full App in Browser
  openAppBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    const query = text ? `?text=${encodeURIComponent(text)}` : '';
    await chrome.tabs.create({ url: `${WEBAPP_URL}/${query}` });
  });
});
