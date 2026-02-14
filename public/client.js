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

const createRoomBtn = document.getElementById("createRoom");
const joinRoomBtn = document.getElementById("joinRoom");
const safetyBtn = document.getElementById("safetyBtn");
const githubBtn = document.getElementById("githubBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const safetyModal = document.getElementById("safetyModal");
const closeModalBtn = document.querySelector('.close-modal');
const voiceJoinBtn = document.getElementById("voiceJoinBtn");
const voiceLeaveBtn = document.getElementById("voiceLeaveBtn");
const voiceMuteBtn = document.getElementById("voiceMuteBtn");
const voiceDeafenBtn = document.getElementById("voiceDeafenBtn");
const voiceStatusLabel = document.getElementById("voiceStatusLabel");
const voiceUsersList = document.getElementById("voiceUsersList");

let currentRoom = "";
let currentNickname = "";
let typingUsers = new Map(); 
let typingTimeout = null;
let isTyping = false;
let voiceJoined = false;
let voiceMuted = false;
let voiceDeafened = false;
let voiceLocalStream = null;
let voiceDevice = null;
let voiceSendTransport = null;
let voiceRecvTransport = null;
let voiceProducer = null;
let voiceConsumers = new Map();
let voiceAudioElements = new Map();
let voiceConsumeQueue = new Set();
let voiceVadContext = null;
let voiceVadAnalyser = null;
let voiceVadTimer = null;
let voiceSpeaking = false;
let voiceParticipants = new Map();
let voiceNeedsUnlock = false;
let voiceUnlockHintShown = false;


if (createRoomBtn) {
  createRoomBtn.addEventListener("click", () => {
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
}


if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
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
}


if (chatInput) {
    chatInput.addEventListener('input', () => {
        if (chatInput.value.trim().length > 0) {
            if (!isTyping) {
                isTyping = true;
                socket.emit('typing');
            }

            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                if (isTyping) {
                    isTyping = false;
                    socket.emit('stopTyping');
                }
            }, 1000); 
        } else {
            if (isTyping) {
                isTyping = false;
                socket.emit('stopTyping');
            }
        }
    });
    
    chatInput.addEventListener('blur', () => {
        if (isTyping) {
            isTyping = false;
            socket.emit('stopTyping');
        }
    });
    
    sendBtn.addEventListener('click', () => {
        if (isTyping) {
            isTyping = false;
            socket.emit('stopTyping');
        }
    });
}

socket.on("userTyping", (data) => {
    typingUsers.set(data.userId, data.nickname);
    updateTypingIndicator();
});

socket.on("userStoppedTyping", (data) => {
    typingUsers.delete(data.userId);
    updateTypingIndicator();
});


socket.on("userLeft", (data) => {
    for (const [userId, nickname] of typingUsers.entries()) {
        if (nickname === data.nickname) {
            typingUsers.delete(userId);
            break;
        }
    }
    updateTypingIndicator();
});

socket.on("roomJoined", () => {
    typingUsers.clear();
    updateTypingIndicator();
    isTyping = false;
});

function updateTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    
    if (!indicator) {
        createTypingIndicator();
    }
    
    const currentIndicator = document.getElementById('typingIndicator');
    
    if (typingUsers.size === 0) {
        currentIndicator.style.display = 'none';
        return;
    }
    
    const users = Array.from(typingUsers.values());
    const firstUser = users[0];
    let dots = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    
    currentIndicator.innerHTML = `
        <i class="fas fa-keyboard"></i>
        <span class="typing-text">
            <span class="username">${firstUser}</span> is typing${dots}
        </span>
    `;
    
    if (users.length > 1) {
        currentIndicator.innerHTML = `
            <i class="fas fa-keyboard"></i>
            <span class="typing-text">
                <span class="username">${firstUser}</span> and ${users.length - 1} more are typing${dots}
            </span>
        `;
    }
    
    currentIndicator.style.display = 'flex';
}

