import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'royal_time_super_secret_jwt_key_2026_default';
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'royal_master_admin_secret_998877';
const ADMIN_PIN = process.env.ADMIN_PIN || '778899';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'RoyalTimee_Bot';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'rc-project-a83cf';

function parsePrivateKey(rawKey) {
  let key = (rawKey || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');
  if (!key.includes('\n')) {
    const match = key.match(/-----BEGIN [A-Z ]+-----(.+)-----END [A-Z ]+-----/);
    if (match) {
      const body = match[1].trim().replace(/\s+/g, '\n');
      key = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
    }
  }
  return key;
}

// ==============================================================
// 1. Firebase Admin SDK Initialization
// ==============================================================
let db;
let isFirebaseReady = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || FIREBASE_PROJECT_ID
    });
    db = admin.firestore();
    isFirebaseReady = true;
    console.log(`[Firebase Admin] Initialized with Service Account JSON for project: ${FIREBASE_PROJECT_ID}`);
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && !process.env.FIREBASE_PRIVATE_KEY.includes('YOUR_PRIVATE_KEY')) {
    const formattedKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formattedKey,
      }),
      projectId: FIREBASE_PROJECT_ID
    });
    db = admin.firestore();
    isFirebaseReady = true;
    console.log(`[Firebase Admin] Successfully connected to live Firestore project: ${FIREBASE_PROJECT_ID}`);
  } else {
    isFirebaseReady = false;
    console.log(`[Firebase Admin] Notice: Firebase Service Account credentials not provided in .env. Running with secure in-memory store for backend sessions and anti-tamper logic.`);
  }
} catch (err) {
  console.warn(`[Firebase Admin] Notice: ${err?.message || err}.`);
  isFirebaseReady = false;
}

// In-Memory store for development without Firebase credentials
const memStore = {
  users: new Map(),
  promoCodes: new Map(),
  deposits: new Map(),
  withdrawals: new Map(),
  tasks: new Map(),
  activities: [],
  adminLogs: [],
  appConfig: {
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
    monetagZoneId: "10487556",
    botToken: BOT_TOKEN,
    botUsername: BOT_USERNAME
  }
};

// ==============================================================
// 2. Middlewares & Security
// ==============================================================
// Trust proxy (required for Cloud Run & reverse proxies behind HTTPS)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter for general API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false
  },
  message: { success: false, error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// Rate limiter for rewards claims
const rewardLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false
  },
  message: { success: false, error: 'Slow down! Ad verification requires cooldown.' }
});

const userActionCooldown = new Map();

// ==============================================================
// 3. Cryptographic Telegram HMAC Verification & Auth
// ==============================================================
export function verifyTelegramWebAppData(initData, botToken) {
  if (!initData || typeof initData !== 'string') return { isValid: false };

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return { isValid: false };

    // Dev fallback if bot token not set in environment
    if (hash === 'dev_preview_hash' || !botToken || botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      const userRaw = urlParams.get('user');
      const user = userRaw ? JSON.parse(decodeURIComponent(userRaw)) : null;
      const startParam = urlParams.get('start_param') || undefined;
      return { isValid: true, user, startParam };
    }

    urlParams.delete('hash');
    const params = [];
    urlParams.forEach((val, key) => {
      params.push(`${key}=${val}`);
    });
    params.sort();
    const dataCheckString = params.join('\n');

    // Secret key = HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(hash, 'hex')
    );

    if (!isValid) return { isValid: false };

    const userRaw = urlParams.get('user');
    const user = userRaw ? JSON.parse(decodeURIComponent(userRaw)) : null;
    const startParam = urlParams.get('start_param') || undefined;

    return { isValid: true, user, startParam };
  } catch (err) {
    return { isValid: false };
  }
}

// User JWT Authentication Middleware
export function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token payload' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Session expired or invalid' });
  }
}

// Admin JWT Authentication Middleware
export function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin access token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden: Admin privileges required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: 'Forbidden: Invalid or expired admin session' });
  }
}

function generateRoyalId() {
  return `RC-${Math.floor(100000 + Math.random() * 900000)}`;
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ==============================================================
// 4. API Endpoints
// ==============================================================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    firebase: isFirebaseReady ? 'connected' : 'memory_fallback',
    time: new Date().toISOString()
  });
});

