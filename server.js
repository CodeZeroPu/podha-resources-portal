/**
 * ICSE PoDha Study Portal - Live API & Web Server
 * 
 * Provides:
 *  - GET /api/files          : Live flattened list of all files uploaded via Telegram bot
 *  - GET /api/stream/:fileId : Secure streaming proxy for Telegram PDFs with CORS & Range support
 *  - GET /api/resolve/:fileId: Resolves Telegram file path & metadata with caching
 *  - GET /api/catalog        : Live hierarchical catalog from catalog.json
 *  - GET /api/stats          : Summary statistics (total files, folders, subjects)
 *  - POST /api/files         : Ingest new files uploaded via Telegram bot in real-time
 *  - Static file serving     : index.html, verify.html, catalog.json, etc.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://podha-resources-portal.onrender.com';
const CATALOG_PATH = path.join(__dirname, 'catalog.json');

// ShrinkMe API Token & Verification Monetization Configuration
const SHRINKME_API_TOKEN = process.env.SHRINKME_API_TOKEN || 'c8f30ce164d6413957b60caf4e84e7844d260d3c';
const VERIFICATION_RETURN_URL = `${BASE_URL}/verify.html?verified=true`;
const SHRINKME_API_GENERATOR_URL = `https://shrinkme.io/api?api=${SHRINKME_API_TOKEN}&url=${encodeURIComponent(VERIFICATION_RETURN_URL)}`;

// Telegram Bot Configuration (Kept secure on backend, never exposed to client)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9084126620:AAFJDD7pBQTvCzJMJ2zUAKZO596Qn-ce0lE';
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1003771095032';

// In-Memory Cache for Telegram File Paths (TTL: 50 minutes to stay fresh before Telegram's 1h expiry)
const filePathCache = new Map();
const CACHE_TTL_MS = 50 * 60 * 1000;

/**
 * Resolves Telegram file_path by file_id with caching
 */