function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'typing-indicator';
    indicator.style.cssText = `
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(5, 5, 15, 0.95);
        border: 1px solid var(--neon-blue);
        color: var(--neon-blue);
        padding: 10px 20px;
        border-radius: 25px;
        font-size: 14px;
        display: none;
        align-items: center;
        gap: 12px;
        z-index: 90;
        box-shadow: 0 0 20px rgba(0, 243, 255, 0.3);
        backdrop-filter: blur(10px);
        font-family: 'Orbitron', sans-serif;
        font-weight: 500;
        letter-spacing: 1px;
        min-width: 200px;
        justify-content: center;
        border-top: 2px solid var(--neon-blue);
        border-bottom: 2px solid transparent;
    `;
    
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
        chatContainer.appendChild(indicator);
    }
}

if (githubBtn) {
  githubBtn.addEventListener('click', () => {
    window.open('https://github.com/badover/FreeGram', '_blank');
  });
}

if (safetyBtn) {
  safetyBtn.addEventListener('click', showSafetyModal);
}

if (closeModalBtn) {
  closeModalBtn.addEventListener('click', hideSafetyModal);
}

if (safetyModal) {
  safetyModal.addEventListener('click', (e) => {
    if (e.target === safetyModal) {
      hideSafetyModal();
    }
  });
}


if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener('click', leaveRoom);
}


function showSafetyModal() {
  if (safetyModal) {
    safetyModal.style.display = 'flex';
  }
}

function hideSafetyModal() {
  if (safetyModal) {
    safetyModal.style.display = 'none';
  }
}

function leaveRoom() {
  if (!currentRoom) return;
  
  if (confirm('Are you sure you want to leave this room?')) {
    leaveVoiceChannel(true);
    socket.emit('leaveRoom', { room: currentRoom });
    
    chatScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    
    currentRoom = '';
    currentNickname = '';
    messagesList.innerHTML = '';
    
    addSystemMessage('>>> Left the room');
  }
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.style.animation = "none";
  setTimeout(() => {
    loginError.style.animation = "errorFlash 0.5s";
  }, 10);
}

function safeText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.textContent;
}

function safeMediaURL(url) {
    if (typeof url !== 'string') return '#';
    if (url.includes('javascript:') || 
      url.includes('data:text/html') ||
      url.includes('onerror=') ||
      url.includes('onload=')) {
      return '#';
    }
    if (url.startsWith('/uploads/')) {
        const filename = url.substring(9); 
        if (/^[a-zA-Z0-9\.\-]+$/.test(filename)) {
            return url;
        }
    }
    
    if (url.startsWith('data:image/jpeg;base64,') ||
        url.startsWith('data:image/png;base64,') ||
        url.startsWith('data:image/gif;base64,') ||
        url.startsWith('data:image/webp;base64,')) {
        return url;
    }
    
    if (url.startsWith('blob:')) {
        return url;
    }
    
    console.warn('Blocked unsafe URL:', url.substring(0, 50));
    return '#'; 
}

socket.on("roomError", (msg) => {
  showError(msg);
});

socket.on("roomJoined", (data) => {
  currentRoom = data.room;
  currentNickname = data.nickname;
  
  currentRoomSpan.textContent = safeText(currentRoom).toUpperCase();
  currentUserSpan.textContent = safeText(currentNickname).toUpperCase();
  userCountSpan.textContent = data.userCount || 1;
  
  loginScreen.style.display = "none";
  chatScreen.style.display = "block";
  
  messagesList.innerHTML = "";
  resetVoiceStateUI();
  
  addSystemMessage(`>>> ROOM: ${currentRoom}`);
  // addSystemMessage(">>> ALL FILES ARE STRIPPED OF METADATA");
  
  createMediaUploadButton();
  
  chatInput.focus();
});

