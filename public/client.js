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
const voiceCamBtn = document.getElementById("voiceCamBtn");
const voiceScreenBtn = document.getElementById("voiceScreenBtn");
const voiceStatusLabel = document.getElementById("voiceStatusLabel");
const voiceUsersList = document.getElementById("voiceUsersList");
const voiceVideoGrid = document.getElementById("voiceVideoGrid");
const voiceTheater = document.getElementById("voiceTheater");
const voiceTheaterStreamMain = document.getElementById("voiceTheaterStreamMain");
const voiceTheaterStreamStrip = document.getElementById("voiceTheaterStreamStrip");
const voiceTheaterGrid = document.getElementById("voiceTheaterGrid");
const voiceTheaterClose = document.getElementById("voiceTheaterClose");
const voicePanel = document.getElementById("voicePanel");
const voicePanelHeader = document.getElementById("voicePanelHeader");
const voiceToggleBtn = document.getElementById("voiceToggleBtn");
const replyPreviewBar = document.getElementById("replyPreviewBar");
const replyPreviewNickname = document.getElementById("replyPreviewNickname");
const replyPreviewSnippet = document.getElementById("replyPreviewSnippet");
const replyPreviewCancel = document.getElementById("replyPreviewCancel");

const screenShareSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
if (voiceScreenBtn && !screenShareSupported) {
  voiceScreenBtn.style.display = "none";
}

let currentRoom = "";
let currentNickname = "";
let typingUsers = new Map();
let typingTimeout = null;
let isTyping = false;
let replyingTo = null;
const messageRegistry = new Map();
const MESSAGE_REGISTRY_LIMIT = 300;
const pendingP2PFiles = new Map();
const p2pSenderConnections = new Map();
const p2pReceiverState = new Map();
let voiceJoined = false;
let voiceMuted = false;
let voiceDeafened = false;
let voiceLocalStream = null;
let voiceCamStream = null;
let voiceScreenStream = null;
let voicePeerConnections = new Map();
let voiceAudioElements = new Map();
const voiceCamSenders = new Map();
const voiceScreenSenders = new Map();
const voiceVideoTiles = new Map();
const voiceRemoteVideoMeta = new Map();
const voicePendingRemoteStreams = new Map();
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
const CHUNK_SIZE = 512 * 1024;
const THUMBNAIL_SIZE_LIMIT = 8 * 1024 * 1024;
const MAX_CHAT_LENGTH = 4000;
const DEFAULT_VOICE_USER_VOLUME = 100;
const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
let ICE_SERVERS = [...STUN_SERVERS];

function refreshIceServers() {
  socket.emit("getIceServers", {}, (response) => {
    console.log("getIceServers response:", JSON.stringify(response));
    if (!response || !response.ok || !response.turnServer) {
      console.warn("No TURN server received — ICE_SERVERS stays STUN-only:", JSON.stringify(ICE_SERVERS));
      return;
    }
    ICE_SERVERS = [...STUN_SERVERS, response.turnServer];
    console.log("ICE_SERVERS updated with TURN:", JSON.stringify(ICE_SERVERS));
  });
}
const VOICE_VAD_INTERVAL_MS = 60;
const VOICE_VAD_ONSET_FRAMES = 2;
const VOICE_VAD_HANGOVER_MS = 400;
const VOICE_VAD_MARGIN = 3.5;
const VOICE_VAD_NOISE_SMOOTHING = 0.05;
const P2P_CHUNK_SIZE = 256 * 1024;
const P2P_BUFFERED_AMOUNT_HIGH = 16 * 1024 * 1024;
const P2P_BLOB_COALESCE_BYTES = 8 * 1024 * 1024;

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

function buildThumbnailAndSend(file, fileData, replyTo) {
  if (!isPreviewableImage(file.type) || file.size > THUMBNAIL_SIZE_LIMIT) {
    sendMediaToServer(file, fileData, null, replyTo);
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function() {
    const displaySize = 150;
    const renderSize = Math.round(displaySize * Math.min(window.devicePixelRatio || 1, 2));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = renderSize;
    canvas.height = renderSize;

    const sourceSize = Math.min(img.naturalWidth, img.naturalHeight);
    const sourceX = (img.naturalWidth - sourceSize) / 2;
    const sourceY = (img.naturalHeight - sourceSize) / 2;
    ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, renderSize, renderSize);

    const thumbnail = canvas.toDataURL('image/jpeg', 0.82);
    sendMediaToServer(file, fileData, thumbnail, replyTo);
    URL.revokeObjectURL(objectUrl);
  };
  img.onerror = function() {
    sendMediaToServer(file, fileData, null, replyTo);
    URL.revokeObjectURL(objectUrl);
  };
  img.src = objectUrl;
}

function resizeChatInput() {
  if (!chatInput) return;
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
  updateTypingIndicatorPosition();
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
    cleanupP2PState();
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
  refreshIceServers();

  addSystemMessage(`>>> ROOM: ${currentRoom}`);
  
  createUploadButton();

  chatInput.focus();
});