function resolveTelegramFilePath(fileId) {
  return new Promise((resolve, reject) => {
    // Check cache
    const cached = filePathCache.get(fileId);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.isTooLarge) {
        const err = new Error('File exceeds 20MB Bot API limit. Please open directly in Telegram.');
        err.code = 'FILE_TOO_LARGE';
        err.fileId = fileId;
        err.fileSize = cached.fileSize;
        return reject(err);
      }
      return resolve(cached.filePath);
    }

    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok && json.result && json.result.file_path) {
            const filePath = json.result.file_path;
            const fileSize = json.result.file_size;

            // Enforce 20MB threshold (20,000,000 bytes)
            if (fileSize && fileSize > 20000000) {
              filePathCache.set(fileId, {
                isTooLarge: true,
                fileSize,
                expiresAt: Date.now() + CACHE_TTL_MS
              });
              const err = new Error('File exceeds 20MB Bot API limit. Please open directly in Telegram.');
              err.code = 'FILE_TOO_LARGE';
              err.fileId = fileId;
              err.fileSize = fileSize;
              return reject(err);
            }

            filePathCache.set(fileId, {
              filePath,
              fileSize,
              isTooLarge: false,
              expiresAt: Date.now() + CACHE_TTL_MS
            });
            resolve(filePath);
          } else {
            const description = json.description || '';
            // Check if Telegram reported file is too big (400 Bad Request: file is too big)
            if (description.toLowerCase().includes('file is too big') || (json.error_code === 400 && description.includes('too big'))) {
              filePathCache.set(fileId, {
                isTooLarge: true,
                expiresAt: Date.now() + CACHE_TTL_MS
              });
              const err = new Error('File exceeds 20MB Bot API limit. Please open directly in Telegram.');
              err.code = 'FILE_TOO_LARGE';
              err.fileId = fileId;
              return reject(err);
            }
            reject(new Error(description || 'Telegram Bot API rejected getFile request'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Telegram API response: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Telegram API connection error: ${err.message}`));
    });
  });
}

/**
 * Streams binary PDF from Telegram CDN to client with CORS, Range support, and inline disposition
 */
function streamTelegramFile(filePath, clientReq, clientRes) {
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  
  const headers = {};
  if (clientReq.headers.range) {
    headers['range'] = clientReq.headers.range;
  }

  const tgReq = https.get(fileUrl, { headers }, (tgRes) => {
    // Handle HTTP Redirects if any
    if (tgRes.statusCode >= 300 && tgRes.statusCode < 400 && tgRes.headers.location) {
      https.get(tgRes.headers.location, { headers }, (redirectRes) => {
        pipeTelegramResponse(redirectRes, clientRes);
      }).on('error', (err) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ error: 'Failed to stream from redirect', details: err.message }));
        }
      });
      return;
    }

    pipeTelegramResponse(tgRes, clientRes);
  });

  tgReq.on('error', (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'Failed to connect to Telegram CDN', details: err.message }));
    }
  });

  clientReq.on('close', () => {
    tgReq.destroy();
  });
}

function pipeTelegramResponse(tgRes, clientRes) {
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, Range, Content-Type, Accept',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="study-document.pdf"',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600'
  };

  if (tgRes.headers['content-range']) {
    responseHeaders['Content-Range'] = tgRes.headers['content-range'];
  }
  if (tgRes.headers['content-length']) {
    responseHeaders['Content-Length'] = tgRes.headers['content-length'];
  }

  clientRes.writeHead(tgRes.statusCode, responseHeaders);
  tgRes.pipe(clientRes);
}

// Helper to flatten nested folder catalog into an array of file records
function flattenCatalog(obj, currentPath = '') {
  let files = [];
  if (!obj || typeof obj !== 'object') return files;

  for (const key of Object.keys(obj)) {
    if (key === 'files' && Array.isArray(obj[key])) {
      const cleanFolder = currentPath.replace(/^ICSE PoDha STUDY MATERIALS\s*[\/\\]?/, '').trim() || 'General';
      for (const item of obj[key]) {
        if (!item || !item.fileId) continue;
        
        let subject = 'General';
        const folderLower = cleanFolder.toLowerCase();
        if (folderLower.includes('physics') || folderLower.includes('phy')) subject = 'Physics';
        else if (folderLower.includes('chemistry') || folderLower.includes('chem')) subject = 'Chemistry';
        else if (folderLower.includes('biology') || folderLower.includes('bio')) subject = 'Biology';
        else if (folderLower.includes('math')) subject = 'Mathematics';
        else if (folderLower.includes('comp') || folderLower.includes('java')) subject = 'Computer Applications';
        else if (folderLower.includes('geo')) subject = 'Geography';
        else if (folderLower.includes('history') || folderLower.includes('civics')) subject = 'History & Civics';
        else if (folderLower.includes('english') || folderLower.includes('ep1') || folderLower.includes('ep2')) subject = 'English';
        else if (folderLower.includes('robotics') || folderLower.includes('rai')) subject = 'Robotics & AI';
        else if (folderLower.includes('top school') || folderLower.includes('prelim')) subject = 'Top Schools Prelims';
        else if (folderLower.includes('all books') || folderLower.includes('arihant') || folderLower.includes('oswaal') || folderLower.includes('educart')) subject = 'All Books';

        files.push({
          id: item.fileId,
          fileId: item.fileId,
          name: item.title || 'Untitled Document',
          folder: cleanFolder,
          subject: subject,
          description: `${item.title || 'Document'} in ${cleanFolder}`,
          date: item.date || '2026-11',
          isLargeFile: item.isLargeFile || false,
          fallbackUrl: item.fallbackUrl || null,
          fileSize: item.fileSize || item.size || null
        });
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      const nextPath = currentPath ? `${currentPath} / ${key}` : key;
      files = files.concat(flattenCatalog(obj[key], nextPath));
    }
  }
  return files;
}

// Read current catalog from disk
function readCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return {};
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading catalog.json:', err.message);
    return {};
  }
}

// Helper to look up a specific file record in the catalog hierarchy by fileId
function findInCatalog(fileId) {
  const catalog = readCatalog();
  function search(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj.files)) {
      for (const item of obj.files) {
        if (item && item.fileId === fileId) {
          return item;
        }
      }
    }
    for (const key of Object.keys(obj)) {
      if (key !== 'files') {
        const found = search(obj[key]);
        if (found) return found;
      }
    }
    return null;
  }
  return search(catalog);
}

// Append or update a file in the catalog
function insertFileIntoCatalog(fileRecord) {
  const catalog = readCatalog();
  const folderPath = fileRecord.folder || 'General';
  const parts = folderPath.split(/[\/\\]/).map(p => p.trim()).filter(Boolean);

  let curr = catalog;
  for (const part of parts) {
    if (!curr[part] || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }

  if (!Array.isArray(curr.files)) {
    curr.files = [];
  }

  const fileData = {
    title: fileRecord.title || fileRecord.name,
    fileId: fileRecord.fileId
  };
  if (fileRecord.isLargeFile) fileData.isLargeFile = fileRecord.isLargeFile;
  if (fileRecord.fallbackUrl) fileData.fallbackUrl = fileRecord.fallbackUrl;
  if (fileRecord.fileSize) fileData.fileSize = fileRecord.fileSize;

  const existingIdx = curr.files.findIndex(f => f.fileId === fileRecord.fileId);
  if (existingIdx >= 0) {
    curr.files[existingIdx] = Object.assign(curr.files[existingIdx], fileData);
  } else {
    curr.files.push(fileData);
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  return true;
}

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, req.headers.host ? `http://${req.headers.host}` : BASE_URL);
  const pathname = reqUrl.pathname;

  // Global CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API: GET /api/stream/:fileId (Live Telegram PDF Proxy) ---
  if (pathname.startsWith('/api/stream') && req.method === 'GET') {
    let fileId = reqUrl.searchParams.get('fileId');
    if (!fileId && pathname.startsWith('/api/stream/')) {
      fileId = decodeURIComponent(pathname.replace('/api/stream/', '').trim());
    }

    if (!fileId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing fileId parameter' }));
      return;
    }

    // Direct redirect if catalog item has an Internet Archive fallback mirror URL
    const catalogItemStream = findInCatalog(fileId);
    if (catalogItemStream && catalogItemStream.isLargeFile && catalogItemStream.fallbackUrl) {
      res.writeHead(302, {
        'Location': catalogItemStream.fallbackUrl,
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }

    resolveTelegramFilePath(fileId)
      .then(filePath => {
        streamTelegramFile(filePath, req, res);
      })
      .catch(err => {
        console.error(`Streaming error for fileId [${fileId}]:`, err.message);
        if (!res.headersSent) {
          // Detect FILE_TOO_LARGE and return HTTP 413 with actionable JSON
          if (err.code === 'FILE_TOO_LARGE') {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'FILE_TOO_LARGE',
              message: 'File exceeds 20MB Telegram Bot API streaming limit. Open directly in Telegram for instant access (supports up to 2 GB).',
              fileId: fileId,
              fileSize: err.fileSize || null,
              telegramLink: 'https://t.me/c/3771095032'
            }));
          } else {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'Failed to resolve file from Telegram Bot API',
              details: err.message,
              fileId: fileId
            }));
          }
        }
      });
    return;
  }

  // --- API: GET /api/resolve/:fileId (Metadata & Path Resolver) ---
  if (pathname.startsWith('/api/resolve') && req.method === 'GET') {
    let fileId = reqUrl.searchParams.get('fileId');
    if (!fileId && pathname.startsWith('/api/resolve/')) {
      fileId = decodeURIComponent(pathname.replace('/api/resolve/', '').trim());
    }

    if (!fileId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing fileId parameter' }));
      return;
    }

    const catalogItem = findInCatalog(fileId);
    if (catalogItem && catalogItem.isLargeFile && catalogItem.fallbackUrl) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        isLargeFile: true,
        streamUrl: catalogItem.fallbackUrl // Direct 24/7 Internet Archive public link
      }));
      return;
    }

    resolveTelegramFilePath(fileId)
      .then(filePath => {
        const cached = filePathCache.get(fileId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          fileId,
          filePath,
          fileSize: cached ? cached.fileSize : null,
          streamUrl: `/api/stream/${encodeURIComponent(fileId)}`
        }));
      })
      .catch(err => {
        if (err.code === 'FILE_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: 'FILE_TOO_LARGE',
            message: 'File exceeds 20MB Bot API limit. Open directly in Telegram.',
            fileId,
            fileSize: err.fileSize || null,
            telegramLink: 'https://t.me/c/3771095032'
          }));
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message, fileId }));
        }
      });
    return;
  }

  // --- API: GET /api/files ---
  if (pathname === '/api/files' && req.method === 'GET') {
    const catalog = readCatalog();
    const files = flattenCatalog(catalog);
    
    // Server-side search filter support
    const query = (reqUrl.searchParams.get('q') || '').toLowerCase().trim();
    let result = files;
    if (query) {
      const keywords = query.split(/\s+/);
      result = files.filter(f => {
        const fn = (f.name || '').toLowerCase();
        const fo = (f.folder || '').toLowerCase();
        const fd = (f.description || '').toLowerCase();
        return keywords.every(kw => fn.includes(kw) || fo.includes(kw) || fd.includes(kw));
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // --- API: GET /api/catalog ---
  if (pathname === '/api/catalog' && req.method === 'GET') {
    const catalog = readCatalog();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(catalog));
    return;
  }

  // --- API: GET /api/stats ---
  if (pathname === '/api/stats' && req.method === 'GET') {
    const catalog = readCatalog();
    const files = flattenCatalog(catalog);
    const subjects = new Set(files.map(f => f.subject));
    const folders = new Set(files.map(f => f.folder));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      totalFiles: files.length,
      totalFolders: folders.size,
      totalSubjects: subjects.size,
      subjects: Array.from(subjects)
    }));
    return;
  }

  // --- API: GET /api/shorten-url (ShrinkMe API Link Generator & Info) ---
  if (pathname === '/api/shorten-url' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      productionBaseUrl: BASE_URL,
      verificationReturnUrl: VERIFICATION_RETURN_URL,
      apiGeneratorUrl: SHRINKME_API_GENERATOR_URL,
      shortenedUrl: 'https://shrinkme.click/FuvOTfD'
    }));
    return;
  }

  // --- API: POST /api/files (Ingest from Telegram Bot) ---
  if (pathname === '/api/files' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.fileId || (!data.title && !data.name)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields: fileId and title/name' }));
          return;
        }

        insertFileIntoCatalog(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'File cataloged successfully' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 ICSE PoDha Live Portal Server running at: ${BASE_URL} (port ${PORT})`);
    console.log(`📡 Live API Files      : ${BASE_URL}/api/files`);
    console.log(`⚡ Secure Stream Proxy : ${BASE_URL}/api/stream/:fileId`);
    console.log(`📊 Catalog Statistics  : ${BASE_URL}/api/stats`);
    console.log(`======================================================\n`);
  });
}

module.exports = { server, flattenCatalog, readCatalog, findInCatalog, resolveTelegramFilePath, BASE_URL, SHRINKME_API_TOKEN, VERIFICATION_RETURN_URL, SHRINKME_API_GENERATOR_URL };