socket.on("roomClosed", (data) => {
  leaveVoiceChannel(false);
  addSystemMessage(`>>> ROOM CLOSED BY ${data.closedBy}`);
  addSystemMessage(">>> ALL FILES DELETED");
  
  setTimeout(() => {
    chatScreen.style.display = "none";
    loginScreen.style.display = "flex";
    messagesList.innerHTML = "";
    currentRoom = "";
    currentNickname = "";
  }, 3000);
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

function createMediaUploadButton() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'mediaUploadInput';
  fileInput.accept = 'image/*,video/*';
  fileInput.multiple = false;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  
  let uploadBtn = document.getElementById('mediaUploadBtn');
  
  if (!uploadBtn) {
    uploadBtn = document.createElement('button');
    uploadBtn.id = 'mediaUploadBtn';
    uploadBtn.innerHTML = '📸';
    uploadBtn.title = 'Upload photo/video (max 50MB)';
    uploadBtn.style.cssText = `
      background: var(--neon-blue);
      color: black;
      border: none;
      border-radius: 4px;
      padding: 12px 16px;
      cursor: pointer;
      font-size: 18px;
      margin-left: 10px;
      transition: all 0.3s;
    `;
    
    uploadBtn.addEventListener('mouseover', () => {
      uploadBtn.style.background = 'var(--neon-green)';
      uploadBtn.style.transform = 'scale(1.05)';
    });
    
    uploadBtn.addEventListener('mouseout', () => {
      uploadBtn.style.background = 'var(--neon-blue)';
      uploadBtn.style.transform = 'scale(1)';
    });
    
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
    
    const inputWrapper = document.querySelector('.input-wrapper');
    if (inputWrapper) {
      inputWrapper.appendChild(uploadBtn);
    }
  }
  
  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      uploadMedia(fileInput.files[0]);
      fileInput.value = '';
    }
  });
}

function uploadMedia(file) {
  if (!file) return;
  
  if (file.size > 50 * 1024 * 1024) {
    alert("File is too large (max 50MB)");
    return;
  }
  
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 
                        'video/mp4', 'video/webm', 'video/quicktime'];
  if (!allowedTypes.includes(file.type)) {
    alert("Only images and videos are allowed");
    return;
  }
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const fileData = e.target.result.split(',')[1];
    let thumbnail = null;
    
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 150;
        canvas.height = 150;
        ctx.drawImage(img, 0, 0, 150, 150);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        sendMediaToServer(file, fileData, thumbnail);
      };
      img.src = e.target.result;
    } else {
      sendMediaToServer(file, fileData, null);
    }
  };
  
  reader.onerror = (error) => {
    console.error("File read error:", error);
    addSystemMessage(`>>> Upload failed: ${file.name}`);
  };
  
  reader.readAsDataURL(file);
}

function sendMediaToServer(file, fileData, thumbnail) {
  // addSystemMessage(`>>> UPLOADING ${file.name} (METADATA WILL BE REMOVED)...`);
  
  const fileInfo = {
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    fileData: fileData,
    thumbnail: thumbnail,
    metadataStripped: true
  };
  
  socket.emit("uploadMedia", fileInfo);
}

socket.on("mediaError", (msg) => {
  addSystemMessage(`>>> MEDIA ERROR: ${msg}`);
});

socket.on("chatMessage", (data) => {
  if (data.type === 'media') {
    addMediaMessage(data);
  } else {
    addTextMessage(data);
  }
});

