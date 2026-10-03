// ==============================================================
//  👑 ROYAL TIME - HARDENED HYBRID CORE ENGINE (v6.0 PRODUCTION)
//  Security: Telegram Exclusive (Multi-Pass 3-Second Auth Retry Loop)
//  Backend Bridge: Server-Authoritative Atomic Transactions with Bearer Tokens
//  Anti-Tamper: Zero Client-Side Balance Manipulation
//  ImgBB: Dynamic Multi-Key Failover Cloud Engine
// ==============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, doc, getDoc, updateDoc, 
  collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ১. ফায়ারবেস ক্লাউড ইনিশিয়ালাইজেশন (Client-side read & assets)
export const firebaseConfig = {
  apiKey: "AIzaSyCTxv5W3HRBplhnMejWVxmlZOo0O7VDlL8",
  authDomain: "rc-project-a83cf.firebaseapp.com",
  projectId: "rc-project-a83cf",
  storageBucket: "rc-project-a83cf.firebasestorage.app",
  messagingSenderId: "957061655551",
  appId: "1:957061655551:web:64bdf935cf61a305de95ca",
  measurementId: "G-6X6D0B7EZ8"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const tg = window.Telegram?.WebApp;
export const BOT_USERNAME = "RoyalTimee_Bot";

// টেলিগ্রাম ইন্টারফেস ইনিশিয়াল কনফিগ & CloudStorage v6.0 পলिफিল
if (tg) {
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#08080B');
    tg.setBackgroundColor('#08080B');

    // CloudStorage 6.0 Compatibility Polyfill (maps safely to localStorage)
    if (!tg.CloudStorage) {
      tg.CloudStorage = {
        setItem: (key, val, cb) => { try { localStorage.setItem(`tg_cs_${key}`, val); cb && cb(null, true); } catch(e) { cb && cb(e); } },
        getItem: (key, cb) => { try { cb && cb(null, localStorage.getItem(`tg_cs_${key}`)); } catch(e) { cb && cb(e); } },
        getItems: (keys, cb) => { try { const res = {}; keys.forEach(k => res[k] = localStorage.getItem(`tg_cs_${k}`)); cb && cb(null, res); } catch(e) { cb && cb(e); } },
        removeItem: (key, cb) => { try { localStorage.removeItem(`tg_cs_${key}`); cb && cb(null, true); } catch(e) { cb && cb(e); } },
        removeItems: (keys, cb) => { try { keys.forEach(k => localStorage.removeItem(`tg_cs_${k}`)); cb && cb(null, true); } catch(e) { cb && cb(e); } },
        getKeys: (cb) => { try { cb && cb(null, Object.keys(localStorage).filter(k => k.startsWith('tg_cs_')).map(k => k.replace('tg_cs_', ''))); } catch(e) { cb && cb(e); } }
      };
    }
  } catch (e) {}
}

// Filter out benign Telegram v6.0 CloudStorage warning
try {
  const origErr = console.error;
  console.error = function(...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('CloudStorage is not supported')) {
      return; // Suppress version mismatch warning
    }
    origErr.apply(console, args);
  };
} catch (e) {}

const CACHE_TTL_MS = 60 * 1000;
const MEMORY_CACHE = new Map();

// ডিফল্ট কনফিগ ও ব্যাকআপ কী (বিজ্ঞাপনের জন্য ০.২০ RC / ২০ পয়সা)
export let dynamicAppConfig = {
  signupBonus: 15.00,
  dailyBonus: 10.00,
  dailyBonusEnabled: true,
  referReward: 10.00,
  activationFee: 30.00,
  loanAmount: 35.00,
  minWithdraw: 600.00,
  withdrawRequiredReferrals: 0,
  requiredWithdrawAds: 3,
  adReward: 0.20,
  dailyAdLimit: 50,
  imgbbApiKeys: [
    "61c1689422ba034a86e3cdc80153165e"
  ]
};

