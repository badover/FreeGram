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
const siteMenuToggle = document.getElementById("siteMenuToggle");
const siteMenu = document.getElementById("siteMenu");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const safetyModal = document.getElementById("safetyModal");
const closeModalBtn = document.querySelector('.close-modal');
const leaveConfirmModal = document.getElementById("leaveConfirmModal");
const leaveConfirmYesBtn = document.getElementById("leaveConfirmYes");
const leaveConfirmNoBtn = document.getElementById("leaveConfirmNo");
const leaveConfirmCloseBtn = document.getElementById("leaveConfirmClose");
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
const shareRoomBtn = document.getElementById("shareRoomBtn");
const cyberToastContainer = document.getElementById("cyberToastContainer");

const inviteBanner = document.getElementById("inviteBanner");
const inviteRoomNameBadge = document.getElementById("inviteRoomNameBadge");
const roomInputGroup = document.getElementById("roomInputGroup");
const passwordInputGroup = document.getElementById("passwordInputGroup");
const normalButtonGroup = document.getElementById("normalButtonGroup");
const inviteButtonGroup = document.getElementById("inviteButtonGroup");
const joinInviteBtn = document.getElementById("joinInviteBtn");
const inviteCancelRow = document.getElementById("inviteCancelRow");
const inviteCancelBtn = document.getElementById("inviteCancelBtn");

function bufferToBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBuffer(base64Url) {
  let str = String(base64Url || "").replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  const binary = atob(str);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isWebCryptoAvailable() {
  return typeof window !== "undefined" &&
    window.crypto &&
    Boolean(window.crypto.subtle);
}

async function deriveE2EEKey(roomName, password) {
  if (!isWebCryptoAvailable()) {
    console.warn("Web Crypto API is unavailable in this environment (requires HTTPS or localhost).");
    return null;
  }
  try {
    const enc = new TextEncoder();
    const cleanRoom = String(roomName || "").trim().toLowerCase();
    const salt = enc.encode("freegram-e2ee-v1:" + cleanRoom);
    const passBytes = enc.encode(String(password || ""));

    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      passBytes,
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    return derivedKey;
  } catch (err) {
    console.error("Failed to derive E2EE key:", err);
    return null;
  }
}

async function exportKeyToBase64(cryptoKey) {
  if (!cryptoKey || !isWebCryptoAvailable()) return null;
  try {
    const rawBuffer = await window.crypto.subtle.exportKey("raw", cryptoKey);
    return bufferToBase64Url(rawBuffer);
  } catch (err) {
    console.error("Failed to export E2EE key:", err);
    return null;
  }
}

async function importKeyFromBase64(base64UrlKey) {
  if (!base64UrlKey || !isWebCryptoAvailable()) return null;
  try {
    const keyBytes = base64UrlToBuffer(base64UrlKey);
    if (keyBytes.byteLength !== 32) {
      console.warn("Invalid AES-256 key length:", keyBytes.byteLength);
      return null;
    }
    const importedKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
    return importedKey;
  } catch (err) {
    console.error("Failed to import E2EE key:", err);
    return null;
  }
}

async function encryptChatMessage(payloadObj) {
  if (!activeRoomKey || !isWebCryptoAvailable()) return null;
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const jsonStr = JSON.stringify(payloadObj);
    const dataBytes = new TextEncoder().encode(jsonStr);

    const ctBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      activeRoomKey,
      dataBytes
    );

    return {
      enc: true,
      iv: bufferToBase64Url(iv),
      ct: bufferToBase64Url(ctBuffer)
    };
  } catch (err) {
    console.error("Encryption error:", err);
    return null;
  }
}

async function decryptChatMessage(ivBase64Url, ctBase64Url) {
  if (!activeRoomKey || !isWebCryptoAvailable()) return null;
  try {
    const iv = base64UrlToBuffer(ivBase64Url);
    const ct = base64UrlToBuffer(ctBase64Url);

    const ptBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      activeRoomKey,
      ct
    );

    const jsonStr = new TextDecoder().decode(ptBuffer);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.warn("Decryption error:", err);
    return null;
  }
}

function persistRoomKey(roomName, keyBase64) {
  if (!roomName || !keyBase64) return;
  try {
    sessionStorage.setItem("freegram_e2ee_" + roomName.toLowerCase().trim(), keyBase64);
  } catch (_) {}
}

function getPersistedRoomKey(roomName) {
  if (!roomName) return null;
  try {
    return sessionStorage.getItem("freegram_e2ee_" + roomName.toLowerCase().trim());
  } catch (_) {
    return null;
  }
}

function clearPersistedRoomKey(roomName) {
  if (!roomName) return;
  try {
    sessionStorage.removeItem("freegram_e2ee_" + roomName.toLowerCase().trim());
  } catch (_) {}
}

function updateE2EEUIState() {
  const badge = document.getElementById("e2eeBadge");
  if (!badge) return;
  const isE2EE = Boolean(activeRoomKey);
  if (isE2EE) {
    badge.classList.remove("inactive");
    badge.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i> <span class="e2ee-badge-text">E2EE</span>';
    badge.title = "End-to-End Encrypted (AES-256-GCM)";
  } else {
    badge.classList.add("inactive");
    badge.innerHTML = '<i class="fas fa-unlock" aria-hidden="true"></i> <span class="e2ee-badge-text">NO E2EE</span>';
    badge.title = "End-to-End Encryption Disabled";
  }
}

function getInviteKeyFromUrl() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash);
  const keyParam = hashParams.get("key") || hashParams.get("k");
  if (keyParam && keyParam.trim()) {
    return keyParam.trim();
  }
  return null;
}