function addTextMessage(data) {
  const messageDiv = document.createElement("div");
  
  if (data.self) {
    messageDiv.className = "message-self";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-nickname">${data.nickname}</span>
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

function addMediaMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.className = data.self ? "message-self media-message" : "message-other media-message";
  
  const fileSize = formatFileSize(data.fileSize);
  
  let mediaContent = '';
  
  if (data.isImage) {
    mediaContent = `
      <div class="media-preview">
        <img src="${safeMediaURL(data.thumbnail || data.fileUrl)}" 
             alt="${escapeHtml(data.fileName)}"
             class="media-thumbnail"
             onclick="event.stopPropagation(); openFullImage('${safeMediaURL(data.fileUrl)}'); return false;"
             ontouchstart="event.stopPropagation();">
        <div class="media-info">
          <strong>📸 ${escapeHtml(data.fileName)}</strong>
          <small>${fileSize}</small>
          ${data.metadataStripped ? '<div class="file-warning"><i class="fas fa-check-circle"></i> METADATA REMOVED</div>' : ''}
          <a href="${safeMediaURL(data.fileUrl)}" target="_blank" class="view-link">🔍 View Full</a>
          <a href="${safeMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
        </div>
      </div>
    `;
  } else if (data.isVideo) {
    mediaContent = `
      <div class="media-preview">
        <video controls class="media-video">
          <source src="${data.fileUrl}" type="${escapeHtml(data.fileType)}">
          Your browser does not support video tag.
        </video>
        <div class="media-info">
          <strong>🎥 ${escapeHtml(data.fileName)}</strong>
          <small>${fileSize}</small>
          ${data.metadataStripped ? '<div class="file-warning"><i class="fas fa-check-circle"></i> METADATA REMOVED</div>' : ''}
          <a href="${data.fileUrl}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
        </div>
      </div>
    `;
  }
  
  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-nickname">${escapeHtml(data.nickname)}</span>
      <span class="message-time">${escapeHtml(data.time)}</span>
    </div>
    ${mediaContent}
  `;
  
  messagesList.appendChild(messageDiv);
  scrollToBottom();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

window.openFullImage = function(url) {
  if (!url.startsWith('/uploads/')) {
        console.error('Invalid image URL');
        return;
    }

  const filename = url.substring(9);
    if (!/^[a-zA-Z0-9\.\-]+$/.test(filename)) {
        console.error('Invalid filename');
        return;
    }

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
    border: 2px solid var(--neon-blue);
    border-radius: 10px;
  `;
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    background: var(--neon-red);
    color: white;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 20px;
    cursor: pointer;
  `;
  
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  modal.appendChild(img);
  modal.appendChild(closeBtn);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
};

function addSystemMessage(text) {
  const systemDiv = document.createElement("div");
  systemDiv.className = "message-system";

  const inner = document.createElement("div");
  inner.className = "system-text";
  inner.textContent = text;

  systemDiv.appendChild(inner);
  messagesList.appendChild(systemDiv);
  scrollToBottom();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  const messagesContainer = document.querySelector('.messages-container');
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
    initGlobalFileHandlers();
});

function initGlobalFileHandlers() {
    document.addEventListener('paste', handleGlobalPaste);
    
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleGlobalDrop);
    
    document.addEventListener('drop', handleBrowserFileDrop);
}

function handleGlobalPaste(e) {
    const items = e.clipboardData.items;
    
    for (const item of items) {
        if (item.type.indexOf('image') !== -1 || 
            item.type.indexOf('video') !== -1) {
            
            const file = item.getAsFile();
            if (file) {
                if (chatScreen.style.display === 'block') {
                    // addSystemMessage(`>>> Pasting ${file.type.startsWith('image/') ? 'image' : 'video'}...`);
                    uploadMedia(file);
                    e.preventDefault();
                    return;
                }
            }
        }
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    showDragIndicator();
    
    e.dataTransfer.dropEffect = 'copy';
    document.body.style.cursor = 'copy';
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.target === document || e.target === document.documentElement) {
        hideDragIndicator();
        document.body.style.cursor = '';
    }
}

function handleGlobalDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    hideDragIndicator();
    document.body.style.cursor = '';
    
    const files = e.dataTransfer.files;
    
    if (files.length > 0 && chatScreen.style.display === 'block') {
        processDroppedFiles(files);
    }
}


function handleBrowserFileDrop(e) {
    if (e.dataTransfer.types.includes('Files')) {
        return;
    }

    const text = e.dataTransfer.getData('text');
    if (text && text.includes('file://')) {
        e.preventDefault();
        addSystemMessage('>>> Drag files directly, not file paths');
    }
}

function showDragIndicator() {
    let indicator = document.getElementById('globalDragIndicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'globalDragIndicator';
        indicator.innerHTML = `
            <div class="drag-indicator-content">
                <i class="fas fa-cloud-upload-alt"></i>
                <h3>DROP TO UPLOAD</h3>
                <p>Release to upload files to chat</p>
            </div>
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.style.display = 'flex';
}

function hideDragIndicator() {
    const indicator = document.getElementById('globalDragIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}


function processDroppedFiles(files) {
    const validFiles = Array.from(files).filter(file => 
        file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    
    if (validFiles.length === 0) {
        addSystemMessage('>>> Only images and videos are supported');
        return;
    }
    
    if (validFiles.length > 5) {
        // addSystemMessage(`>>> Uploading ${validFiles.length} files...`);
    }
    
    validFiles.forEach((file, index) => {
        setTimeout(() => {
            uploadMedia(file);
        }, index * 300); 
    });
}


function uploadMedia(file) {
    if (!file) return;
    addUploadNotification(file);
    
    if (file.size > 50 * 1024 * 1024) {
        alert("File is too large (max 50MB)");
        return;
    }
    
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 
                          'video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(file.type)) {
        alert("Only images and videos are allowed");
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const fileData = e.target.result.split(',')[1];
        let thumbnail = null;
        
        if (file.type.startsWith('image/')) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 150;
                canvas.height = 150;
                ctx.drawImage(img, 0, 0, 150, 150);
                thumbnail = canvas.toDataURL('image/jpeg', 0.7);
                sendMediaToServer(file, fileData, thumbnail);
            };
            img.src = e.target.result;
        } else {
            sendMediaToServer(file, fileData, null);
        }
    };
    
    reader.onerror = (error) => {
        console.error("File read error:", error);
        addSystemMessage(`>>> Upload failed: ${file.name}`);
    };
    
    reader.readAsDataURL(file);
}

function addUploadNotification(file) {
    const notification = document.createElement('div');
    notification.className = 'upload-notification';
    notification.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Uploading ${file.name}...</span>
    `;
    
    document.querySelector('.messages-container').appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function resetVoiceStateUI() {
  voiceJoined = false;
  voiceMuted = false;
  voiceDeafened = false;
  voiceSpeaking = false;
  voiceParticipants.clear();
  voiceConsumeQueue.clear();
  renderVoiceParticipants();
  updateVoiceButtons();
}

function updateVoiceButtons() {
  if (voiceJoinBtn) voiceJoinBtn.disabled = voiceJoined;
  if (voiceLeaveBtn) voiceLeaveBtn.disabled = !voiceJoined;
  if (voiceMuteBtn) {
    voiceMuteBtn.disabled = !voiceJoined;
    voiceMuteBtn.classList.toggle("active", voiceMuted);
    voiceMuteBtn.innerHTML = voiceMuted
      ? '<i class="fas fa-microphone-slash"></i> UNMUTE'
      : '<i class="fas fa-microphone"></i> MUTE';
  }
  if (voiceDeafenBtn) {
    voiceDeafenBtn.disabled = !voiceJoined;
    voiceDeafenBtn.classList.toggle("active", voiceDeafened);
    voiceDeafenBtn.innerHTML = voiceDeafened
      ? '<i class="fas fa-volume-up"></i> UNDEAFEN'
      : '<i class="fas fa-headphones"></i> DEAFEN';
  }
  if (voiceStatusLabel) {
    if (!voiceJoined) {
      voiceStatusLabel.textContent = "VOICE: OFF";
    } else if (voiceDeafened) {
      voiceStatusLabel.textContent = "VOICE: DEAFENED";
    } else if (voiceMuted) {
      voiceStatusLabel.textContent = "VOICE: MUTED";
    } else {
      voiceStatusLabel.textContent = "VOICE: LIVE";
    }
  }
}

function renderVoiceParticipants() {
  if (!voiceUsersList) return;
  voiceUsersList.innerHTML = "";

  if (voiceParticipants.size === 0) {
    const empty = document.createElement("div");
    empty.className = "voice-user voice-empty";
    empty.textContent = "No one in voice";
    voiceUsersList.appendChild(empty);
    return;
  }

  for (const participant of voiceParticipants.values()) {
    const item = document.createElement("div");
    item.className = "voice-user";
    if (voiceJoined && participant.speaking) item.classList.add("speaking");

    const flags = [];
    if (participant.muted) flags.push("MUTED");
    if (participant.deafened) flags.push("DEAF");

    item.textContent = `${participant.nickname}${participant.socketId === socket.id ? " [YOU]" : ""}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    voiceUsersList.appendChild(item);
  }
}