// ১৩টি সোশ্যাল মিডিয়া ও প্ল্যাটফর্মের আইকন ডিকশনারি
export const SOCIAL_PLATFORM_CONFIG = {
  tiktok:    { name: "TikTok",      icon: "fa-brands fa-tiktok text-[#ff0050]" },
  telegram:  { name: "Telegram",    icon: "fa-brands fa-telegram text-sky-400" },
  youtube:   { name: "YouTube",     icon: "fa-brands fa-youtube text-red-500" },
  facebook:  { name: "Facebook",    icon: "fa-brands fa-facebook text-blue-500" },
  instagram: { name: "Instagram",   icon: "fa-brands fa-instagram text-pink-500" },
  twitter:   { name: "X (Twitter)", icon: "fa-brands fa-x-twitter text-white" },
  threads:   { name: "Threads",     icon: "fa-brands fa-threads text-white" },
  discord:   { name: "Discord",     icon: "fa-brands fa-discord text-[#5865F2]" },
  whatsapp:  { name: "WhatsApp",    icon: "fa-brands fa-whatsapp text-emerald-400" },
  linkedin:  { name: "LinkedIn",    icon: "fa-brands fa-linkedin text-[#0A66C2]" },
  snapchat:  { name: "Snapchat",    icon: "fa-brands fa-snapchat text-[#FFFC00]" },
  pinterest: { name: "Pinterest",   icon: "fa-brands fa-pinterest text-[#E60023]" },
  reddit:    { name: "Reddit",      icon: "fa-brands fa-reddit text-[#FF4500]" },
  web:       { name: "Web & Apps",  icon: "fa-solid fa-globe text-purple-400" }
};

// ১২টি শাহী পদবীর স্তর
export const ROYAL_HIERARCHY = [
  { level: 1, title: "GUARDSMAN", bn: "প্রহরী", req: 0, role: "দরবার প্রহরী", icon: "fa-shield-halved" },
  { level: 2, title: "SOLDIER", bn: "সেনা", req: 3, role: "শাহী সেনা", icon: "fa-person-military-pointing" },
  { level: 3, title: "SQUAD LEADER", bn: "নায়ক", req: 9, role: "স্কোয়াড লিডার", icon: "fa-user-shield" },
  { level: 4, title: "GENERAL", bn: "সেনাপতি", req: 27, role: "সেনাপতি", icon: "fa-chess-knight" },
  { level: 5, title: "VIZIER", bn: "উজির", req: 81, role: "প্রধান উজির", icon: "fa-handshake-angle" },
  { level: 6, title: "NAWAB", bn: "নবাব", req: 243, role: "নবাব বাহাদুর", icon: "fa-chess-rook" },
  { level: 7, title: "CROWN PRINCE", bn: "যুবরাজ", req: 729, role: "শাহী যুবরাজ", icon: "fa-crown" },
  { level: 8, title: "SULTAN", bn: "সুলতান", req: 2187, role: "সুলতান", icon: "fa-star-and-crescent" },
  { level: 9, title: "KING", bn: "রাজা", req: 6561, role: "মহারাজা", icon: "fa-chess-king" },
  { level: 10, title: "EMPEROR", bn: "সম্রাট", req: 19683, role: "শাহেনশাহ", icon: "fa-gem" },
  { level: 11, title: "SOVEREIGN", bn: "বাদশা", req: 59049, role: "সার্বভৌম বাদশা", icon: "fa-meteor" },
  { level: 12, title: "CREATOR", bn: "ক্রিয়েটর", req: 177147, role: "সুপ্রিম প্রতিষ্ঠাতা", icon: "fa-sun" }
];

export function isValidRoyalId(id) {
  return typeof id === 'string' && /^RC-\d{6}$/.test(id.trim());
}

