// Icon generator script — run with Node.js to create PNG icons
// Or just create simple SVG-based icons for the extension

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const center = size / 2;
  const scale = size / 128;

  // Background circle
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#6366f1');
  gradient.addColorStop(1, '#8b5cf6');

  ctx.beginPath();
  ctx.arc(center, center, center * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Inner circle (target)
  ctx.beginPath();
  ctx.arc(center, center, center * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2 * scale;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(center, center, center * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Crosshair lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5 * scale;
  ctx.lineCap = 'round';

  // Top
  ctx.beginPath();
  ctx.moveTo(center, center * 0.15);
  ctx.lineTo(center, center * 0.4);
  ctx.stroke();

  // Bottom
  ctx.beginPath();
  ctx.moveTo(center, center * 1.6);
  ctx.lineTo(center, center * 1.85);
  ctx.stroke();

  // Left
  ctx.beginPath();
  ctx.moveTo(center * 0.15, center);
  ctx.lineTo(center * 0.4, center);
  ctx.stroke();

  // Right
  ctx.beginPath();
  ctx.moveTo(center * 1.6, center);
  ctx.lineTo(center * 1.85, center);
  ctx.stroke();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buffer);
  console.log(`Created icon${size}.png`);
});

console.log('All icons generated!');