socket.on("roomClosed", (data) => {
  leaveVoiceChannel(false);
  cleanupP2PState();
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

function truncateSnippet(text, maxLen = 80) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

function registerMessage(msgId, nickname, snippet, type, el) {
  if (!msgId) return;
  messageRegistry.set(msgId, { nickname: String(nickname || ""), snippet, type, el });
  if (messageRegistry.size > MESSAGE_REGISTRY_LIMIT) {
    messageRegistry.delete(messageRegistry.keys().next().value);
  }
}

function startReply(msgId) {
  const entry = messageRegistry.get(msgId);
  if (!entry) return;

  replyingTo = { msgId, nickname: entry.nickname, snippet: entry.snippet, type: entry.type };
  if (replyPreviewNickname) replyPreviewNickname.textContent = entry.nickname;
  if (replyPreviewSnippet) replyPreviewSnippet.textContent = entry.snippet;
  if (replyPreviewBar) replyPreviewBar.style.display = "flex";
  chatInput.focus();
}

function cancelReply() {
  replyingTo = null;
  if (replyPreviewBar) replyPreviewBar.style.display = "none";
}

function scrollToMessage(msgId) {
  const entry = messageRegistry.get(msgId);
  if (!entry || !entry.el || !entry.el.isConnected) return;
  entry.el.scrollIntoView({ behavior: "smooth", block: "center" });
  entry.el.classList.add("message-highlight");
  setTimeout(() => entry.el.classList.remove("message-highlight"), 1200);
}

function buildReplyQuoteHtml(replyTo) {
  if (!replyTo || !replyTo.msgId) return "";
  const nickname = escapeHtml(String(replyTo.nickname || ""));
  const snippet = escapeHtml(String(replyTo.snippet || ""));
  const targetId = escapeHtml(String(replyTo.msgId));
  return `
    <div class="message-reply-quote" data-reply-target="${targetId}">
      <span class="message-reply-quote-nickname">${nickname}</span>
      <span class="message-reply-quote-snippet">${snippet}</span>
    </div>
  `;
}

function buildReplyButtonHtml(msgId) {
  if (!msgId) return "";
  const id = escapeHtml(String(msgId));
  return `<button type="button" class="message-reply-btn" data-reply-to="${id}" aria-label="Reply" title="Reply"><i class="fas fa-reply"></i></button>`;
}

if (replyPreviewCancel) {
  replyPreviewCancel.addEventListener("click", cancelReply);
}

function sendMessage() {
  const msg = normalizeOutgoingMessage(chatInput.value);
  if (!msg) return;
  if (msg.length > MAX_CHAT_LENGTH) {
    addSystemMessage(`>>> Message too long (${msg.length}/${MAX_CHAT_LENGTH})`);
    return;
  }

  socket.emit("chatMessage", { msg, replyTo: replyingTo ? { msgId: replyingTo.msgId } : null });
  chatInput.value = "";
  resizeChatInput();
  cancelReply();
}

let pendingUploadMode = "server";
let uploadChoiceMenu = null;

function createUploadButton() {
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
    uploadBtn.title = 'Send a file';
    uploadBtn.setAttribute('aria-label', 'Send a file');
    uploadBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openUploadChoiceMenu(uploadBtn);
    });
    inputWrapper.appendChild(uploadBtn);
  }

  if (!uploadInput.dataset.bound) {
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files.length > 0) {
        const file = uploadInput.files[0];
        if (pendingUploadMode === "p2p") {
          offerP2PFile(file);
        } else {
          uploadMedia(file);
        }
        uploadInput.value = '';
      }
    });
    uploadInput.dataset.bound = 'true';
  }
}

function closeUploadChoiceMenu() {
  if (!uploadChoiceMenu) return;
  uploadChoiceMenu.remove();
  uploadChoiceMenu = null;
}

function openUploadChoiceMenu(anchorEl) {
  closeUploadChoiceMenu();

  const menu = document.createElement("div");
  menu.className = "upload-choice-menu";

  const serverOption = document.createElement("button");
  serverOption.type = "button";
  serverOption.className = "upload-choice-option";
  serverOption.innerHTML = `
    <span class="upload-choice-icon" aria-hidden="true">📎</span>
    <span class="upload-choice-text">
      <strong>Regular upload</strong>
      <small>Via server, faster, up to 50MB</small>
    </span>
  `;
  serverOption.addEventListener("click", () => {
    pendingUploadMode = "server";
    document.getElementById('mediaUploadInput').click();
    closeUploadChoiceMenu();
  });

  const p2pOption = document.createElement("button");
  p2pOption.type = "button";
  p2pOption.className = "upload-choice-option";
  p2pOption.innerHTML = `
    <span class="upload-choice-icon" aria-hidden="true">🔗</span>
    <span class="upload-choice-text">
      <strong>P2P direct</strong>
      <small>Serverless, no size limit, but slower</small>
    </span>
  `;
  p2pOption.addEventListener("click", () => {
    pendingUploadMode = "p2p";
    document.getElementById('mediaUploadInput').click();
    closeUploadChoiceMenu();
  });

  menu.appendChild(serverOption);
  menu.appendChild(p2pOption);
  anchorEl.parentElement.appendChild(menu);

  uploadChoiceMenu = menu;
}

document.addEventListener("click", (event) => {
  if (!uploadChoiceMenu) return;
  if (uploadChoiceMenu.contains(event.target)) return;
  closeUploadChoiceMenu();
});

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

async function sendMediaToServer(file, fileData, thumbnail, replyTo) {
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

      const response = await emitUploadChunk({
        uploadId,
        fileName: file.name || "file",
        fileType,
        fileSize: file.size || bytes.byteLength,
        thumbnail: index === 0 ? thumbnail : null,
        replyTo: index === 0 && replyTo ? { msgId: replyTo.msgId } : null,
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
  } else if (data.type === 'p2p-offer') {
    addP2PMessage(data);
  } else {
    addTextMessage(data);
  }
});