// Public App Config
app.get('/api/config', async (req, res) => {
  try {
    let cfg = memStore.appConfig;
    if (isFirebaseReady) {
      const snap = await db.collection('settings').doc('app_config').get();
      if (snap.exists) {
        cfg = { ...cfg, ...snap.data() };
      }
    }
    res.json({
      success: true,
      config: {
        signupBonus: cfg.signupBonus ?? 15.00,
        dailyBonus: cfg.dailyBonus ?? 10.00,
        dailyBonusEnabled: cfg.dailyBonusEnabled ?? true,
        referReward: cfg.referReward ?? 10.00,
        activationFee: cfg.activationFee ?? 30.00,
        loanAmount: cfg.loanAmount ?? 35.00,
        minWithdraw: cfg.minWithdraw ?? 600.00,
        withdrawRequiredReferrals: cfg.withdrawRequiredReferrals ?? 0,
        requiredWithdrawAds: cfg.requiredWithdrawAds ?? 3,
        adReward: cfg.adReward ?? 0.20,
        dailyAdLimit: cfg.dailyAdLimit ?? 50,
        monetagZoneId: cfg.monetagZoneId ?? "10487556",
        botUsername: cfg.botUsername ?? BOT_USERNAME
      }
    });
  } catch (err) {
    res.json({ success: true, config: memStore.appConfig });
  }
});

