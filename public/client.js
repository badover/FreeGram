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
let voicePeerConnections = new Map();
let voiceAudioElements = new Map();
let voiceUserVolumes = new Map();
let voiceVadContext = null;
let voiceVadAnalyser = null;
let voiceVadTimer = null;
let voiceVadNoiseFloor = 0.6;
let voiceVadAboveCount = 0;
let voiceVadLastAboveTime = 0;
let voiceSpeaking = false;
let voiceParticipants = new Map();
let voiceNeedsUnlock = false;
let voiceUnlockHintShown = false;
let voiceContextMenu = null;

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
// Keep the raw chunk far below the server limit so base64 transport never trips
// the server with larger images or videos.
const CHUNK_SIZE = 512 * 1024;
const THUMBNAIL_SIZE_LIMIT = 8 * 1024 * 1024;
const MAX_CHAT_LENGTH = 4000;
const DEFAULT_VOICE_USER_VOLUME = 100;
const VOICE_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
const VOICE_VAD_INTERVAL_MS = 60;
const VOICE_VAD_ONSET_FRAMES = 2;
const VOICE_VAD_HANGOVER_MS = 400;
const VOICE_VAD_MARGIN = 3.5;
const VOICE_VAD_NOISE_SMOOTHING = 0.05;

function normalizeUploadMime(file) {
  if (file && typeof file.type === "string" && file.type.trim()) {
    return file.type.trim();
  }
  return "application/octet-stream";
}

function isPreviewableImage(fileType) {
  return typeof fileType === "string" &&
    /^image\/(jpeg|jpg|png|gif|webp)$/i.test(fileType);
}