function voiceRequest(eventName, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (response) => {
      if (!response || response.ok === false) {
        reject(new Error(response?.error || `${eventName} failed`));
        return;
      }
      resolve(response);
    });
  });
}

function startVoiceVad(stream) {
  stopVoiceVad();

  voiceVadContext = new AudioContext();
  const source = voiceVadContext.createMediaStreamSource(stream);
  voiceVadAnalyser = voiceVadContext.createAnalyser();
  voiceVadAnalyser.fftSize = 1024;
  source.connect(voiceVadAnalyser);

  const data = new Uint8Array(voiceVadAnalyser.fftSize);
  voiceVadTimer = setInterval(() => {
    if (!voiceJoined || voiceMuted || voiceDeafened || !voiceVadAnalyser) {
      if (voiceSpeaking) {
        voiceSpeaking = false;
        socket.emit("voiceStateUpdate", { speaking: false });
      }
      return;
    }

    voiceVadAnalyser.getByteTimeDomainData(data);
    let total = 0;
    for (let i = 0; i < data.length; i += 1) {
      total += Math.abs(data[i] - 128);
    }

    const level = total / data.length;
    const nowSpeaking = level > 3.2;
    if (nowSpeaking !== voiceSpeaking) {
      voiceSpeaking = nowSpeaking;
      socket.emit("voiceStateUpdate", { speaking: nowSpeaking });
    }
  }, 120);
}

