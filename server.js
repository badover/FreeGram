const crypto = require("crypto");

const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 20;
const MAX_ROOM_LEN = 30;
const MAX_PASSWORD_LEN = 64;

function sanitizeString(str, maxLen) {
  if (typeof str !== "string") return null;
  str = str.trim();
  if (!str || str.length > maxLen) return null;
  return str.replace(/[<>]/g, "");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}


const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));


const rooms = {}; 

io.on("connection", (socket) => {
  socket.lastMsg = 0;
  console.log("User connected:", socket.id);

 
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
      createdAt: Date.now()
    };

    rooms[room].users[socket.id] = {
      nickname,
      joinedAt: Date.now()
    };

    socket.join(room);
    socket.room = room;
    socket.nickname = nickname;

    socket.emit("roomJoined", {
      room,
      nickname,
      userCount: 1
    });
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
      joinedAt: Date.now()
    };

    socket.join(room);
    socket.room = room;
    socket.nickname = nickname;

    socket.emit("roomJoined", {
      room,
      nickname,
      userCount: Object.keys(roomData.users).length
    });

    io.to(room).emit("updateUserCount", {
      count: Object.keys(roomData.users).length
    });
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
      msg,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      self: false
    };

    socket.to(socket.room).emit("chatMessage", messageData);
    socket.emit("chatMessage", { ...messageData, self: true });
  });


  
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    
    if (socket.room && rooms[socket.room]) {
      const userData = rooms[socket.room].users[socket.id];
      
      
      socket.to(socket.room).emit("userLeft", {
        nickname: socket.nickname
      });
      
      delete rooms[socket.room].users[socket.id];

      
      if (rooms[socket.room]) {
        io.to(socket.room).emit("updateUserCount", {
          count: Object.keys(rooms[socket.room].users).length
        });
      }

      
      if (Object.keys(rooms[socket.room].users).length === 0) {
        setTimeout(() => {
          if (rooms[socket.room] && Object.keys(rooms[socket.room].users).length === 0) {
            delete rooms[socket.room];
          }
        }, 300000);
      }
    }
  });
});

server.listen(3000, "127.0.0.1", () => {
  console.log("Server running on http://127.0.0.1:3000");
});