export function generateRoyalId() {
  return `RC-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function triggerHaptic(type = 'light') {
  try {
    if (tg?.HapticFeedback) {
      if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
      else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
      else tg.HapticFeedback.impactOccurred('light');
    } else if (navigator?.vibrate) {
      navigator.vibrate(type === 'heavy' ? 30 : (type === 'medium' ? 18 : 8));
    }
  } catch (e) {}
}

export function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function calculateUserRank(referralCount = 0) {
  const count = Math.max(0, Number(referralCount) || 0);
  let current = ROYAL_HIERARCHY[0];
  let next = ROYAL_HIERARCHY[1];

  for (let i = ROYAL_HIERARCHY.length - 1; i >= 0; i--) {
    if (count >= ROYAL_HIERARCHY[i].req) {
      current = ROYAL_HIERARCHY[i];
      next = ROYAL_HIERARCHY[i + 1] || ROYAL_HIERARCHY[i];
      break;
    }
  }
  const progressPercent = Math.min(100, Math.round((count / (next.req || 1)) * 100));
  return { current, next, progressPercent, count };
}

// ১ মিলিসেকেন্ডেই ক্যাশ থেকে রেন্ডার (Zero Layout Shift)
export function getImmediateCachedProfile() {
  try {
    const uid = localStorage.getItem('rt_uid') || '';
    let royalId = localStorage.getItem('rt_royal_id');
    if (!isValidRoyalId(royalId)) {
      royalId = generateRoyalId();
      localStorage.setItem('rt_royal_id', royalId);
    }
    const balance = parseFloat(localStorage.getItem('rc_balance') || '0.00');
    const status = localStorage.getItem('account_status') || 'inactive';
    const referrals = parseInt(localStorage.getItem('user_referrals') || '0', 10);
    const name = localStorage.getItem('rt_user_name') || 'Royal Member';
    const username = localStorage.getItem('rt_user_handle') || '@user';
    const photoUrl = localStorage.getItem('rt_user_photo') || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80';
    const loanRemaining = parseFloat(localStorage.getItem('loan_remaining') || '0.00');

    return { uid, royalId, balance, status, referrals, name, username, photoUrl, loanRemaining };
  } catch (e) {
    return { uid: '', royalId: generateRoyalId(), balance: 0.00, status: 'inactive', referrals: 0, name: 'Royal Member', username: '@user', photoUrl: '', loanRemaining: 0.00 };
  }
}

// ==============================================================
//  ★ ২. ব্যাকএন্ড API ব্রিজ উইথ Bearer Token
// ==============================================================
export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('rt_session_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn(`[API] Network error on ${endpoint}:`, err);
    throw err;
  }
}

// ==============================================================
//  ★ ৩. ইন্টেলিজেন্ট ৩-সেকেন্ড টেলিগ্রাম রিট্রাই লুপ (No False Denied Screen)
// ==============================================================
function extractRawTelegramData() {
  try {
    if (window.Telegram?.WebApp?.initData && window.Telegram.WebApp.initData.length > 10) {
      return {
        initData: window.Telegram.WebApp.initData,
        user: window.Telegram.WebApp.initDataUnsafe?.user,
        startParam: window.Telegram.WebApp.initDataUnsafe?.start_param || null
      };
    }

    const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(rawHash);
    const searchParams = new URLSearchParams(window.location.search);

    const tgData = hashParams.get('tgWebAppData') || searchParams.get('tgWebAppData');
    if (tgData && tgData.length > 10) {
      const parsedData = new URLSearchParams(tgData);
      const userRaw = parsedData.get('user');
      const startParam = parsedData.get('start_param') || hashParams.get('tgWebAppStartParam') || searchParams.get('tgWebAppStartParam');
      return {
        initData: tgData,
        user: userRaw ? JSON.parse(decodeURIComponent(userRaw)) : null,
        startParam: startParam ? decodeURIComponent(startParam).trim() : null
      };
    }
  } catch (e) {
    console.warn("Telegram raw extraction notice:", e);
  }
  return null;
}

async function resolveTelegramWithRetryLoop() {
  // ১. তাৎক্ষণিক চেক
  let extracted = extractRawTelegramData();
  if (extracted?.initData) return extracted;

  // ২. ৩-সেকেন্ড স্বয়ংক্রিয় রিট্রাই লুপ (প্রতি ১০০ms পর পর চেক)
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 100));
    extracted = extractRawTelegramData();
    if (extracted?.initData) return extracted;
  }

  // ৩. পূর্ববর্তী ভ্যালিড সেশন চেক (ক্যাশ ব্যাকআপ)
  const cachedToken = localStorage.getItem('rt_session_token');
  const cachedUser = localStorage.getItem('rt_tg_session_user');
  if (cachedToken && cachedUser) {
    try {
      const parsed = JSON.parse(cachedUser);
      if (parsed?.id) {
        return {
          initData: `user=${encodeURIComponent(JSON.stringify(parsed))}&auth_date=${Math.floor(Date.now()/1000)}&hash=cached_session`,
          user: parsed,
          startParam: localStorage.getItem('rt_tg_start_param') || null,
          fromCache: true
        };
      }
    } catch (e) {}
  }

  // ৪. যদি লোকালহোস্টে বা ডেভেলপমেন্টে টেলিগ্রাম ছাড়া টেস্ট করা হয়, তখন নিরাপদ ডিবাগ ইউজার তৈরি
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('run.app')) {
    const devId = localStorage.getItem('rt_dev_uid') || `dev_${Math.floor(100000 + Math.random()*900000)}`;
    localStorage.setItem('rt_dev_uid', devId);
    const mockUser = {
      id: devId,
      first_name: "Developer",
      last_name: "Preview",
      username: "dev_royal"
    };
    return {
      initData: `user=${encodeURIComponent(JSON.stringify(mockUser))}&auth_date=${Math.floor(Date.now()/1000)}&hash=dev_preview_hash`,
      user: mockUser,
      startParam: null,
      isDev: true
    };
  }

  // ৫. সাধারণ ব্রাউজার ব্লক স্ক্রিন
  renderAccessDeniedScreen();
  throw new Error("UNAUTHORIZED_EXTERNAL_BROWSER_ACCESS");
}

function renderAccessDeniedScreen() {
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;background:#050508;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:'Plus Jakarta Sans',sans-serif;z-index:999999;">
      <div style="width:76px;height:76px;border-radius:24px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);display:flex;align-items:center;justify-content:center;color:#f87171;font-size:32px;margin-bottom:20px;box-shadow:0 0 30px rgba(239,68,68,0.2);">
        <i class="fa-solid fa-shield-halved"></i>
      </div>
      <h2 style="font-size:18px;font-weight:900;color:#fff;margin:0 0 8px 0;letter-spacing:0.5px;">ACCESS DENIED / প্রবেশাধিকার সংরক্ষিত</h2>
      <p style="font-size:12px;color:#9ca3af;max-width:320px;line-height:1.6;margin:0 0 24px 0;">
        নিরাপত্তা কারণে এই অ্যাপটি শুধুমাত্র <b>অফিসিয়াল Telegram অ্যাপ</b> থেকে ব্যবহার করা যাবে। ক্রোম বা সাধারণ ব্রাউজার থেকে সরাসরি প্রবেশ সম্পূর্ণ নিষিদ্ধ।
      </p>
      <a href="https://t.me/${BOT_USERNAME}" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:16px;background:linear-gradient(135deg,#D4AF37,#AA820A);color:#000;font-size:12px;font-weight:900;text-decoration:none;box-shadow:0 6px 20px rgba(212,175,55,0.3);">
        <i class="fa-brands fa-telegram" style="font-size:16px;"></i>
        <span>টেলিগ্রাম বটের মাধ্যমে প্রবেশ করুন</span>
      </a>
      <span style="font-size:9px;color:#4b5563;margin-top:28px;font-family:monospace;">ROYAL SECURE PROTOCOL • ZERO GUEST ACCESS</span>
    </div>
  `;
}