function stopVoiceVad() {
  if (voiceVadTimer) {
    clearInterval(voiceVadTimer);
    voiceVadTimer = null;
  }
  if (voiceVadContext) {
    voiceVadContext.close().catch(() => {});
    voiceVadContext = null;
    voiceVadAnalyser = null;
  }
}

function cleanupConsumer(producerId) {
  const item = voiceConsumers.get(producerId);
  if (!item) return;

  try { item.consumer.close(); } catch (_) {}
  if (item.audioEl) {
    item.audioEl.pause();
    item.audioEl.srcObject = null;
    item.audioEl.remove();
  }

  voiceConsumers.delete(producerId);
  voiceAudioElements.delete(producerId);
}

function tryPlayRemoteAudio(audioEl) {
  if (!audioEl) return;
  const playPromise = audioEl.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      voiceNeedsUnlock = true;
      if (!voiceUnlockHintShown) {
        voiceUnlockHintShown = true;
        addSystemMessage(">>> Click anywhere once to unlock voice audio");
      }
    });
  }
}

function unlockVoiceAudio() {
  if (!voiceNeedsUnlock) return;
  for (const audioEl of voiceAudioElements.values()) {
    tryPlayRemoteAudio(audioEl);
  }
  const allReady = Array.from(voiceAudioElements.values()).every((el) => !el.paused);
  if (allReady) {
    voiceNeedsUnlock = false;
    voiceUnlockHintShown = false;
  }
}

async function consumeProducer(producerId) {
  if (!voiceJoined || !voiceDevice || !voiceRecvTransport || !producerId) return;
  if (voiceConsumers.has(producerId) || voiceConsumeQueue.has(producerId)) return;

  voiceConsumeQueue.add(producerId);
  try {
    const consumeData = await voiceRequest("voiceConsume", {
      transportId: voiceRecvTransport.id,
      producerId,
      rtpCapabilities: voiceDevice.rtpCapabilities
    });

    const consumer = await voiceRecvTransport.consume({
      id: consumeData.id,
      producerId: consumeData.producerId,
      kind: consumeData.kind,
      rtpParameters: consumeData.rtpParameters
    });

    const stream = new MediaStream([consumer.track]);
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.srcObject = stream;
    audioEl.muted = !!voiceDeafened;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    tryPlayRemoteAudio(audioEl);

    voiceConsumers.set(producerId, { consumer, audioEl });
    voiceAudioElements.set(producerId, audioEl);

    consumer.on("transportclose", () => cleanupConsumer(producerId));
    consumer.on("producerclose", () => cleanupConsumer(producerId));
    consumer.on("trackended", () => cleanupConsumer(producerId));

    await voiceRequest("voiceResumeConsumer", { consumerId: consumer.id });
  } catch (error) {
    console.error("consumeProducer error:", error);
  } finally {
    voiceConsumeQueue.delete(producerId);
  }
}