function addTextMessage(data) {
  const messageDiv = document.createElement("div");
  const messageHtml = linkifyMessageText(data.msg);
  const nickname = escapeHtml(String(data.nickname || ""));
  const time = escapeHtml(String(data.time || ""));

  messageDiv.className = data.self ? "message-self" : "message-other";
  if (data.msgId) messageDiv.dataset.msgId = data.msgId;
  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-nickname">${nickname}</span>
      <span class="message-time">${time}</span>
      ${buildReplyButtonHtml(data.msgId)}
    </div>
    ${buildReplyQuoteHtml(data.replyTo)}
    <div class="message-content">${messageHtml}</div>
  `;

  messagesList.appendChild(messageDiv);
  registerMessage(data.msgId, data.nickname, truncateSnippet(data.msg), "text", messageDiv);
  scrollToBottom();
}

function addMediaMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.className = data.self ? "message-self media-message" : "message-other media-message";
  if (data.msgId) messageDiv.dataset.msgId = data.msgId;

  const fileSize = formatFileSize(data.fileSize);
  
  let mediaContent = '';
  
  if (data.isImage) {
    mediaContent = `
      <div class="media-preview">
        <img src="${safeMediaURL(data.thumbnail || data.fileUrl)}"
             alt="${escapeHtml(data.fileName)}"
             class="media-thumbnail"
             data-full-url="${safeMediaURL(data.fileUrl)}"
             draggable="false">
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
      ${buildReplyButtonHtml(data.msgId)}
    </div>
    ${buildReplyQuoteHtml(data.replyTo)}
    ${mediaContent}
  `;

  messagesList.appendChild(messageDiv);
  const zoomableMedia = messageDiv.querySelector(".media-thumbnail");
  if (zoomableMedia) {
    zoomableMedia.addEventListener("click", (event) => {
      event.stopPropagation();
      openFullImage(zoomableMedia.dataset.fullUrl);
    });
  }

  const mediaSnippetPrefix = data.isImage ? "📸" : data.isVideo ? "🎥" : getFileEmoji(data.fileType, data.fileName);
  registerMessage(data.msgId, data.nickname, `${mediaSnippetPrefix} ${truncateSnippet(data.fileName, 60)}`, "media", messageDiv);
  scrollToBottom();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function addP2PMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.className = data.self ? "message-self media-message" : "message-other media-message";
  if (data.msgId) messageDiv.dataset.msgId = data.msgId;

  const fileSize = formatFileSize(data.fileSize);
  const fileId = escapeHtml(String(data.fileId || ""));
  const isOwnOffer = pendingP2PFiles.has(data.fileId);

  const actionHtml = isOwnOffer
    ? `<span class="p2p-status">Ready to send, stay online for the download</span>`
    : `<button type="button" class="p2p-download-btn" data-file-id="${fileId}" data-sender-id="${escapeHtml(String(data.senderSocketId || ""))}">⬇ Download (P2P)</button>`;

  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-nickname">${escapeHtml(data.nickname)}</span>
      <span class="message-time">${escapeHtml(data.time)}</span>
      ${buildReplyButtonHtml(data.msgId)}
    </div>
    ${buildReplyQuoteHtml(data.replyTo)}
    <div class="media-preview media-preview-file">
      <div class="media-file-icon" aria-hidden="true">🔗</div>
      <div class="media-info">
        <strong>🔗 ${escapeHtml(data.fileName)}</strong>
        <small>${fileSize} • Serverless P2P, no size limit</small>
        <div class="p2p-progress-row" data-file-id="${fileId}" style="display:none;">
          <div class="p2p-progress-bar"><div class="p2p-progress-fill"></div></div>
          <span class="p2p-progress-label">0%</span>
        </div>
        ${actionHtml}
      </div>
    </div>
  `;

  messagesList.appendChild(messageDiv);
  registerMessage(data.msgId, data.nickname, `🔗 ${truncateSnippet(data.fileName, 60)}`, "media", messageDiv);
  scrollToBottom();
}

function updateP2PProgress(fileId, receivedBytes, totalBytes) {
  const row = document.querySelector(`.p2p-progress-row[data-file-id="${CSS.escape(String(fileId))}"]`);
  if (!row) return;
  row.style.display = "flex";
  const pct = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
  const fill = row.querySelector(".p2p-progress-fill");
  const label = row.querySelector(".p2p-progress-label");
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
}

function cleanupP2PState() {
  for (const fileId of Array.from(p2pReceiverState.keys())) {
    closeP2PReceiverState(fileId);
  }
  for (const key of Array.from(p2pSenderConnections.keys())) {
    closeP2PSenderConnection(key);
  }
  pendingP2PFiles.clear();
}

function offerP2PFile(file) {
  if (!file || !currentRoom) return;

  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  pendingP2PFiles.set(fileId, file);

  const replyTo = replyingTo;
  cancelReply();

  socket.emit("p2pFileOffer", {
    fileId,
    fileName: file.name || "file",
    fileSize: file.size,
    fileType: file.type || "application/octet-stream",
    replyTo: replyTo ? { msgId: replyTo.msgId } : null
  });
}

function closeP2PReceiverState(fileId) {
  const state = p2pReceiverState.get(fileId);
  if (!state) return;
  clearTimeout(state.connectTimeout);
  try { state.channel && state.channel.close(); } catch (_) {}
  try { state.pc.close(); } catch (_) {}
  p2pReceiverState.delete(fileId);
}