function getInviteTokenFromUrl() {
  const path = window.location.pathname;
  const matchPrefixed = path.match(/^\/(?:join|i|r)\/([^\/?#]+)/i);
  if (matchPrefixed) return matchPrefixed[1].trim();

  const matchDirect = path.match(/^\/([a-zA-Z0-9_-]{8,64})\/?$/);
  if (matchDirect && !path.includes(".")) return matchDirect[1].trim();

  const urlParams = new URLSearchParams(window.location.search);
  const queryInvite = urlParams.get("invite") || urlParams.get("i");
  if (queryInvite && queryInvite.trim()) return queryInvite.trim();

  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const inviteParam = hashParams.get("invite") || hashParams.get("i");
    if (inviteParam && inviteParam.trim()) return inviteParam.trim();
    if (!hash.includes("=") && /^[a-zA-Z0-9_-]{8,64}$/.test(hash)) {
      return hash.trim();
    }
  }

  return null;
}

function getRoomInviteUrl(token) {
  let url = `${window.location.origin}/join/${token}`;
  if (activeRoomKeyBase64) {
    url += `#key=${activeRoomKeyBase64}`;
  }
  return url;
}

function showCyberToast(message, type = "success", durationMs = 2500) {
  let container = document.getElementById("cyberToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "cyberToastContainer";
    container.className = "cyber-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `cyber-toast ${type}`;
  const iconClass = type === "error" ? "fa-circle-exclamation" : "fa-circle-check";
  toast.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.25s forwards";
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

function copyTextToClipboard(text) {
  return new Promise((resolve) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => resolve(true))
        .catch(() => {
          resolve(fallbackCopy(text));
        });
    } else {
      resolve(fallbackCopy(text));
    }
  });
}

function fallbackCopy(text) {
  let success = false;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  textArea.style.width = "2em";
  textArea.style.height = "2em";
  textArea.style.padding = "0";
  textArea.style.border = "none";
  textArea.style.outline = "none";
  textArea.style.boxShadow = "none";
  textArea.style.background = "transparent";
  textArea.setAttribute("readonly", "");
  document.body.appendChild(textArea);

  if (navigator.userAgent.match(/ipad|ipod|iphone/i)) {
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    textArea.setSelectionRange(0, 999999);
  } else {
    textArea.select();
  }

  try {
    success = document.execCommand("copy");
  } catch (err) {
    console.error("Fallback copy failed:", err);
    success = false;
  }

  document.body.removeChild(textArea);
  return success;
}

const screenShareSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
if (voiceScreenBtn && !screenShareSupported) {
  voiceScreenBtn.style.display = "none";
}

let currentRoom = "";
let currentNickname = "";
let currentInviteToken = null;
let pendingInviteToken = getInviteTokenFromUrl();
let pendingInviteKey = getInviteKeyFromUrl();
let activeRoomKey = null;
let activeRoomKeyBase64 = null;
let fileAccessToken = null;
let loginRequestPending = false;
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
const IMAGE_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const CHUNK_SIZE = 512 * 1024;
const MAX_CHAT_LENGTH = 4000;
const DEFAULT_VOICE_USER_VOLUME = 100;
const THEME_STORAGE_KEY = "freegram-theme-v1";
const ROUNDED_BUTTONS_STORAGE_KEY = "freegram-rounded-buttons-v1";
const APPEARANCE_DB_NAME = "freegram-appearance";
const APPEARANCE_DB_STORE = "settings";
let customWallpaperUrl = null;
const THEME_PRESETS = {
  default: {
    bg: "#050508", panel: "#05050f", surface: "#00050a", header: "#001428",
    accent: "#00f3ff", accentAlt: "#ff00ff", text: "#e0f0ff", muted: "#88aacc",
    incoming: "#00101a", outgoing: "#001a0e", border: "#00f3ff", grid: "rgba(0, 243, 255, 0.1)"
  },
  cyberpunk: {
    bg: "#21080d", panel: "#12080b", surface: "#0c0507", header: "#1b090d",
    accent: "#ff365d", accentAlt: "#ffc857", text: "#f3e7e9", muted: "#b99ba1",
    incoming: "#2a0d13", outgoing: "#32151a", border: "#792535", grid: "rgba(255, 54, 93, 0.1)"
  },
  telegram: {
    bg: "#17212b", panel: "#1c2733", surface: "#0e1621", header: "#242f3d",
    accent: "#55c7a4", accentAlt: "#55c7a4", text: "#f1f4f6", muted: "#91a0ad",
    incoming: "#202d3b", outgoing: "#244c45", border: "#344452", grid: "rgba(85, 199, 164, 0.07)"
  },
  instagram: {
    bg: "#000000", panel: "#121212", surface: "#000000", header: "#1b1b1b",
    accent: "#d62976", accentAlt: "#a645d8", text: "#f5f5f5", muted: "#a8a8a8",
    incoming: "#202020", outgoing: "#38213a", border: "#363636", grid: "rgba(214, 41, 118, 0.07)"
  },
  discord: {
    bg: "#313338", panel: "#2b2d31", surface: "#1e1f22", header: "#2b2d31",
    accent: "#4752c4", accentAlt: "#c8c9cd", text: "#dbdee1", muted: "#949ba4",
    incoming: "#313338", outgoing: "#383a40", border: "#3f4147", grid: "rgba(71, 82, 196, 0.025)"
  }
};

function applyRoundedButtonsPreference(enabled) {
  document.body.dataset.roundedButtons = String(Boolean(enabled));
}

function applyThemePalette(palette, themeName) {
  const roundedButtonsEnabled = document.body.dataset.roundedButtons === "true";
  const root = document.documentElement;
  if (themeName === "default") {
    [
      "--theme-bg", "--theme-panel", "--theme-surface", "--theme-header",
      "--theme-accent", "--theme-accent-alt", "--theme-text", "--theme-muted",
      "--theme-incoming", "--theme-outgoing", "--theme-border",
      "--bg-dark", "--bg-darker", "--neon-blue", "--neon-pink", "--neon-yellow",
      "--neon-green", "--text-primary", "--text-secondary", "--grid-color"
    ].forEach((name) => root.style.removeProperty(name));
    delete document.body.dataset.theme;
    applyRoundedButtonsPreference(roundedButtonsEnabled);
    return;
  }

  const variableMap = {
    "--theme-bg": palette.bg,
    "--theme-panel": palette.panel,
    "--theme-surface": palette.surface,
    "--theme-header": palette.header,
    "--theme-accent": palette.accent,
    "--theme-accent-alt": palette.accentAlt,
    "--theme-text": palette.text,
    "--theme-muted": palette.muted,
    "--theme-incoming": palette.incoming,
    "--theme-outgoing": palette.outgoing,
    "--theme-border": palette.border,
    "--bg-dark": palette.panel,
    "--bg-darker": palette.bg,
    "--neon-blue": palette.accent,
    "--neon-pink": palette.accentAlt,
    "--neon-yellow": palette.accentAlt,
    "--neon-green": palette.accent,
    "--text-primary": palette.text,
    "--text-secondary": palette.muted,
    "--grid-color": palette.grid
  };
  Object.entries(variableMap).forEach(([name, value]) => root.style.setProperty(name, value));
  document.body.dataset.theme = themeName;
  applyRoundedButtonsPreference(roundedButtonsEnabled);
}

function saveTheme(palette, themeName) {
  applyThemePalette(palette, themeName);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeName, palette }));
  } catch (error) {
    console.warn("Could not save appearance settings:", error);
  }
}

function isValidThemePalette(palette) {
  const keys = ["bg", "panel", "surface", "header", "accent", "accentAlt", "text", "muted", "incoming", "outgoing", "border"];
  return palette &&
    keys.every((key) => typeof palette[key] === "string" && /^#[0-9a-f]{6}$/i.test(palette[key])) &&
    typeof palette.grid === "string" &&
    /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.\d+\)$/.test(palette.grid);
}

function shadeHex(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function openAppearanceDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(APPEARANCE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(APPEARANCE_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open appearance storage"));
  });
}

async function readSavedWallpaper() {
  const db = await openAppearanceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(APPEARANCE_DB_STORE, "readonly");
    const request = transaction.objectStore(APPEARANCE_DB_STORE).get("background-image");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read background image"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function saveWallpaper(blob) {
  const db = await openAppearanceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(APPEARANCE_DB_STORE, "readwrite");
    transaction.objectStore(APPEARANCE_DB_STORE).put(blob, "background-image");
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Could not save background image"));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Background image save was cancelled"));
    };
  });
}

async function removeSavedWallpaper() {
  const db = await openAppearanceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(APPEARANCE_DB_STORE, "readwrite");
    transaction.objectStore(APPEARANCE_DB_STORE).delete("background-image");
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Could not remove background image"));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Background image removal was cancelled"));
    };
  });
}

function applyWallpaper(blob) {
  if (customWallpaperUrl) URL.revokeObjectURL(customWallpaperUrl);
  customWallpaperUrl = blob ? URL.createObjectURL(blob) : null;
  if (customWallpaperUrl) {
    document.body.style.setProperty("--custom-wallpaper", `url("${customWallpaperUrl}")`);
    document.body.dataset.customWallpaper = "true";
  } else {
    document.body.style.removeProperty("--custom-wallpaper");
    delete document.body.dataset.customWallpaper;
  }
}

