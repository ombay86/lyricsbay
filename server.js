const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// --- Helper Functions for Data Access ---
function readJSON(file, fallback = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
  return fallback;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    if (file === SETTINGS_FILE) {
      fs.writeFileSync(path.join(PUBLIC_DIR, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
  }
}

// Password Hashing
function verifyPassword(password, salt, hash) {
  const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return testHash === hash;
}

// Active Sessions Store: token -> user
const activeSessions = new Map();

// Helper: Multi-tenant ownership check
// Legacy or untagged items default to 'gms'
// 'gms' and 'gmsco' are treated as aliases for the GMS tenant
function canAccess(item, user) {
  if (!user || !user.username) return false;
  const currentUsername = (user.username || '').toLowerCase().trim();
  const itemOwner = (item.username || item.userId || 'gms').toLowerCase().trim();

  if (itemOwner === currentUsername) return true;

  // GMS tenant alias
  const isGmsUser = currentUsername === 'gms' || currentUsername === 'gmsco';
  const isGmsItem = itemOwner === 'gms' || itemOwner === 'gmsco';
  if (isGmsUser && isGmsItem) return true;

  return false;
}

// Default Visual Settings
const defaultSettings = {
  fontFamily: 'Montserrat',
  activeFontSize: 46,
  inactiveOpacity: 35,
  activeColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2.2,
  glowEnabled: true,
  glowColor: '#00d2ff',
  verticalPosition: 50
};

// Initial state song
const initialSongs = readJSON(SONGS_FILE, []);
const initialSong = initialSongs.find(s => s.id === 'song_1') || initialSongs[0] || null;

// Global Application Live State
let appState = {
  currentSongIndex: 0,
  currentSongId: initialSong ? initialSong.id : 'song_1',
  currentLineIndex: 0,
  isBlank: false,
  activePlaylistId: 'pl_1',
  currentSong: initialSong,
  settings: { ...defaultSettings, ...readJSON(SETTINGS_FILE, defaultSettings) },
  timestamp: Date.now()
};

// Connected SSE clients for live synchronization
const sseClients = new Set();

function broadcastState() {
  const payload = `data: ${JSON.stringify(appState)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Middleware: Authenticate Token from Bearer or Header
function getSessionUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return activeSessions.get(token) || null;
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // -------------------------------------------------------------
  // SSE ENDPOINT (REALTIME BROADCAST)
  // -------------------------------------------------------------
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(appState)}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // -------------------------------------------------------------
  // AUTHENTICATION APIS
  // -------------------------------------------------------------
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await parseBody(req);
      const users = readJSON(USERS_FILE, []);
      const user = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());

      // 1. Check local users
      if (user && verifyPassword(password, user.salt, user.hash)) {
        const token = crypto.randomBytes(32).toString('hex');
        const sessionUser = {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role
        };
        activeSessions.set(token, sessionUser);
        return sendJSON(res, 200, {
          success: true,
          token,
          user: sessionUser
        });
      }

      // 2. Fallback: Authenticate against Jurnal Ombay Central Database
      try {
        const ssoHubUrl = process.env.SSO_HUB_URL || 'https://jurnalombay.my.id';
        const loginUrl = new URL('/sso/login', ssoHubUrl);
        const postData = JSON.stringify({ identifier: username, password });
        const client = loginUrl.protocol === 'https:' ? require('node:https') : require('node:http');

        const ssoReq = client.request(loginUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (ssoRes) => {
          let body = '';
          ssoRes.on('data', chunk => body += chunk);
          ssoRes.on('end', () => {
            try {
              const result = JSON.parse(body);
              if (result.success && result.user) {
                const token = crypto.randomBytes(32).toString('hex');
                const sessionUser = {
                  id: result.user.id,
                  username: result.user.username,
                  name: result.user.fullName || result.user.username,
                  role: result.user.role
                };
                activeSessions.set(token, sessionUser);
                return sendJSON(res, 200, { success: true, token, user: sessionUser });
              } else {
                return sendJSON(res, 401, { error: result.error || 'Username atau password salah!' });
              }
            } catch (e) {
              return sendJSON(res, 401, { error: 'Username atau password salah!' });
            }
          });
        });

        ssoReq.on('error', () => {
          return sendJSON(res, 401, { error: 'Username atau password salah!' });
        });

        ssoReq.write(postData);
        ssoReq.end();
        return;
      } catch (ssoErr) {
        return sendJSON(res, 401, { error: 'Username atau password salah!' });
      }
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getSessionUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
    }
    return sendJSON(res, 200, { user });
  }

  if (pathname === '/api/auth/sso-verify' && req.method === 'POST') {
    try {
      const { ssoToken } = await parseBody(req);
      if (!ssoToken) return sendJSON(res, 400, { error: 'Token SSO tidak disertakan' });

      // Verify token with Jurnal Ombay SSO Hub
      const ssoHubUrl = process.env.SSO_HUB_URL || 'https://jurnalombay.my.id';
      const verifyUrl = new URL('/sso/verify', ssoHubUrl);

      const postData = JSON.stringify({ token: ssoToken });
      const client = verifyUrl.protocol === 'https:' ? require('node:https') : require('node:http');

      const verifyReq = client.request(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (verifyRes) => {
        let body = '';
        verifyRes.on('data', chunk => body += chunk);
        verifyRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.valid && data.user) {
              const localToken = crypto.randomBytes(32).toString('hex');
              const sessionUser = {
                id: data.user.id,
                username: data.user.username,
                name: data.user.fullName || data.user.name || data.user.username,
                role: data.user.role
              };
              activeSessions.set(localToken, sessionUser);
              return sendJSON(res, 200, { success: true, token: localToken, user: sessionUser });
            } else {
              return sendJSON(res, 401, { error: data.error || 'Token SSO tidak valid' });
            }
          } catch (e) {
            return sendJSON(res, 500, { error: 'Gagal memverifikasi respon SSO' });
          }
        });
      });

      verifyReq.on('error', (err) => {
        return sendJSON(res, 500, { error: 'Gagal menghubungi server SSO: ' + err.message });
      });

      verifyReq.write(postData);
      verifyReq.end();
      return;
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      activeSessions.delete(token);
    }
    return sendJSON(res, 200, { success: true });
  }

  // -------------------------------------------------------------
  // STATE MANAGEMENT APIS (Live Show)
  // -------------------------------------------------------------
  if (pathname === '/api/state' && req.method === 'GET') {
    return sendJSON(res, 200, appState);
  }

  if (pathname === '/api/state' && req.method === 'POST') {
    try {
      const user = getSessionUser(req);
      const data = await parseBody(req);
      if (typeof data.currentSongIndex === 'number') appState.currentSongIndex = data.currentSongIndex;
      if (typeof data.currentSongId === 'string') {
        appState.currentSongId = data.currentSongId;
        const songs = readJSON(SONGS_FILE, []);
        const target = songs.find(s => s.id === data.currentSongId);
        if (target) appState.currentSong = target;
      }
      if (data.currentSong && data.currentSong.lines) {
        appState.currentSong = data.currentSong;
      }
      if (typeof data.currentLineIndex === 'number') appState.currentLineIndex = data.currentLineIndex;
      if (typeof data.isBlank === 'boolean') appState.isBlank = data.isBlank;
      if (typeof data.activePlaylistId === 'string') appState.activePlaylistId = data.activePlaylistId;
      if (user) {
        appState.activeUser = user.username;
      }
      if (data.settings) {
        appState.settings = { ...appState.settings, ...data.settings };
        writeJSON(SETTINGS_FILE, appState.settings);
      }
      appState.timestamp = Date.now();

      broadcastState();
      return sendJSON(res, 200, { success: true, state: appState });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // -------------------------------------------------------------
  // SETTINGS APIS
  // -------------------------------------------------------------
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJSON(res, 200, appState.settings);
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const newSettings = await parseBody(req);
      appState.settings = { ...appState.settings, ...newSettings };
      writeJSON(SETTINGS_FILE, appState.settings);
      appState.timestamp = Date.now();
      broadcastState();
      return sendJSON(res, 200, { success: true, settings: appState.settings });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // -------------------------------------------------------------
  // SONGS CRUD APIS (USER-SCOPED)
  // -------------------------------------------------------------
  if (pathname === '/api/songs' && req.method === 'GET') {
    const user = getSessionUser(req);
    const songs = readJSON(SONGS_FILE, []);

    if (user) {
      // Authenticated: return strictly songs belonging to this user
      const userSongs = songs.filter(s => canAccess(s, user));
      return sendJSON(res, 200, userSongs);
    } else {
      // Unauthenticated (vMix overlay or public preview iframe):
      // Return all songs of the currently active live playlist so overlay has them cached
      const playlists = readJSON(PLAYLISTS_FILE, []);
      const activePl = playlists.find(p => p.id === appState.activePlaylistId) || playlists[0];
      if (activePl && Array.isArray(activePl.songIds) && activePl.songIds.length > 0) {
        const liveSongs = activePl.songIds
          .map(id => songs.find(s => s.id === id))
          .filter(Boolean);
        if (liveSongs.length > 0) {
          return sendJSON(res, 200, liveSongs);
        }
      }
      if (appState.currentSong) {
        return sendJSON(res, 200, [appState.currentSong]);
      }
      const activeSong = songs.find(s => s.id === appState.currentSongId);
      return sendJSON(res, 200, activeSong ? [activeSong] : []);
    }
  }

  if (pathname === '/api/songs' && req.method === 'POST') {
    try {
      const user = getSessionUser(req);
      if (!user) {
        return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
      }

      const songData = await parseBody(req);
      const songs = readJSON(SONGS_FILE, []);

      // If payload is an array (batch save/reorder)
      if (Array.isArray(songData)) {
        const otherSongs = songs.filter(s => !canAccess(s, user));
        const updatedUserSongs = songData.map(s => ({
          ...s,
          userId: s.userId || user.id || user.username,
          username: s.username || user.username
        }));
        const allSongs = [...otherSongs, ...updatedUserSongs];
        writeJSON(SONGS_FILE, allSongs);
        broadcastState();
        return sendJSON(res, 200, { success: true, count: updatedUserSongs.length });
      }

      // Single Song Creation
      if (!songData.title || !songData.lines || songData.lines.length === 0) {
        return sendJSON(res, 400, { error: 'Judul dan lirik lagu wajib diisi!' });
      }

      const newSong = {
        id: songData.id || `song_${Date.now()}`,
        userId: user.id || user.username,
        username: user.username,
        title: songData.title.trim(),
        artist: (songData.artist || '').trim(),
        lines: songData.lines
      };

      songs.push(newSong);
      writeJSON(SONGS_FILE, songs);
      broadcastState();
      return sendJSON(res, 201, { success: true, song: newSong });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // PUT /api/songs/:id
  const songIdMatch = pathname.match(/^\/api\/songs\/([^/]+)$/);
  if (songIdMatch && req.method === 'PUT') {
    const id = songIdMatch[1];
    try {
      const user = getSessionUser(req);
      if (!user) {
        return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
      }

      const updatedData = await parseBody(req);
      const songs = readJSON(SONGS_FILE, []);
      const index = songs.findIndex(s => s.id === id);

      if (index === -1) {
        return sendJSON(res, 404, { error: 'Lagu tidak ditemukan!' });
      }

      if (!canAccess(songs[index], user)) {
        return sendJSON(res, 403, { error: 'Anda tidak memiliki hak akses ke lagu ini!' });
      }

      songs[index] = {
        ...songs[index],
        title: updatedData.title ? updatedData.title.trim() : songs[index].title,
        artist: typeof updatedData.artist === 'string' ? updatedData.artist.trim() : songs[index].artist,
        lines: Array.isArray(updatedData.lines) ? updatedData.lines : songs[index].lines
      };

      writeJSON(SONGS_FILE, songs);
      if (appState.currentSongId === id) {
        appState.currentSong = songs[index];
      }
      broadcastState();
      return sendJSON(res, 200, { success: true, song: songs[index] });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // DELETE /api/songs/:id
  if (songIdMatch && req.method === 'DELETE') {
    const id = songIdMatch[1];
    const user = getSessionUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
    }

    let songs = readJSON(SONGS_FILE, []);
    const song = songs.find(s => s.id === id);

    if (!song) {
      return sendJSON(res, 404, { error: 'Lagu tidak ditemukan!' });
    }

    if (!canAccess(song, user)) {
      return sendJSON(res, 403, { error: 'Anda tidak memiliki hak akses untuk menghapus lagu ini!' });
    }

    const filtered = songs.filter(s => s.id !== id);
    writeJSON(SONGS_FILE, filtered);

    // Also remove from user's playlists
    const playlists = readJSON(PLAYLISTS_FILE, []);
    let plChanged = false;
    playlists.forEach(pl => {
      if (canAccess(pl, user) && pl.songIds && pl.songIds.includes(id)) {
        pl.songIds = pl.songIds.filter(sid => sid !== id);
        plChanged = true;
      }
    });
    if (plChanged) writeJSON(PLAYLISTS_FILE, playlists);

    broadcastState();
    return sendJSON(res, 200, { success: true, remaining: filtered.length });
  }

  // -------------------------------------------------------------
  // PLAYLISTS CRUD APIS (USER-SCOPED)
  // -------------------------------------------------------------
  if (pathname === '/api/playlists' && req.method === 'GET') {
    const user = getSessionUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
    }
    const playlists = readJSON(PLAYLISTS_FILE, []);
    const userPlaylists = playlists.filter(pl => canAccess(pl, user));
    return sendJSON(res, 200, userPlaylists);
  }

  if (pathname === '/api/playlists' && req.method === 'POST') {
    try {
      const user = getSessionUser(req);
      if (!user) {
        return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
      }

      const plData = await parseBody(req);
      if (!plData.name) {
        return sendJSON(res, 400, { error: 'Nama playlist wajib diisi!' });
      }

      const playlists = readJSON(PLAYLISTS_FILE, []);
      const newPlaylist = {
        id: `pl_${Date.now()}`,
        userId: user.id || user.username,
        username: user.username,
        name: plData.name.trim(),
        description: (plData.description || '').trim(),
        songIds: Array.isArray(plData.songIds) ? plData.songIds : [],
        createdAt: new Date().toISOString()
      };

      playlists.push(newPlaylist);
      writeJSON(PLAYLISTS_FILE, playlists);
      broadcastState();
      return sendJSON(res, 201, { success: true, playlist: newPlaylist });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // PUT /api/playlists/:id
  const plIdMatch = pathname.match(/^\/api\/playlists\/([^/]+)$/);
  if (plIdMatch && req.method === 'PUT') {
    const id = plIdMatch[1];
    try {
      const user = getSessionUser(req);
      if (!user) {
        return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
      }

      const updatedData = await parseBody(req);
      const playlists = readJSON(PLAYLISTS_FILE, []);
      const index = playlists.findIndex(p => p.id === id);

      if (index === -1) {
        return sendJSON(res, 404, { error: 'Playlist tidak ditemukan!' });
      }

      if (!canAccess(playlists[index], user)) {
        return sendJSON(res, 403, { error: 'Anda tidak memiliki hak akses ke playlist ini!' });
      }

      playlists[index] = {
        ...playlists[index],
        name: updatedData.name ? updatedData.name.trim() : playlists[index].name,
        description: typeof updatedData.description === 'string' ? updatedData.description.trim() : playlists[index].description,
        songIds: Array.isArray(updatedData.songIds) ? updatedData.songIds : playlists[index].songIds
      };

      writeJSON(PLAYLISTS_FILE, playlists);
      broadcastState();
      return sendJSON(res, 200, { success: true, playlist: playlists[index] });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // DELETE /api/playlists/:id
  if (plIdMatch && req.method === 'DELETE') {
    const id = plIdMatch[1];
    const user = getSessionUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: 'Sesi telah berakhir atau belum login' });
    }

    let playlists = readJSON(PLAYLISTS_FILE, []);
    const pl = playlists.find(p => p.id === id);

    if (!pl) {
      return sendJSON(res, 404, { error: 'Playlist tidak ditemukan!' });
    }

    if (!canAccess(pl, user)) {
      return sendJSON(res, 403, { error: 'Anda tidak memiliki hak akses untuk menghapus playlist ini!' });
    }

    const filtered = playlists.filter(p => p.id !== id);
    writeJSON(PLAYLISTS_FILE, filtered);
    if (appState.activePlaylistId === id) {
      appState.activePlaylistId = '';
    }
    broadcastState();
    return sendJSON(res, 200, { success: true, remaining: filtered.length });
  }

  // -------------------------------------------------------------
  // STATIC FILES & ROUTING
  // -------------------------------------------------------------
  let filePath = '';
  if (pathname === '/' || pathname === '/controller') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else if (pathname === '/overlay') {
    filePath = path.join(PUBLIC_DIR, 'overlay.html');
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`  🎵 LYRICSBAY SERVER PRO RUNNING`);
  console.log(`  -----------------------------------------------`);
  console.log(`  🎮 Operator Controller : http://localhost:${PORT}/`);
  console.log(`  📺 vMix Browser Input  : http://localhost:${PORT}/overlay`);
  console.log(`  🔐 Default Login       : admin / admin123`);
  console.log(`=================================================`);
});
