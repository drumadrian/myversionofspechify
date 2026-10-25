// Background Service Worker for MyVersionOfSpeechify Chrome Extension (Manifest V3)

const SERVER_URL = 'http://localhost:5001';
const WEBAPP_URL = 'http://localhost:3000';

// Register Context Menus on Installation
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: 'speechify-read-selection',
    title: '🔊 Read selection with Speechify (Neural AI)',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'speechify-read-code',
    title: '💻 Read selection as Code (Smart Code Reader)',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'speechify-open-webapp',
    title: '🚀 Send to Speechify Web App',
    contexts: ['selection'],
  });

  // Set default settings
  const existing = await chrome.storage.local.get(['voiceId', 'engine', 'speed']);
  if (!existing.voiceId) {
    await chrome.storage.local.set({
      voiceId: 'Joanna',
      engine: 'neural',
      speed: '1.0',
    });
  }
});

// Handle Context Menu item clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  if (!selectedText || !tab || !tab.id) return;

  const settings = await chrome.storage.local.get(['voiceId', 'engine', 'speed']);
  const voiceId = settings.voiceId || 'Joanna';
  const engine = settings.engine || 'neural';

  if (info.menuItemId === 'speechify-open-webapp') {
    // Also send clip to server queue
    try {
      await fetch(`${SERVER_URL}/api/clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedText,
          title: tab.title || 'Selected Text',
          source: tab.url,
        }),
      });
    } catch (e) {
      console.warn('Could not post to clip queue:', e.message);
    }

    // Open web app with preloaded text query
    const targetUrl = `${WEBAPP_URL}/?text=${encodeURIComponent(selectedText)}`;
    await chrome.tabs.create({ url: targetUrl });
    return;
  }

  const isCodeMode = (info.menuItemId === 'speechify-read-code');
  const canInjectScript = tab.url && 
    !tab.url.startsWith('chrome://') && 
    !tab.url.startsWith('chrome-extension://') && 
    !tab.url.startsWith('edge://') && 
    !tab.url.startsWith('devtools://') && 
    !tab.url.startsWith('about:') && 
    !tab.url.includes('chromewebstore.google.com');

  // Provide immediate visual feedback in the active tab if allowed
  if (canInjectScript) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showInPageToast,
        args: ['🎙️ Converting to Speechify Neural Audio...', 'info'],
      });
    } catch (err) {
      // Silently ignore injection restrictions
    }
  }

  // Set loading badge
  await chrome.action.setBadgeText({ text: '⏳' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

  try {
    // Send to MyVersionOfSpeechify backend
    const response = await fetch(`${SERVER_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: selectedText,
        voiceId,
        engine,
        codeMode: isCodeMode ? 'natural' : false,
      }),
    });

    const data = await response.json();

    if (!data.success || !data.audioUrl) {
      throw new Error(data.message || 'Failed to synthesize speech');
    }

    // Save clip to local storage
    const { history = [] } = await chrome.storage.local.get('history');
    const newEntry = {
      id: Date.now().toString(),
      text: selectedText.slice(0, 150),
      audioUrl: data.audioUrl,
      timestamp: new Date().toLocaleTimeString(),
      engine: data.engine,
      voiceId: data.voiceId,
    };
    await chrome.storage.local.set({
      history: [newEntry, ...history.slice(0, 9)],
      lastAudioUrl: data.audioUrl,
    });

    // Notify tab and play audio if allowed on this page
    if (canInjectScript) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: playAudioInPage,
        args: [data.audioUrl, voiceId, engine],
      });
    }

    await chrome.action.setBadgeText({ text: '▶' });
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

  } catch (error) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

    if (canInjectScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showInPageToast,
          args: [`❌ Speechify: ${error.message}`, 'error'],
        });
      } catch (e) {
        // Silently ignore
      }
    }
  }
});

// Helper function injected into tab to play audio with floating player widget
function playAudioInPage(audioUrl, voiceId, engine) {
  // Remove existing widget if any
  const existing = document.getElementById('speechify-floating-widget');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'speechify-floating-widget';
  container.style.position = 'fixed';
  container.style.bottom = '24px';
  container.style.right = '24px';
  container.style.zIndex = '2147483647';
  container.style.backgroundColor = '#111827';
  container.style.color = '#ffffff';
  container.style.borderRadius = '14px';
  container.style.padding = '14px 18px';
  container.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)';
  container.style.border = '1px solid rgba(99, 102, 241, 0.4)';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '12px';
  container.style.backdropFilter = 'blur(12px)';
  container.style.transition = 'all 0.3s ease';

  container.innerHTML = `
    <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #a855f7); display: flex; align-items: center; justify-content: center; font-size: 16px;">
      🔊
    </div>
    <div style="display: flex; flex-direction: column;">
      <span style="font-weight: 600; font-size: 13px; color: #f3f4f6;">MyVersionOfSpeechify</span>
      <span style="font-size: 11px; color: #9ca3af;">${voiceId} (${engine.toUpperCase()})</span>
    </div>
    <audio id="speechify-widget-audio" controls autoplay src="${audioUrl}" style="height: 32px; max-width: 220px; outline: none;"></audio>
    <button id="speechify-widget-close" style="background: transparent; border: none; color: #9ca3af; font-size: 16px; cursor: pointer; padding: 4px;">✕</button>
  `;

  document.body.appendChild(container);

  const closeBtn = document.getElementById('speechify-widget-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      const audio = document.getElementById('speechify-widget-audio');
      if (audio) audio.pause();
      container.remove();
    };
  }

  // Auto remove after finished
  const audioEl = document.getElementById('speechify-widget-audio');
  if (audioEl) {
    audioEl.onended = () => {
      setTimeout(() => container.remove(), 4000);
    };
  }
}

// In-page feedback toast function
function showInPageToast(message, type) {
  const existing = document.getElementById('speechify-inpage-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'speechify-inpage-toast';
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '2147483647';
  toast.style.backgroundColor = type === 'error' ? '#7f1d1d' : '#1e1b4b';
  toast.style.color = '#ffffff';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '10px';
  toast.style.border = type === 'error' ? '1px solid #ef4444' : '1px solid #818cf8';
  toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  toast.style.fontSize = '13px';
  toast.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.4)';
  toast.textContent = message;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
