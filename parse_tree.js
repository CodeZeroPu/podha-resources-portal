const fs = require('fs');
const path = require('path');

const logPath = 'C:/Users/User/.gemini/antigravity/brain/561e7e48-e0f1-4a42-a84f-fad3831c5c88/.system_generated/tasks/task-39.log';
const raw = fs.readFileSync(logPath, 'utf8');

const lines = raw.split('\n');
console.log('Total lines:', lines.length);

// Analyze subjects and file types
const subjects = {
  'Physics': [],
  'Chemistry': [],
  'Biology': [],
  'Mathematics': [],
  'History & Civics': [],
  'Geography': [],
  'Computer Applications': [],
  'English Language & Literature': [],
  'Robotics & AI': [],
  'Hindi': [],
  'Physical Education': []
};

const fileTypes = {
  pdf: 0,
  mp4_video: 0,
  mp4_audio: 0,
  images: 0,
  docs: 0,
  xlsx: 0,
  folders: 0,
  other: 0
};

const topSections = {};
let currentTop = 'Root';

lines.forEach(line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.match(/├── (ALL BOOKS|BACKBENCHER|CURATED MATERIAL|TOP SCHOOLS|ULTIMATE DUMP)/)) {
    const match = trimmed.match(/├── (.*?)(?:\/|$)/);
    if (match) currentTop = match[1];
  }

  // Count extensions
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('.pdf')) fileTypes.pdf++;
  else if (lower.includes('video') && (lower.endsWith('.mp4') || lower.endsWith('.mkv'))) fileTypes.mp4_video++;
  else if (lower.includes('audio') && (lower.endsWith('.mp4') || lower.endsWith('.mp3'))) fileTypes.mp4_audio++;
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) fileTypes.images++;
  else if (lower.endsWith('.doc') || lower.endsWith('.docx')) fileTypes.docs++;
  else if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) fileTypes.xlsx++;
  else if (trimmed.endsWith('/')) fileTypes.folders++;
  else fileTypes.other++;
});

console.log('File Types Count:', fileTypes);
