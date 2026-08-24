const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
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
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
// Server-side limit must stay above the largest decoded chunk that the client can
// legitimately send through Socket.IO base64 transport.
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

const MAX_CONNECTIONS = 10000;
const MAX_USERS_PER_ROOM = 500;
const MAX_ROOM_CREATIONS = 20; 
const MAX_ROOM_CREATIONS_PERIOD = 10 * 60 * 1000; // 10 min
const MAX_FILE_UPLOADS = 5; // per socket
const MAX_FILE_UPLOADS_PERIOD = 30 * 1000; // 30 secs

const SERVER_HOST = process.env.HOST || "127.0.0.1";

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
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
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

let activeConnections = 0;

const rooms = {};
const roomFiles = {}; 
const uploadedFiles = Object.create(null);
const pendingUploads = Object.create(null);

function sanitizeUploadName(fileName) {
  if (typeof fileName !== "string") return "file";
  // Strip only control characters and path/quote characters so non-Latin
  // names (e.g. Cyrillic) survive; everything else is safe for display and
  // is HTML-escaped by the client and re-encoded for the download header.
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

  const filePath = path.join(UPLOADS_DIR, requestedFile);
  const meta = uploadedFiles[requestedFile];

  if (fs.existsSync(filePath)) {
    if (meta?.mimeType) {
      res.type(meta.mimeType);
    }

    if (!meta?.inlinePreview) {
      const rawName = meta?.originalName || requestedFile;
      // Non-ASCII characters (e.g. Cyrillic) aren't valid raw HTTP header
      // bytes, so send an ASCII fallback plus an RFC 5987 encoded name.
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

// Serve static assets after the secured uploads route so generic files
// keep Content-Disposition: attachment and correct MIME types.
app.use(express.static("public"));

function sanitizeString(str, maxLen) {
  if (typeof str !== "string") return null;
  str = str.trim();
  if (!str || str.length > maxLen) return null;
  return str;
}


function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
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
  if (store.tempFilePath && fs.existsSync(store.tempFilePath)) {
    try {
      fs.unlinkSync(store.tempFilePath);
    } catch (err) {
      console.error("Failed to remove temp upload:", err.message);
    }
  }
  delete pendingUploads[storeKey];
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

async function optimizeUploadBuffer(buffer, fileType) {
  let finalBuffer = buffer;
  let finalType = typeof fileType === "string" && fileType.trim()
    ? fileType.trim()
    : "application/octet-stream";
  let metadataStripped = false;

  const isImage = finalType.startsWith("image/");
  const isAnimatedGif = finalType === "image/gif";

  if (isImage && !isAnimatedGif) {
    try {
      // Always re-encode non-GIF images to strip EXIF/metadata.
      // Large images are also resized to keep payloads reasonable.
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
      console.error("Image optimize failed, keeping original:", optimizeError.message);
    }
  } else if (isInlineUpload(finalType)) {
    metadataStripped = true;
  }

  return { finalBuffer, finalType, metadataStripped };
}

async function saveUploadedMedia(socket, payload) {
  const { fileName, fileType, thumbnail, buffer } = payload;

  if (!socket.room || !rooms[socket.room]) {
    socket.emit("mediaError", "You are not in a room");
    return false;
  }

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
    const { finalBuffer, finalType, metadataStripped } = await optimizeUploadBuffer(buffer, fileType);
    const fileExt = getStoredFileExtension(sanitizedFileName, finalType);
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${fileExt}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);

    fs.writeFileSync(filePath, finalBuffer);

    if (!roomFiles[socket.room]) {
      roomFiles[socket.room] = [];
    }
    roomFiles[socket.room].push(uniqueName);

    const inlinePreview = isInlineUpload(finalType);
    uploadedFiles[uniqueName] = {
      originalName: sanitizedFileName.substring(0, 100),
      mimeType: finalType,
      inlinePreview
    };

    const mediaMsg = {
      type: "media",
      fileName: sanitizedFileName.substring(0, 100),
      fileUrl: `/uploads/${uniqueName}`,
      fileType: finalType,
      fileSize: finalBuffer.length,
      thumbnail: inlinePreview && finalType.startsWith("image/") ? thumbnail || null : null,
      isImage: finalType.startsWith("image/"),
      isVideo: finalType.startsWith("video/"),
      isGenericFile: !(finalType.startsWith("image/") || finalType.startsWith("video/")),
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false,
      metadataStripped: metadataStripped || inlinePreview
    };

    socket.to(socket.room).emit("chatMessage", mediaMsg);
    socket.emit("chatMessage", { ...mediaMsg, self: true });
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
    const { fileName, fileType, fileSize, thumbnail } = uploadStore;
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
      thumbnail,
      buffer
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

  socket.on("createRoom", ({ room, password, nickname }) => {
    room = sanitizeString(room, MAX_ROOM_LEN);
    nickname = sanitizeString(nickname || "Anonymous", MAX_NICK_LEN);

    if (!room || !password || password.length > MAX_PASSWORD_LEN) {
      socket.emit("roomError", "Invalid data");
      return;
    }

    if (rooms[room]) {
      socket.emit("roomError", "Room already exists");
      return;
    }

    if (!roomCreationLimiter.isAllowed(socket.id)) {
      const remainingWait = roomCreationLimiter.getRemainingTime(socket.id);
      socket.emit("roomError", `Too many room creations. Try again in ${remainingWait}s`);
      console.warn(`⚠️ Room creation rate limit: ${socket.nickname || 'Anonymous'} blocked for ${remainingWait}s`);
      return;
    }

    rooms[room] = {
      password: hashPassword(password),
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

    socket.emit("roomJoined", {
      room,
      nickname,
      userCount: 1,
      isCreator: true
    });
    emitVoiceParticipants(room);

  });

  socket.on("joinRoom", ({ room, password, nickname }) => {
    room = sanitizeString(room, MAX_ROOM_LEN);
    nickname = sanitizeString(nickname || "Anonymous", MAX_NICK_LEN);

    if (!room || !password) {
      socket.emit("roomError", "Invalid data");
      return;
    }

    const roomData = rooms[room];
    if (!roomData) {
      socket.emit("roomError", "Room doesn't exist");
      return;
    }

    if (roomData.password !== hashPassword(password)) {
      socket.emit("roomError", "Incorrect password");
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

    socket.emit("roomJoined", {
      room,
      nickname,
      userCount: Object.keys(roomData.users).length,
      isCreator: roomData.creator === socket.id
    });
    emitVoiceParticipants(room);

    socket.to(room).emit("userJoined", { nickname });

    io.to(room).emit("updateUserCount", {
      count: Object.keys(roomData.users).length
    });

  });

 
  socket.on("leaveRoom", ({ room }) => {
    if (socket.room && rooms[socket.room]) {
      leaveVoice(socket);
      const userData = rooms[socket.room].users[socket.id];
      
      if (userData) {
        delete rooms[socket.room].users[socket.id];
        
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

      // Peers already in voice: the joiner will initiate a WebRTC offer to each.
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

  // Relays WebRTC offer/answer/ICE-candidate signaling between two peers already
  // in the same room's voice roster; the server never touches the media itself.
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


  socket.on("chatMessage", (msg) => {
    const now = Date.now();
    if (now - socket.lastMsg < 500) return;
    socket.lastMsg = now;

    if (!socket.room || !rooms[socket.room]) return;
    if (typeof msg !== "string") return;
    
    msg = msg.trim();
    if (!msg || msg.length > MAX_MSG_LEN) return;

    // We allow any printable characters in chat messages. XSS protection happens
    // when the message is rendered on the client by escaping HTML and sanitizing URLs.
    const messageData = {
      msg: msg,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false
    };

    socket.to(socket.room).emit("chatMessage", messageData);
    socket.emit("chatMessage", { ...messageData, self: true });
  });


  socket.on("uploadMedia", async (data) => {
    if (!socket.room || !rooms[socket.room]) {
      console.error("No room or user not in room");
      socket.emit("mediaError", "You are not in a room");
      return;
    }

    if (!fileUploadLimiter.isAllowed(socket.id)) {
      const remainingWait = fileUploadLimiter.getRemainingTime(socket.id);
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

      const { fileName, fileType, fileData, fileSize, thumbnail } = data;

      if (!fileName || !fileData) {
        console.error("Missing required fields");
        socket.emit("mediaError", "Invalid file payload");
        return;
      }

      if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE) {
        console.error("File too large:", fileSize);
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
        thumbnail,
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

    if (!socket.room || !rooms[socket.room]) {
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
      thumbnail,
      chunkIndex,
      totalChunks,
      chunkData
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

      if (!fileUploadLimiter.isAllowed(socket.id)) {
        const remainingWait = fileUploadLimiter.getRemainingTime(socket.id);
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

      // Limit concurrent unfinished uploads per socket
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
        thumbnail: thumbnail || null,
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

    // Chunk size must match the sender's negotiated upload size and allow larger
    // images/files to be split into multiple safe chunks.
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
    if (!socket.room || !rooms[socket.room]) return;

    socket.to(socket.room).emit("userTyping", {
      userId: socket.id,
      nickname: socket.nickname
    });
  });

  socket.on("stopTyping", () => {
    if (!socket.room || !rooms[socket.room]) return;

    socket.to(socket.room).emit("userStoppedTyping", {
      userId: socket.id
    });
  });

  socket.onAny((eventName, data) => {
    if (eventName === "chatMessage" && 
        typeof data === "object" && 
        data.type === "media") {
        console.error('BLOCKED: Fake media message from', socket.nickname);
        return;
    }

    if (eventName === "chatMessage" && 
        typeof data === "string" && 
        data.length > MAX_MSG_LEN * 2) {
        console.error('BLOCKED: Too long message from', socket.nickname);
        return;
    }
});


  socket.on("disconnect", () => {
    activeConnections--;
    
    roomCreationLimiter.attempts.delete(socket.id);
    fileUploadLimiter.attempts.delete(socket.id);
    Object.keys(pendingUploads)
      .filter((key) => key.startsWith(`${socket.id}:`))
      .forEach((key) => cleanupPendingUpload(key));
    
    if (socket.room && rooms[socket.room]) {
      leaveVoice(socket);
      const userData = rooms[socket.room].users[socket.id];
      
      if (userData) {      
        delete rooms[socket.room].users[socket.id];
        
        socket.to(socket.room).emit("userLeft", {
          nickname: socket.nickname
        });
        
        if (rooms[socket.room]) {
          io.to(socket.room).emit("updateUserCount", {
            count: Object.keys(rooms[socket.room].users).length
          });
        }

        if (Object.keys(rooms[socket.room].users).length === 0) {
          setTimeout(() => {
            if (rooms[socket.room] && Object.keys(rooms[socket.room].users).length === 0) {
              deleteRoomFiles(socket.room);
              delete rooms[socket.room];
            }
          }, 300000); 
        }
      }
    }
  });
});


const PORT = process.env.PORT || 3000;

server.listen(PORT, SERVER_HOST, () => {
  console.log(`Server running on http://${SERVER_HOST}:${PORT}`);
});