// ==============================================================
//  ★ ৪. সুপার কোর ইনিশিয়ালাইজার (Backend Auth + Firestore Hydration)
// ==============================================================
export async function initSuperEngine(forceLive = false) {
  const tgData = await resolveTelegramWithRetryLoop();

  // ১. ব্যাকএন্ডের সাথে অথেন্টিকেট করে JWT সেশন টোকেন নেওয়া
  let sessionToken = localStorage.getItem('rt_session_token');
  let userData = null;
  let userId = null;

  try {
    const authRes = await apiFetch('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData: tgData.initData })
    });

    if (authRes.success && authRes.token) {
      sessionToken = authRes.token;
      localStorage.setItem('rt_session_token', sessionToken);
      userData = authRes.user;
      userId = userData.uid || `tg_${userData.telegram_chat_id || tgData.user.id}`;
    }
  } catch (err) {
    console.warn("Backend auth fetch warning, checking client cached profile:", err);
  }

  // ২. যদি ব্যাকএন্ড রেসপন্স না দেয় তবে ফায়ারস্টোর থেকে সরাসরি হাইড্রেশন (Client Resilience)
  if (!userData) {
    const rawTgId = String(tgData.user.id);
    userId = `tg_${rawTgId}`;

    try {
      const uSnap = await getDoc(doc(db, "users", userId));
      if (uSnap.exists()) {
        userData = uSnap.data();
      }
    } catch (e) {}

    if (!userData) {
      userData = getImmediateCachedProfile();
      userData.uid = userId;
      userData.name = `${tgData.user.first_name || ''} ${tgData.user.last_name || ''}`.trim() || 'Royal Member';
      userData.username = tgData.user.username ? `@${tgData.user.username}` : `@user_${rawTgId.slice(-4)}`;
    }
  }

  // ৩. লোকাল স্টোরেজ স্টেট রিফ্রেশ
  localStorage.setItem('rt_uid', userId);
  localStorage.setItem('rt_royal_id', userData.royal_id || generateRoyalId());
  localStorage.setItem('rc_balance', Number(userData.balance || 0).toFixed(2));
  localStorage.setItem('account_status', userData.account_status || 'inactive');
  localStorage.setItem('loan_remaining', Number(userData.loan_remaining || 0).toFixed(2));
  localStorage.setItem('user_referrals', userData.user_referrals || 0);
  localStorage.setItem('rt_user_name', userData.name);
  localStorage.setItem('rt_user_handle', userData.username);
  localStorage.setItem('rt_user_photo', userData.photoUrl || '');
  localStorage.setItem('rt_tg_session_user', JSON.stringify(tgData.user));

  return { userId, userData, fromCache: false };
}

