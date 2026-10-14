require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const argon2 = require("argon2");
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 5 * 60 * 1000,
    skipMiddlewares: true
  },
  maxHttpBufferSize: 100e6
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy",
        "default-src 'self'; " +
        "img-src 'self' data: blob:; " +
        "media-src 'self' blob:; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
        "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
        "connect-src 'self' ws: wss:;"
    );

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");

    next();
});

const MAX_MSG_LEN = 4000;
const MAX_NICK_LEN = 20;
const MAX_ROOM_LEN = 30;
const MAX_PASSWORD_LEN = 64;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

const MAX_CONNECTIONS = 10000;
const MAX_USERS_PER_ROOM = 500;
const MAX_ROOM_CREATIONS = 20;
const MAX_ROOM_CREATIONS_PERIOD = 10 * 60 * 1000;
const MAX_FILE_UPLOADS = 5;
const MAX_FILE_UPLOADS_PERIOD = 30 * 1000;
const MAX_JOIN_ATTEMPTS = 20;
const MAX_JOIN_ATTEMPTS_PERIOD = 60 * 1000;
const MAX_PENDING_UPLOAD_AGE_MS = 2 * 60 * 1000;
const RECONNECT_GRACE_PERIOD_MS = 5 * 60 * 1000;

const SERVER_HOST = process.env.HOST || "127.0.0.1";
const TURN_URL = process.env.TURN_URL || "";
const TURN_SECRET = process.env.TURN_SECRET || "";
const TURN_CREDENTIAL_TTL = 6 * 60 * 60;

