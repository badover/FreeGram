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
const closeRoomBtn = document.getElementById("closeRoomBtn");
const safetyInfoBtn = document.getElementById("safetyInfoBtn");
const githubLinkBtn = document.getElementById("githubLinkBtn");
const safetyModal = document.getElementById("safetyModal");
const closeModalBtn = document.querySelector('.close-modal');

let currentRoom = "";
let currentNickname = "";
let typingUsers = new Map(); 
let typingTimeout = null;
let isTyping = false;


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

if (githubLinkBtn) {
  githubLinkBtn.addEventListener('click', () => {
    window.open('https://github.com/badover/FreeGram', '_blank');
  });
}


if (safetyBtn) {
  safetyBtn.addEventListener('click', showSafetyModal);
}

if (safetyInfoBtn) {
  safetyInfoBtn.addEventListener('click', showSafetyModal);
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


if (closeRoomBtn) {
  closeRoomBtn.addEventListener('click', closeRoom);
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
    socket.emit('leaveRoom', { room: currentRoom });
    
    chatScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    
    currentRoom = '';
    currentNickname = '';
    messagesList.innerHTML = '';
    
    addSystemMessage('>>> Left the room');
  }
}

function closeRoom() {
  if (!currentRoom) return;
  
  if (confirm('⚠️ CLOSE ROOM FOR EVERYONE?\nThis will kick all users and delete all files. (Only creator of the room can do it)')) {
    socket.emit('closeRoom', { room: currentRoom });
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
  
  addSystemMessage(`>>> ROOM: ${currentRoom}`);
  // addSystemMessage(">>> ALL FILES ARE STRIPPED OF METADATA");
  
  createMediaUploadButton();
  
  chatInput.focus();
});

socket.on("roomClosed", (data) => {
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
             onclick="openFullImage('${safeMediaURL(data.fileUrl)}')">
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
      <span class="message-nickname">${escapeHtml(data.nickname)} ${data.self ? '[YOU]' : ''}</span>
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

messagesList.addEventListener("click", () => {
  chatInput.focus();
});

window.addEventListener("DOMContentLoaded", () => {
  nicknameInput.value = "";
  roomInput.value = "";
  passwordInput.value = "";
  
  nicknameInput.focus();
});