async function joinVoiceChannel() {
  if (!currentRoom || voiceJoined) return;
  if (!window.mediasoupClient || !window.mediasoupClient.Device) {
    addSystemMessage(">>> Voice error: mediasoup-client bundle missing");
    return;
  }

  try {
    voiceLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
  } catch (error) {
    addSystemMessage(">>> Voice error: microphone access denied");
    return;
  }

  try {
    const joinData = await voiceRequest("voiceJoin");
    voiceDevice = new window.mediasoupClient.Device();
    await voiceDevice.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });

    const sendTransportData = await voiceRequest("voiceCreateTransport", { direction: "send" });
    voiceSendTransport = voiceDevice.createSendTransport({
      id: sendTransportData.id,
      iceParameters: sendTransportData.iceParameters,
      iceCandidates: sendTransportData.iceCandidates,
      dtlsParameters: sendTransportData.dtlsParameters
    });

    voiceSendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      voiceRequest("voiceConnectTransport", {
        transportId: voiceSendTransport.id,
        dtlsParameters
      }).then(() => callback()).catch(errback);
    });

    voiceSendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
      voiceRequest("voiceProduce", {
        transportId: voiceSendTransport.id,
        kind,
        rtpParameters
      }).then((result) => callback({ id: result.id })).catch(errback);
    });

    const recvTransportData = await voiceRequest("voiceCreateTransport", { direction: "recv" });
    voiceRecvTransport = voiceDevice.createRecvTransport({
      id: recvTransportData.id,
      iceParameters: recvTransportData.iceParameters,
      iceCandidates: recvTransportData.iceCandidates,
      dtlsParameters: recvTransportData.dtlsParameters
    });

    voiceRecvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      voiceRequest("voiceConnectTransport", {
        transportId: voiceRecvTransport.id,
        dtlsParameters
      }).then(() => callback()).catch(errback);
    });

    const micTrack = voiceLocalStream.getAudioTracks()[0];
    voiceProducer = await voiceSendTransport.produce({ track: micTrack });

    voiceJoined = true;
    voiceMuted = false;
    voiceDeafened = false;
    voiceSpeaking = false;

    startVoiceVad(voiceLocalStream);
    updateVoiceButtons();
    socket.emit("voiceStateUpdate", { muted: false, deafened: false, speaking: false });
    addSystemMessage(">>> Voice connected");

    for (const producerInfo of (joinData.existingProducers || [])) {
      await consumeProducer(producerInfo.producerId);
    }
  } catch (error) {
    console.error("joinVoiceChannel error:", error);
    addSystemMessage(`>>> Voice error: ${error.message}`);
    leaveVoiceChannel(true);
  }
}

function leaveVoiceChannel(notifyServer) {
  if (!voiceJoined && !voiceLocalStream && !voiceDevice) {
    resetVoiceStateUI();
    return;
  }

  if (notifyServer) {
    socket.emit("voiceLeave", {}, () => {});
  }

  stopVoiceVad();
  if (voiceProducer) {
    try { voiceProducer.close(); } catch (_) {}
    voiceProducer = null;
  }
  for (const producerId of Array.from(voiceConsumers.keys())) {
    cleanupConsumer(producerId);
  }
  if (voiceSendTransport) {
    try { voiceSendTransport.close(); } catch (_) {}
    voiceSendTransport = null;
  }
  if (voiceRecvTransport) {
    try { voiceRecvTransport.close(); } catch (_) {}
    voiceRecvTransport = null;
  }
  if (voiceLocalStream) {
    voiceLocalStream.getTracks().forEach((track) => track.stop());
    voiceLocalStream = null;
  }
  voiceDevice = null;

  voiceJoined = false;
  voiceMuted = false;
  voiceDeafened = false;
  voiceSpeaking = false;
  voiceParticipants.clear();
  voiceConsumeQueue.clear();
  voiceConsumers.clear();
  voiceAudioElements.clear();

  renderVoiceParticipants();
  updateVoiceButtons();
}

async function toggleVoiceMute() {
  if (!voiceJoined) return;
  voiceMuted = !voiceMuted;
  if (voiceMuted || voiceDeafened) {
    if (voiceProducer && !voiceProducer.paused) await voiceProducer.pause();
  } else if (voiceProducer && voiceProducer.paused) {
    await voiceProducer.resume();
  }
  if (voiceMuted) voiceSpeaking = false;

  socket.emit("voiceStateUpdate", {
    muted: voiceMuted,
    deafened: voiceDeafened,
    speaking: voiceSpeaking
  });
  updateVoiceButtons();
}

async function toggleVoiceDeafen() {
  if (!voiceJoined) return;

  voiceDeafened = !voiceDeafened;
  if (voiceDeafened) {
    voiceMuted = true;
    voiceSpeaking = false;
  }

  for (const audioEl of voiceAudioElements.values()) {
    audioEl.muted = !!voiceDeafened;
  }

  if (voiceDeafened || voiceMuted) {
    if (voiceProducer && !voiceProducer.paused) await voiceProducer.pause();
  } else if (voiceProducer && voiceProducer.paused) {
    await voiceProducer.resume();
  }

  socket.emit("voiceStateUpdate", {
    muted: voiceMuted,
    deafened: voiceDeafened,
    speaking: voiceSpeaking
  });
  updateVoiceButtons();
}