function getTurnServer() {
  if (!TURN_URL || !TURN_SECRET) return null;

  const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL}`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");

  return { urls: TURN_URL, username, credential, credentialType: "password" };
}

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'jpg',
  'image/heic': 'jpg',
  'image/heif': 'jpg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};
const IMAGE_TYPES_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  ico: 'image/x-icon'
};

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: 'Too many requests'
});

class RateLimiter {
  constructor(maxAttempts, periodMs) {
    this.maxAttempts = maxAttempts;
    this.periodMs = periodMs;
    this.attempts = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    if (!this.attempts.has(key)) {
      this.attempts.set(key, []);
    }
    
    const timestamps = this.attempts.get(key);
    while (timestamps.length > 0 && now - timestamps[0] > this.periodMs) {
      timestamps.shift();
    }
    
    if (timestamps.length < this.maxAttempts) {
      timestamps.push(now);
      return true;
    }
    return false;
  }

  getRemainingTime(key) {
    const now = Date.now();
    const timestamps = this.attempts.get(key);
    if (!timestamps || timestamps.length === 0) return this.periodMs;
    
    while (timestamps.length > 0 && now - timestamps[0] > this.periodMs) {
      timestamps.shift();
    }
    
    if (timestamps.length < this.maxAttempts) return 0;
    return Math.ceil((timestamps[0] + this.periodMs - now) / 1000);
  }
}

const roomCreationLimiter = new RateLimiter(MAX_ROOM_CREATIONS, MAX_ROOM_CREATIONS_PERIOD);
const fileUploadLimiter = new RateLimiter(MAX_FILE_UPLOADS, MAX_FILE_UPLOADS_PERIOD);
const joinAttemptLimiter = new RateLimiter(MAX_JOIN_ATTEMPTS, MAX_JOIN_ATTEMPTS_PERIOD);

function clientIp(socket) {
  return (socket.handshake && socket.handshake.address) || socket.id;
}

let activeConnections = 0;

const rooms = Object.create(null);
const roomFiles = Object.create(null);
const uploadedFiles = Object.create(null);
const pendingUploads = Object.create(null);
const pendingRoomCreations = new Set();
const fileAccessTokens = new Map();
const disconnectGraceTimers = new Map();

function getSocketRoom(socket) {
  if (!socket.room) return null;
  const roomData = rooms[socket.room];
  if (!roomData || !roomData.users[socket.id]) return null;
  return { roomName: socket.room, roomData };
}

function issueFileAccessToken(socket) {
  if (socket.fileAccessToken && fileAccessTokens.has(socket.fileAccessToken)) {
    const existing = fileAccessTokens.get(socket.fileAccessToken);
    if (existing && existing.roomName === socket.room) {
      existing.socketId = socket.id;
      return socket.fileAccessToken;
    }
  }

  socket.fileAccessToken = crypto.randomBytes(32).toString("base64url");
  fileAccessTokens.set(socket.fileAccessToken, {
    roomName: socket.room,
    socketId: socket.id
  });
  return socket.fileAccessToken;
}

function revokeFileAccessToken(socket) {
  if (!socket.fileAccessToken) return;
  fileAccessTokens.delete(socket.fileAccessToken);
  socket.fileAccessToken = null;
}

function revokeSocketFileAccessTokens(socketId) {
  for (const [token, access] of fileAccessTokens) {
    if (access.socketId === socketId) fileAccessTokens.delete(token);
  }
}

function clearDisconnectGraceTimer(socketId) {
  const pending = disconnectGraceTimers.get(socketId);
  if (!pending) return;
  clearTimeout(pending.timer);
  disconnectGraceTimers.delete(socketId);
}

function removeDisconnectedRoomMember(socketId, roomName, nickname) {
  const roomData = rooms[roomName];
  if (!roomData?.users[socketId]) {
    revokeSocketFileAccessTokens(socketId);
    return;
  }

  delete roomData.users[socketId];
  revokeSocketFileAccessTokens(socketId);
  io.to(roomName).emit("userLeft", { nickname });
  io.to(roomName).emit("updateUserCount", {
    count: Object.keys(roomData.users).length
  });

  if (Object.keys(roomData.users).length === 0) {
    setTimeout(() => {
      if (rooms[roomName] && Object.keys(rooms[roomName].users).length === 0) {
        deleteRoomFiles(roomName);
        delete rooms[roomName];
      }
    }, 300000);
  }
}

function revokeRoomFileAccessTokens(roomName) {
  for (const [token, access] of fileAccessTokens) {
    if (access.roomName === roomName) fileAccessTokens.delete(token);
  }
}

function sanitizeUploadName(fileName) {
  if (typeof fileName !== "string") return "file";
  const normalized = path.basename(fileName).replace(/[\x00-\x1f\x7f\\/"]+/g, "_").trim();
  return normalized || "file";
}

function getStoredFileExtension(fileName, fileType) {
  const typeExt = ALLOWED_TYPES[fileType];
  if (typeExt) return typeExt;

  const rawExt = path.extname(fileName || "").slice(1).toLowerCase();
  if (rawExt && /^[a-z0-9]{1,16}$/.test(rawExt)) return rawExt;

  return "bin";
}

function isInlineUpload(fileType) {
  return typeof fileType === "string" && (
    fileType.startsWith("image/") ||
    fileType.startsWith("video/")
  );
}

function emitVoiceParticipants(roomName) {
  const roomData = rooms[roomName];
  if (!roomData) return;

  const participants = Object.entries(roomData.voiceUsers || {}).map(([socketId, state]) => ({
    socketId,
    nickname: state.nickname,
    muted: !!state.muted,
    deafened: !!state.deafened,
    speaking: !!state.speaking
  }));

  io.to(roomName).emit("voiceParticipants", { participants });
}

function leaveVoice(socket) {
  if (!socket.room || !rooms[socket.room]) return;

  const roomName = socket.room;
  const roomData = rooms[roomName];
  if (!roomData.voiceUsers || !roomData.voiceUsers[socket.id]) return;

  delete roomData.voiceUsers[socket.id];

  io.to(roomName).emit("voiceUserLeft", { socketId: socket.id, nickname: socket.nickname });

  emitVoiceParticipants(roomName);
}

app.use('/uploads/', apiLimiter);

app.get('/uploads/:filename', (req, res) => {
  const requestedFile = path.basename(req.params.filename || "");
  if (!requestedFile || requestedFile !== req.params.filename) {
    res.status(400).send('Invalid file name');
    return;
  }

  const access = typeof req.query.token === "string"
    ? fileAccessTokens.get(req.query.token)
    : null;
  const roomData = access && rooms[access.roomName];
  const meta = uploadedFiles[requestedFile];
  if (
    !access ||
    !roomData ||
    !meta ||
    meta.roomName !== access.roomName
  ) {
    res.sendStatus(403);
    return;
  }

  const filePath = path.join(UPLOADS_DIR, requestedFile);

  if (fs.existsSync(filePath)) {
    res.setHeader("Cache-Control", "private, no-store");
    if (meta?.mimeType) {
      res.type(meta.mimeType);
    }

    if (req.query.download === "1" || !meta?.inlinePreview) {
      const rawName = meta?.originalName || requestedFile;
      const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'") || "file";
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
      );
    }
    res.sendFile(filePath);
  } else {
    console.error(`File not found: ${req.params.filename}`);
    res.status(404).send('File not found');
  }
});

app.use(express.static("public"));

function sanitizeString(str, maxLen) {
  if (typeof str !== "string") return null;
  str = str.trim();
  if (!str || str.length > maxLen) return null;
  return str;
}


let dummyPasswordHash;

function generateMessageId() {
  return crypto.randomBytes(9).toString("base64url");
}

const MESSAGE_CACHE_LIMIT = 200;

function cacheMessageForReply(roomData, msgId, nickname, snippet, type) {
  if (!roomData) return;
  if (!roomData.messageCache) roomData.messageCache = new Map();
  roomData.messageCache.set(msgId, { nickname, snippet, type });
  if (roomData.messageCache.size > MESSAGE_CACHE_LIMIT) {
    roomData.messageCache.delete(roomData.messageCache.keys().next().value);
  }
}

function resolveReplyTo(roomData, replyTo) {
  if (!roomData || !roomData.messageCache) return null;
  if (!replyTo || typeof replyTo !== "object") return null;

  const msgId = typeof replyTo.msgId === "string" ? replyTo.msgId.trim().slice(0, 32) : "";
  if (!msgId) return null;

  const entry = roomData.messageCache.get(msgId);
  if (!entry) return null;

  return { msgId, nickname: entry.nickname, snippet: entry.snippet, type: entry.type };
}

function deleteRoomFiles(roomName) {
  if (roomFiles[roomName]) {
    roomFiles[roomName].forEach(fileName => {
      const filePath = path.join(UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(`✗ Error deleting ${fileName}:`, err);
        }
      }
      delete uploadedFiles[fileName];
    });
    delete roomFiles[roomName];
  }
}

function cleanupPendingUpload(storeKey) {
  const store = pendingUploads[storeKey];
  if (!store) return;
  clearTimeout(store.expiryTimer);
  if (store.tempFilePath && fs.existsSync(store.tempFilePath)) {
    try {
      fs.unlinkSync(store.tempFilePath);
    } catch (err) {
      console.error("Failed to remove temp upload:", err.message);
    }
  }
  delete pendingUploads[storeKey];
}

function refreshPendingUploadExpiry(storeKey, store) {
  clearTimeout(store.expiryTimer);
  store.expiryTimer = setTimeout(
    () => cleanupPendingUpload(storeKey),
    MAX_PENDING_UPLOAD_AGE_MS
  );
  store.expiryTimer.unref();
}

function decodeChunkData(chunkData) {
  if (Buffer.isBuffer(chunkData)) {
    return chunkData;
  }
  if (chunkData instanceof ArrayBuffer) {
    return Buffer.from(chunkData);
  }
  if (ArrayBuffer.isView(chunkData)) {
    return Buffer.from(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
  }
  if (typeof chunkData === "string") {
    return Buffer.from(chunkData, "base64");
  }
  if (chunkData && typeof chunkData === "object" && chunkData.type === "Buffer" && Array.isArray(chunkData.data)) {
    return Buffer.from(chunkData.data);
  }
  throw new Error("Unsupported chunk data format");
}

function estimatePayloadBytes(fileData) {
  if (Buffer.isBuffer(fileData)) return fileData.length;
  if (fileData instanceof ArrayBuffer) return fileData.byteLength;
  if (ArrayBuffer.isView(fileData)) return fileData.byteLength;
  if (typeof fileData === "string") return Math.ceil(fileData.length * 0.75);
  if (fileData && typeof fileData === "object" && Array.isArray(fileData.data)) return fileData.data.length;
  return 0;
}

async function optimizeUploadBuffer(buffer, fileType, fileName) {
  let finalBuffer = buffer;
  const declaredType = typeof fileType === "string" ? fileType.trim().toLowerCase() : "";
  const extension = path.extname(typeof fileName === "string" ? fileName : "").slice(1).toLowerCase();
  const inferredImageType = IMAGE_TYPES_BY_EXTENSION[extension];
  const requestedType = declaredType.startsWith("image/") ? declaredType : inferredImageType || declaredType;
  let finalType = ALLOWED_TYPES[requestedType] ? requestedType : "application/octet-stream";
  let metadataStripped = false;

  if (requestedType.startsWith("image/") && !ALLOWED_TYPES[requestedType]) {
    throw new Error(`Unsupported image format: ${requestedType}`);
  }

  const isImage = finalType.startsWith("image/");
  const isAnimatedGif = finalType === "image/gif";

  if (isAnimatedGif) {
    try {
      finalBuffer = await sharp(finalBuffer, { animated: true })
        .gif({ effort: 7 })
        .toBuffer();
      metadataStripped = true;
    } catch (validateError) {
      console.error("GIF metadata removal failed:", validateError.message);
      throw validateError;
    }
  } else if (isImage) {
    try {
      let pipeline = sharp(finalBuffer).rotate();
      if (finalBuffer.length > MAX_IMAGE_BYTES) {
        pipeline = pipeline.resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: "inside",
          withoutEnlargement: true
        });
      }

      if (finalType === "image/png") {
        finalBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
        finalType = "image/png";
      } else if (finalType === "image/webp") {
        finalBuffer = await pipeline.webp({ quality: 80 }).toBuffer();
        finalType = "image/webp";
      } else {
        finalBuffer = await pipeline.jpeg({ quality: 78, progressive: true }).toBuffer();
        finalType = "image/jpeg";
      }
      metadataStripped = true;
    } catch (optimizeError) {
      console.error("Image metadata removal failed:", optimizeError.message);
      throw optimizeError;
    }
  }

  return { finalBuffer, finalType, metadataStripped };
}

async function saveUploadedMedia(socket, payload) {
  const { fileName, fileType, buffer, replyTo } = payload;

  const membership = getSocketRoom(socket);
  if (!membership) {
    socket.emit("mediaError", "You are not in a room");
    return false;
  }
  const { roomName, roomData } = membership;

  if (!fileName || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.error("Invalid upload payload");
    socket.emit("mediaError", "Invalid file payload");
    return false;
  }

  if (buffer.length > MAX_FILE_SIZE) {
    socket.emit("mediaError", "File is too large (max 50MB)");
    return false;
  }

  try {
    const sanitizedFileName = sanitizeUploadName(fileName);
    const { finalBuffer, finalType, metadataStripped } = await optimizeUploadBuffer(buffer, fileType, sanitizedFileName);
    if (getSocketRoom(socket)?.roomData !== roomData) {
      socket.emit("mediaError", "You are not in a room");
      return false;
    }
    const fileExt = getStoredFileExtension(sanitizedFileName, finalType);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(16).toString("base64url")}.${fileExt}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);
    const isImage = finalType.startsWith("image/");

    fs.writeFileSync(filePath, finalBuffer);

    if (!roomFiles[roomName]) {
      roomFiles[roomName] = [];
    }
    roomFiles[roomName].push(uniqueName);

    const inlinePreview = isInlineUpload(finalType);
    uploadedFiles[uniqueName] = {
      originalName: sanitizedFileName.substring(0, 100),
      mimeType: finalType,
      inlinePreview,
      roomName
    };

    const isVideo = finalType.startsWith("video/");
    const displayName = sanitizedFileName.substring(0, 100);
    const msgId = generateMessageId();

    const mediaMsg = {
      type: "media",
      msgId,
      fileName: displayName,
      fileUrl: `/uploads/${uniqueName}`,
      fileType: finalType,
      fileSize: finalBuffer.length,
      thumbnail: null,
      isImage,
      isVideo,
      isGenericFile: !(isImage || isVideo),
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false,
      metadataStripped,
      replyTo: resolveReplyTo(roomData, replyTo)
    };

    const snippetEmoji = isImage ? "📸" : isVideo ? "🎥" : "📎";
    cacheMessageForReply(roomData, msgId, socket.nickname, `${snippetEmoji} ${displayName}`, "media");

    socket.to(roomName).emit("chatMessage", mediaMsg);
    socket.emit("chatMessage", { ...mediaMsg, self: true });

    if (inlinePreview && isImage) {
      setImmediate(async () => {
        try {
          const thumbnailBuffer = await sharp(finalBuffer)
            .rotate()
            .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 70, progressive: true })
            .toBuffer();
          io.to(roomName).emit("mediaThumbnailReady", {
            msgId,
            thumbnail: `data:image/jpeg;base64,${thumbnailBuffer.toString("base64")}`
          });
        } catch (thumbnailError) {
          console.error("Image thumbnail generation failed:", thumbnailError.message);
          io.to(roomName).emit("mediaThumbnailFailed", { msgId });
        }
      });
    }

    return true;
  } catch (error) {
    console.error("Upload save error:", error);
    socket.emit("mediaError", "Failed to process uploaded file");
    return false;
  }
}

async function finalizeChunkedUpload(socket, storeKey) {
  const uploadStore = pendingUploads[storeKey];
  if (!uploadStore || uploadStore.finalizing) return false;
  uploadStore.finalizing = true;

  try {
    for (let i = 0; i < uploadStore.totalChunks; i += 1) {
      if (!Buffer.isBuffer(uploadStore.chunks[i])) {
        cleanupPendingUpload(storeKey);
        socket.emit("mediaError", "Upload incomplete");
        return false;
      }
    }

    const buffer = Buffer.concat(uploadStore.chunks, uploadStore.receivedBytes);
    const { fileName, fileType, fileSize, replyTo } = uploadStore;
    cleanupPendingUpload(storeKey);

    if (typeof fileSize === "number" && fileSize > 0 && buffer.length !== fileSize) {
      console.error(`Upload size mismatch: expected ${fileSize}, got ${buffer.length}`);
      socket.emit("mediaError", "File data incomplete");
      return false;
    }

    return await saveUploadedMedia(socket, {
      fileName,
      fileType,
      fileSize: buffer.length,
      buffer,
      replyTo
    });
  } catch (error) {
    cleanupPendingUpload(storeKey);
    console.error("Chunk finalize error:", error);
    socket.emit("mediaError", "Failed to process uploaded file");
    return false;
  }
}

io.on("connection", (socket) => {
  activeConnections++;
  if (activeConnections > MAX_CONNECTIONS) {
    activeConnections--;
    socket.emit("error", { code: "SERVER_FULL", message: "Server is at max capacity" });
    socket.disconnect(true);
    console.warn(`⚠️ Connection rejected: Server full (${activeConnections}/${MAX_CONNECTIONS})`);
    return;
  }

  socket.lastMsg = 0;

  if (socket.recovered) {
    clearDisconnectGraceTimer(socket.id);
    const roomName = socket.data.room;
    const nickname = socket.data.nickname;
    const roomData = typeof roomName === "string" ? rooms[roomName] : null;

    if (roomData?.users[socket.id] && typeof nickname === "string") {
      socket.room = roomName;
      socket.nickname = nickname;
      const fileAccessToken = issueFileAccessToken(socket);
      socket.emit("sessionRecovered", {
        room: roomName,
        nickname,
        userCount: Object.keys(roomData.users).length,
        fileAccessToken
      });
    } else {
      for (const joinedRoom of socket.rooms) {
        if (joinedRoom !== socket.id) socket.leave(joinedRoom);
      }
      socket.room = null;
      socket.nickname = null;
      socket.data.room = null;
      socket.data.nickname = null;
      socket.emit("sessionExpired");
    }
  }

  socket.on("getIceServers", (_, callback) => {
    if (typeof callback !== "function") return;
    const turnServer = getTurnServer();
    callback({ ok: true, turnServer });
  });

  socket.on("createRoom", async ({ room, password, nickname } = {}) => {
    room = sanitizeString(room, MAX_ROOM_LEN);
    nickname = sanitizeString(nickname || "Anonymous", MAX_NICK_LEN);

    if (!room || typeof password !== "string" || !password || password.length > MAX_PASSWORD_LEN) {
      socket.emit("roomError", "Invalid data");
      return;
    }

    if (rooms[room] || pendingRoomCreations.has(room)) {
      socket.emit("roomError", "Room already exists");
      return;
    }

    if (!roomCreationLimiter.isAllowed(clientIp(socket))) {
      const remainingWait = roomCreationLimiter.getRemainingTime(clientIp(socket));
      socket.emit("roomError", `Too many room creations. Try again in ${remainingWait}s`);
      console.warn(`⚠️ Room creation rate limit: ${socket.nickname || 'Anonymous'} blocked for ${remainingWait}s`);
      return;
    }

    pendingRoomCreations.add(room);

    try {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      if (!socket.connected) return;

      rooms[room] = {
        password: passwordHash,
        users: Object.create(null),
        voiceUsers: Object.create(null),
        createdAt: Date.now(),
        creator: socket.id
      };

      rooms[room].users[socket.id] = {
        nickname,
        joinedAt: Date.now(),
        isCreator: true
      };

      roomFiles[room] = [];

      socket.join(room);
      socket.room = room;
      socket.nickname = nickname;
      socket.data.room = room;
      socket.data.nickname = nickname;
      const fileAccessToken = issueFileAccessToken(socket);

      socket.emit("roomJoined", {
        room,
        nickname,
        userCount: 1,
        isCreator: true,
        fileAccessToken
      });
      emitVoiceParticipants(room);
    } catch (error) {
      console.error("Failed to create room:", error);
      socket.emit("roomError", "Unable to create room");
    } finally {
      pendingRoomCreations.delete(room);
    }
  });

  socket.on("joinRoom", async ({ room, password, nickname } = {}) => {
    room = sanitizeString(room, MAX_ROOM_LEN);
    nickname = sanitizeString(nickname || "Anonymous", MAX_NICK_LEN);

    if (!room || typeof password !== "string" || !password || password.length > MAX_PASSWORD_LEN) {
      socket.emit("roomError", "Invalid data");
      return;
    }

    const joinKey = `${clientIp(socket)}:${room}`;
    if (!joinAttemptLimiter.isAllowed(joinKey)) {
      const remainingWait = joinAttemptLimiter.getRemainingTime(joinKey);
      socket.emit("roomError", `Too many attempts. Try again in ${remainingWait}s`);
      console.warn(`⚠️ Join rate limit: ${socket.nickname || 'Anonymous'} blocked for ${remainingWait}s`);
      return;
    }

    const roomData = rooms[room];
    let passwordOk;
    try {
      passwordOk = await argon2.verify(roomData ? roomData.password : dummyPasswordHash, password);
    } catch (error) {
      console.error("Failed to verify room password:", error);
      socket.emit("roomError", "Unable to join room");
      return;
    }

    if (!roomData || rooms[room] !== roomData || !passwordOk) {
      socket.emit("roomError", "Invalid room or password");
      return;
    }

    if (Object.keys(roomData.users).length >= MAX_USERS_PER_ROOM) {
      socket.emit("roomError", `Room is full (max ${MAX_USERS_PER_ROOM} users)`);
      console.warn(`⚠️ Room full: ${room} has reached max users (${MAX_USERS_PER_ROOM})`);
      return;
    }

    roomData.users[socket.id] = {
      nickname,
      joinedAt: Date.now(),
      isCreator: roomData.creator === socket.id
    };

    socket.join(room);
    socket.room = room;
    socket.nickname = nickname;
    socket.data.room = room;
    socket.data.nickname = nickname;
    const fileAccessToken = issueFileAccessToken(socket);

    socket.emit("roomJoined", {
      room,
      nickname,
      userCount: Object.keys(roomData.users).length,
      isCreator: roomData.creator === socket.id,
      fileAccessToken
    });
    emitVoiceParticipants(room);

    socket.to(room).emit("userJoined", { nickname });

    io.to(room).emit("updateUserCount", {
      count: Object.keys(roomData.users).length
    });

  });

 
  socket.on("leaveRoom", ({ room }) => {
    if (socket.room && rooms[socket.room]) {
      clearDisconnectGraceTimer(socket.id);
      leaveVoice(socket);
      const userData = rooms[socket.room].users[socket.id];
      
      if (userData) {
        delete rooms[socket.room].users[socket.id];
        revokeFileAccessToken(socket);
        
        socket.leave(socket.room);
        socket.to(socket.room).emit("userLeft", {
          nickname: socket.nickname
        });
        
        if (rooms[socket.room]) {
          io.to(socket.room).emit("updateUserCount", {
            count: Object.keys(rooms[socket.room].users).length
          });
        }

        if (Object.keys(rooms[socket.room].users).length === 0) {
          const roomToDelete = socket.room;
          setTimeout(() => {
            if (rooms[roomToDelete] && Object.keys(rooms[roomToDelete].users).length === 0) {
              deleteRoomFiles(roomToDelete);
              delete rooms[roomToDelete];
              console.log(`Room ${roomToDelete} deleted`);
            }
          }, 300000); 
        }
        
        socket.room = null;
        socket.nickname = null;
        socket.data.room = null;
        socket.data.nickname = null;
        
      }
    }
  });

  socket.on("closeRoom", ({ room }) => {
    if (!room || !rooms[room]) {
      socket.emit("roomError", "Room not found");
      return;
    }
    
    const roomData = rooms[room];
    if (roomData.creator !== socket.id) {
      socket.emit("roomError", "Only room creator can close the room");
      return;
    }
    
    io.to(room).emit("roomClosed", {
      reason: "host_closed",
      closedBy: socket.nickname
    });

    io.to(room).emit("voiceRoomClosed");

    deleteRoomFiles(room);
    revokeRoomFileAccessTokens(room);
    delete rooms[room];
    io.in(room).socketsLeave(room);
  });

  socket.on("voiceJoin", (_, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }

      const roomData = rooms[socket.room];
      if (!roomData.users[socket.id]) {
        callback && callback({ ok: false, error: "Not a room member" });
        return;
      }

      if (!roomData.voiceUsers) roomData.voiceUsers = Object.create(null);

      const existingPeers = Object.keys(roomData.voiceUsers);

      roomData.voiceUsers[socket.id] = {
        nickname: socket.nickname || "Anonymous",
        muted: false,
        deafened: false,
        speaking: false
      };

      emitVoiceParticipants(socket.room);
      callback && callback({ ok: true, peers: existingPeers });
    } catch (error) {
      console.error("voiceJoin error:", error);
      callback && callback({ ok: false, error: "voiceJoin failed" });
    }
  });

  socket.on("voiceSignal", ({ to, data } = {}) => {
    if (!socket.room || !rooms[socket.room]) return;
    if (typeof to !== "string" || !to || !data || typeof data !== "object") return;

    const roomData = rooms[socket.room];
    if (!roomData.voiceUsers || !roomData.voiceUsers[to] || !roomData.voiceUsers[socket.id]) return;

    io.to(to).emit("voiceSignal", {
      from: socket.id,
      nickname: socket.nickname || "Anonymous",
      data
    });
  });

  socket.on("voiceLeave", (_, callback) => {
    leaveVoice(socket);
    callback && callback({ ok: true });
  });

  socket.on("voiceStateUpdate", (payload = {}) => {
    if (!socket.room || !rooms[socket.room]) return;
    const roomData = rooms[socket.room];
    const state = roomData.voiceUsers && roomData.voiceUsers[socket.id];
    if (!state) return;

    if (typeof payload.muted === "boolean") state.muted = payload.muted;
    if (typeof payload.deafened === "boolean") state.deafened = payload.deafened;
    if (typeof payload.speaking === "boolean") state.speaking = payload.speaking;

    emitVoiceParticipants(socket.room);
  });

  socket.on("p2pFileOffer", (payload = {}) => {
    const membership = getSocketRoom(socket);
    if (!membership) return;
    const { roomName, roomData } = membership;
    if (!payload || typeof payload !== "object") return;

    if (!fileUploadLimiter.isAllowed(clientIp(socket))) {
      const remainingWait = fileUploadLimiter.getRemainingTime(clientIp(socket));
      socket.emit("mediaError", `Upload limit reached. Try again in ${remainingWait}s`);
      return;
    }

    const fileId = typeof payload.fileId === "string" ? payload.fileId.trim().slice(0, 64) : "";
    const fileSize = typeof payload.fileSize === "number" && payload.fileSize > 0 ? payload.fileSize : 0;
    if (!fileId || !/^[a-zA-Z0-9._-]{1,64}$/.test(fileId) || !fileSize) return;

    const fileName = sanitizeUploadName(typeof payload.fileName === "string" ? payload.fileName : "file").substring(0, 100);
    const fileType = typeof payload.fileType === "string" ? payload.fileType.slice(0, 120) : "application/octet-stream";

    const replyTo = resolveReplyTo(roomData, payload.replyTo);
    const msgId = generateMessageId();

    const offerMsg = {
      type: "p2p-offer",
      msgId,
      fileId,
      fileName,
      fileSize,
      fileType,
      senderSocketId: socket.id,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false,
      replyTo
    };

    cacheMessageForReply(roomData, msgId, socket.nickname, `🔗 ${fileName}`, "media");

    socket.to(roomName).emit("chatMessage", offerMsg);
    socket.emit("chatMessage", { ...offerMsg, self: true });
  });

  socket.on("p2pSignal", ({ to, data } = {}) => {
    if (!socket.room || !rooms[socket.room]) return;
    if (typeof to !== "string" || !to || !data || typeof data !== "object") return;

    const roomData = rooms[socket.room];
    if (!roomData.users[to] || !roomData.users[socket.id]) return;

    io.to(to).emit("p2pSignal", {
      from: socket.id,
      nickname: socket.nickname || "Anonymous",
      data
    });
  });


  socket.on("chatMessage", (payload) => {
    const now = Date.now();
    if (now - socket.lastMsg < 500) return;
    socket.lastMsg = now;

    const membership = getSocketRoom(socket);
    if (!membership) return;
    const { roomName, roomData } = membership;
    if (!payload || typeof payload !== "object" || typeof payload.msg !== "string") return;

    const msg = payload.msg.trim();
    if (!msg || msg.length > MAX_MSG_LEN) return;

    const replyTo = resolveReplyTo(roomData, payload.replyTo);
    const msgId = generateMessageId();

    const messageData = {
      msgId,
      msg: msg,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false,
      replyTo
    };

    cacheMessageForReply(roomData, msgId, socket.nickname, msg.slice(0, 120), "text");

    socket.to(roomName).emit("chatMessage", messageData);
    socket.emit("chatMessage", { ...messageData, self: true });
  });


  socket.on("uploadMedia", async (data) => {
    if (!getSocketRoom(socket)) {
      console.error("No room or user not in room");
      socket.emit("mediaError", "You are not in a room");
      return;
    }

    if (!fileUploadLimiter.isAllowed(clientIp(socket))) {
      const remainingWait = fileUploadLimiter.getRemainingTime(clientIp(socket));
      socket.emit("mediaError", `Upload limit reached. Try again in ${remainingWait}s`);
      console.warn(`⚠️ File upload rate limit: ${socket.nickname || "Anonymous"} blocked for ${remainingWait}s`);
      return;
    }

    try {
      if (!data || typeof data !== "object") {
        console.error("Invalid data format");
        socket.emit("mediaError", "Invalid file payload");
        return;
      }

      const { fileName, fileType, fileData } = data;

      if (!fileName || !fileData) {
        console.error("Missing required fields");
        socket.emit("mediaError", "Invalid file payload");
        return;
      }

      const declaredBytes = estimatePayloadBytes(fileData);
      if (declaredBytes > MAX_FILE_SIZE) {
        console.error("File too large:", declaredBytes);
        socket.emit("mediaError", "File is too large (max 50MB)");
        return;
      }

      let buffer;
      try {
        buffer = typeof fileData === "string"
          ? Buffer.from(fileData, "base64")
          : decodeChunkData(fileData);
      } catch (bufferError) {
        console.error("Buffer creation error:", bufferError);
        socket.emit("mediaError", "File data corrupted");
        return;
      }

      if (!buffer || buffer.length === 0) {
        console.error("Buffer too small:", buffer?.length);
        socket.emit("mediaError", "File data is empty");
        return;
      }

      await saveUploadedMedia(socket, {
        fileName,
        fileType: fileType || "application/octet-stream",
        fileSize: buffer.length,
        buffer
      });
    } catch (error) {
      console.error("✗ Upload error:", error);
      socket.emit("mediaError", "Upload failed");
    }
  });

  socket.on("uploadMediaChunk", async (data, callback) => {
    const ack = (result) => {
      if (typeof callback === "function") callback(result);
    };

    if (!getSocketRoom(socket)) {
      const result = { ok: false, error: "You are not in a room" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    if (!data || typeof data !== "object") {
      const result = { ok: false, error: "Invalid upload chunk" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    const {
      uploadId,
      fileName,
      fileType,
      fileSize,
      chunkIndex,
      totalChunks,
      chunkData,
      replyTo
    } = data;

    if (
      !uploadId ||
      typeof uploadId !== "string" ||
      !/^[a-zA-Z0-9._-]{1,80}$/.test(uploadId) ||
      typeof chunkIndex !== "number" ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      typeof totalChunks !== "number" ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > 500 ||
      chunkIndex >= totalChunks ||
      chunkData == null
    ) {
      const result = { ok: false, error: "Invalid upload chunk metadata" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE) {
      const result = { ok: false, error: "File is too large (max 50MB)" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    const storeKey = `${socket.id}:${uploadId}`;
    let uploadStore = pendingUploads[storeKey];

    if (!uploadStore) {
      if (chunkIndex !== 0) {
        const result = { ok: false, error: "Upload session expired" };
        socket.emit("mediaError", result.error);
        ack(result);
        return;
      }

      if (!fileUploadLimiter.isAllowed(clientIp(socket))) {
        const remainingWait = fileUploadLimiter.getRemainingTime(clientIp(socket));
        const result = { ok: false, error: `Upload limit reached. Try again in ${remainingWait}s` };
        socket.emit("mediaError", result.error);
        ack(result);
        return;
      }

      if (!fileName) {
        const result = { ok: false, error: "Invalid file payload" };
        socket.emit("mediaError", result.error);
        ack(result);
        return;
      }

      const activeForSocket = Object.keys(pendingUploads).filter((key) => key.startsWith(`${socket.id}:`)).length;
      if (activeForSocket >= 3) {
        const result = { ok: false, error: "Too many uploads in progress" };
        socket.emit("mediaError", result.error);
        ack(result);
        return;
      }

      uploadStore = {
        fileName,
        fileType: fileType || "application/octet-stream",
        fileSize: typeof fileSize === "number" ? fileSize : null,
        replyTo: replyTo || null,
        totalChunks,
        chunks: new Array(totalChunks),
        receivedCount: 0,
        receivedBytes: 0,
        finalizing: false,
        createdAt: Date.now()
      };
      pendingUploads[storeKey] = uploadStore;
    }

    if (uploadStore.finalizing) {
      ack({ ok: true, duplicate: true });
      return;
    }

    if (uploadStore.totalChunks !== totalChunks) {
      cleanupPendingUpload(storeKey);
      const result = { ok: false, error: "Upload metadata mismatch" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    let buffer;
    try {
      buffer = decodeChunkData(chunkData);
    } catch (bufferError) {
      cleanupPendingUpload(storeKey);
      const result = { ok: false, error: "File data corrupted" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    if (!buffer || buffer.length === 0) {
      cleanupPendingUpload(storeKey);
      const result = { ok: false, error: "Empty chunk received" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    if (buffer.length > MAX_CHUNK_BYTES) {
      cleanupPendingUpload(storeKey);
      const result = { ok: false, error: "Chunk too large" };
      socket.emit("mediaError", result.error);
      ack(result);
      return;
    }

    if (!Buffer.isBuffer(uploadStore.chunks[chunkIndex])) {
      uploadStore.chunks[chunkIndex] = buffer;
      uploadStore.receivedCount += 1;
      uploadStore.receivedBytes += buffer.length;

      if (uploadStore.receivedBytes > MAX_FILE_SIZE) {
        cleanupPendingUpload(storeKey);
        const result = { ok: false, error: "File is too large (max 50MB)" };
        socket.emit("mediaError", result.error);
        ack(result);
        return;
      }
    }

    refreshPendingUploadExpiry(storeKey, uploadStore);

    if (uploadStore.receivedCount >= uploadStore.totalChunks) {
      const saved = await finalizeChunkedUpload(socket, storeKey);
      if (saved) {
        ack({ ok: true, complete: true });
      } else {
        ack({ ok: false, error: "Failed to process uploaded file" });
      }
      return;
    }

    ack({ ok: true, chunkIndex, receivedCount: uploadStore.receivedCount });
  });

  socket.on("typing", () => {
    const membership = getSocketRoom(socket);
    if (!membership) return;

    socket.to(membership.roomName).emit("userTyping", {
      userId: socket.id,
      nickname: socket.nickname
    });
  });

  socket.on("stopTyping", () => {
    const membership = getSocketRoom(socket);
    if (!membership) return;

    socket.to(membership.roomName).emit("userStoppedTyping", {
      userId: socket.id
    });
  });

  socket.on("disconnect", () => {
    activeConnections--;

    Object.keys(pendingUploads)
      .filter((key) => key.startsWith(`${socket.id}:`))
      .forEach((key) => cleanupPendingUpload(key));
    
    if (socket.room && rooms[socket.room]) {
      leaveVoice(socket);
      const userData = rooms[socket.room].users[socket.id];
      
      if (userData) {
        const roomName = socket.room;
        const nickname = userData.nickname || socket.nickname || "Anonymous";
        clearDisconnectGraceTimer(socket.id);
        const timer = setTimeout(() => {
          disconnectGraceTimers.delete(socket.id);
          removeDisconnectedRoomMember(socket.id, roomName, nickname);
        }, RECONNECT_GRACE_PERIOD_MS);
        disconnectGraceTimers.set(socket.id, { timer, roomName });
      } else {
        revokeFileAccessToken(socket);
      }
    }
  });
});


const PORT = process.env.PORT || 3000;

argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id })
  .then((hash) => {
    dummyPasswordHash = hash;
    server.listen(PORT, SERVER_HOST, () => {
      console.log(`Server running on http://${SERVER_HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize room password verification:", error);
    process.exitCode = 1;
  });