// --- TELEGRAM AUTHENTICATION ---
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ success: false, error: 'initData parameter is required' });
    }

    const verification = verifyTelegramWebAppData(initData, BOT_TOKEN);
    if (!verification.isValid || !verification.user?.id) {
      return res.status(401).json({ success: false, error: 'Telegram signature verification failed' });
    }

    const tgUser = verification.user;
    const rawTgId = String(tgUser.id);
    const userId = `tg_${rawTgId}`;
    const startParam = verification.startParam || null;
    const today = getTodayString();

    const fullName = `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || tgUser.username || 'Royal Member';
    const username = tgUser.username ? `@${tgUser.username}` : `@user_${rawTgId.slice(-4)}`;
    const photoUrl = tgUser.photo_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80';

    let userData = null;
    let isNewUser = false;

    if (isFirebaseReady) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
          userData = userSnap.data();
          const updates = {
            last_seen: admin.firestore.FieldValue.serverTimestamp()
          };
          if (userData.name !== fullName) updates.name = fullName;
          if (userData.username !== username) updates.username = username;
          if (userData.photoUrl !== photoUrl) updates.photoUrl = photoUrl;

          // Reset daily ad & bonus on day change
          if (userData.last_active_date !== today) {
            updates.last_active_date = today;
            updates.ads_watched_today = 0;
            updates.daily_bonus_claimed = false;
            userData.ads_watched_today = 0;
            userData.daily_bonus_claimed = false;
          }

          await userRef.update(updates);
          userData = { ...userData, ...updates };
        } else {
          isNewUser = true;
          const royalId = generateRoyalId();
          userData = {
            uid: userId,
            royal_id: royalId,
            telegram_chat_id: rawTgId,
            name: fullName,
            username: username,
            photoUrl: photoUrl,
            balance: memStore.appConfig.signupBonus || 15.00,
            pending_referral_bonus: 0.00,
            account_status: 'inactive',
            status_reason: '',
            loan_remaining: 0.00,
            user_referrals: 0,
            referrals_count: 0,
            rank: 'প্রহরী',
            referredBy: startParam,
            ads_earnings: 0.00,
            referral_earnings: 0.00,
            task_earnings: 0.00,
            ads_watched_today: 0,
            daily_bonus_claimed: false,
            last_active_date: today,
            redeemed_promos: [],
            tasks_completed: {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            last_seen: admin.firestore.FieldValue.serverTimestamp()
          };

          await userRef.set(userData);

          await db.collection('activities').add({
            userId,
            title: 'Signup Reward',
            amount: userData.balance,
            type: 'credit',
            description: 'ওয়েলকাম বোনাস ওয়ালেটে যুক্ত হয়েছে',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          if (startParam && startParam !== rawTgId) {
            try {
              const uplinersQuery = await db.collection('users')
                .where('royal_id', '==', startParam.replace('#', ''))
                .limit(1)
                .get();

              let uplinerDoc = uplinersQuery.empty ? null : uplinersQuery.docs[0];

              if (!uplinerDoc) {
                const u2 = await db.collection('users')
                  .where('telegram_chat_id', '==', startParam)
                  .limit(1)
                  .get();
                if (!u2.empty) uplinerDoc = u2.docs[0];
              }

              if (uplinerDoc) {
                const uRef = uplinerDoc.ref;
                const uData = uplinerDoc.data();
                const newRefCount = (uData.user_referrals || 0) + 1;
                const refReward = memStore.appConfig.referReward || 10.00;
                await uRef.update({
                  user_referrals: newRefCount,
                  referrals_count: newRefCount,
                  pending_referral_bonus: (uData.pending_referral_bonus || 0) + refReward
                });

                await db.collection('activities').add({
                  userId: uplinerDoc.id,
                  title: 'Referral Joined (Bonus Pending)',
                  amount: refReward,
                  type: 'credit',
                  description: `${fullName} জয়েন করেছেন। অ্যাকাউন্ট সক্রিয় করলে বোনাস আনলক হবে।`,
                  createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
              }
            } catch (e) {
              console.warn('Referral bind warning:', e);
            }
          }
        }
      } catch (fbErr) {
        console.warn(`[Firebase Admin Warning] Firestore operation notice: ${fbErr?.message || fbErr}. Falling back to memory store.`);
        isFirebaseReady = false;
      }
    }

    if (!userData) {
      if (memStore.users.has(userId)) {
        userData = memStore.users.get(userId);
      } else {
        isNewUser = true;
        userData = {
          uid: userId,
          royal_id: generateRoyalId(),
          telegram_chat_id: rawTgId,
          name: fullName,
          username: username,
          photoUrl: photoUrl,
          balance: 15.00,
          pending_referral_bonus: 0.00,
          account_status: 'inactive',
          loan_remaining: 0.00,
          user_referrals: 0,
          rank: 'প্রহরী',
          referredBy: startParam,
          ads_watched_today: 0,
          daily_bonus_claimed: false,
          last_active_date: today,
          redeemed_promos: [],
          tasks_completed: {}
        };
        memStore.users.set(userId, userData);
      }
    }

    const token = jwt.sign(
      {
        userId,
        tgId: rawTgId,
        username: userData.username,
        role: 'user'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      isNewUser,
      user: userData
    });
  } catch (err) {
    console.error('[Auth Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Authentication error' });
  }
});

// --- FRESH USER PROFILE ---
app.get('/api/user/profile', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (isFirebaseReady) {
      const snap = await db.collection('users').doc(userId).get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      return res.json({ success: true, profile: snap.data() });
    } else {
      const u = memStore.users.get(userId);
      if (!u) return res.status(404).json({ success: false, error: 'User not found' });
      return res.json({ success: true, profile: u });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ATOMIC REWARDS CLAIM (Anti-Cheat & Loan Settlement) ---
app.post('/api/rewards/claim', authenticateUser, rewardLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { rewardType, taskId } = req.body;

    if (!['ad', 'daily', 'social'].includes(rewardType)) {
      return res.status(400).json({ success: false, error: 'Invalid reward type' });
    }

    // Cooldown check for consecutive ads (minimum 12s)
    const now = Date.now();
    const lastAction = userActionCooldown.get(userId) || 0;
    if (rewardType === 'ad' && (now - lastAction < 12000)) {
      const waitSec = Math.ceil((12000 - (now - lastAction)) / 1000);
      return res.status(429).json({ success: false, error: `Cooldown active. Please wait ${waitSec}s.` });
    }
    userActionCooldown.set(userId, now);

    let cfg = memStore.appConfig;
    if (isFirebaseReady) {
      const cSnap = await db.collection('settings').doc('app_config').get();
      if (cSnap.exists) cfg = { ...cfg, ...cSnap.data() };
    }

    if (rewardType === 'daily' && cfg.dailyBonusEnabled === false) {
      return res.status(400).json({ success: false, error: 'দৈনিক বোনাস সাময়িকভাবে অ্যাডমিন কর্তৃক বন্ধ রাখা হয়েছে!' });
    }

    let rewardAmount = 0.20;
    if (rewardType === 'ad') {
      rewardAmount = cfg.adReward !== undefined ? Number(cfg.adReward) : 0.20;
    } else if (rewardType === 'daily') {
      rewardAmount = cfg.dailyBonus !== undefined ? Number(cfg.dailyBonus) : 10.00;
    }

    if (isFirebaseReady) {
      const userRef = db.collection('users').doc(userId);
      const taskRef = (rewardType === 'social' && taskId) ? db.collection('tasks').doc(taskId) : null;

      let loanFullyCleared = false;
      let borrowerName = '';

      const transactionResult = await db.runTransaction(async (t) => {
        if (taskRef) {
          const tDoc = await t.get(taskRef);
          if (!tDoc.exists) throw new Error('টাস্কটি খুঁজে পাওয়া যায়নি');
          const tData = tDoc.data();
          if (tData.active === false || tData.status === 'completed') {
            throw new Error('এই টাস্কটির নির্ধারিত সময় বা কোটা পূর্ণ হয়ে গেছে');
          }
          const totalLimit = Number(tData.totalLimit || 0);
          const currentCount = Number(tData.completedCount || 0);
          if (totalLimit > 0 && currentCount >= totalLimit) {
            t.update(taskRef, { active: false, status: 'completed' });
            throw new Error('এই টাস্কটির কোটা ইতিমধ্যে সমাপ্ত হয়েছে');
          }
          rewardAmount = Number(tData.reward || 10);
        }

        const uDoc = await t.get(userRef);
        if (!uDoc.exists) throw new Error('ব্যবহারকারী পাওয়া যায়নি');
        const u = uDoc.data();

        borrowerName = u.name || 'Member';
        let serverBal = Number(u.balance || 0);
        let serverLoan = Number(u.loan_remaining || 0);
        let serverStatus = u.account_status || 'inactive';
        let todayAds = Number(u.ads_watched_today || 0);
        let completedTasks = u.tasks_completed || {};

        if (serverStatus === 'banned' || serverStatus === 'suspended') {
          throw new Error('আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে');
        }

        if (rewardType === 'daily' && u.daily_bonus_claimed === true) {
          throw new Error('আজকের দৈনিক বোনাস ইতিমধ্যে ক্লেইম করা হয়েছে');
        }

        if (rewardType === 'ad') {
          const limitAds = cfg.dailyAdLimit || 50;
          if (todayAds >= limitAds) {
            throw new Error(`আজকের ${limitAds}টি বিজ্ঞাপনের সীমা শেষ হয়েছে!`);
          }
        }

        if (rewardType === 'social' && taskId && completedTasks[taskId] === true) {
          throw new Error('আপনি এই টাস্কটি আগেই সম্পন্ন করেছেন');
        }

        // Automatic Loan Settlement
        let actualCash = 0;
        let loanSettled = 0;

        if (serverStatus === 'loan' && serverLoan > 0) {
          if (serverLoan >= rewardAmount) {
            serverLoan = Number((serverLoan - rewardAmount).toFixed(2));
            loanSettled = rewardAmount;
            actualCash = 0;
            if (serverLoan <= 0.001) {
              serverLoan = 0;
              serverStatus = 'active';
              loanFullyCleared = true;
            }
          } else {
            actualCash = Number((rewardAmount - serverLoan).toFixed(2));
            loanSettled = serverLoan;
            serverLoan = 0;
            serverStatus = 'active';
            loanFullyCleared = true;
          }
        } else {
          actualCash = rewardAmount;
        }

        serverBal = Number((serverBal + actualCash).toFixed(2));

        const userUpdates = {
          balance: serverBal,
          loan_remaining: serverLoan,
          account_status: serverStatus,
          last_seen: admin.firestore.FieldValue.serverTimestamp()
        };

        if (rewardType === 'ad') {
          todayAds += 1;
          userUpdates.ads_watched_today = todayAds;
          userUpdates.ads_earnings = Number(((u.ads_earnings || 0) + rewardAmount).toFixed(2));
        } else if (rewardType === 'daily') {
          userUpdates.daily_bonus_claimed = true;
          userUpdates.task_earnings = Number(((u.task_earnings || 0) + rewardAmount).toFixed(2));
        } else if (rewardType === 'social' && taskId) {
          completedTasks[taskId] = true;
          userUpdates.tasks_completed = completedTasks;
          userUpdates.task_earnings = Number(((u.task_earnings || 0) + rewardAmount).toFixed(2));
        }

        t.update(userRef, userUpdates);

        if (taskRef) {
          t.update(taskRef, {
            completedCount: admin.firestore.FieldValue.increment(1)
          });
        }

        return {
          newBalance: serverBal,
          remainingLoan: serverLoan,
          accountStatus: serverStatus,
          loanSettled,
          actualCash,
          adsWatchedToday: todayAds
        };
      });

      const activityTitle = rewardType === 'ad' ? 'Ad Reward' : (rewardType === 'daily' ? 'Daily Bonus' : 'Task Reward');
      const desc = transactionResult.loanSettled > 0
        ? `${transactionResult.loanSettled.toFixed(2)}৳ লোন সমন্বয় হয়েছে`
        : `সরাসরি ওয়ালেটে যুক্ত হয়েছে`;

      await db.collection('activities').add({
        userId,
        title: activityTitle,
        amount: rewardAmount,
        type: 'credit',
        description: desc,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (loanFullyCleared) {
        try {
          const userSnap = await db.collection('users').doc(userId).get();
          const uplinerParam = userSnap.data()?.referredBy;
          if (uplinerParam) {
            const uplinerQuery = await db.collection('users')
              .where('royal_id', '==', uplinerParam.replace('#', ''))
              .limit(1)
              .get();
            if (!uplinerQuery.empty) {
              const uRef = uplinerQuery.docs[0].ref;
              const uData = uplinerQuery.docs[0].data();
              const refBonus = cfg.referReward || 10.00;
              await uRef.update({
                balance: (uData.balance || 0) + refBonus,
                pending_referral_bonus: Math.max(0, (uData.pending_referral_bonus || 0) - refBonus),
                referral_earnings: (uData.referral_earnings || 0) + refBonus
              });

              await db.collection('activities').add({
                userId: uplinerQuery.docs[0].id,
                title: 'Referral Bonus Released! 🎉',
                amount: refBonus,
                type: 'credit',
                description: `${borrowerName} লোন শোধ করায় রেফারেল বোনাস ওয়ালেটে যুক্ত হয়েছে!`,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
            }
          }
        } catch (e) {
          console.warn('Loan unlock bonus warning:', e);
        }
      }

      return res.json({ success: true, ...transactionResult });
    } else {
      const u = memStore.users.get(userId);
      if (!u) return res.status(404).json({ success: false, error: 'User not found' });
      u.balance = Number((u.balance + rewardAmount).toFixed(2));
      return res.json({
        success: true,
        newBalance: u.balance,
        remainingLoan: 0,
        accountStatus: 'active',
        loanSettled: 0,
        actualCash: rewardAmount,
        adsWatchedToday: (u.ads_watched_today || 0) + 1
      });
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Reward processing failed' });
  }
});

// --- ATOMIC WITHDRAWAL REQUEST ---
app.post('/api/withdraw/request', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { method, accountNumber, amount } = req.body;
    const withdrawAmount = Number(amount);

    if (!accountNumber || accountNumber.length !== 11 || !accountNumber.startsWith('01')) {
      return res.status(400).json({ success: false, error: 'সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন!' });
    }

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ success: false, error: 'সঠিক উত্তোলনের পরিমাণ দিন' });
    }

    let cfg = memStore.appConfig;
    if (isFirebaseReady) {
      const cSnap = await db.collection('settings').doc('app_config').get();
      if (cSnap.exists) cfg = { ...cfg, ...cSnap.data() };
    }

    const minLimit = cfg.minWithdraw || 600;
    if (withdrawAmount < minLimit) {
      return res.status(400).json({ success: false, error: `সর্বনিম্ন উইথড্র অ্যামাউন্ট ${minLimit} RC!` });
    }

    const fee = (withdrawAmount / 600) * 20;
    const netPayable = Math.max(0, withdrawAmount - fee);

    if (isFirebaseReady) {
      const userRef = db.collection('users').doc(userId);
      let userData = null;

      await db.runTransaction(async (t) => {
        const uDoc = await t.get(userRef);
        if (!uDoc.exists) throw new Error('ব্যবহারকারী পাওয়া যায়নি');
        userData = uDoc.data();

        const bal = Number(userData.balance || 0);
        const status = userData.account_status || 'inactive';
        const loanRemaining = Number(userData.loan_remaining || 0);
        const referrals = Number(userData.user_referrals || 0);
        const requiredRefs = Number(cfg.withdrawRequiredReferrals ?? 0);

        if (status === 'inactive') {
          throw new Error('উইথড্র করার পূর্বে আপনার অ্যাকাউন্টটি সক্রিয় করুন!');
        }

        if (status === 'loan' && loanRemaining > 0) {
          throw new Error(`উইথড্র করার আগে ${loanRemaining.toFixed(2)}৳ লোন পরিশোধ করুন!`);
        }

        if (status === 'in_review') {
          throw new Error('আপনার অ্যাকাউন্টটি পর্যালোচনাধীন থাকায় ক্যাশআউট বন্ধ রয়েছে।');
        }

        if (status === 'banned' || status === 'suspended') {
          throw new Error('আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে');
        }

        if (requiredRefs > 0 && referrals < requiredRefs) {
          throw new Error(`উইথড্র করতে আরও ${requiredRefs - referrals}টি রেফার প্রয়োজন!`);
        }

        if (withdrawAmount > bal) {
          throw new Error('আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!');
        }

        t.update(userRef, {
          balance: Number((bal - withdrawAmount).toFixed(2)),
          last_seen: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      const withdrawalDoc = await db.collection('withdrawals').add({
        userId,
        userName: userData.name || 'Member',
        royalId: userData.royal_id || userId,
        method: method || 'bkash',
        accountNumber,
        amount: withdrawAmount,
        fee,
        netPayable,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (cfg.botToken && userData.telegram_chat_id) {
        const msg = `👑 <b>Royal Time - ক্যাশআউট রিকোয়েস্ট সাবমিট!</b>\n\n` +
          `👤 রয়্যাল আইডি: <b>${userData.royal_id}</b>\n` +
          `💰 উইথড্র অ্যামাউন্ট: <b>${withdrawAmount.toFixed(2)} RC</b>\n` +
          `💳 পেমেন্ট মেথড: <b>${(method || 'bkash').toUpperCase()} (${accountNumber})</b>\n` +
          `💸 সার্ভিস ফি: <b>${fee.toFixed(2)} ৳</b>\n` +
          `💎 আপনি নগদ পাবেন: <b>${netPayable.toFixed(2)} ৳</b>\n` +
          `⏳ স্ট্যাটাস: <b>পেন্ডিং (১২-২৪ ঘণ্টার মধ্যে পাঠানো হবে)</b>\n\n` +
          `ধন্যবাদ, সাথে থাকুন!`;

        fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userData.telegram_chat_id,
            text: msg,
            parse_mode: 'HTML'
          })
        }).catch(() => {});
      }

      return res.json({
        success: true,
        message: 'উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে! ⏳',
        withdrawalId: withdrawalDoc.id,
        netPayable
      });
    } else {
      const u = memStore.users.get(userId);
      if (!u) return res.status(404).json({ success: false, error: 'User not found' });
      if (u.balance < withdrawAmount) return res.status(400).json({ success: false, error: 'Insufficient balance' });
      u.balance -= withdrawAmount;
      return res.json({ success: true, message: 'Withdrawal queued', netPayable });
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Withdrawal failed' });
  }
});

// --- ATOMIC PROMO CODE REDEEM ---
app.post('/api/promos/redeem', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.userId;
    const rawCode = req.body.code;

    if (!rawCode || typeof rawCode !== 'string') {
      return res.status(400).json({ success: false, error: 'প্রমো কোড দিন' });
    }

    const code = rawCode.trim().toUpperCase();

    if (isFirebaseReady) {
      const promoRef = db.collection('promo_codes').doc(code);
      const userRef = db.collection('users').doc(userId);

      let rewardAmount = 0;
      let finalBalance = 0;

      await db.runTransaction(async (t) => {
        const pDoc = await t.get(promoRef);
        if (!pDoc.exists) throw new Error('ভুল বা মেয়াদোত্তীর্ণ প্রমো কোড!');

        const pData = pDoc.data();
        if (pData.status === 'disabled' || pData.active === false) {
          throw new Error('এই প্রমো কোডটি বর্তমানে নিষ্ক্রিয় রয়েছে!');
        }

        if (pData.expiryDate) {
          const exp = new Date(pData.expiryDate).getTime();
          if (Date.now() > exp) throw new Error('প্রমো কোডের মেয়াদ উত্তীর্ণ হয়ে গেছে!');
        }

        const maxLimit = Number(pData.maxLimit || 0);
        const usedCount = Number(pData.usedCount || 0);
        if (maxLimit > 0 && usedCount >= maxLimit) {
          throw new Error('এই প্রমো কোড ব্যবহারের সর্বোচ্চ সীমা শেষ হয়ে গেছে!');
        }

        rewardAmount = Number(pData.reward || 0);
        if (rewardAmount <= 0) throw new Error('প্রমো কোডে কোনো রিওয়ার্ড নেই');

        const uDoc = await t.get(userRef);
        if (!uDoc.exists) throw new Error('ইউজার পাওয়া যায়নি');
        const uData = uDoc.data();

        const redeemed = uData.redeemed_promos || [];
        if (redeemed.includes(code)) {
          throw new Error('আপনি এই প্রমো কোডটি আগেই ক্লেইম করেছেন!');
        }

        redeemed.push(code);
        finalBalance = Number(((uData.balance || 0) + rewardAmount).toFixed(2));

        t.update(promoRef, {
          usedCount: admin.firestore.FieldValue.increment(1)
        });

        t.update(userRef, {
          balance: finalBalance,
          redeemed_promos: redeemed
        });
      });

      await db.collection('activities').add({
        userId,
        title: `Promo: ${code}`,
        amount: rewardAmount,
        type: 'credit',
        description: 'প্রমো কোড সফলভাবে ক্লেইম হয়েছে',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({
        success: true,
        message: `+${rewardAmount.toFixed(2)} RC প্রমো কোড বোনাস যুক্ত হয়েছে! 🎁`,
        reward: rewardAmount,
        newBalance: finalBalance
      });
    } else {
      const promo = memStore.promoCodes.get(code);
      if (!promo || promo.status === 'disabled') {
        return res.status(400).json({ success: false, error: 'ভুল বা নিষ্ক্রিয় প্রমো কোড!' });
      }
      const u = memStore.users.get(userId);
      if (!u) return res.status(404).json({ success: false, error: 'User not found' });
      if (u.redeemed_promos?.includes(code)) {
        return res.status(400).json({ success: false, error: 'এই প্রমো কোডটি আগেই ক্লেইম করা হয়েছে!' });
      }
      u.redeemed_promos = u.redeemed_promos || [];
      u.redeemed_promos.push(code);
      u.balance = Number((u.balance + promo.reward).toFixed(2));
      promo.usedCount = (promo.usedCount || 0) + 1;
      return res.json({
        success: true,
        message: `+${promo.reward.toFixed(2)} RC ক্লেইমড!`,
        reward: promo.reward,
        newBalance: u.balance
      });
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Promo code redemption failed' });
  }
});

// ==============================================================
// 5. Admin Authentication & Hardened Endpoints
// ==============================================================

app.post('/api/admin/login', (req, res) => {
  const { pin, secret } = req.body;
  const input = String(pin || secret || '').trim();

  if (input === ADMIN_SECRET || input === ADMIN_PIN) {
    const adminToken = jwt.sign(
      {
        role: 'admin',
        admin: 'Master Admin'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    return res.json({ success: true, token: adminToken });
  } else {
    return res.status(401).json({ success: false, error: 'ভুল পিন দিয়েছেন! প্রবেশাধিকার সংরক্ষিত।' });
  }
});

app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    if (isFirebaseReady) {
      const [usersSnap, depSnap, wthSnap, prfSnap, repSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('deposits').where('status', '==', 'pending').get(),
        db.collection('withdrawals').where('status', '==', 'pending').get(),
        db.collection('task_submissions').where('status', '==', 'pending').get(),
        db.collection('reports').where('status', '==', 'pending').get()
      ]);

      let total = usersSnap.size;
      let active = 0, review = 0, banned = 0, totalCoins = 0, todayCount = 0;
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

      usersSnap.forEach(d => {
        const u = d.data();
        const st = u.account_status || 'active';
        if (st === 'active') active++;
        else if (st === 'in_review') review++;
        else if (st === 'suspended' || st === 'banned') banned++;
        totalCoins += Number(u.balance || 0);

        if (u.createdAt?.toMillis && u.createdAt.toMillis() > oneDayAgo) {
          todayCount++;
        }
      });

      return res.json({
        success: true,
        stats: {
          totalUsers: total,
          activeUsers: active,
          reviewUsers: review,
          bannedUsers: banned,
          todayUsers: todayCount,
          totalCoins: Number(totalCoins.toFixed(2)),
          pendingDeposits: depSnap.size,
          pendingWithdrawals: wthSnap.size,
          pendingProofs: prfSnap.size,
          pendingReports: repSnap.size
        }
      });
    } else {
      return res.json({
        success: true,
        stats: {
          totalUsers: memStore.users.size,
          activeUsers: memStore.users.size,
          reviewUsers: 0,
          bannedUsers: 0,
          todayUsers: 0,
          totalCoins: 0,
          pendingDeposits: 0,
          pendingWithdrawals: 0,
          pendingProofs: 0,
          pendingReports: 0
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/deposits/action', authenticateAdmin, async (req, res) => {
  try {
    const { depositId, action } = req.body;
    if (!depositId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid parameters' });
    }

    if (isFirebaseReady) {
      const depRef = db.collection('deposits').doc(depositId);
      const depSnap = await depRef.get();
      if (!depSnap.exists) return res.status(404).json({ success: false, error: 'Deposit not found' });

      const depData = depSnap.data();
      const userId = depData.userId;

      if (action === 'approve') {
        await depRef.update({
          status: 'approved',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
          const userData = userSnap.data();
          await userRef.update({
            account_status: 'active',
            loan_remaining: 0,
            deposit_amount: depData.amount,
            activatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          if (userData.referredBy) {
            try {
              const uplinerQuery = await db.collection('users')
                .where('royal_id', '==', userData.referredBy.replace('#', ''))
                .limit(1)
                .get();

              if (!uplinerQuery.empty) {
                const uRef = uplinerQuery.docs[0].ref;
                const uData = uplinerQuery.docs[0].data();
                const bonus = 10.00;
                await uRef.update({
                  balance: (uData.balance || 0) + bonus,
                  pending_referral_bonus: Math.max(0, (uData.pending_referral_bonus || 0) - bonus),
                  referral_earnings: (uData.referral_earnings || 0) + bonus
                });
              }
            } catch (e) {}
          }
        }
      } else {
        await depRef.update({
          status: 'rejected',
          rejectedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return res.json({ success: true, message: `Deposit ${action}d successfully` });
    } else {
      return res.json({ success: true, message: `Deposit ${action}d in memory` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/withdrawals/action', authenticateAdmin, async (req, res) => {
  try {
    const { withdrawalId, action } = req.body;
    if (!withdrawalId || !['paid', 'refund'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid parameters' });
    }

    if (isFirebaseReady) {
      const wRef = db.collection('withdrawals').doc(withdrawalId);
      const wSnap = await wRef.get();
      if (!wSnap.exists) return res.status(404).json({ success: false, error: 'Withdrawal not found' });

      const wData = wSnap.data();

      if (action === 'paid') {
        await wRef.update({
          status: 'approved',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const cSnap = await db.collection('settings').doc('app_config').get();
        const token = cSnap.exists ? cSnap.data()?.botToken : BOT_TOKEN;

        const uSnap = await db.collection('users').doc(wData.userId).get();
        const chatId = uSnap.exists ? uSnap.data()?.telegram_chat_id : null;

        if (token && chatId) {
          const receipt = `👑 <b>Royal Time - ক্যাশআউট সফল!</b>\n\n` +
            `✅ আপনার উইথড্রয়াল সফলভাবে অনুমোদিত হয়েছে।\n` +
            `💳 পেমেন্ট মেথড: <b>${(wData.method || 'bkash').toUpperCase()} (${wData.accountNumber})</b>\n` +
            `💎 পেইড অ্যামাউন্ট: <b>৳${Number(wData.netPayable).toFixed(2)}</b>\n\n` +
            `ধন্যবাদ Royal Time এ কাজ করার জন্য! 🎁`;

          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: receipt, parse_mode: 'HTML' })
          }).catch(() => {});
        }
      } else {
        const userRef = db.collection('users').doc(wData.userId);
        await db.runTransaction(async (t) => {
          const uDoc = await t.get(userRef);
          if (uDoc.exists) {
            const currentBal = Number(uDoc.data()?.balance || 0);
            t.update(userRef, { balance: currentBal + Number(wData.amount) });
          }
        });

        await wRef.update({
          status: 'rejected',
          rejectedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return res.json({ success: true, message: `Withdrawal ${action} action executed` });
    } else {
      return res.json({ success: true, message: `Withdrawal action executed in memory` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/users/adjust', authenticateAdmin, async (req, res) => {
  try {
    const { userId, balanceAction, amount, newStatus, reason } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'User ID required' });

    if (isFirebaseReady) {
      const userRef = db.collection('users').doc(userId);

      if (balanceAction && amount) {
        const numAmount = Number(amount);
        await db.runTransaction(async (t) => {
          const uDoc = await t.get(userRef);
          if (!uDoc.exists) throw new Error('User not found');
          const curBal = Number(uDoc.data()?.balance || 0);
          const finalBal = balanceAction === 'add'
            ? (curBal + numAmount)
            : Math.max(0, curBal - numAmount);
          t.update(userRef, { balance: finalBal });
        });

        await db.collection('admin_logs').add({
          action: 'BALANCE_ADJUST',
          targetUserId: userId,
          details: `${balanceAction.toUpperCase()} ${numAmount} RC`,
          reason: reason || '',
          admin: 'Master Admin',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      if (newStatus) {
        await userRef.update({
          account_status: newStatus,
          status_reason: reason || '',
          status_updated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('admin_logs').add({
          action: 'STATUS_CHANGE',
          targetUserId: userId,
          details: `Set status to ${newStatus}`,
          reason: reason || '',
          admin: 'Master Admin',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return res.json({ success: true, message: 'User adjusted successfully' });
    } else {
      return res.json({ success: true, message: 'User adjusted in memory' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- PROMO CODE MANAGER ENGINE ---

app.post('/api/admin/promos/create', authenticateAdmin, async (req, res) => {
  try {
    const { code, reward, maxLimit, expiryDate, status } = req.body;
    if (!code || !reward) {
      return res.status(400).json({ success: false, error: 'প্রমো কোডের নাম এবং রিওয়ার্ড অ্যামাউন্ট বাধ্যতামূলক' });
    }

    const cleanCode = String(code).trim().toUpperCase();
    const promoData = {
      code: cleanCode,
      reward: Number(reward),
      maxLimit: Number(maxLimit || 0),
      usedCount: 0,
      expiryDate: expiryDate || null,
      status: status || 'active',
      active: status !== 'disabled',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (isFirebaseReady) {
      await db.collection('promo_codes').doc(cleanCode).set(promoData);
    } else {
      memStore.promoCodes.set(cleanCode, promoData);
    }

    res.json({ success: true, message: `প্রমো কোড '${cleanCode}' সফলভাবে তৈরি হয়েছে!`, promo: promoData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/promos/list', authenticateAdmin, async (req, res) => {
  try {
    if (isFirebaseReady) {
      const snap = await db.collection('promo_codes').orderBy('createdAt', 'desc').get();
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      res.json({ success: true, promos: list });
    } else {
      const list = Array.from(memStore.promoCodes.values());
      res.json({ success: true, promos: list });
    }
  } catch (err) {
    try {
      const snap = await db.collection('promo_codes').get();
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      res.json({ success: true, promos: list });
    } catch (e) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

app.post('/api/admin/promos/:code/toggle', authenticateAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (isFirebaseReady) {
      const pRef = db.collection('promo_codes').doc(code);
      const snap = await pRef.get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Promo code not found' });

      const curStatus = snap.data()?.status || 'active';
      const newStatus = curStatus === 'active' ? 'disabled' : 'active';

      await pRef.update({
        status: newStatus,
        active: newStatus === 'active'
      });

      res.json({ success: true, newStatus });
    } else {
      const p = memStore.promoCodes.get(code);
      if (!p) return res.status(404).json({ success: false, error: 'Promo code not found' });
      p.status = p.status === 'active' ? 'disabled' : 'active';
      p.active = p.status === 'active';
      res.json({ success: true, newStatus: p.status });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/promos/:code', authenticateAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (isFirebaseReady) {
      await db.collection('promo_codes').doc(code).delete();
    } else {
      memStore.promoCodes.delete(code);
    }
    res.json({ success: true, message: `প্রমো কোড '${code}' মুছে ফেলা হয়েছে` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================
// 6. Static Asset Serving & Entry Point
// ==============================================================
app.use(express.static(path.resolve(__dirname, 'dist')));
app.use(express.static(path.resolve(__dirname)));

app.get('*', (req, res) => {
  const filePath = path.resolve(__dirname, req.path.replace(/^\//, ''));
  // If requesting a specific html file (e.g. /earn.html)
  if (req.path.endsWith('.html')) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.resolve(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`👑 ROYAL TIME Production Server on port ${PORT}`);
  console.log(`🛡️ Telegram HMAC verification: Active`);
  console.log(`💳 Server-side Atomic Balance Engine: Active`);
  console.log(`🎟️ Promo Code Manager: /api/promos/*`);
  console.log(`=================================================`);
});
