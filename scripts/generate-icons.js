const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create a valid RGBA PNG using Node's built-in zlib
function createPng(width, height, drawPixel) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color type
  ihdrData.writeUInt8(0, 10); // Deflate compression
  ihdrData.writeUInt8(0, 11); // Filter method
  ihdrData.writeUInt8(0, 12); // No interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw image data with scanline filter 0
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData.writeUInt8(0, offset++); // Filter byte for scanline
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      rawData.writeUInt8(r, offset++);
      rawData.writeUInt8(g, offset++);
      rawData.writeUInt8(b, offset++);
      rawData.writeUInt8(a, offset++);
    }
  }

  // Compress raw image data with zlib
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcInput);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

// Standard CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Generate icons for extension
const iconsDir = path.join(__dirname, '..', 'chrome-extension', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Draw a modern purple/indigo gradient with audio wave bars
function drawSpeechifyIcon(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 1;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

  // Rounded squircle background
  const cornerR = w * 0.22;
  const inBox = (x >= cornerR && x <= w - cornerR) || (y >= cornerR && y <= h - cornerR) ||
    (Math.sqrt((x - cornerR) ** 2 + (y - cornerR) ** 2) <= cornerR && x < cornerR && y < cornerR) ||
    (Math.sqrt((x - (w - cornerR)) ** 2 + (y - cornerR) ** 2) <= cornerR && x > w - cornerR && y < cornerR) ||
    (Math.sqrt((x - cornerR) ** 2 + (y - (h - cornerR)) ** 2) <= cornerR && x < cornerR && y > h - cornerR) ||
    (Math.sqrt((x - (w - cornerR)) ** 2 + (y - (h - cornerR)) ** 2) <= cornerR && x > w - cornerR && y > h - cornerR);

  if (!inBox) {
    return [0, 0, 0, 0]; // Transparent
  }

  // Gradient background: deep violet to electric indigo (#4f46e5 to #7c3aed)
  const gradT = (x + y) / (w + h);
  let bgR = Math.round(79 + (124 - 79) * gradT);
  let bgG = Math.round(70 + (58 - 70) * gradT);
  let bgB = Math.round(229 + (237 - 229) * gradT);

  // Soundwave bars in center
  const numBars = 5;
  const barWidth = Math.max(1, Math.floor(w * 0.08));
  const barGap = Math.max(1, Math.floor(w * 0.06));
  const totalWidth = numBars * barWidth + (numBars - 1) * barGap;
  const startX = cx - totalWidth / 2;

  const barHeights = [0.35, 0.65, 0.9, 0.55, 0.4];

  for (let i = 0; i < numBars; i++) {
    const bx = startX + i * (barWidth + barGap);
    const bh = barHeights[i] * (h * 0.6);
    const by1 = cy - bh / 2;
    const by2 = cy + bh / 2;

    if (x >= bx && x < bx + barWidth && y >= by1 && y <= by2) {
      return [255, 255, 255, 255]; // Crisp white sound bar
    }
  }

  return [bgR, bgG, bgB, 255];
}

[16, 48, 128].forEach(size => {
  const png = createPng(size, size, drawSpeechifyIcon);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${size}x${size}, ${png.length} bytes)`);
});