function setupThemes() {
  let savedTheme = null;
  try {
    savedTheme = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
  } catch (error) {
    console.warn("Could not read saved appearance settings:", error);
  }

  const activeThemeName = savedTheme?.themeName === "custom" && isValidThemePalette(savedTheme.palette)
    ? "custom"
    : typeof savedTheme?.themeName === "string" && THEME_PRESETS[savedTheme.themeName]
      ? savedTheme.themeName
      : "default";
  const activePalette = activeThemeName === "custom" ? savedTheme.palette : THEME_PRESETS[activeThemeName];
  applyThemePalette(activePalette, activeThemeName);

  const modal = document.getElementById("themeModal");
  const backgroundInput = document.getElementById("themeBackgroundColor");
  const accentInput = document.getElementById("themeAccentColor");
  const textInput = document.getElementById("themeTextColor");
  const preview = document.getElementById("themePreview");
  const backgroundImageInput = document.getElementById("themeBackgroundImage");
  const backgroundStatus = document.getElementById("themeBackgroundStatus");
  const roundedButtonsToggle = document.getElementById("roundedButtonsToggle");
  backgroundInput.value = activePalette.bg;
  accentInput.value = activePalette.accent;
  textInput.value = activePalette.text;
  try {
    roundedButtonsToggle.checked = localStorage.getItem(ROUNDED_BUTTONS_STORAGE_KEY) === "true";
  } catch (error) {
    console.warn("Could not read button shape setting:", error);
  }
  applyRoundedButtonsPreference(roundedButtonsToggle.checked);
  document.querySelectorAll("[data-theme-preset]").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.themePreset === activeThemeName));
  });

  const open = () => {
    if (modal) modal.style.display = "flex";
  };
  [document.getElementById("themeSettingsBtn"), document.getElementById("chatThemeSettingsBtn")]
    .filter(Boolean)
    .forEach((button) => button.addEventListener("click", open));

  document.getElementById("themeModalClose")?.addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) modal.style.display = "none";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal?.style.display === "flex") modal.style.display = "none";
  });

  document.querySelectorAll("[data-theme-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.themePreset;
      const palette = THEME_PRESETS[name];
      if (!palette) return;
      saveTheme(palette, name);
      backgroundInput.value = palette.bg;
      accentInput.value = palette.accent;
      textInput.value = palette.text;
      document.querySelectorAll("[data-theme-preset]").forEach((card) => {
        card.setAttribute("aria-pressed", String(card === button));
      });
      updateCustomPreview();
    });
  });

  const updateCustomPreview = () => {
    if (!preview) return;
    preview.style.setProperty("--preview-bg", backgroundInput.value);
    preview.style.setProperty("--preview-accent", accentInput.value);
    preview.style.setProperty("--preview-text", textInput.value);
  };
  [backgroundInput, accentInput, textInput].forEach((input) => input?.addEventListener("input", updateCustomPreview));
  updateCustomPreview();

  readSavedWallpaper()
    .then((blob) => {
      if (blob instanceof Blob && blob.type.startsWith("image/")) {
        applyWallpaper(blob);
        backgroundStatus.textContent = "Your background image is active on this device.";
      }
    })
    .catch((error) => {
      console.error("Could not load saved background image:", error);
      backgroundStatus.textContent = "Could not load the saved background image.";
    });

  backgroundImageInput.addEventListener("change", async () => {
    const [file] = backgroundImageInput.files || [];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/avif"].includes(file.type)) {
      backgroundStatus.textContent = "Choose a PNG, JPEG, WebP, or AVIF image.";
      backgroundImageInput.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      backgroundStatus.textContent = "Background image must be 20 MB or smaller.";
      backgroundImageInput.value = "";
      return;
    }
    try {
      const decodedImage = await createImageBitmap(file);
      const imageIsTooLarge = decodedImage.width * decodedImage.height > 20_000_000;
      decodedImage.close();
      if (imageIsTooLarge) {
        backgroundStatus.textContent = "Image dimensions must not exceed 20 megapixels.";
        return;
      }
      await saveWallpaper(file);
      applyWallpaper(file);
      backgroundStatus.textContent = "Background image saved on this device.";
    } catch (error) {
      console.error("Could not save background image:", error);
      backgroundStatus.textContent = "Could not save the background image.";
    } finally {
      backgroundImageInput.value = "";
    }
  });

  document.getElementById("clearThemeBackgroundBtn").addEventListener("click", async () => {
    try {
      await removeSavedWallpaper();
      applyWallpaper(null);
      backgroundStatus.textContent = "";
    } catch (error) {
      console.error("Could not remove background image:", error);
      backgroundStatus.textContent = "Could not remove the background image.";
    }
  });

  roundedButtonsToggle.addEventListener("change", () => {
    applyRoundedButtonsPreference(roundedButtonsToggle.checked);
    try {
      localStorage.setItem(ROUNDED_BUTTONS_STORAGE_KEY, String(roundedButtonsToggle.checked));
    } catch (error) {
      console.error("Could not save button shape setting:", error);
    }
  });

  document.getElementById("applyCustomThemeBtn")?.addEventListener("click", () => {
    const bg = backgroundInput.value;
    const accent = accentInput.value;
    const text = textInput.value;
    const palette = {
      ...THEME_PRESETS.cyberpunk,
      bg,
      panel: shadeHex(bg, 10),
      surface: shadeHex(bg, 4),
      header: shadeHex(bg, 16),
      accent,
      accentAlt: accent,
      text,
      muted: shadeHex(text, -85),
      incoming: shadeHex(bg, 24),
      outgoing: shadeHex(bg, 32),
      border: shadeHex(bg, 42),
      grid: `rgba(${Number.parseInt(accent.slice(1, 3), 16)}, ${Number.parseInt(accent.slice(3, 5), 16)}, ${Number.parseInt(accent.slice(5, 7), 16)}, 0.08)`
    };
    saveTheme(palette, "custom");
    document.querySelectorAll("[data-theme-preset]").forEach((card) => {
      card.setAttribute("aria-pressed", "false");
    });
  });

  document.getElementById("resetThemeBtn")?.addEventListener("click", () => {
    saveTheme(THEME_PRESETS.default, "default");
    backgroundInput.value = THEME_PRESETS.default.bg;
    accentInput.value = THEME_PRESETS.default.accent;
    textInput.value = THEME_PRESETS.default.text;
    updateCustomPreview();
    document.querySelectorAll("[data-theme-preset]").forEach((card) => {
      card.setAttribute("aria-pressed", String(card.dataset.themePreset === "default"));
    });
  });
}

setupThemes();

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
let ICE_SERVERS = [...STUN_SERVERS];

function refreshIceServers() {
  socket.emit("getIceServers", {}, (response) => {
    if (!response || !response.ok || !response.turnServer) {
      console.warn("No TURN relay configuration received; using STUN servers only.");
      return;
    }
    ICE_SERVERS = [...STUN_SERVERS, response.turnServer];
    console.info("TURN relay configuration received.");
  });
}
const VOICE_VAD_INTERVAL_MS = 60;
const VOICE_VAD_ONSET_FRAMES = 2;
const VOICE_VAD_HANGOVER_MS = 400;
const VOICE_VAD_MARGIN = 3.5;
const VOICE_VAD_NOISE_SMOOTHING = 0.05;
const P2P_CHUNK_SIZE = 256 * 1024;
const P2P_BUFFERED_AMOUNT_HIGH = 4 * 1024 * 1024;
const P2P_BLOB_COALESCE_BYTES = 8 * 1024 * 1024;
const MAX_DROPPED_FILES = 5;
let mediaUploadInProgress = false;

function normalizeUploadMime(file) {
  if (file && typeof file.type === "string" && file.type.trim()) {
    return file.type.trim();
  }
  return "application/octet-stream";
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
  createRoomBtn.addEventListener("click", async () => {
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

    if (nickname) {
      try { localStorage.setItem("freegram_nickname", nickname); } catch (_) {}
    }

    loginError.textContent = "";
    loginRequestPending = true;

    try {
      activeRoomKey = await deriveE2EEKey(room, password);
      if (activeRoomKey) {
        activeRoomKeyBase64 = await exportKeyToBase64(activeRoomKey);
        persistRoomKey(room, activeRoomKeyBase64);
      }
    } catch (err) {
      console.warn("Could not derive E2EE key:", err);
    }

    socket.emit("createRoom", { room, password, nickname });
  });
}


