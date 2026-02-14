const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 100e6
});

const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 20;
const MAX_ROOM_LEN = 30;
const MAX_PASSWORD_LEN = 64;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const SERVER_HOST = process.env.HOST || "0.0.0.0";
const WEBRTC_LISTEN_IP = process.env.WEBRTC_LISTEN_IP || "0.0.0.0";
const WEBRTC_MIN_PORT = Number(process.env.WEBRTC_MIN_PORT || 40000);
const WEBRTC_MAX_PORT = Number(process.env.WEBRTC_MAX_PORT || 49999);

const MEDIA_CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2
  }
];

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

const rooms = {};
const roomFiles = {}; 
let mediasoupWorker = null;
let effectiveAnnouncedIp = process.env.WEBRTC_ANNOUNCED_IP || undefined;

function detectLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    if (!Array.isArray(values)) continue;
    for (const item of values) {
      if (!item || item.family !== "IPv4" || item.internal) continue;
      return item.address;
    }
  }
  return null;
}

async function initMediasoupWorker() {
  mediasoupWorker = await mediasoup.createWorker({
    rtcMinPort: WEBRTC_MIN_PORT,
    rtcMaxPort: WEBRTC_MAX_PORT
  });

  mediasoupWorker.on("died", () => {
    console.error("Mediasoup worker died, exiting in 2 seconds");
    setTimeout(() => process.exit(1), 2000);
  });
}

async function getOrCreateVoiceRouter(roomName) {
  const roomData = rooms[roomName];
  if (!roomData) return null;
  if (!mediasoupWorker) return null;

  if (!roomData.voiceRouter) {
    roomData.voiceRouter = await mediasoupWorker.createRouter({ mediaCodecs: MEDIA_CODECS });
    roomData.voicePeers = Object.create(null);
  }

  return roomData.voiceRouter;
}

function ensureVoicePeer(roomName, socketId) {
  const roomData = rooms[roomName];
  if (!roomData) return null;

  if (!roomData.voicePeers) roomData.voicePeers = Object.create(null);
  if (!roomData.voicePeers[socketId]) {
    roomData.voicePeers[socketId] = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    };
  }

  return roomData.voicePeers[socketId];
}

function closePeerMedia(peer) {
  if (!peer) return;

  for (const consumer of peer.consumers.values()) {
    try { consumer.close(); } catch (_) {}
  }
  for (const producer of peer.producers.values()) {
    try { producer.close(); } catch (_) {}
  }
  for (const transport of peer.transports.values()) {
    try { transport.close(); } catch (_) {}
  }

  peer.consumers.clear();
  peer.producers.clear();
  peer.transports.clear();
}

function listVoiceProducerInfos(roomName, excludeSocketId = null) {
  const roomData = rooms[roomName];
  if (!roomData || !roomData.voicePeers) return [];

  const producers = [];

  for (const [socketId, peer] of Object.entries(roomData.voicePeers)) {
    if (excludeSocketId && socketId === excludeSocketId) continue;
    for (const producer of peer.producers.values()) {
      producers.push({
        producerId: producer.id,
        socketId,
        nickname: (roomData.voiceUsers && roomData.voiceUsers[socketId]?.nickname) || "Anonymous"
      });
    }
  }

  return producers;
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

  if (roomData.voicePeers && roomData.voicePeers[socket.id]) {
    closePeerMedia(roomData.voicePeers[socket.id]);
    delete roomData.voicePeers[socket.id];
  }

  delete roomData.voiceUsers[socket.id];

  io.to(roomName).emit("voiceUserLeft", { socketId: socket.id, nickname: socket.nickname });

  emitVoiceParticipants(roomName);
}

app.use(express.static("public"));
app.use('/uploads/', apiLimiter);

function sanitizeString(str, maxLen) {
  if (typeof str !== "string") return null;
  str = str.trim();
  if (!str || str.length > maxLen) return null;
  return str.replace(/[<>]/g, "");
}