// ==============================================================
//  ★ ৫. ব্যাকএন্ড অথরিটেটিভ রিওয়ার্ড ক্রেডিট ইঞ্জিন (Zero Client Balance Write)
// ==============================================================
export async function executeRewardCredit(userId, amount, rewardType, meta = {}) {
  try {
    const res = await apiFetch('/api/rewards/claim', {
      method: 'POST',
      body: JSON.stringify({
        rewardType,
        taskId: meta.taskKey || meta.taskId || null
      })
    });

    if (res.success) {
      localStorage.setItem('rc_balance', res.newBalance.toFixed(2));
      localStorage.setItem('account_status', res.accountStatus);
      localStorage.setItem('loan_remaining', res.remainingLoan.toFixed(2));
      return {
        success: true,
        newBalance: res.newBalance,
        remainingLoan: res.remainingLoan,
        accountStatus: res.accountStatus,
        loanSettled: res.loanSettled,
        actualCash: res.actualCash,
        adsWatchedToday: res.adsWatchedToday
      };
    } else {
      return { success: false, message: res.error || 'রিওয়ার্ড প্রসেসিং সফল হয়নি' };
    }
  } catch (err) {
    return { success: false, message: 'সার্ভার সংযোগ সমস্যা, আবার চেষ্টা করুন' };
  }
}