function cancelP2PDownload(fileId) {
  const state = p2pReceiverState.get(fileId);
  const btnEl = state ? state.btnEl : null;

  closeP2PReceiverState(fileId);

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = "⬇ Download (P2P)";
    btnEl.classList.remove("p2p-cancel-btn");
  }

  const row = document.querySelector(`.p2p-progress-row[data-file-id="${CSS.escape(String(fileId))}"]`);
  if (row) {
    row.style.display = "none";
    const fill = row.querySelector(".p2p-progress-fill");
    if (fill) fill.style.width = "0%";
    const label = row.querySelector(".p2p-progress-label");
    if (label) label.textContent = "0%";
  }
}

function candidateType(candidateStr) {
  const match = /typ (\w+)/.exec(candidateStr || "");
  return match ? match[1] : "unknown";
}

function requestP2PDownload(fileId, senderSocketId, btnEl) {
  if (!fileId || !senderSocketId) return;
  if (p2pReceiverState.has(fileId)) return;

  if (btnEl) {
    btnEl.textContent = "✕ Cancel";
    btnEl.classList.add("p2p-cancel-btn");
  }

  console.log("[P2P receiver] creating RTCPeerConnection with ICE_SERVERS:", JSON.stringify(ICE_SERVERS));
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const state = {
    pc,
    channel: null,
    fileId,
    senderSocketId,
    chunks: [],
    pendingCoalesceBytes: 0,
    receivedBytes: 0,
    fileSize: 0,
    fileName: "file",
    fileType: "application/octet-stream",
    btnEl,
    completed: false
  };
  p2pReceiverState.set(fileId, state);

  const failDownload = (reason) => {
    if (state.completed) return;
    console.error("P2P download failed:", reason, "connectionState:", pc.connectionState, "iceConnectionState:", pc.iceConnectionState);
    clearTimeout(state.connectTimeout);
    closeP2PReceiverState(fileId);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "⬇ Download (P2P)";
      btnEl.classList.remove("p2p-cancel-btn");
    }
    addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
  };

  state.connectTimeout = setTimeout(() => {
    if (!state.completed && pc.connectionState !== "connected") {
      failDownload("connect timeout after 20s");
    }
  }, 20000);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[P2P receiver] local candidate type=${candidateType(event.candidate.candidate)}:`, event.candidate.candidate);
      socket.emit("p2pSignal", { to: senderSocketId, data: { type: "ice-candidate", fileId, candidate: event.candidate } });
    } else {
      console.log("[P2P receiver] ICE gathering complete");
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`P2P receiver connectionState: ${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      clearTimeout(state.connectTimeout);
    } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      failDownload(`connectionState=${pc.connectionState}`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`P2P receiver iceConnectionState: ${pc.iceConnectionState}`);
  };

  const channel = pc.createDataChannel(`p2p-${fileId}`, { priority: "high" });
  channel.binaryType = "arraybuffer";
  state.channel = channel;

  channel.onopen = () => {
    console.log("P2P data channel open, sending request for", fileId);
    channel.send(JSON.stringify({ type: "request", fileId }));
  };

  channel.onerror = (event) => failDownload(`channel error: ${event.error || event}`);

  channel.onmessage = (event) => {
    if (typeof event.data === "string") {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (msg.type === "meta") {
        state.fileSize = msg.fileSize;
        state.fileName = msg.fileName;
        state.fileType = msg.fileType;
        updateP2PProgress(fileId, 0, state.fileSize);
      } else if (msg.type === "end") {
        finishP2PDownload(state);
      }
      return;
    }
    state.chunks.push(event.data);
    state.receivedBytes += event.data.byteLength;
    state.pendingCoalesceBytes += event.data.byteLength;

    if (state.pendingCoalesceBytes >= P2P_BLOB_COALESCE_BYTES) {
      state.chunks = [new Blob(state.chunks)];
      state.pendingCoalesceBytes = 0;
    }

    updateP2PProgress(fileId, state.receivedBytes, state.fileSize);
  };

  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("p2pSignal", { to: senderSocketId, data: { type: "offer", fileId, sdp: pc.localDescription } });
    } catch (error) {
      console.error("P2P download offer error:", error);
      failDownload();
    }
  })();
}

