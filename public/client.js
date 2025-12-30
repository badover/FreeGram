const socket = io();


const loginScreen = document.getElementById("login-screen");
const chatScreen = document.getElementById("chat-screen");
const nicknameInput = document.getElementById("nickname");
const roomInput = document.getElementById("room");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("loginError");
const messagesList = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const currentRoomSpan = document.getElementById("currentRoom");
const currentUserSpan = document.getElementById("currentUser");
const userCountSpan = document.getElementById("userCount"); 
let currentRoom = "";
let currentNickname = "";


document.getElementById("createRoom").addEventListener("click", () => {
  const room = roomInput.value.trim();
  const password = passwordInput.value;
  const nickname = nicknameInput.value.trim() || "Anonymous";

  if (!room) {
    showError("Enter room name");
    return;
  }

  if (!password) {
    showError("Enter password");
    return;
  }

  loginError.textContent = "";
  socket.emit("createRoom", { room, password, nickname });
});


document.getElementById("joinRoom").addEventListener("click", () => {
  const room = roomInput.value.trim();
  const password = passwordInput.value;
  const nickname = nicknameInput.value.trim() || "Anonymous";

  if (!room) {
    showError("Enter room name");
    return;
  }

  if (!password) {
    showError("Enter password");
    return;
  }

  loginError.textContent = "";
  socket.emit("joinRoom", { room, password, nickname });
});

function showError(msg) {
  loginError.textContent = msg;
  loginError.style.animation = "none";
  setTimeout(() => {
    loginError.style.animation = "errorFlash 0.5s";
  }, 10);
}


socket.on("roomError", (msg) => {
  showError(msg);
});


socket.on("roomJoined", (data) => {
  currentRoom = data.room;
  currentNickname = data.nickname;
  

  currentRoomSpan.textContent = `ROOM: ${currentRoom.toUpperCase()}`;
  currentUserSpan.textContent = `USER: ${currentNickname.toUpperCase()}`;
  userCountSpan.textContent = data.userCount || 1; 
  

  loginScreen.style.display = "none";
  chatScreen.style.display = "block";
  
  
  messagesList.innerHTML = "";
  
 
  addSystemMessage(`>>> ROOM: ${currentRoom}`);
//   addSystemMessage(`>>> YOUR NICK: ${currentNickname}`);
//   addSystemMessage(">>> ENCRYPTION ACTIVE");
//   addSystemMessage(">>> ALL COMMUNICATIONS MONITORED");
  
  
  chatInput.focus();
});


socket.on("userJoined", (data) => {
  addSystemMessage(`>>> ${data.nickname.toUpperCase()} CONNECTED`);
});


socket.on("userLeft", (data) => {
  addSystemMessage(`>>> ${data.nickname.toUpperCase()} DISCONNECTED`);
});


socket.on("updateUserCount", (data) => {
  if (userCountSpan) {
    userCountSpan.textContent = data.count;
  }
});


sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;

  socket.emit("chatMessage", msg);
  chatInput.value = "";
}


socket.on("chatMessage", (data) => {
  addMessage(data);
});


function addMessage(data) {
  const messageDiv = document.createElement("div");
  
  if (data.self) {
    messageDiv.className = "message-self";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-nickname">${data.nickname} [YOU]</span>
        <span class="message-time">${data.time}</span>
      </div>
      <div class="message-content">${escapeHtml(data.msg)}</div>
    `;
  } else {
    messageDiv.className = "message-other";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-nickname">${data.nickname}</span>
        <span class="message-time">${data.time}</span>
      </div>
      <div class="message-content">${escapeHtml(data.msg)}</div>
    `;
  }
  
  messagesList.appendChild(messageDiv);
  scrollToBottom();
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


function addSystemMessage(text) {
  const systemDiv = document.createElement("div");
  systemDiv.className = "message-system";
  systemDiv.innerHTML = `
    <div class="system-text">${text}</div>
  `;
  messagesList.appendChild(systemDiv);
  scrollToBottom();
}


function scrollToBottom() {
  const messagesContainer = document.querySelector('.messages-container');
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}


messagesList.addEventListener("click", () => {
  chatInput.focus();
});


window.addEventListener("DOMContentLoaded", () => {
  nicknameInput.value = "";
  roomInput.value = "";
  passwordInput.value = "";
  
  nicknameInput.focus();
});