if (voiceJoinBtn) {
  voiceJoinBtn.addEventListener("click", () => {
    joinVoiceChannel().catch((error) => {
      console.error("voice join click error:", error);
    });
  });
}

if (voiceLeaveBtn) {
  voiceLeaveBtn.addEventListener("click", () => {
    leaveVoiceChannel(true);
    addSystemMessage(">>> Voice disconnected");
  });
}

if (voiceMuteBtn) {
  voiceMuteBtn.addEventListener("click", () => {
    toggleVoiceMute().catch((error) => {
      console.error("voice mute toggle error:", error);
    });
  });
}

if (voiceDeafenBtn) {
  voiceDeafenBtn.addEventListener("click", () => {
    toggleVoiceDeafen().catch((error) => {
      console.error("voice deafen toggle error:", error);
    });
  });
}

socket.on("voiceParticipants", ({ participants } = {}) => {
  const nextParticipants = new Map();
  (participants || []).forEach((participant) => {
    nextParticipants.set(participant.socketId, participant);
  });
  voiceParticipants = nextParticipants;
  renderVoiceParticipants();
});

socket.on("voiceUserLeft", ({ socketId } = {}) => {
  if (!socketId) return;
});

socket.on("voiceRoomClosed", () => {
  leaveVoiceChannel(false);
});

socket.on("voiceNewProducer", ({ producerId } = {}) => {
  if (!voiceJoined || !producerId) return;
  consumeProducer(producerId).catch((error) => {
    console.error("voiceNewProducer consume error:", error);
  });
});

socket.on("voiceProducerClosed", ({ producerId } = {}) => {
  if (!producerId) return;
  cleanupConsumer(producerId);
});

socket.on("disconnect", () => {
  leaveVoiceChannel(false);
});

document.addEventListener('keydown', handleEscapeKey);

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        closeFullImageModal();
        hideSafetyModal();
        hideDragIndicator();
        document.body.style.cursor = '';
        
        const fileInput = document.getElementById('mediaUploadInput');
        if (fileInput && document.activeElement === fileInput) {
            fileInput.value = '';
            chatInput.focus();
        }
    }
}

window.openFullImage = function(url) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 9999;
        display: flex;
        justify-content: center;
        align-items: center;
    `;
    
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        border: 2px solid var(--neon-blue);
        border-radius: 10px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.className = 'modal-close-btn';
    closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: var(--neon-red);
        color: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 20px;
        cursor: pointer;
        z-index: 10000;
    `;
    
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    window.currentImageModal = modal;
}

function closeFullImageModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) {
        document.body.removeChild(modal);
        window.currentImageModal = null;
    }
}

function hideDragIndicator() {
    const indicator = document.getElementById('globalDragIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    isDragging = false;
}

let isDragging = false;

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!isDragging) {
        isDragging = true;
        showDragIndicator();
    }
    
    e.dataTransfer.dropEffect = 'copy';
    document.body.style.cursor = 'copy';
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.target === document || e.target === document.documentElement) {
        isDragging = false;
        hideDragIndicator();
        document.body.style.cursor = '';
    }
}

function handleGlobalDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    isDragging = false;
    hideDragIndicator();
    document.body.style.cursor = '';
    
    const files = e.dataTransfer.files;
    
    if (files.length > 0 && chatScreen.style.display === 'block') {
        processDroppedFiles(files);
    }
}

messagesList.addEventListener("click", (e) => {
  if (!chatInput) return;

  const interactiveTarget = e.target.closest(
    ".media-thumbnail, .view-link, .download-link, video, a, button, input, textarea"
  );

  if (interactiveTarget) return;
  chatInput.focus();
});

window.addEventListener("DOMContentLoaded", () => {
  nicknameInput.value = "";
  roomInput.value = "";
  passwordInput.value = "";
  resetVoiceStateUI();
  
  nicknameInput.focus();
});

window.addEventListener("beforeunload", () => {
  if (voiceJoined) {
    socket.emit("voiceLeave", {}, () => {});
  }
  stopVoiceVad();
});

document.addEventListener("click", unlockVoiceAudio, { passive: true });
document.addEventListener("keydown", unlockVoiceAudio);