function getFileEmoji(fileType = "", fileName = "") {
  const normalizedType = String(fileType).toLowerCase();
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (normalizedType.startsWith("image/")) return "📸";
  if (normalizedType.startsWith("video/")) return "🎥";
  if (normalizedType.startsWith("audio/")) return "🎵";
  if (normalizedType.includes("pdf") || ext === "pdf") return "📄";
  if (/(zip|rar|7z|tar|gz)/.test(normalizedType) || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (/(json|xml|javascript|typescript|shellscript|x-sh|html|css|csv|plain)/.test(normalizedType) || ["js", "ts", "json", "xml", "html", "css", "sh", "txt", "md", "csv"].includes(ext)) return "🧾";
  return "📎";
}

function buildThumbnailAndSend(file, fileData) {
  if (!isPreviewableImage(file.type) || file.size > THUMBNAIL_SIZE_LIMIT) {
    sendMediaToServer(file, fileData, null);
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 150;
    canvas.height = 150;
    ctx.drawImage(img, 0, 0, 150, 150);
    const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
    sendMediaToServer(file, fileData, thumbnail);
    URL.revokeObjectURL(objectUrl);
  };
  img.onerror = function() {
    sendMediaToServer(file, fileData, null);
    URL.revokeObjectURL(objectUrl);
  };
  img.src = objectUrl;
}

function resizeChatInput() {
  if (!chatInput) return;
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
}

function normalizeOutgoingMessage(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}


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
        resizeChatInput();
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

    chatInput.addEventListener("paste", () => {
      requestAnimationFrame(resizeChatInput);
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
    updateTypingIndicatorPosition();
    
    if (typingUsers.size === 0) {
        currentIndicator.style.display = 'none';
        return;
    }
    
    const users = Array.from(typingUsers.values());
    const firstUser = String(users[0] || "Someone");
    const safeFirstUser = escapeHtml(firstUser);
    let dots = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    
    currentIndicator.innerHTML = `
        <i class="fas fa-keyboard"></i>
        <span class="typing-text">
            <span class="username">${safeFirstUser}</span> is typing${dots}
        </span>
    `;
    
    if (users.length > 1) {
        currentIndicator.innerHTML = `
            <i class="fas fa-keyboard"></i>
            <span class="typing-text">
                <span class="username">${safeFirstUser}</span> and ${users.length - 1} more are typing${dots}
            </span>
        `;
    }
    
    currentIndicator.style.display = 'flex';
}

function updateTypingIndicatorPosition() {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;

    const inputPanel = document.querySelector('.input-panel');
    const voicePanel = document.querySelector('.voice-panel');
    const bottomOffset = (inputPanel?.offsetHeight || 0) + (voicePanel?.offsetHeight || 0) + 12;

    indicator.style.bottom = `${bottomOffset}px`;
}

function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'typingIndicator';
    indicator.className = 'typing-indicator';
    indicator.style.cssText = `
        position: absolute;
        bottom: 120px;
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
    updateTypingIndicatorPosition();
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

function getErrorMessage(payload, fallback = "An unexpected error occurred") {
  if (typeof payload === "string") {
    const message = payload.trim();
    return message || fallback;
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  }

  return fallback;
}

function showError(msg) {
  const message = getErrorMessage(msg);

  if (loginError) {
    loginError.textContent = message;
    loginError.style.animation = "none";
    setTimeout(() => {
      loginError.style.animation = "errorFlash 0.5s";
    }, 10);
    return;
  }

  console.error(message);
  window.alert(message);
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

socket.on("error", (payload) => {
  console.error("Socket error:", payload);
  showError(GENERIC_ERROR_MESSAGE);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  showError(GENERIC_ERROR_MESSAGE);
});

socket.on("disconnect", (reason) => {
  if (reason === "io client disconnect") return;
  console.error("Disconnected:", reason);
  showError(GENERIC_ERROR_MESSAGE);
});

socket.on("roomError", (msg) => {
  console.error("Room error:", msg);
  showError(GENERIC_ERROR_MESSAGE);
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
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const msg = normalizeOutgoingMessage(chatInput.value);
  if (!msg) return;
  if (msg.length > MAX_CHAT_LENGTH) {
    addSystemMessage(`>>> Message too long (${msg.length}/${MAX_CHAT_LENGTH})`);
    return;
  }

  socket.emit("chatMessage", msg);
  chatInput.value = "";
  resizeChatInput();
}

function createMediaUploadButton() {
  let uploadInput = document.getElementById('mediaUploadInput');
  if (!uploadInput) {
    uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.id = 'mediaUploadInput';
    uploadInput.multiple = false;
    uploadInput.style.display = 'none';
    document.body.appendChild(uploadInput);
  }

  const inputWrapper = document.querySelector('.input-wrapper');
  if (!inputWrapper) return;

  let uploadBtn = document.getElementById('mediaUploadBtn');
  if (!uploadBtn) {
    uploadBtn = document.createElement('button');
    uploadBtn.id = 'mediaUploadBtn';
    uploadBtn.type = 'button';
    uploadBtn.className = 'upload-action-btn';
    uploadBtn.innerHTML = '<span aria-hidden="true">📎</span>';
    uploadBtn.title = 'Upload photo, video or file';
    uploadBtn.setAttribute('aria-label', 'Upload photo, video or file');
    uploadBtn.addEventListener('click', () => {
      uploadInput.click();
    });
    inputWrapper.appendChild(uploadBtn);
  }

  if (!uploadInput.dataset.bound) {
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files.length > 0) {
        uploadMedia(uploadInput.files[0]);
        uploadInput.value = '';
      }
    });
    uploadInput.dataset.bound = 'true';
  }
}

function uint8ToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function emitUploadChunk(payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Upload timed out"));
    }, 60000);

    try {
      socket.timeout(60000).emit("uploadMediaChunk", payload, (err, response) => {
        clearTimeout(timer);
        if (err) {
          reject(err instanceof Error ? err : new Error("Upload timed out"));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error((response && response.error) || "Upload failed"));
          return;
        }
        resolve(response);
      });
    } catch (emitError) {
      clearTimeout(timer);
      reject(emitError);
    }
  });
}

async function sendMediaToServer(file, fileData, thumbnail) {
  const bytes = fileData instanceof ArrayBuffer
    ? new Uint8Array(fileData)
    : new Uint8Array(fileData);

  if (!bytes.byteLength) {
    console.error("Upload failed: empty file", file.name);
    addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
    return;
  }

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
  const fileType = normalizeUploadMime(file);

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, bytes.byteLength);
      const chunk = bytes.subarray(start, end);

      // Base64 keeps chunk payloads reliable across Socket.IO transports.
      const response = await emitUploadChunk({
        uploadId,
        fileName: file.name || "file",
        fileType,
        fileSize: file.size || bytes.byteLength,
        thumbnail: index === 0 ? thumbnail : null,
        chunkIndex: index,
        totalChunks,
        chunkData: uint8ToBase64(chunk)
      });

      if (response.complete) {
        return;
      }
    }
  } catch (error) {
    console.error("Upload failed:", file.name, error);
    const message = error && error.message ? String(error.message) : "unknown error";
    // Server-side failures already arrive via the mediaError event.
    if (/timed out|network|disconnected|Upload failed$/i.test(message)) {
      addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
    }
  }
}

socket.on("mediaError", (msg) => {
  console.error("Media error:", msg);
  addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
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
  const messageHtml = linkifyMessageText(data.msg);
  const nickname = escapeHtml(String(data.nickname || ""));
  const time = escapeHtml(String(data.time || ""));
  
  if (data.self) {
    messageDiv.className = "message-self";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-nickname">${nickname}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${messageHtml}</div>
    `;
  } else {
    messageDiv.className = "message-other";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-nickname">${nickname}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${messageHtml}</div>
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
             data-full-url="${safeMediaURL(data.fileUrl)}">
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
          <source src="${safeMediaURL(data.fileUrl)}" type="${escapeHtml(data.fileType)}">
          Your browser does not support video tag.
        </video>
        <div class="media-info">
          <strong>🎥 ${escapeHtml(data.fileName)}</strong>
          <small>${fileSize}</small>
          ${data.metadataStripped ? '<div class="file-warning"><i class="fas fa-check-circle"></i> METADATA REMOVED</div>' : ''}
          <a href="${safeMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
        </div>
      </div>
    `;
  } else {
    mediaContent = `
      <div class="media-preview media-preview-file">
        <div class="media-file-icon" aria-hidden="true">${getFileEmoji(data.fileType, data.fileName)}</div>
        <div class="media-info">
          <strong>${getFileEmoji(data.fileType, data.fileName)} ${escapeHtml(data.fileName)}</strong>
          <small>${fileSize}${data.fileType ? ` • ${escapeHtml(data.fileType)}` : ''}</small>
          <a href="${safeMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
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
  const zoomableMedia = messageDiv.querySelector(".media-thumbnail");
  if (zoomableMedia) {
    attachPreviewZoom(zoomableMedia);
    zoomableMedia.addEventListener("click", (event) => {
      event.stopPropagation();
      openFullImage(zoomableMedia.dataset.fullUrl);
    });
  }
  scrollToBottom();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function clampZoomLevel(value, min = 1, max = 4) {
  return Math.min(max, Math.max(min, value));
}

function setZoomOriginFromPointer(mediaEl, clientX, clientY) {
  if (!mediaEl || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  const rect = mediaEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  const clampedX = Math.min(100, Math.max(0, x));
  const clampedY = Math.min(100, Math.max(0, y));

  mediaEl.style.transformOrigin = `${clampedX}% ${clampedY}%`;
}

function applyPreviewZoom(mediaEl, zoom) {
  if (!mediaEl) return;
  const normalizedZoom = clampZoomLevel(zoom);
  mediaEl.dataset.zoom = String(normalizedZoom);
  mediaEl.style.transform = `scale(${normalizedZoom})`;
}

function attachPreviewZoom(mediaEl) {
  if (!mediaEl || mediaEl.dataset.zoomBound === "true") return;

  applyPreviewZoom(mediaEl, Number(mediaEl.dataset.zoom || 1));

  mediaEl.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoomOriginFromPointer(mediaEl, event.clientX, event.clientY);
    const currentZoom = Number(mediaEl.dataset.zoom || 1);
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    applyPreviewZoom(mediaEl, currentZoom + delta);
  }, { passive: false });

  mediaEl.addEventListener("dblclick", (event) => {
    event.preventDefault();
    applyPreviewZoom(mediaEl, 1);
  });

  mediaEl.dataset.zoomBound = "true";
}

function handleVideoFullscreenChange() {
  const fsEl = document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement;

  document.querySelectorAll(".media-video").forEach((videoEl) => {
    if (videoEl === fsEl) {
      videoEl.style.setProperty("border", "none", "important");
      videoEl.style.setProperty("border-radius", "0", "important");
    } else {
      videoEl.style.removeProperty("border");
      videoEl.style.removeProperty("border-radius");
    }
  });
}

["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((eventName) => {
  document.addEventListener(eventName, handleVideoFullscreenChange);
});

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