function finishP2PDownload(state) {
  state.completed = true;
  clearTimeout(state.connectTimeout);
  const blob = new Blob(state.chunks, { type: state.fileType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.fileName || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  if (state.btnEl) {
    state.btnEl.textContent = "✓ Downloaded";
    state.btnEl.classList.remove("p2p-cancel-btn");
    state.btnEl.disabled = true;
  }
  updateP2PProgress(state.fileId, state.fileSize, state.fileSize);

  try { state.channel.close(); } catch (_) {}
  try { state.pc.close(); } catch (_) {}
  p2pReceiverState.delete(state.fileId);
}

async function sendFileOverP2PChannel(channel, file) {
  channel.send(JSON.stringify({ type: "meta", fileName: file.name, fileSize: file.size, fileType: file.type || "application/octet-stream" }));
  channel.bufferedAmountLowThreshold = Math.floor(P2P_BUFFERED_AMOUNT_HIGH / 2);

  const chunkSize = channel.maxMessageSize
    ? Math.min(P2P_CHUNK_SIZE, channel.maxMessageSize)
    : P2P_CHUNK_SIZE;

  let offset = 0;
  while (offset < file.size) {
    if (channel.readyState !== "open") return;

    if (channel.bufferedAmount > P2P_BUFFERED_AMOUNT_HIGH) {
      await new Promise((resolve) => {
        channel.onbufferedamountlow = () => resolve();
      });
      if (channel.readyState !== "open") return;
    }

    const slice = file.slice(offset, offset + chunkSize);
    const buffer = await slice.arrayBuffer();
    if (channel.readyState !== "open") return;
    channel.send(buffer);
    offset += buffer.byteLength;
  }

  if (channel.readyState === "open") {
    channel.send(JSON.stringify({ type: "end" }));
  }
}

function senderKey(remoteSocketId, fileId) {
  return `${remoteSocketId}:${fileId}`;
}

function closeP2PSenderConnection(key) {
  const entry = p2pSenderConnections.get(key);
  if (!entry) return;
  try { entry.channel && entry.channel.close(); } catch (_) {}
  try { entry.pc.close(); } catch (_) {}
  p2pSenderConnections.delete(key);
}

async function handleP2POffer(fromSocketId, data) {
  const file = pendingP2PFiles.get(data.fileId);
  if (!file) {
    console.error(
      "P2P offer received for a fileId we no longer have (tab reloaded, or socket reconnected and cleared pendingP2PFiles):",
      data.fileId
    );
    return;
  }

  const key = senderKey(fromSocketId, data.fileId);
  closeP2PSenderConnection(key);

  console.log("[P2P sender] creating RTCPeerConnection with ICE_SERVERS:", JSON.stringify(ICE_SERVERS));
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  p2pSenderConnections.set(key, { pc, channel: null, fileId: data.fileId });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[P2P sender] local candidate type=${candidateType(event.candidate.candidate)}:`, event.candidate.candidate);
      socket.emit("p2pSignal", { to: fromSocketId, data: { type: "ice-candidate", fileId: data.fileId, candidate: event.candidate } });
    } else {
      console.log("[P2P sender] ICE gathering complete");
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`P2P sender connectionState (${key}): ${pc.connectionState}`);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      closeP2PSenderConnection(key);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`P2P sender iceConnectionState (${key}): ${pc.iceConnectionState}`);
  };

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    channel.binaryType = "arraybuffer";
    const entry = p2pSenderConnections.get(key);
    if (entry) entry.channel = channel;

    channel.onmessage = (msgEvent) => {
      if (typeof msgEvent.data !== "string") return;
      let msg;
      try {
        msg = JSON.parse(msgEvent.data);
      } catch (_) {
        return;
      }
      if (msg.type === "request" && msg.fileId === data.fileId) {
        sendFileOverP2PChannel(channel, file).catch((error) => {
          console.error("P2P send error:", error);
        });
      }
    };

    channel.onclose = () => {
      closeP2PSenderConnection(key);
    };
  };

  await pc.setRemoteDescription(data.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("p2pSignal", { to: fromSocketId, data: { type: "answer", fileId: data.fileId, sdp: pc.localDescription } });
}

socket.on("p2pSignal", async ({ from, data } = {}) => {
  if (!from || !data || !data.fileId) return;
  try {
    if (data.type === "offer") {
      await handleP2POffer(from, data);
    } else if (data.type === "answer") {
      const state = p2pReceiverState.get(data.fileId);
      if (state) await state.pc.setRemoteDescription(data.sdp);
    } else if (data.type === "ice-candidate" && data.candidate) {
      const senderEntry = p2pSenderConnections.get(senderKey(from, data.fileId));
      const receiverState = p2pReceiverState.get(data.fileId);
      const pc = (senderEntry ? senderEntry.pc : null) || (receiverState ? receiverState.pc : null);
      if (pc) {
        console.log(`[P2P] remote candidate type=${candidateType(data.candidate.candidate)}:`, data.candidate.candidate);
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          console.error("P2P addIceCandidate error:", error);
        }
      }
    }
  } catch (error) {
    console.error("p2pSignal handling error:", error);
  }
});

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

    const replyTo = replyingTo;
    cancelReply();

    const reader = new FileReader();

    reader.onload = function(e) {
        buildThumbnailAndSend(file, e.target.result, replyTo);
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
  if (voicePanel && voiceJoined) voicePanel.classList.remove("collapsed");
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
  if (voiceCamBtn) {
    voiceCamBtn.disabled = !voiceJoined;
    voiceCamBtn.classList.toggle("active", !!voiceCamStream);
    voiceCamBtn.innerHTML = voiceCamStream
      ? '<i class="fas fa-video-slash"></i> STOP CAM'
      : '<i class="fas fa-video"></i> CAM';
  }
  if (voiceScreenBtn) {
    voiceScreenBtn.disabled = !voiceJoined;
    voiceScreenBtn.classList.toggle("active", !!voiceScreenStream);
    voiceScreenBtn.innerHTML = voiceScreenStream
      ? '<i class="fas fa-stop"></i> STOP SHARE'
      : '<i class="fas fa-desktop"></i> SHARE';
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
  updateTypingIndicatorPosition();
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
    const threshold = voiceVadNoiseFloor + VOICE_VAD_MARGIN;
    const isAboveThreshold = level > threshold;
    const now = Date.now();

    if (isAboveThreshold) {
      voiceVadAboveCount += 1;
      voiceVadLastAboveTime = now;
    } else {
      voiceVadAboveCount = 0;
      voiceVadNoiseFloor = Math.min(20, Math.max(0.3,
        voiceVadNoiseFloor + (level - voiceVadNoiseFloor) * VOICE_VAD_NOISE_SMOOTHING
      ));
    }

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

  voiceCamSenders.delete(remoteSocketId);
  voiceScreenSenders.delete(remoteSocketId);
  hideRemoteVideoTile(remoteSocketId, "cam");
  hideRemoteVideoTile(remoteSocketId, "screen");
  for (const [streamId, meta] of Array.from(voiceRemoteVideoMeta.entries())) {
    if (meta.from === remoteSocketId) voiceRemoteVideoMeta.delete(streamId);
  }
  for (const key of Array.from(voicePendingRemoteStreams.keys())) {
    if (key.startsWith(`${remoteSocketId}:`)) voicePendingRemoteStreams.delete(key);
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

let theaterOpen = false;
let theaterMode = null;

function ensureVideoGridVisible() {
  if (!voiceVideoGrid) return;
  voiceVideoGrid.style.display = voiceVideoGrid.children.length > 0 ? "grid" : "none";
}

function enterVideoFullscreen(el) {
  if (!el || typeof el.requestFullscreen !== "function") return;
  el.requestFullscreen().catch(() => {});
}

function exitVideoFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;

function handleVoiceOrientationChange() {
  if (!isTouchDevice || !theaterOpen) return;
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  if (isLandscape) {
    enterVideoFullscreen(voiceTheater);
  } else {
    exitVideoFullscreen();
  }
}

if (window.screen && window.screen.orientation) {
  window.screen.orientation.addEventListener("change", handleVoiceOrientationChange);
} else {
  window.addEventListener("orientationchange", handleVoiceOrientationChange);
}

function getVideoTilesByKind(kind) {
  const result = [];
  for (const tile of voiceVideoTiles.values()) {
    if (tile.el.dataset.kind === kind) result.push(tile);
  }
  return result;
}

function relayoutVideoTiles() {
  if (!voiceTheater) return;

  if (!theaterOpen) {
    for (const tile of voiceVideoTiles.values()) {
      if (tile.el.parentElement !== voiceVideoGrid) voiceVideoGrid.appendChild(tile.el);
    }
    ensureVideoGridVisible();
    return;
  }

  const screenTiles = getVideoTilesByKind("screen");
  const camTiles = getVideoTilesByKind("cam");

  if (theaterMode === "stream" && screenTiles.length === 0) {
    theaterMode = camTiles.length > 0 ? "cameras" : null;
  } else if (theaterMode === "cameras" && camTiles.length === 0) {
    theaterMode = screenTiles.length > 0 ? "stream" : null;
  }

  if (!theaterMode) {
    closeVideoTheater();
    return;
  }

  voiceTheater.dataset.mode = theaterMode;

  if (theaterMode === "stream") {
    for (const tile of screenTiles) {
      if (tile.el.parentElement !== voiceTheaterStreamMain) voiceTheaterStreamMain.appendChild(tile.el);
    }
    for (const tile of camTiles) {
      if (tile.el.parentElement !== voiceTheaterStreamStrip) voiceTheaterStreamStrip.appendChild(tile.el);
    }
  } else {
    for (const tile of camTiles) {
      if (tile.el.parentElement !== voiceTheaterGrid) voiceTheaterGrid.appendChild(tile.el);
    }
  }
}

function openVideoTheater(mode) {
  if (!voiceTheater) return;
  theaterOpen = true;
  theaterMode = mode;
  voiceTheater.hidden = false;
  relayoutVideoTiles();
  handleVoiceOrientationChange();
}

function closeVideoTheater() {
  if (!voiceTheater) return;
  theaterOpen = false;
  theaterMode = null;
  voiceTheater.hidden = true;
  exitVideoFullscreen();
  relayoutVideoTiles();
}

function handleVideoTileClick(kind) {
  if (!theaterOpen) {
    openVideoTheater(kind === "screen" ? "stream" : "cameras");
    return;
  }
  if (kind === "cam" && theaterMode !== "cameras") {
    theaterMode = "cameras";
    relayoutVideoTiles();
  }
}

function createVideoTile(key, label, muted, kind) {
  const el = document.createElement("div");
  el.className = "voice-video-tile";
  el.dataset.key = key;
  el.dataset.kind = kind;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;

  const labelEl = document.createElement("span");
  labelEl.className = "voice-video-label";
  labelEl.textContent = label;

  el.appendChild(video);
  el.appendChild(labelEl);
  el.addEventListener("click", () => handleVideoTileClick(kind));

  voiceVideoTiles.set(key, { el, video, labelEl });
  voiceVideoGrid.appendChild(el);
  relayoutVideoTiles();
  return voiceVideoTiles.get(key);
}

function removeVideoTile(key) {
  const tile = voiceVideoTiles.get(key);
  if (!tile) return;
  tile.video.srcObject = null;
  tile.el.remove();
  voiceVideoTiles.delete(key);
  ensureVideoGridVisible();
  relayoutVideoTiles();
}

function showLocalVideoTile(kind, stream) {
  if (!voiceVideoGrid) return;
  const key = `local:${kind}`;
  const label = kind === "screen" ? "Your screen" : "You";
  const tile = voiceVideoTiles.get(key) || createVideoTile(key, label, true, kind);
  tile.video.srcObject = stream;
  ensureVideoGridVisible();
}

function hideLocalVideoTile(kind) {
  removeVideoTile(`local:${kind}`);
}

function showRemoteVideoTile(remoteSocketId, kind, stream) {
  if (!voiceVideoGrid) return;
  const key = `${remoteSocketId}:${kind}`;
  const participant = voiceParticipants.get(remoteSocketId);
  const label = `${participant ? participant.nickname : "Peer"}${kind === "screen" ? " (screen)" : ""}`;
  const tile = voiceVideoTiles.get(key) || createVideoTile(key, label, false, kind);
  tile.labelEl.textContent = label;
  tile.video.srcObject = stream;
  ensureVideoGridVisible();
}

function hideRemoteVideoTile(remoteSocketId, kind) {
  removeVideoTile(`${remoteSocketId}:${kind}`);
}

function clearVideoGrid() {
  closeVideoTheater();
  for (const key of Array.from(voiceVideoTiles.keys())) {
    removeVideoTile(key);
  }
}

function sendVideoMeta(remoteSocketId, kind, streamId, active) {
  socket.emit("voiceSignal", {
    to: remoteSocketId,
    data: { type: "video-meta", kind, streamId, active }
  });
}

function addAllLocalTracksTo(pc, remoteSocketId) {
  if (voiceLocalStream) {
    for (const track of voiceLocalStream.getTracks()) {
      pc.addTrack(track, voiceLocalStream);
    }
  }
  if (voiceCamStream) {
    const sender = pc.addTrack(voiceCamStream.getVideoTracks()[0], voiceCamStream);
    voiceCamSenders.set(remoteSocketId, sender);
    sendVideoMeta(remoteSocketId, "cam", voiceCamStream.id, true);
  }
  if (voiceScreenStream) {
    const sender = pc.addTrack(voiceScreenStream.getVideoTracks()[0], voiceScreenStream);
    voiceScreenSenders.set(remoteSocketId, sender);
    sendVideoMeta(remoteSocketId, "screen", voiceScreenStream.id, true);
  }
}

function createVoicePeerConnection(remoteSocketId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.polite = socket.id < remoteSocketId;
  pc.makingOffer = false;
  pc.ignoreOffer = false;

  addAllLocalTracksTo(pc, remoteSocketId);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voiceSignal", {
        to: remoteSocketId,
        data: { type: "ice-candidate", candidate: event.candidate }
      });
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      pc.makingOffer = true;
      await pc.setLocalDescription();
      socket.emit("voiceSignal", {
        to: remoteSocketId,
        data: { type: "description", description: pc.localDescription }
      });
    } catch (error) {
      console.error("voice negotiation error:", error);
    } finally {
      pc.makingOffer = false;
    }
  };

  pc.ontrack = (event) => {
    if (event.track.kind === "audio") {
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
      return;
    }

    const stream = event.streams[0] || new MediaStream([event.track]);
    const streamId = stream.id;
    const meta = voiceRemoteVideoMeta.get(streamId);
    if (meta) {
      showRemoteVideoTile(remoteSocketId, meta.kind, stream);
    } else {
      voicePendingRemoteStreams.set(`${remoteSocketId}:${streamId}`, stream);
    }

    event.track.onended = () => {
      const currentMeta = voiceRemoteVideoMeta.get(streamId);
      hideRemoteVideoTile(remoteSocketId, currentMeta ? currentMeta.kind : "cam");
    };
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      closeVoicePeerConnection(remoteSocketId);
    }
  };

  voicePeerConnections.set(remoteSocketId, pc);
  return pc;
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
      createVoicePeerConnection(remoteSocketId);
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

  if (voiceCamStream) {
    voiceCamStream.getTracks().forEach((track) => track.stop());
    voiceCamStream = null;
  }

  if (voiceScreenStream) {
    voiceScreenStream.getTracks().forEach((track) => track.stop());
    voiceScreenStream = null;
  }

  voiceCamSenders.clear();
  voiceScreenSenders.clear();
  voiceRemoteVideoMeta.clear();
  voicePendingRemoteStreams.clear();
  clearVideoGrid();

  voiceJoined = false;
  voiceMuted = false;
  voiceDeafened = false;
  voiceSpeaking = false;
  voiceParticipants.clear();

  renderVoiceParticipants();
  updateVoiceButtons();
}

async function toggleVoiceCam() {
  if (!voiceJoined) return;

  if (voiceCamStream) {
    stopVoiceCam();
    return;
  }

  try {
    voiceCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
    });
  } catch (error) {
    console.error("camera getUserMedia error:", error);
    try {
      voiceCamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (fallbackError) {
      console.error("camera getUserMedia fallback error:", fallbackError);
      addSystemMessage(`>>> Voice error: camera access denied (${fallbackError.name || "unknown"})`);
      return;
    }
  }

  showLocalVideoTile("cam", voiceCamStream);
  const camTrack = voiceCamStream.getVideoTracks()[0];
  for (const [remoteSocketId, pc] of voicePeerConnections) {
    const sender = pc.addTrack(camTrack, voiceCamStream);
    voiceCamSenders.set(remoteSocketId, sender);
    sendVideoMeta(remoteSocketId, "cam", voiceCamStream.id, true);
  }
  updateVoiceButtons();
}

function stopVoiceCam() {
  if (!voiceCamStream) return;
  const streamId = voiceCamStream.id;

  for (const [remoteSocketId, pc] of voicePeerConnections) {
    const sender = voiceCamSenders.get(remoteSocketId);
    if (sender) {
      try { pc.removeTrack(sender); } catch (_) {}
    }
    sendVideoMeta(remoteSocketId, "cam", streamId, false);
  }
  voiceCamSenders.clear();

  voiceCamStream.getTracks().forEach((track) => track.stop());
  voiceCamStream = null;
  hideLocalVideoTile("cam");
  updateVoiceButtons();
}

async function toggleVoiceScreen() {
  if (!voiceJoined) return;

  if (voiceScreenStream) {
    stopVoiceScreen();
    return;
  }

  if (!screenShareSupported) {
    addSystemMessage(">>> Voice error: screen sharing is not supported on this device");
    return;
  }

  try {
    voiceScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false
    });
  } catch (error) {
    return;
  }

  const screenTrack = voiceScreenStream.getVideoTracks()[0];
  screenTrack.onended = () => stopVoiceScreen();

  showLocalVideoTile("screen", voiceScreenStream);
  for (const [remoteSocketId, pc] of voicePeerConnections) {
    const sender = pc.addTrack(screenTrack, voiceScreenStream);
    voiceScreenSenders.set(remoteSocketId, sender);
    sendVideoMeta(remoteSocketId, "screen", voiceScreenStream.id, true);
  }
  updateVoiceButtons();
}

function stopVoiceScreen() {
  if (!voiceScreenStream) return;
  const streamId = voiceScreenStream.id;

  for (const [remoteSocketId, pc] of voicePeerConnections) {
    const sender = voiceScreenSenders.get(remoteSocketId);
    if (sender) {
      try { pc.removeTrack(sender); } catch (_) {}
    }
    sendVideoMeta(remoteSocketId, "screen", streamId, false);
  }
  voiceScreenSenders.clear();

  voiceScreenStream.getTracks().forEach((track) => track.stop());
  voiceScreenStream = null;
  hideLocalVideoTile("screen");
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

if (voicePanelHeader) {
  voicePanelHeader.addEventListener("click", (event) => {
    if (event.target.closest(".voice-controls")) return;
    voicePanel.classList.toggle("collapsed");
    updateTypingIndicatorPosition();
  });
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

if (voiceCamBtn) {
  voiceCamBtn.addEventListener("click", () => {
    toggleVoiceCam().catch((error) => {
      console.error("voice cam toggle error:", error);
    });
  });
}

if (voiceScreenBtn) {
  voiceScreenBtn.addEventListener("click", () => {
    toggleVoiceScreen().catch((error) => {
      console.error("voice screen toggle error:", error);
    });
  });
}

if (voiceTheaterClose) {
  voiceTheaterClose.addEventListener("click", () => closeVideoTheater());
}

if (voiceTheater) {
  voiceTheater.addEventListener("click", (event) => {
    if (
      event.target === voiceTheater ||
      event.target === voiceTheaterGrid ||
      event.target === voiceTheaterStreamMain
    ) {
      closeVideoTheater();
    }
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
    if (data.type === "description") {
      const pc = voicePeerConnections.get(from) || createVoicePeerConnection(from);
      const description = data.description;
      const offerCollision = description.type === "offer" && (pc.makingOffer || pc.signalingState !== "stable");
      pc.ignoreOffer = !pc.polite && offerCollision;
      if (pc.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        socket.emit("voiceSignal", { to: from, data: { type: "description", description: pc.localDescription } });
      }
    } else if (data.type === "ice-candidate" && data.candidate) {
      const pc = voicePeerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          if (!pc.ignoreOffer) console.error("addIceCandidate error:", error);
        }
      }
    } else if (data.type === "video-meta" && data.streamId && data.kind) {
      if (data.active) {
        voiceRemoteVideoMeta.set(data.streamId, { kind: data.kind, from });
        const pendingKey = `${from}:${data.streamId}`;
        const pendingStream = voicePendingRemoteStreams.get(pendingKey);
        if (pendingStream) {
          showRemoteVideoTile(from, data.kind, pendingStream);
          voicePendingRemoteStreams.delete(pendingKey);
        }
      } else {
        voiceRemoteVideoMeta.delete(data.streamId);
        hideRemoteVideoTile(from, data.kind);
        voicePendingRemoteStreams.delete(`${from}:${data.streamId}`);
      }
    }
  } catch (error) {
    console.error("voiceSignal handling error:", error);
  }
});

socket.on("disconnect", () => {
  leaveVoiceChannel(false);
  cleanupP2PState();
});

document.addEventListener('keydown', handleEscapeKey);

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        closeVoiceContextMenu();
        closeUploadChoiceMenu();
        closeFullImageModal();
        closeVideoTheater();
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
    img.draggable = false;
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
  const replyBtn = e.target.closest(".message-reply-btn");
  if (replyBtn) {
    startReply(replyBtn.dataset.replyTo);
    return;
  }

  const replyQuote = e.target.closest(".message-reply-quote");
  if (replyQuote) {
    scrollToMessage(replyQuote.dataset.replyTarget);
    return;
  }

  const p2pDownloadBtn = e.target.closest(".p2p-download-btn");
  if (p2pDownloadBtn) {
    const fileId = p2pDownloadBtn.dataset.fileId;
    if (p2pReceiverState.has(fileId)) {
      cancelP2PDownload(fileId);
    } else {
      requestP2PDownload(fileId, p2pDownloadBtn.dataset.senderId, p2pDownloadBtn);
    }
    return;
  }

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