function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function deleteRoomFiles(roomName) {
  if (roomFiles[roomName]) {
    // console.log(`Deleting ${roomFiles[roomName].length} files for room ${roomName}`);
    roomFiles[roomName].forEach(fileName => {
      const filePath = path.join(UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          // console.log(`✓ Deleted: ${fileName}`);
        } catch (err) {
          console.error(`✗ Error deleting ${fileName}:`, err);
        }
      }
    });
    delete roomFiles[roomName];
  }
}

function closeRoomVoice(roomName) {
  const roomData = rooms[roomName];
  if (!roomData) return;

  if (roomData.voicePeers) {
    Object.values(roomData.voicePeers).forEach(closePeerMedia);
    roomData.voicePeers = Object.create(null);
  }

  if (roomData.voiceRouter) {
    try { roomData.voiceRouter.close(); } catch (_) {}
    roomData.voiceRouter = null;
  }
}

io.on("connection", (socket) => {
  socket.lastMsg = 0;
  // console.log("User connected:", socket.id);

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

    rooms[room] = {
      password: hashPassword(password),
      users: Object.create(null),
      voiceUsers: Object.create(null),
      voicePeers: Object.create(null),
      voiceRouter: null,
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
          // console.log(`Room ${socket.room} is empty, scheduling deletion...`);
          setTimeout(() => {
            if (rooms[socket.room] && Object.keys(rooms[socket.room].users).length === 0) {
              deleteRoomFiles(socket.room);
              closeRoomVoice(socket.room);
              delete rooms[socket.room];
              console.log(`Room ${socket.room} deleted`);
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
    
    // console.log(`Closing room ${room} by ${socket.nickname}`);
    
    io.to(room).emit("roomClosed", {
      reason: "host_closed",
      closedBy: socket.nickname
    });

    io.to(room).emit("voiceRoomClosed");

    closeRoomVoice(room);
    
    deleteRoomFiles(room);
    delete rooms[room];
    io.in(room).socketsLeave(room);
    
    // console.log(`Room ${room} closed and files deleted`);
  });

  socket.on("voiceJoin", async (_, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }
      if (!mediasoupWorker) {
        callback && callback({ ok: false, error: "Voice service unavailable" });
        return;
      }

      const roomData = rooms[socket.room];
      if (!roomData.users[socket.id]) {
        callback && callback({ ok: false, error: "Not a room member" });
        return;
      }

      const router = await getOrCreateVoiceRouter(socket.room);
      if (!router) {
        callback && callback({ ok: false, error: "Failed to init voice router" });
        return;
      }

      ensureVoicePeer(socket.room, socket.id);
      roomData.voiceUsers[socket.id] = {
        nickname: socket.nickname || "Anonymous",
        muted: false,
        deafened: false,
        speaking: false
      };

      emitVoiceParticipants(socket.room);
      callback && callback({
        ok: true,
        routerRtpCapabilities: router.rtpCapabilities,
        existingProducers: listVoiceProducerInfos(socket.room, socket.id)
      });
    } catch (error) {
      console.error("voiceJoin error:", error);
      callback && callback({ ok: false, error: "voiceJoin failed" });
    }
  });

  socket.on("voiceCreateTransport", async ({ direction } = {}, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }
      const roomData = rooms[socket.room];
      if (!roomData.voiceUsers[socket.id]) {
        callback && callback({ ok: false, error: "Join voice first" });
        return;
      }

      const router = await getOrCreateVoiceRouter(socket.room);
      const peer = ensureVoicePeer(socket.room, socket.id);

      const listenIp = effectiveAnnouncedIp
        ? { ip: WEBRTC_LISTEN_IP, announcedIp: effectiveAnnouncedIp }
        : { ip: WEBRTC_LISTEN_IP };

      const transport = await router.createWebRtcTransport({
        listenIps: [listenIp],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1200000
      });

      transport.appData = { socketId: socket.id, direction: direction || "send" };

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          try { transport.close(); } catch (_) {}
        }
      });

      transport.on("close", () => {
        if (peer.transports) peer.transports.delete(transport.id);
      });

      peer.transports.set(transport.id, transport);

      callback && callback({
        ok: true,
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error("voiceCreateTransport error:", error);
      callback && callback({ ok: false, error: "voiceCreateTransport failed" });
    }
  });

  socket.on("voiceConnectTransport", async ({ transportId, dtlsParameters } = {}, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }
      const peer = ensureVoicePeer(socket.room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback && callback({ ok: false, error: "Transport not found" });
        return;
      }

      await transport.connect({ dtlsParameters });
      callback && callback({ ok: true });
    } catch (error) {
      console.error("voiceConnectTransport error:", error);
      callback && callback({ ok: false, error: "voiceConnectTransport failed" });
    }
  });

  socket.on("voiceProduce", async ({ transportId, kind, rtpParameters } = {}, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }
      const peer = ensureVoicePeer(socket.room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback && callback({ ok: false, error: "Transport not found" });
        return;
      }

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { socketId: socket.id }
      });

      peer.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });

      producer.on("close", () => {
        peer.producers.delete(producer.id);
      });

      socket.to(socket.room).emit("voiceNewProducer", {
        producerId: producer.id,
        socketId: socket.id,
        nickname: socket.nickname || "Anonymous"
      });

      callback && callback({ ok: true, id: producer.id });
    } catch (error) {
      console.error("voiceProduce error:", error);
      callback && callback({ ok: false, error: "voiceProduce failed" });
    }
  });

  socket.on("voiceConsume", async ({ transportId, producerId, rtpCapabilities } = {}, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }
      const roomData = rooms[socket.room];
      const router = roomData.voiceRouter;
      if (!router) {
        callback && callback({ ok: false, error: "Voice router not found" });
        return;
      }
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        callback && callback({ ok: false, error: "Cannot consume this producer" });
        return;
      }

      const peer = ensureVoicePeer(socket.room, socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback && callback({ ok: false, error: "Transport not found" });
        return;
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true
      });

      peer.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        socket.emit("voiceProducerClosed", { producerId });
      });

      callback && callback({
        ok: true,
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });
    } catch (error) {
      console.error("voiceConsume error:", error);
      callback && callback({ ok: false, error: "voiceConsume failed" });
    }
  });

  socket.on("voiceResumeConsumer", async ({ consumerId } = {}, callback) => {
    try {
      if (!socket.room || !rooms[socket.room]) {
        callback && callback({ ok: false, error: "Room not found" });
        return;
      }

      const peer = ensureVoicePeer(socket.room, socket.id);
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) {
        callback && callback({ ok: false, error: "Consumer not found" });
        return;
      }

      await consumer.resume();
      callback && callback({ ok: true });
    } catch (error) {
      console.error("voiceResumeConsumer error:", error);
      callback && callback({ ok: false, error: "voiceResumeConsumer failed" });
    }
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

    msg = msg.replace(/[<>]/g, "");

    const messageData = {
      msg: msg,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false
    };

    socket.to(socket.room).emit("chatMessage", messageData);
    socket.emit("chatMessage", { ...messageData, self: true });
  });


  socket.on("uploadMedia", (data) => {
    // console.log('\n=== UPLOAD MEDIA STARTED ===');
    // console.log('User:', socket.nickname);
    // console.log('Room:', socket.room);
    
    if (!socket.room || !rooms[socket.room]) {
      console.error('No room or user not in room');
      socket.emit("mediaError", "You are not in a room");
      return;
    }

    try {
      if (!data || typeof data !== 'object') {
            console.error('Invalid data format');
            return;
      }

      const { fileName, fileType, fileData, fileSize, thumbnail } = data;

      if (!fileName || !fileType || !fileData || !fileSize) {
            console.error('Missing required fields');
            return;
      }
   
      if (fileSize > MAX_FILE_SIZE) {
        console.error('File too large:', fileSize);
        socket.emit("mediaError", "File is too large (max 50MB)");
        return;
      }
    
      if (!ALLOWED_TYPES[fileType]) {
        console.error('Invalid file type:', fileType);
        socket.emit("mediaError", "File type not allowed. Only images and videos.");
        return;
      }

      if (!fileData || fileData.length < 100) {
        console.error('Invalid file data length:', fileData?.length);
        socket.emit("mediaError", "Invalid file data");
        return;
      }

   
      const fileExt = ALLOWED_TYPES[fileType];
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${fileExt}`;
      const filePath = path.join(UPLOADS_DIR, uniqueName);
      
      // console.log('Saving to:', filePath);
      
      if (!roomFiles[socket.room]) {
        roomFiles[socket.room] = [];
      }
      roomFiles[socket.room].push(uniqueName);
      
      let buffer;
      try {
        buffer = Buffer.from(fileData, 'base64');
        // console.log('Buffer created, size:', buffer.length);
      } catch (bufferError) {
        console.error('Buffer creation error:', bufferError);
        socket.emit("mediaError", "File data corrupted");
        return;
      }
      
      if (!buffer || buffer.length < 100) {
        console.error('Buffer too small:', buffer?.length);
        socket.emit("mediaError", "File data too small");
        return;
      }
      
      fs.writeFile(filePath, buffer, (writeError) => {
        if (writeError) {
          console.error('File write error:', writeError);
          socket.emit("mediaError", "Failed to save file");
          return;
        }
        
        // console.log('File saved successfully');
        
        
        const mediaMsg = {
          type: "media",
          fileName: fileName.substring(0, 100),
          fileUrl: `/uploads/${uniqueName}`,
          fileType: fileType,
          fileSize: fileSize,
          thumbnail: data.thumbnail || null,
          isImage: fileType.startsWith('image/'),
          isVideo: fileType.startsWith('video/'),
          nickname: socket.nickname,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          self: false,
          metadataStripped: true 
        };

        // console.log('Sending media message to room:', socket.room);
        
        socket.to(socket.room).emit("chatMessage", mediaMsg);
        socket.emit("chatMessage", { ...mediaMsg, self: true });

        // console.log(`✓ Media uploaded successfully: ${fileName}\n`);
      });

    } catch (error) {
      console.error("✗ Upload error:", error);
      console.error("Error stack:", error.stack);
      socket.emit("mediaError", "Upload failed: " + error.message);
    }
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
    // console.log("User disconnected:", socket.id);
    
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
        
        // console.log(`Room ${socket.room} now has ${Object.keys(rooms[socket.room].users).length} users`);
        
        
        if (Object.keys(rooms[socket.room].users).length === 0) {
          // console.log(`Room ${socket.room} is empty. Will delete in 5 minutes.`);
          setTimeout(() => {
            if (rooms[socket.room] && Object.keys(rooms[socket.room].users).length === 0) {
              // console.log(`Deleting empty room ${socket.room}`);
              deleteRoomFiles(socket.room);
              closeRoomVoice(socket.room);
              delete rooms[socket.room];
            }
          }, 300000); 
        }
      }
    }
  });
});


app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  
  // console.log('File request:', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    console.error(`File not found: ${req.params.filename}`);
    res.status(404).send('File not found');
  }
});

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", 
        "default-src 'self'; " +
        "img-src 'self' data: blob:; " +
        "media-src 'self' blob:; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " + 
        "font-src 'self' data:; " +
        "connect-src 'self' ws: wss:;"
    );
    
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    
    next();
});


const PORT = process.env.PORT || 3000;

async function startServer() {
  if (!effectiveAnnouncedIp) {
    if (WEBRTC_LISTEN_IP === "127.0.0.1") {
      effectiveAnnouncedIp = undefined;
    } else if (SERVER_HOST === "127.0.0.1" || SERVER_HOST === "localhost") {
      effectiveAnnouncedIp = undefined;
    } else {
      effectiveAnnouncedIp = detectLocalIPv4() || undefined;
    }
  }

  await initMediasoupWorker();
  if (WEBRTC_LISTEN_IP === "0.0.0.0" && !effectiveAnnouncedIp) {
    console.warn("⚠️ Could not detect WEBRTC announced IP. Set WEBRTC_ANNOUNCED_IP manually for remote clients.");
  }

  server.listen(PORT, SERVER_HOST, () => {
    console.log(`🚀 Server running on http://${SERVER_HOST}:${PORT}`);
    console.log(`🎙️ Voice SFU ready (listen ${WEBRTC_LISTEN_IP}, announced ${effectiveAnnouncedIp || "none"}, UDP/TCP ${WEBRTC_MIN_PORT}-${WEBRTC_MAX_PORT})`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