function normalizeLinkHref(rawUrl) {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl) return null;
  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function trimTrailingLinkPunctuation(url) {
  return String(url || "").replace(/[),.!?;:]+$/g, "");
}

function linkifyMessageText(text) {
  const rawText = String(text || "");
  const linkPattern = /(?:https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;

  let result = "";
  let lastIndex = 0;

  for (const match of rawText.matchAll(linkPattern)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;
    const trimmedMatch = trimTrailingLinkPunctuation(matchedText);
    const trailingText = matchedText.slice(trimmedMatch.length);
    const href = normalizeLinkHref(trimmedMatch);

    result += escapeHtml(rawText.slice(lastIndex, matchIndex));

    if (href) {
      result += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="message-link">${escapeHtml(trimmedMatch)}</a>`;
    } else {
      result += escapeHtml(matchedText);
    }

    result += escapeHtml(trailingText);
    lastIndex = matchIndex + matchedText.length;
  }

  result += escapeHtml(rawText.slice(lastIndex));
  return result;
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

function processDroppedFiles(files) {
    const validFiles = Array.from(files).filter(file => file instanceof File);
    
    if (validFiles.length === 0) {
        addSystemMessage('>>> No valid files detected');
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

    if (file.size > MAX_UPLOAD_SIZE) {
        alert("File is too large (max 50MB)");
        return;
    }

    if (file.size === 0) {
        console.error("Upload failed: empty file", file.name);
        addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
        return;
    }

    addUploadNotification(file);

    const reader = new FileReader();

    reader.onload = function(e) {
        buildThumbnailAndSend(file, e.target.result);
    };

    reader.onerror = (error) => {
        console.error("File read error:", file.name, error);
        addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
    };

    reader.readAsArrayBuffer(file);
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
  renderVoiceParticipants();
  updateVoiceButtons();
}

function getVoiceUserVolume(socketId) {
  const storedVolume = voiceUserVolumes.get(socketId);
  return Number.isFinite(storedVolume) ? storedVolume : DEFAULT_VOICE_USER_VOLUME;
}

function setVoiceUserVolume(socketId, value) {
  if (!socketId) return;
  const normalizedValue = Math.max(0, Math.min(200, Number(value) || 0));
  voiceUserVolumes.set(socketId, normalizedValue);
  applyVoiceUserVolume(socketId);
  return normalizedValue;
}

function formatVoiceVolumeLabel(value) {
  return `${Math.max(0, Math.min(200, Math.round(Number(value) || 0)))}%`;
}

function syncVoiceVolumeDisplay(socketId, sliderEl, valueEl, nextValue) {
  const normalizedValue = setVoiceUserVolume(socketId, nextValue);
  if (sliderEl) {
    sliderEl.value = String(normalizedValue);
  }
  if (valueEl) {
    valueEl.textContent = formatVoiceVolumeLabel(normalizedValue);
  }
}

function applyVoiceUserVolume(socketId) {
  if (!socketId) return;

  const audioEl = voiceAudioElements.get(socketId);
  if (audioEl) {
    audioEl.volume = getVoiceUserVolume(socketId) / 100;
  }
}

function closeVoiceContextMenu() {
  if (!voiceContextMenu) return;
  voiceContextMenu.remove();
  voiceContextMenu = null;
}

function openVoiceContextMenu(participant, clientX, clientY) {
  if (!participant || !participant.socketId || participant.socketId === socket.id) return;

  closeVoiceContextMenu();

  const menu = document.createElement("div");
  menu.className = "voice-context-menu";

  const title = document.createElement("div");
  title.className = "voice-context-title";
  title.textContent = participant.nickname;

  const volumeRow = document.createElement("label");
  volumeRow.className = "voice-context-volume";

  const volumeLabel = document.createElement("span");
  volumeLabel.className = "voice-context-label";
  volumeLabel.textContent = "Volume";

  const volumeSlider = document.createElement("input");
  volumeSlider.className = "voice-context-slider";
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "200";
  volumeSlider.step = "1";
  volumeSlider.value = String(getVoiceUserVolume(participant.socketId));

  const handleVolumeChange = (event) => {
    syncVoiceVolumeDisplay(
      participant.socketId,
      volumeSlider,
      null,
      event.target.valueAsNumber
    );
  };

  volumeSlider.addEventListener("input", handleVolumeChange);
  volumeSlider.addEventListener("change", handleVolumeChange);
  volumeSlider.addEventListener("pointerup", handleVolumeChange);

  volumeRow.appendChild(volumeLabel);
  volumeRow.appendChild(volumeSlider);

  menu.appendChild(title);
  menu.appendChild(volumeRow);
  document.body.appendChild(menu);

  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(clientX, innerWidth - rect.width - 12);
  const top = Math.min(clientY, innerHeight - rect.height - 12);

  menu.style.left = `${Math.max(12, left)}px`;
  menu.style.top = `${Math.max(12, top)}px`;

  voiceContextMenu = menu;
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
    closeVoiceContextMenu();
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
    if (participant.socketId === socket.id) item.classList.add("voice-user-self");
    if (participant.socketId !== socket.id) {
      item.classList.add("voice-user-adjustable");
      item.title = "Right click to adjust volume";
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openVoiceContextMenu(participant, event.clientX, event.clientY);
      });
    }

    const flags = [];
    if (participant.muted) flags.push("MUTED");
    if (participant.deafened) flags.push("DEAF");

    const header = document.createElement("div");
    header.className = "voice-user-meta";

    const name = document.createElement("span");
    name.className = "voice-user-name";
    name.textContent = `${participant.nickname}${participant.socketId === socket.id ? " [YOU]" : ""}`;
    header.appendChild(name);

    if (flags.length > 0) {
      const status = document.createElement("span");
      status.className = "voice-user-flags";
      status.textContent = flags.join(" · ");
      header.appendChild(status);
    }

    item.appendChild(header);

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

  voiceVadNoiseFloor = 0.6;
  voiceVadAboveCount = 0;
  voiceVadLastAboveTime = 0;

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
    // Threshold rides just above the ambient noise floor instead of a fixed
    // value, so it self-calibrates to each mic's gain/background noise.
    const threshold = voiceVadNoiseFloor + VOICE_VAD_MARGIN;
    const isAboveThreshold = level > threshold;
    const now = Date.now();

    if (isAboveThreshold) {
      voiceVadAboveCount += 1;
      voiceVadLastAboveTime = now;
    } else {
      voiceVadAboveCount = 0;
      // Only drift the noise floor toward quiet samples, never while speaking,
      // so a long sentence can't slowly raise the threshold out from under it.
      voiceVadNoiseFloor = Math.min(20, Math.max(0.3,
        voiceVadNoiseFloor + (level - voiceVadNoiseFloor) * VOICE_VAD_NOISE_SMOOTHING
      ));
    }

    // Require a couple of consecutive loud frames to start (ignores clicks/pops),
    // then hold "speaking" through brief pauses between words for a flicker-free indicator.
    const withinHangover = voiceSpeaking && (now - voiceVadLastAboveTime) < VOICE_VAD_HANGOVER_MS;
    const nowSpeaking = voiceVadAboveCount >= VOICE_VAD_ONSET_FRAMES || withinHangover;

    if (nowSpeaking !== voiceSpeaking) {
      voiceSpeaking = nowSpeaking;
      socket.emit("voiceStateUpdate", { speaking: nowSpeaking });
    }
  }, VOICE_VAD_INTERVAL_MS);
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

function closeVoicePeerConnection(remoteSocketId) {
  const pc = voicePeerConnections.get(remoteSocketId);
  if (pc) {
    try { pc.close(); } catch (_) {}
    voicePeerConnections.delete(remoteSocketId);
  }

  const audioEl = voiceAudioElements.get(remoteSocketId);
  if (audioEl) {
    audioEl.pause();
    audioEl.srcObject = null;
    audioEl.remove();
    voiceAudioElements.delete(remoteSocketId);
  }
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

function createVoicePeerConnection(remoteSocketId) {
  const pc = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });

  if (voiceLocalStream) {
    for (const track of voiceLocalStream.getTracks()) {
      pc.addTrack(track, voiceLocalStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voiceSignal", {
        to: remoteSocketId,
        data: { type: "ice-candidate", candidate: event.candidate }
      });
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    let audioEl = voiceAudioElements.get(remoteSocketId);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = "none";
      audioEl.muted = !!voiceDeafened;
      audioEl.volume = getVoiceUserVolume(remoteSocketId) / 100;
      document.body.appendChild(audioEl);
      voiceAudioElements.set(remoteSocketId, audioEl);
    }
    audioEl.srcObject = stream;
    tryPlayRemoteAudio(audioEl);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      closeVoicePeerConnection(remoteSocketId);
    }
  };

  voicePeerConnections.set(remoteSocketId, pc);
  return pc;
}

async function initiateVoiceCall(remoteSocketId) {
  const pc = createVoicePeerConnection(remoteSocketId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("voiceSignal", {
    to: remoteSocketId,
    data: { type: "offer", sdp: pc.localDescription }
  });
}

async function joinVoiceChannel() {
  if (!currentRoom || voiceJoined) return;
  if (!window.RTCPeerConnection) {
    console.error("Voice error: WebRTC not supported in this browser");
    addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
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

    voiceJoined = true;
    voiceMuted = false;
    voiceDeafened = false;
    voiceSpeaking = false;

    startVoiceVad(voiceLocalStream);
    updateVoiceButtons();
    socket.emit("voiceStateUpdate", { muted: false, deafened: false, speaking: false });
    addSystemMessage(">>> Voice connected");

    for (const remoteSocketId of (joinData.peers || [])) {
      initiateVoiceCall(remoteSocketId).catch((error) => {
        console.error("initiateVoiceCall error:", error);
      });
    }
  } catch (error) {
    console.error("joinVoiceChannel error:", error);
    addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
    leaveVoiceChannel(true);
  }
}

function leaveVoiceChannel(notifyServer) {
  if (!voiceJoined && !voiceLocalStream && voicePeerConnections.size === 0) {
    resetVoiceStateUI();
    return;
  }

  if (notifyServer) {
    socket.emit("voiceLeave", {}, () => {});
  }

  stopVoiceVad();

  for (const remoteSocketId of Array.from(voicePeerConnections.keys())) {
    closeVoicePeerConnection(remoteSocketId);
  }

  if (voiceLocalStream) {
    voiceLocalStream.getTracks().forEach((track) => track.stop());
    voiceLocalStream = null;
  }

  voiceJoined = false;
  voiceMuted = false;
  voiceDeafened = false;
  voiceSpeaking = false;
  voiceParticipants.clear();

  renderVoiceParticipants();
  updateVoiceButtons();
}

async function toggleVoiceMute() {
  if (!voiceJoined) return;
  voiceMuted = !voiceMuted;
  if (voiceLocalStream) {
    const shouldSend = !(voiceMuted || voiceDeafened);
    voiceLocalStream.getAudioTracks().forEach((track) => {
      track.enabled = shouldSend;
    });
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

  if (voiceLocalStream) {
    const shouldSend = !(voiceMuted || voiceDeafened);
    voiceLocalStream.getAudioTracks().forEach((track) => {
      track.enabled = shouldSend;
    });
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
  closeVoicePeerConnection(socketId);
});

socket.on("voiceRoomClosed", () => {
  leaveVoiceChannel(false);
});

socket.on("voiceSignal", async ({ from, data } = {}) => {
  if (!voiceJoined || !from || !data) return;
  try {
    if (data.type === "offer") {
      const pc = voicePeerConnections.get(from) || createVoicePeerConnection(from);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("voiceSignal", { to: from, data: { type: "answer", sdp: pc.localDescription } });
    } else if (data.type === "answer") {
      const pc = voicePeerConnections.get(from);
      if (pc) await pc.setRemoteDescription(data.sdp);
    } else if (data.type === "ice-candidate" && data.candidate) {
      const pc = voicePeerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          console.error("addIceCandidate error:", error);
        }
      }
    }
  } catch (error) {
    console.error("voiceSignal handling error:", error);
  }
});

socket.on("disconnect", () => {
  leaveVoiceChannel(false);
});

document.addEventListener('keydown', handleEscapeKey);

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        closeVoiceContextMenu();
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
    closeFullImageModal();

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
    applyPreviewZoom(img, 1);

    img.addEventListener("wheel", (event) => {
        event.preventDefault();
        setZoomOriginFromPointer(img, event.clientX, event.clientY);
        const currentZoom = Number(img.dataset.zoom || 1);
        const delta = event.deltaY < 0 ? 0.16 : -0.16;
        applyPreviewZoom(img, currentZoom + delta);
    }, { passive: false });

    img.addEventListener("dblclick", (event) => {
        event.preventDefault();
        applyPreviewZoom(img, 1);
    });
    
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
    
    closeBtn.addEventListener('click', closeFullImageModal);
    
    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFullImageModal();
        }
    });
    
    window.currentImageModal = modal;
}

function closeFullImageModal() {
    const modal = window.currentImageModal || document.querySelector('.image-modal');
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

function hasActiveTextSelection() {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

messagesList.addEventListener("click", (e) => {
  if (!chatInput) return;
  if (hasActiveTextSelection()) return;

  const interactiveTarget = e.target.closest(
    ".media-thumbnail, .view-link, .download-link, video, a, button, input, textarea"
  );

  const messageContent = e.target.closest(".message-content, .media-info, .message-header");

  if (interactiveTarget) return;
  if (messageContent) return;
  chatInput.focus();
});

window.addEventListener("DOMContentLoaded", () => {
  nicknameInput.value = "";
  roomInput.value = "";
  passwordInput.value = "";
  resetVoiceStateUI();
  resizeChatInput();
  
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
document.addEventListener("click", (event) => {
  if (!voiceContextMenu) return;
  if (voiceContextMenu.contains(event.target)) return;
  closeVoiceContextMenu();
});
window.addEventListener("resize", updateTypingIndicatorPosition);
