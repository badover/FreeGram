const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));


const rooms = {}; 

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

 
  socket.on("createRoom", ({ room, password, nickname }) => {
    if (rooms[room]) {
      socket.emit("roomError", "Room already exists");
      return;
    }

    rooms[room] = {
      password,
      users: {},
      createdAt: new Date().toISOString()
    };

    rooms[room].users[socket.id] = {
      nickname: nickname || "Anonymous",
      joinedAt: new Date().toISOString()
    };
    
    socket.join(room);
    socket.room = room;
    socket.nickname = nickname || "Anonymous";

    socket.emit("roomJoined", { 
      room, 
      nickname: nickname || "Anonymous",
      userCount: Object.keys(rooms[room].users).length 
    });
    
    
    console.log(`Room created: ${room}`);
  });

  
  socket.on("joinRoom", ({ room, password, nickname }) => {
    if (!rooms[room]) {
      socket.emit("roomError", "Room doesn't exist");
      return;
    }

    if (rooms[room].password !== password) {
      socket.emit("roomError", "Incorrect password");
      return;
    }

    rooms[room].users[socket.id] = {
      nickname: nickname || "Anonymous",
      joinedAt: new Date().toISOString()
    };
    
    socket.join(room);
    socket.room = room;
    socket.nickname = nickname || "Anonymous";

    socket.emit("roomJoined", { 
      room, 
      nickname: nickname || "Anonymous",
      userCount: Object.keys(rooms[room].users).length 
    });
    
    
    io.to(room).emit("updateUserCount", {
      count: Object.keys(rooms[room].users).length
    });
    
    
    console.log(`User joined ${room}`);
  });

  
  socket.on("chatMessage", (msg) => {
    if (!socket.room || !rooms[socket.room]) return;

    const messageData = {
      msg,
      nickname: socket.nickname,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: false
    };

    
    socket.to(socket.room).emit("chatMessage", messageData);
    
    
    socket.emit("chatMessage", {
      ...messageData,
      self: true
    });
    
   
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

server.listen(3000, () => console.log("Server running on http://localhost:3000"));