if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", async () => {
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

    if (nickname) {
      try { localStorage.setItem("freegram_nickname", nickname); } catch (_) {}
    }

    loginError.textContent = "";
    loginRequestPending = true;

    try {
      activeRoomKey = await deriveE2EEKey(room, password);
      if (activeRoomKey) {
        activeRoomKeyBase64 = await exportKeyToBase64(activeRoomKey);
        persistRoomKey(room, activeRoomKeyBase64);
      }
    } catch (err) {
      console.warn("Could not derive E2EE key:", err);
    }

    socket.emit("joinRoom", { room, password, nickname });
  });
}

function setupInviteMode(token) {
  if (!token) return;
  pendingInviteToken = token;

  if (inviteBanner) inviteBanner.style.display = "block";
  if (roomInputGroup) roomInputGroup.style.display = "none";
  if (passwordInputGroup) passwordInputGroup.style.display = "none";
  if (normalButtonGroup) normalButtonGroup.style.display = "none";
  if (inviteButtonGroup) inviteButtonGroup.style.display = "flex";
  if (inviteCancelRow) inviteCancelRow.style.display = "block";

  try {
    const saved = localStorage.getItem("freegram_nickname");
    if (saved && nicknameInput) {
      nicknameInput.value = saved;
    }
  } catch (_) {}

  if (nicknameInput) {
    nicknameInput.placeholder = "Enter your custom nickname";
    nicknameInput.focus();
    if (nicknameInput.value) {
      nicknameInput.select();
    }
  }

  if (socket.connected) {
    resolveInviteDetails(token);
  } else {
    socket.once("connect", () => resolveInviteDetails(token));
  }
}

function resolveInviteDetails(token) {
  socket.emit("resolveInvite", { token }, (res) => {
    if (res && res.ok && res.roomName) {
      if (inviteRoomNameBadge) {
        const countInfo = typeof res.userCount === "number" ? ` (${res.userCount} online)` : "";
        inviteRoomNameBadge.textContent = `${res.roomName.toUpperCase()}${countInfo}`;
        inviteRoomNameBadge.className = "neon-yellow";
      }
    } else if (res && res.error) {
      if (inviteRoomNameBadge) {
        inviteRoomNameBadge.textContent = "EXPIRED OR INVALID";
        inviteRoomNameBadge.className = "neon-red";
      }
      showError(res.error || "Invite link expired or invalid");
    }
  });
}

function cancelInviteMode() {
  pendingInviteToken = null;
  pendingInviteKey = null;
  if (inviteBanner) inviteBanner.style.display = "none";
  if (roomInputGroup) roomInputGroup.style.display = "block";
  if (passwordInputGroup) passwordInputGroup.style.display = "block";
  if (normalButtonGroup) normalButtonGroup.style.display = "flex";
  if (inviteButtonGroup) inviteButtonGroup.style.display = "none";
  if (inviteCancelRow) inviteCancelRow.style.display = "none";
  if (nicknameInput) {
    nicknameInput.placeholder = "Enter nickname";
    nicknameInput.focus();
  }
}

function submitInviteJoin() {
  if (!pendingInviteToken) return;

  const rawNick = nicknameInput ? nicknameInput.value.trim() : "";
  const nickname = rawNick || `Guest_${Math.floor(1000 + Math.random() * 9000)}`;

  if (rawNick) {
    try {
      localStorage.setItem("freegram_nickname", rawNick);
    } catch (_) {}
  }

  loginError.textContent = "";
  loginRequestPending = true;

  socket.emit("joinByInvite", { token: pendingInviteToken, nickname });
}

if (joinInviteBtn) {
  joinInviteBtn.addEventListener("click", submitInviteJoin);
}

if (inviteCancelBtn) {
  inviteCancelBtn.addEventListener("click", cancelInviteMode);
}

if (nicknameInput) {
  nicknameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (pendingInviteToken) {
        submitInviteJoin();
      } else if (roomInput) {
        roomInput.focus();
      }
    }
  });
}

if (pendingInviteToken) {
  setupInviteMode(pendingInviteToken);
}

function shareCurrentRoom() {
  if (!currentRoom) return;
  if (!currentInviteToken) {
    socket.emit("getInviteLink", (res) => {
      if (res && res.ok && res.inviteToken) {
        currentInviteToken = res.inviteToken;
        doCopyInviteLink();
      } else {
        showCyberToast("Could not generate invite link", "error");
      }
    });
    return;
  }
  doCopyInviteLink();
}

async function doCopyInviteLink() {
  const url = getRoomInviteUrl(currentInviteToken);
  const ok = await copyTextToClipboard(url);
  if (ok) {
    if (shareRoomBtn) {
      shareRoomBtn.classList.add("copied");
      const btnText = shareRoomBtn.querySelector(".share-btn-text");
      const icon = shareRoomBtn.querySelector("i");
      if (btnText) btnText.textContent = "COPIED!";
      if (icon) icon.className = "fas fa-check";
      setTimeout(() => {
        shareRoomBtn.classList.remove("copied");
        if (btnText) btnText.textContent = "INVITE";
        if (icon) icon.className = "fas fa-link";
      }, 2000);
    }
    showCyberToast("Invite link copied: " + url, "success");
  } else {
    showCyberToast("Could not copy invite link", "error");
  }
}

if (shareRoomBtn) {
  shareRoomBtn.addEventListener("click", shareCurrentRoom);
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

function closeSiteMenu(returnFocus = false) {
  if (!siteMenu || !siteMenuToggle) return;
  siteMenu.hidden = true;
  siteMenuToggle.setAttribute("aria-expanded", "false");
  if (returnFocus) siteMenuToggle.focus();
}

if (siteMenuToggle && siteMenu) {
  siteMenuToggle.addEventListener("click", () => {
    const isOpen = !siteMenu.hidden;
    siteMenu.hidden = isOpen;
    siteMenuToggle.setAttribute("aria-expanded", String(!isOpen));
  });

  siteMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeSiteMenu());
  });

  document.addEventListener("click", (event) => {
    if (!siteMenu.hidden && !event.target.closest(".site-menu")) {
      closeSiteMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !siteMenu.hidden) {
      closeSiteMenu(true);
    }
  });
}