// ==============================================================
//  ★ ৬. অ্যাক্টিভেশন ও রেফারেল রিওয়ার্ড হ্যান্ডলার
// ==============================================================
export async function handleActivationReferralReward(newUserId, activationType) {
  try {
    const newUserSnap = await getDoc(doc(db, "users", newUserId));
    if (!newUserSnap.exists()) return;

    const userData = newUserSnap.data();
    const uplinerParam = userData.referredBy;
    if (!uplinerParam) return;

    if (activationType === 'deposit') {
      // Handled via backend /api/admin/deposits/action when approved
    } else if (activationType === 'loan') {
      await logActivity(
        newUserId,
        "Loan Activated",
        35.00,
        "credit",
        "৩৫.০০৳ লোন নিয়ে একাউন্ট সক্রিয় করা হয়েছে। কাজের আয় থেকে লোন শোধ হবে।"
      );
    }
  } catch (err) {
    console.error("Activation reward notification:", err);
  }
}

// ==============================================================
//  ★ ৭. প্রমো কোড রিডিম API ব্রিজ
// ==============================================================
export async function redeemPromoCodeApi(code) {
  return await apiFetch('/api/promos/redeem', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
}

// ==============================================================
//  ★ ৮. উইথড্রয়াল সাবমিট API ব্রিজ
// ==============================================================
export async function submitWithdrawRequestApi(method, accountNumber, amount) {
  return await apiFetch('/api/withdraw/request', {
    method: 'POST',
    body: JSON.stringify({ method, accountNumber, amount })
  });
}

// ==============================================================
//  ★ ৯. ImgBB ক্লাউড মাল্টি-কী ফেইলওভার ইঞ্জিন
// ==============================================================
export async function uploadImageToImgBB(fileOrBase64) {
  const keyList = dynamicAppConfig.imgbbApiKeys && dynamicAppConfig.imgbbApiKeys.length > 0 
    ? dynamicAppConfig.imgbbApiKeys 
    : ["61c1689422ba034a86e3cdc80153165e"];

  let cleanBase64 = "";
  if (typeof fileOrBase64 === "string") {
    cleanBase64 = fileOrBase64.replace(/^data:image\/\w+;base64,/, "");
  }

  let lastError = null;

  for (let i = 0; i < keyList.length; i++) {
    const currentApiKey = keyList[i];
    const formData = new FormData();

    if (cleanBase64) {
      formData.append("image", cleanBase64);
    } else {
      formData.append("image", fileOrBase64);
    }

    try {
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${currentApiKey}`, {
        method: "POST",
        body: formData
      });

      const result = await response.json();
      if (result.success && result.data?.url) {
        return result.data.url;
      } else {
        lastError = new Error(result.error?.message || `Key #${i + 1} failed`);
        console.warn(`ImgBB Key #${i + 1} failed, rotating...`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`ImgBB Key #${i + 1} network notice, rotating...`);
    }
  }

  throw (lastError || new Error("সকল ImgBB API Key এর লিমিট শেষ বা আপলোড ব্যর্থ হয়েছে"));
}

// ==============================================================
//  ★ ১০. লগ ও অ্যাক্টিভিটি হেল্পার
// ==============================================================
export async function logActivity(userId, title, amount, type = "credit", description = "") {
  try {
    await addDoc(collection(db, "activities"), {
      userId,
      title,
      amount: Number(amount),
      type,
      description,
      createdAt: serverTimestamp()
    });
  } catch (e) {}
}

export async function fetchLiveActivities(userId, limitCount = 5) {
  try {
    const q = query(
      collection(db, "activities"), 
      where("userId", "==", userId), 
      orderBy("createdAt", "desc"), 
      limit(limitCount)
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list;
  } catch (err) {
    try {
      const qFallback = query(collection(db, "activities"), where("userId", "==", userId), limit(limitCount));
      const snapFallback = await getDocs(qFallback);
      const list = [];
      snapFallback.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      return list;
    } catch (e) {
      return [];
    }
  }
}

export async function submitUserReport(userId, { reportType, category, message }) {
  try {
    const uSnap = await getDoc(doc(db, "users", userId));
    const uData = uSnap.exists() ? uSnap.data() : {};

    await addDoc(collection(db, "reports"), {
      userId: userId,
      userName: uData.name || "Member",
      royalId: uData.royal_id || userId,
      reportType: reportType || "General Report",
      category: category || "General",
      description: message,
      message: message,
      status: "pending",
      createdAt: serverTimestamp()
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