if (safetyBtn) {
  safetyBtn.addEventListener('click', () => {
    closeSiteMenu();
    showSafetyModal();
  });
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

if (leaveConfirmYesBtn) {
  leaveConfirmYesBtn.addEventListener('click', () => {
    hideLeaveConfirmModal();
    performLeaveRoom();
  });
}

if (leaveConfirmNoBtn) {
  leaveConfirmNoBtn.addEventListener('click', hideLeaveConfirmModal);
}

if (leaveConfirmCloseBtn) {
  leaveConfirmCloseBtn.addEventListener('click', hideLeaveConfirmModal);
}

if (leaveConfirmModal) {
  leaveConfirmModal.addEventListener('click', (e) => {
    if (e.target === leaveConfirmModal) {
      hideLeaveConfirmModal();
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

  if (leaveConfirmModal) {
    leaveConfirmModal.style.display = 'flex';
  } else {
    performLeaveRoom();
  }
}

function hideLeaveConfirmModal() {
  if (leaveConfirmModal) {
    leaveConfirmModal.style.display = 'none';
  }
}

function performLeaveRoom() {
  if (!currentRoom) return;

  leaveVoiceChannel(true);
  cleanupP2PState();
  socket.emit('leaveRoom', { room: currentRoom });
  clearPersistedRoomKey(currentRoom);
  activeRoomKey = null;
  activeRoomKeyBase64 = null;
  updateE2EEUIState();
  fileAccessToken = null;
  currentInviteToken = null;

  chatScreen.style.display = 'none';
  loginScreen.style.display = 'flex';

  currentRoom = '';
  currentNickname = '';
  messagesList.innerHTML = '';

  addSystemMessage('>>> Left the room');
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
    if (typeof url !== 'string' || !url) return '#';
    if (url.includes('javascript:') || 
      url.includes('data:text/html') ||
      url.includes('onerror=') ||
      url.includes('onload=')) {
      return '#';
    }
    if (url.startsWith('/uploads/')) {
        const cleanPath = url.split('?')[0];
        const filename = cleanPath.substring(9);
        if (/^[a-zA-Z0-9._-]+$/.test(filename)) {
            return fileAccessToken ? `${cleanPath}?token=${encodeURIComponent(fileAccessToken)}` : cleanPath;
        }
        return '#';
    }
    
    if (url.startsWith('data:image/jpeg;base64,') ||
        url.startsWith('data:image/png;base64,') ||
        url.startsWith('data:image/gif;base64,') ||
        url.startsWith('data:image/webp;base64,') ||
        url.startsWith('data:image/avif;base64,')) {
        return url;
    }
    
    if (url.startsWith('blob:')) {
        return url;
    }
    
    console.warn('Blocked unsafe URL:', url.substring(0, 50));
    return '#'; 
}

function downloadableMediaURL(url) {
  const safeURL = safeMediaURL(url);
  if (!safeURL || safeURL === '#' || !safeURL.startsWith("/uploads/")) return safeURL;
  const cleanPath = safeURL.split('?')[0];
  const tokenQuery = fileAccessToken ? `token=${encodeURIComponent(fileAccessToken)}&` : '';
  return `${cleanPath}?${tokenQuery}download=1`;
}

async function downloadMediaFile(url, fileName) {
  try {
    const safeUrl = safeMediaURL(url);
    if (!safeUrl || safeUrl === '#') {
      console.error("Download failed: invalid URL", url);
      return;
    }
    const downloadUrl = downloadableMediaURL(safeUrl);
    
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    
    const cleanName = fileName || (safeUrl.split('/').pop() || 'download').split('?')[0];
    
    if (navigator.canShare && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try {
        const file = new File([blob], cleanName, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: cleanName
          });
          return;
        }
      } catch (shareError) {
        if (shareError.name === 'AbortError') return;
      }
    }
    
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (error) {
    console.warn("Direct blob download failed, falling back to direct navigation:", error);
    const fallbackUrl = downloadableMediaURL(url);
    const a = document.createElement('a');
    a.href = fallbackUrl;
    a.download = fileName || 'file';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

socket.on("error", (payload) => {
  console.error("Socket error:", payload);
  showError(getErrorMessage(payload, GENERIC_ERROR_MESSAGE));
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  if (loginRequestPending) {
    loginRequestPending = false;
    showError("Could not connect to the server. Check your connection and try again.");
  }
});

socket.on("disconnect", (reason) => {
  if (reason === "io client disconnect") {
    fileAccessToken = null;
    return;
  }
  console.error("Disconnected:", reason);
  if (currentRoom) {
    addSystemMessage(">>> Connection interrupted. Reconnecting…");
  }
});

function handleExpiredRoomSession() {
  if (!currentRoom) return;
  leaveVoiceChannel(false);
  cleanupP2PState();
  clearPersistedRoomKey(currentRoom);
  activeRoomKey = null;
  activeRoomKeyBase64 = null;
  updateE2EEUIState();
  fileAccessToken = null;
  currentInviteToken = null;
  loginError.textContent = "Connection expired. Rejoin the room to continue.";
  chatScreen.style.display = "none";
  loginScreen.style.display = "flex";
  currentRoom = "";
  currentNickname = "";
  messagesList.innerHTML = "";
}

socket.on("connect", () => {
  if (currentRoom && !socket.recovered) {
    handleExpiredRoomSession();
    return;
  }
  if (pendingInviteToken && !currentRoom) {
    setupInviteMode(pendingInviteToken);
  }
});

if (socket.connected && pendingInviteToken && !currentRoom) {
  setupInviteMode(pendingInviteToken);
}

socket.on("sessionRecovered", async (data) => {
  if (!data || data.room !== currentRoom) return;
  currentNickname = data.nickname;
  fileAccessToken = typeof data.fileAccessToken === "string" ? data.fileAccessToken : null;
  currentInviteToken = typeof data.inviteToken === "string" ? data.inviteToken : currentInviteToken;
  currentRoomSpan.textContent = safeText(currentRoom).toUpperCase();
  currentUserSpan.textContent = safeText(currentNickname).toUpperCase();
  userCountSpan.textContent = data.userCount || 1;

  if (!activeRoomKey) {
    const persisted = getPersistedRoomKey(currentRoom);
    if (persisted) {
      try {
        activeRoomKey = await importKeyFromBase64(persisted);
        if (activeRoomKey) activeRoomKeyBase64 = persisted;
      } catch (_) {}
    }
  }
  updateE2EEUIState();
  addSystemMessage(">>> Connection restored.");
});

socket.on("sessionExpired", handleExpiredRoomSession);

socket.on("roomError", (msg) => {
  console.error("Room error:", msg);
  loginRequestPending = false;
  showError(msg);
});

socket.on("roomJoined", async (data) => {
  loginRequestPending = false;
  currentRoom = data.room;
  currentNickname = data.nickname;
  fileAccessToken = typeof data.fileAccessToken === "string" ? data.fileAccessToken : null;
  currentInviteToken = typeof data.inviteToken === "string" ? data.inviteToken : null;

  try {
    if (currentNickname) localStorage.setItem("freegram_nickname", currentNickname);
  } catch (_) {}

  // Setup E2EE key from invite key or persisted storage
  if (!activeRoomKey && pendingInviteKey) {
    try {
      activeRoomKey = await importKeyFromBase64(pendingInviteKey);
      if (activeRoomKey) {
        activeRoomKeyBase64 = pendingInviteKey;
        persistRoomKey(currentRoom, activeRoomKeyBase64);
      }
    } catch (err) {
      console.warn("Failed to import invite key:", err);
    }
    pendingInviteKey = null;
  } else if (!activeRoomKey) {
    const persisted = getPersistedRoomKey(currentRoom);
    if (persisted) {
      try {
        activeRoomKey = await importKeyFromBase64(persisted);
        if (activeRoomKey) activeRoomKeyBase64 = persisted;
      } catch (_) {}
    }
  }

  updateE2EEUIState();

  currentRoomSpan.textContent = safeText(currentRoom).toUpperCase();
  currentUserSpan.textContent = safeText(currentNickname).toUpperCase();
  userCountSpan.textContent = data.userCount || 1;

  loginScreen.style.display = "none";
  chatScreen.style.display = "block";

  try {
    const cleanPath = window.location.pathname.replace(/^\/(?:join|i|r)\/[a-zA-Z0-9_-]+|\/[a-zA-Z0-9_-]{8,64}$/, "") || "/";
    window.history.replaceState({}, document.title, window.location.origin + cleanPath);
  } catch (_) {}

  messagesList.innerHTML = "";
  resetVoiceStateUI();
  refreshIceServers();

  addSystemMessage(`>>> ROOM: ${currentRoom}`);
  if (currentInviteToken) {
    const inviteUrl = getRoomInviteUrl(currentInviteToken);
    addSystemMessage(`>>> INVITE LINK: ${inviteUrl} (click to copy)`);
  }
  
  createUploadButton();

  chatInput.focus();
});

socket.on("roomClosed", (data) => {
  leaveVoiceChannel(false);
  cleanupP2PState();
  clearPersistedRoomKey(currentRoom);
  activeRoomKey = null;
  activeRoomKeyBase64 = null;
  updateE2EEUIState();
  addSystemMessage(`>>> ROOM CLOSED BY ${data.closedBy}`);
  addSystemMessage(">>> ALL FILES DELETED");
  
  setTimeout(() => {
    chatScreen.style.display = "none";
    loginScreen.style.display = "flex";
    messagesList.innerHTML = "";
    currentRoom = "";
    currentNickname = "";
    fileAccessToken = null;
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

function registerMessage(msgId, nickname, snippet, type, el, rawText = "") {
  if (!msgId) return;
  messageRegistry.set(msgId, { nickname: String(nickname || ""), snippet, type, el, rawText });
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

function buildMessageActionsHtml(msgId) {
  if (!msgId) return "";
  const id = escapeHtml(String(msgId));
  return `
    <div class="message-actions">
      <button type="button" class="message-action-btn message-copy-btn" data-copy-msg-id="${id}" aria-label="Copy message" title="Copy message"><i class="fas fa-copy"></i></button>
      <button type="button" class="message-action-btn message-reply-btn" data-reply-to="${id}" aria-label="Reply" title="Reply"><i class="fas fa-reply"></i></button>
    </div>
  `;
}

function buildReplyButtonHtml(msgId) {
  return buildMessageActionsHtml(msgId);
}

async function handleCopyMessage(btn) {
  const msgId = btn.dataset.copyMsgId;
  if (!msgId) return;

  let textToCopy = "";
  const entry = messageRegistry.get(msgId);
  if (entry && entry.rawText) {
    textToCopy = entry.rawText;
  } else {
    const el = findMessageElement(msgId);
    if (el) {
      if (el.dataset.rawMsg) {
        try {
          textToCopy = decodeURIComponent(el.dataset.rawMsg);
        } catch (_) {
          textToCopy = el.dataset.rawMsg;
        }
      } else {
        const contentEl = el.querySelector(".message-content");
        if (contentEl) {
          textToCopy = contentEl.innerText || contentEl.textContent || "";
        } else {
          const link = el.querySelector(".view-link, .download-link");
          if (link) {
            textToCopy = link.href;
          } else {
            textToCopy = entry?.snippet || "";
          }
        }
      }
    }
  }

  if (!textToCopy) return;

  const ok = await copyTextToClipboard(textToCopy);
  if (ok) {
    btn.classList.add("copied");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    showCyberToast("Message copied to clipboard!", "success");
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = originalHtml;
    }, 1500);
  } else {
    showCyberToast("Could not copy message", "error");
  }
}

if (replyPreviewCancel) {
  replyPreviewCancel.addEventListener("click", cancelReply);
}

async function sendMessage() {
  const msg = normalizeOutgoingMessage(chatInput.value);
  if (!msg) return;
  if (msg.length > MAX_CHAT_LENGTH) {
    addSystemMessage(`>>> Message too long (${msg.length}/${MAX_CHAT_LENGTH})`);
    return;
  }

  const currentReply = replyingTo ? {
    msgId: replyingTo.msgId,
    nickname: replyingTo.nickname,
    snippet: replyingTo.snippet,
    type: replyingTo.type
  } : null;

  chatInput.value = "";
  resizeChatInput();
  cancelReply();

  if (activeRoomKey) {
    try {
      const encrypted = await encryptChatMessage({
        text: msg,
        replyTo: currentReply
      });
      if (encrypted) {
        socket.emit("chatMessage", {
          enc: true,
          iv: encrypted.iv,
          ct: encrypted.ct,
          replyTo: currentReply ? { msgId: currentReply.msgId } : null
        });
        return;
      }
    } catch (err) {
      console.warn("Encryption failed, falling back to plaintext:", err);
    }
  }

  socket.emit("chatMessage", {
    msg,
    replyTo: currentReply ? { msgId: currentReply.msgId } : null
  });
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
    if (!socket.connected) {
      reject(new Error("Disconnected before upload"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("Upload timed out"));
    }, 60000);

    const onDisconnect = () => finish(new Error("Disconnected during upload"));
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("disconnect", onDisconnect);
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    };

    socket.once("disconnect", onDisconnect);

    try {
      socket.timeout(60000).emit("uploadMediaChunk", payload, (err, response) => {
        if (err) {
          finish(err instanceof Error ? err : new Error("Upload timed out"));
          return;
        }
        if (!response || response.ok === false) {
          finish(new Error((response && response.error) || "Upload failed"));
          return;
        }
        finish(null, response);
      });
    } catch (emitError) {
      finish(emitError);
    }
  });
}

async function sendMediaToServer(file, fileData, replyTo, onProgress) {
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
      if (!socket.connected) {
        throw new Error("Disconnected during upload");
      }

      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, bytes.byteLength);
      const chunk = bytes.subarray(start, end);

      const response = await emitUploadChunk({
        uploadId,
        fileName: file.name || "file",
        fileType,
        fileSize: file.size || bytes.byteLength,
        replyTo: index === 0 && replyTo ? { msgId: replyTo.msgId } : null,
        chunkIndex: index,
        totalChunks,
        chunkData: chunk
      });
      if (response.complete) {
        if (onProgress) onProgress(bytes.byteLength, bytes.byteLength);
        return true;
      }
      if (onProgress) onProgress(end, bytes.byteLength);
    }
    return false;
  } catch (error) {
    console.error("Upload failed:", file.name, error);
    addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
    return false;
  }
}

socket.on("mediaError", (msg) => {
  console.error("Media error:", msg);
  addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
});

socket.on("chatMessage", async (data) => {
  if (data.type === 'media') {
    addMediaMessage(data);
  } else if (data.type === 'p2p-offer') {
    addP2PMessage(data);
  } else {
    if (data.enc && data.iv && data.ct) {
      if (activeRoomKey) {
        try {
          const decrypted = await decryptChatMessage(data.iv, data.ct);
          if (decrypted && typeof decrypted.text === "string") {
            data.msg = decrypted.text;
            if (decrypted.replyTo) {
              data.replyTo = decrypted.replyTo;
            }
            data.encrypted = true;
          } else {
            data.msg = "[🔒 Encrypted message (Unable to decrypt)]";
            data.decryptFailed = true;
          }
        } catch (err) {
          console.warn("Failed to decrypt message:", err);
          data.msg = "[🔒 Encrypted message (Decryption error)]";
          data.decryptFailed = true;
        }
      } else {
        data.msg = "[🔒 Encrypted message (Key unavailable)]";
        data.decryptFailed = true;
      }
    }
    addTextMessage(data);
  }
});

function findMessageElement(msgId) {
  if (!msgId) return null;
  const entry = messageRegistry.get(msgId);
  if (entry?.el && entry.el.isConnected) return entry.el;
  const safeId = String(msgId).replace(/["\\]/g, "");
  return messagesList.querySelector(`[data-msg-id="${safeId}"]`);
}

socket.on("mediaThumbnailReady", (data) => {
  if (!data || typeof data.msgId !== "string" || typeof data.thumbnail !== "string") return;
  const message = findMessageElement(data.msgId);
  const image = message && message.querySelector(".media-thumbnail");
  if (!image) return;

  image.src = safeMediaURL(data.thumbnail);
  image.classList.remove("media-thumbnail-pending");
});

socket.on("mediaThumbnailFailed", (data) => {
  if (!data || typeof data.msgId !== "string") return;
  const message = findMessageElement(data.msgId);
  const image = message && message.querySelector(".media-thumbnail");
  if (image) showFullImagePreview(image);
});

function showFullImagePreview(image) {
  if (!image) return;
  const fullUrl = image.dataset.fullUrl;
  if (!fullUrl || fullUrl === '#') return;
  image.classList.remove("media-thumbnail-pending");
  image.dataset.fallbackTried = "true";
  image.src = safeMediaURL(fullUrl);
}

function addTextMessage(data) {
  const messageDiv = document.createElement("div");
  const messageHtml = linkifyMessageText(data.msg);
  const nickname = escapeHtml(String(data.nickname || ""));
  const time = escapeHtml(String(data.time || ""));

  const lockHtml = data.encrypted
    ? `<span class="message-e2e-lock" title="End-to-End Encrypted (AES-256-GCM)"><i class="fas fa-lock" aria-hidden="true"></i></span>`
    : (data.decryptFailed
       ? `<span class="message-e2e-lock lock-error" title="Could not decrypt message"><i class="fas fa-lock-open" aria-hidden="true"></i></span>`
       : '');

  messageDiv.className = data.self ? "message-self" : "message-other";
  if (data.msgId) messageDiv.dataset.msgId = data.msgId;
  if (typeof data.msg === "string") messageDiv.dataset.rawMsg = encodeURIComponent(data.msg);
  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-nickname">${nickname}</span>
      <span class="message-time">${time}${lockHtml}</span>
      ${buildMessageActionsHtml(data.msgId)}
    </div>
    ${buildReplyQuoteHtml(data.replyTo)}
    <div class="message-content${data.decryptFailed ? ' message-decrypt-failed' : ''}">${messageHtml}</div>
  `;

  messagesList.appendChild(messageDiv);
  registerMessage(data.msgId, data.nickname, truncateSnippet(data.msg), "text", messageDiv, data.msg);
  scrollToBottom();
}

function addMediaMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.className = data.self ? "message-self media-message" : "message-other media-message";
  if (data.msgId) messageDiv.dataset.msgId = data.msgId;

  const fileSize = formatFileSize(data.fileSize);
  
  let mediaContent = '';
  
  if (data.isImage) {
    const thumbnailUrl = safeMediaURL(data.thumbnail || IMAGE_PLACEHOLDER);
    mediaContent = `
      <div class="media-preview">
        <img src="${thumbnailUrl}"
             alt="${escapeHtml(data.fileName)}"
             class="media-thumbnail${data.thumbnail ? "" : " media-thumbnail-pending"}"
             data-preview-url="${thumbnailUrl}"
             data-full-url="${safeMediaURL(data.fileUrl)}"
             draggable="false">
        <div class="media-info">
          <strong>📸 ${escapeHtml(data.fileName)}</strong>
          <small>${fileSize}</small>
          ${data.metadataStripped ? '<div class="file-warning"><i class="fas fa-check-circle"></i> METADATA REMOVED</div>' : ''}
          <a href="${safeMediaURL(data.fileUrl)}" target="_blank" class="view-link">🔍 View Full</a>
          <a href="${downloadableMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
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
          <a href="${downloadableMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
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
          <a href="${downloadableMediaURL(data.fileUrl)}" download="${escapeHtml(data.fileName)}" class="download-link">⬇ Download</a>
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
    zoomableMedia.addEventListener("error", () => {
      if (zoomableMedia.dataset.fallbackTried === "true") {
        zoomableMedia.alt = "Image preview could not be loaded";
        return;
      }
      showFullImagePreview(zoomableMedia);
    });
    zoomableMedia.addEventListener("click", (event) => {
      event.stopPropagation();
      openFullImage(safeMediaURL(data.fileUrl), data.fileName);
    });
  }
  const viewFullLink = messageDiv.querySelector(".view-link");
  if (viewFullLink) {
    viewFullLink.addEventListener("click", (event) => {
      event.preventDefault();
      openFullImage(safeMediaURL(data.fileUrl), data.fileName);
    });
  }
  const downloadLink = messageDiv.querySelector(".download-link");
  if (downloadLink) {
    downloadLink.addEventListener("click", (event) => {
      event.preventDefault();
      downloadMediaFile(data.fileUrl, data.fileName);
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
  const p2pImageMetadataNotice = typeof data.fileType === "string" && data.fileType.toLowerCase().startsWith("image/")
    ? '<div class="file-warning">IMAGE METADATA IS NOT REMOVED FOR P2P FILES</div>'
    : "";

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
        ${p2pImageMetadataNotice}
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

  console.log("[P2P receiver] creating RTCPeerConnection");
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
    completed: false,
    pendingIceCandidates: []
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
      console.log(`[P2P receiver] local candidate type=${candidateType(event.candidate.candidate)}`);
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
        const resume = () => {
          channel.removeEventListener("bufferedamountlow", resume);
          channel.removeEventListener("close", resume);
          channel.removeEventListener("error", resume);
          resolve();
        };
        channel.addEventListener("bufferedamountlow", resume, { once: true });
        channel.addEventListener("close", resume, { once: true });
        channel.addEventListener("error", resume, { once: true });
        if (channel.readyState !== "open" || channel.bufferedAmount <= P2P_BUFFERED_AMOUNT_HIGH / 2) {
          resume();
        }
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

  console.log("[P2P sender] creating RTCPeerConnection");
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const senderState = { pc, channel: null, fileId: data.fileId, pendingIceCandidates: [] };
  p2pSenderConnections.set(key, senderState);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[P2P sender] local candidate type=${candidateType(event.candidate.candidate)}`);
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
  for (const candidate of senderState.pendingIceCandidates.splice(0)) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.error("P2P addIceCandidate error:", error);
    }
  }
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
      if (state) {
        await state.pc.setRemoteDescription(data.sdp);
        for (const candidate of state.pendingIceCandidates.splice(0)) {
          try {
            await state.pc.addIceCandidate(candidate);
          } catch (error) {
            console.error("P2P addIceCandidate error:", error);
          }
        }
      }
    } else if (data.type === "ice-candidate" && data.candidate) {
      const senderEntry = p2pSenderConnections.get(senderKey(from, data.fileId));
      const receiverState = p2pReceiverState.get(data.fileId);
      const pc = (senderEntry ? senderEntry.pc : null) || (receiverState ? receiverState.pc : null);
      if (pc) {
        console.log(`[P2P] remote candidate type=${candidateType(data.candidate.candidate)}`);
        const state = senderEntry || receiverState;
        if (!pc.remoteDescription) {
          if (state.pendingIceCandidates.length >= 64) {
            console.warn("P2P candidate queue limit reached.");
            return;
          }
          state.pendingIceCandidates.push(data.candidate);
        } else {
          await pc.addIceCandidate(data.candidate);
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

  const inviteMatch = String(text || "").match(/(>>> INVITE LINK:\s*)(https?:\/\/[^\s]+)(.*)/);
  if (inviteMatch) {
    inner.innerHTML = `${escapeHtml(inviteMatch[1])}<span class="system-invite-link" data-url="${escapeHtml(inviteMatch[2])}" title="Click to copy invite link">${escapeHtml(inviteMatch[2])}</span>${escapeHtml(inviteMatch[3])}`;
  } else {
    inner.textContent = text;
  }

  systemDiv.appendChild(inner);
  messagesList.appendChild(systemDiv);
  scrollToBottom();
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    
    if (validFiles.length > MAX_DROPPED_FILES) {
        addSystemMessage(`>>> You can upload at most ${MAX_DROPPED_FILES} files at a time`);
        return;
    }
    
    void (async () => {
        for (const file of validFiles) {
            if (!await uploadMedia(file)) break;
        }
    })();
}


async function uploadMedia(file) {
    if (!file) return false;

    if (file.size > MAX_UPLOAD_SIZE) {
        addSystemMessage(">>> File is too large (max 50MB)");
        return false;
    }

    if (file.size === 0) {
        console.error("Upload failed: empty file", file.name);
        addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
        return false;
    }

    if (mediaUploadInProgress) {
        addSystemMessage(">>> Wait for the current upload to finish before sending another file");
        return false;
    }

    if (!socket.connected) {
        addSystemMessage(">>> Reconnect before uploading a file");
        return false;
    }

    mediaUploadInProgress = true;
    const notification = addUploadNotification(file);

    const replyTo = replyingTo;
    cancelReply();

    try {
        const fileData = await file.arrayBuffer();
        return await sendMediaToServer(file, fileData, replyTo, (sent, total) => {
            notification.querySelector("span").textContent =
                `Uploading ${file.name}... ${Math.round((sent / total) * 100)}%`;
        });
    } catch (error) {
        console.error("File read error:", file.name, error);
        addSystemMessage(`>>> ${GENERIC_ERROR_MESSAGE}`);
        return false;
    } finally {
        notification.remove();
        mediaUploadInProgress = false;
    }
}

function addUploadNotification(file) {
    const notification = document.createElement('div');
    notification.className = 'upload-notification';
    const spinner = document.createElement("i");
    spinner.className = "fas fa-spinner fa-spin";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `Preparing ${file.name}...`;
    notification.append(spinner, label);
    
    document.querySelector('.messages-container').appendChild(notification);
    return notification;
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
  tile.video.play().catch(error => console.error("local video play() failed:", error));
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
  tile.video.play().catch(error => console.error("remote video play() failed:", error));
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

window.openFullImage = function(url, fileName) {
    if (!url || url === '#' || url === IMAGE_PLACEHOLDER) return;
    closeFullImageModal();

    const modal = document.createElement('div');
    modal.className = 'image-modal';
    document.body.classList.add('image-modal-open');

    const img = document.createElement('img');
    img.draggable = false;
    img.alt = fileName ? `Image: ${fileName}` : "Full-size image";
    img.style.visibility = "hidden";
    applyPreviewZoom(img, 1);

    const loadingLabel = document.createElement("div");
    loadingLabel.className = "image-modal-loading-label";
    loadingLabel.textContent = "Loading full image…";
    modal.classList.add("image-modal-loading");

    const onImageLoaded = () => {
        if (window.currentImageModal !== modal) return;
        modal.classList.remove("image-modal-loading");
        img.style.visibility = "visible";
    };

    img.onload = onImageLoaded;
    img.onerror = () => {
        if (window.currentImageModal !== modal) return;
        modal.classList.remove("image-modal-loading");
        loadingLabel.textContent = "Full image could not be loaded";
        loadingLabel.classList.add("image-modal-load-error");
    };

    let currentZoom = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let initialPinchDistance = 0;
    let initialZoom = 1;

    const updateTransform = () => {
        img.dataset.zoom = String(currentZoom);
        if (currentZoom <= 1) {
            panX = 0;
            panY = 0;
            img.style.transform = "scale(1)";
        } else {
            img.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
        }
    };

    img.addEventListener("wheel", (event) => {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.2 : -0.2;
        currentZoom = clampZoomLevel(currentZoom + delta);
        updateTransform();
    }, { passive: false });

    let lastTapTime = 0;
    img.addEventListener("dblclick", (event) => {
        event.preventDefault();
        currentZoom = currentZoom > 1 ? 1 : 2.5;
        updateTransform();
    });

    img.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
            const now = Date.now();
            if (now - lastTapTime < 300) {
                e.preventDefault();
                currentZoom = currentZoom > 1 ? 1 : 2.5;
                updateTransform();
                lastTapTime = 0;
                return;
            }
            lastTapTime = now;

            isPanning = true;
            startX = e.touches[0].clientX - panX;
            startY = e.touches[0].clientY - panY;
        } else if (e.touches.length === 2) {
            isPanning = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.hypot(dx, dy);
            initialZoom = currentZoom;
        }
    }, { passive: false });

    img.addEventListener("touchmove", (e) => {
        if (e.touches.length === 1 && isPanning) {
            if (currentZoom > 1) {
                e.preventDefault();
                panX = e.touches[0].clientX - startX;
                panY = e.touches[0].clientY - startY;
                updateTransform();
            }
        } else if (e.touches.length === 2 && initialPinchDistance > 0) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.hypot(dx, dy);
            const scale = currentDistance / initialPinchDistance;
            currentZoom = clampZoomLevel(initialZoom * scale);
            updateTransform();
        }
    }, { passive: false });

    img.addEventListener("touchend", (e) => {
        if (e.touches.length === 0) {
            isPanning = false;
            initialPinchDistance = 0;
        }
    });

    const actions = document.createElement('div');
    actions.className = 'image-modal-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'modal-download-btn';
    downloadBtn.innerHTML = '<i class="fas fa-arrow-down" aria-hidden="true"></i>';
    downloadBtn.title = 'Download image';
    downloadBtn.setAttribute('aria-label', 'Download image');
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadMediaFile(url, fileName);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close preview';
    closeBtn.setAttribute('aria-label', 'Close preview');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFullImageModal();
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(closeBtn);

    modal.appendChild(img);
    modal.appendChild(actions);
    modal.appendChild(loadingLabel);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFullImageModal();
        }
    });

    window.currentImageModal = modal;
    img.src = url;

    if (img.complete && img.naturalWidth > 0) {
        onImageLoaded();
    }
};

function closeFullImageModal() {
    const modal = window.currentImageModal || document.querySelector('.image-modal');
    if (modal) {
        modal.remove();
        window.currentImageModal = null;
    }
    document.body.classList.remove('image-modal-open');
}

function showDragIndicator() {
    let indicator = document.getElementById('globalDragIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'globalDragIndicator';
        document.body.appendChild(indicator);
    }
    indicator.innerHTML = `
        <div class="drag-indicator-content">
            <i class="fas fa-cloud-upload-alt"></i>
            <h3>DROP TO UPLOAD</h3>
            <p>Release to upload files to chat</p>
        </div>
    `;
    indicator.style.display = 'flex';
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
    const hasFiles = e.dataTransfer.types && (
        e.dataTransfer.types.includes('Files') ||
        e.dataTransfer.types.indexOf('Files') !== -1
    );
    const inChat = chatScreen.style.display === 'block';

    if (!hasFiles || !inChat) {
        return;
    }

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
  const copyBtn = e.target.closest(".message-copy-btn");
  if (copyBtn) {
    e.stopPropagation();
    handleCopyMessage(copyBtn);
    return;
  }

  const systemInviteLink = e.target.closest(".system-invite-link");
  if (systemInviteLink) {
    e.stopPropagation();
    const url = systemInviteLink.dataset.url || systemInviteLink.textContent;
    copyTextToClipboard(url).then((ok) => {
      if (ok) showCyberToast("Invite link copied to clipboard!", "success");
    });
    return;
  }

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

  const messageContent = e.target.closest(".message-content, .media-info, .media-preview, .message-header");

  if (interactiveTarget) return;
  if (messageContent) return;
  chatInput.focus();
});

window.addEventListener("DOMContentLoaded", () => {
  try {
    const savedNickname = localStorage.getItem("freegram_nickname");
    if (savedNickname && nicknameInput) {
      nicknameInput.value = savedNickname;
    } else if (nicknameInput) {
      nicknameInput.value = "";
    }
  } catch (_) {
    if (nicknameInput) nicknameInput.value = "";
  }

  if (nicknameInput) {
    nicknameInput.addEventListener("input", () => {
      try {
        const val = nicknameInput.value.trim();
        if (val) localStorage.setItem("freegram_nickname", val);
      } catch (_) {}
    });
  }

  if (roomInput) roomInput.value = "";
  if (passwordInput) passwordInput.value = "";
  resetVoiceStateUI();
  resizeChatInput();
  
  if (pendingInviteToken) {
    setupInviteMode(pendingInviteToken);
  } else if (nicknameInput && nicknameInput.value) {
    roomInput && roomInput.focus();
  } else if (nicknameInput) {
    nicknameInput.focus();
  }
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
