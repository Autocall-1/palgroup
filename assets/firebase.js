// LeadMachine — Firebase + Razorpay Shared Utilities
import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         updateProfile, GoogleAuthProvider,
         signInWithPopup }                       from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc,
         updateDoc, collection, addDoc,
         getDocs, query, orderBy,
         serverTimestamp }                       from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── PASTE YOUR FIREBASE CONFIG ────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ── RAZORPAY KEY (public key — safe to expose) ────────────────────────────────
export const RAZORPAY_KEY_ID = "rzp_live_XXXXXXXXXXXXXXXX"; // replace with yours

const _app  = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(_app);
export const db   = getFirestore(_app);

// ─────────────────────────────────────────────────────────
//  PLAN CONSTANTS
// ─────────────────────────────────────────────────────────
export const PLANS = {
  free_trial: { label: 'Free Trial',  days: 7,     price: 0,   leads: 100  },
  paid:       { label: 'Pro — ₹499',  days: 30,    price: 499, leads: 9999 }
};

export function getPlanStatus(profile) {
  if (!profile) return { plan: 'free_trial', active: false, expired: true, daysLeft: 0 };
  const now        = Date.now();
  const trialEnd   = profile.trial_ends_at?.toDate?.()?.getTime() || 0;
  const paidEnd    = profile.paid_until?.toDate?.()?.getTime()    || 0;
  const isPaid     = paidEnd > now;
  const isTrial    = !isPaid && trialEnd > now;
  const daysLeft   = isPaid
    ? Math.ceil((paidEnd - now) / 86400000)
    : isTrial ? Math.ceil((trialEnd - now) / 86400000) : 0;
  return {
    plan:     isPaid ? 'paid' : 'free_trial',
    active:   isPaid || isTrial,
    expired:  !isPaid && !isTrial,
    isPaid,
    isTrial,
    daysLeft
  };
}

// ─────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────
export async function signUpEmail(email, password, name, businessName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await _createProfile(cred.user, { name, email, businessName });
  return cred.user;
}

export async function signInEmail(email, password) {
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  const cred = await signInWithPopup(auth, provider);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  if (!snap.exists()) await _createProfile(cred.user, { name: cred.user.displayName, email: cred.user.email });
  return cred.user;
}

export async function logOut() { await signOut(auth); }

async function _createProfile(user, { name, email, businessName = '' }) {
  // Trial ends 7 days from now
  const trialEnd = new Date(Date.now() + 7 * 86400000);
  await setDoc(doc(db, 'users', user.uid), {
    name:            name || '',
    email:           email || '',
    business_name:   businessName || name || '',
    website_link:    '',
    offer_text:      '',
    plan:            'free_trial',
    bot_active:      true,        // auto-activate
    ig_connected:    false,
    ig_access_token: null,
    ig_page_id:      null,
    ig_page_name:    null,
    trial_ends_at:   trialEnd,    // 7-day trial
    paid_until:      null,
    razorpay_sub_id: null,
    created_at:      serverTimestamp(),
    updated_at:      serverTimestamp()
  });
}

// ─────────────────────────────────────────────────────────
//  AUTH GUARDS
// ─────────────────────────────────────────────────────────
export function requireAuth(to = '/pages/login.html') {
  return new Promise((res, rej) => {
    const u = onAuthStateChanged(auth, user => { u(); if (user) res(user); else { location.href = to; rej(); } });
  });
}
export function redirectIfLoggedIn(to = '/pages/dashboard.html') {
  const u = onAuthStateChanged(auth, user => { u(); if (user) location.href = to; });
}
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

// ─────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────
export async function getProfile(uid) {
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function saveProfile(uid, data) {
  await updateDoc(doc(db, 'users', uid), { ...data, updated_at: serverTimestamp() });
}

// ─────────────────────────────────────────────────────────
//  LEADS
// ─────────────────────────────────────────────────────────
export async function getLeads(uid) {
  const q = query(collection(db, 'users', uid, 'leads'), orderBy('created_at', 'desc'));
  return (await getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
}
export function calcStats(leads) {
  const total     = leads.length;
  const converted = leads.filter(l => l.status === 'converted').length;
  const today     = leads.filter(l => { const d = l.created_at?.toDate?.() || new Date(l.created_at||0); return d.toDateString() === new Date().toDateString(); }).length;
  return { total, converted, today, rate: total ? Math.round(converted/total*100) : 0 };
}
export function exportCSV(leads) {
  const H = ['Name','IG User ID','Business','Product','Budget','Status','Date'];
  const R = leads.map(l => [l.name||'',l.ig_user_id||'',l.business_type||'',l.product||'',l.budget||'',l.status||'',fmtDate(l.created_at)]);
  const csv = [H,...R].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`leads_${Date.now()}.csv`}).click();
}

// ─────────────────────────────────────────────────────────
//  RAZORPAY — load script + open checkout
// ─────────────────────────────────────────────────────────
export function loadRazorpay() {
  return new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export async function openRazorpayCheckout({ orderId, amount, name, email, phone, onSuccess, onFailure }) {
  const loaded = await loadRazorpay();
  if (!loaded) { alert('Razorpay load failed. Internet check karo।'); return; }

  const rzp = new Razorpay({
    key:         RAZORPAY_KEY_ID,
    amount:      amount * 100,  // paise
    currency:    'INR',
    name:        'LeadMachine',
    description: 'Pro Plan — ₹499/month',
    order_id:    orderId,
    prefill:     { name, email, contact: phone || '' },
    theme:       { color: '#ff6b00' },
    handler: response => onSuccess(response),
    modal:   { ondismiss: () => onFailure?.('dismissed') }
  });
  rzp.on('payment.failed', r => onFailure?.(r.error));
  rzp.open();
}

// ─────────────────────────────────────────────────────────
//  FLOW TEMPLATE
// ─────────────────────────────────────────────────────────
export const FLOW_TEMPLATE = {
  trigger: ['hi','hello','hii','hey','price','details','start','info','interested','help','kya','bata'],
  steps: [
    { id:1, hi:"Hey 👋 Kaise ho! Aapka naam kya hai?",                                                            en:"Hey 👋 What's your name?",                                                           save:'name'          },
    { id:2, hi:"Nice to meet you {name}! 😊\nAapka business kya hai?\n1️⃣ Service  2️⃣ Product  3️⃣ Freelance  4️⃣ Other", en:"Nice {name}! 😊\nBusiness type?\n1️⃣ Service  2️⃣ Product  3️⃣ Freelance  4️⃣ Other", save:'business_type' },
    { id:3, hi:"Aap exactly kya sell karte ho?",                                                                   en:"What exactly do you sell?",                                                          save:'product'       },
    { id:4, hi:"Perfect! 🎯\nBudget approx?\n💰 Under ₹5K\n💰 ₹5–15K\n💰 ₹15K+",                              en:"Perfect! 🎯\nApprox budget?\n💰 Under ₹5K\n💰 ₹5–15K\n💰 ₹15K+",                      save:'budget'        },
    { id:5, hi:"🔥 Hamare details yahan dekho 👇\n{website_link}",                                                en:"🔥 Check details here 👇\n{website_link}",                                           save:null            },
    { id:6, hi:"Interested? Reply karo: YES 👍\nTeam 24hrs me contact karegi! 🚀",                               en:"Reply YES if interested 👍\nWe'll contact within 24hrs! 🚀",                         save:'interest'      }
  ],
  end_hi:"🎉 Shukriya {name}! Hamari team jald contact karegi। 🙏",
  end_en:"🎉 Thank you {name}! Our team will reach out soon! 🙏"
};

export function injectVars(msg, data) { return msg.replace(/\{(\w+)\}/g, (_,k)=>data[k]||''); }
export function detectLang(t) { return /[\u0900-\u097F]/.test(t)?'hi':'en'; }
export function isTrigger(t)  { const l=t.toLowerCase(); return FLOW_TEMPLATE.trigger.some(k=>l.includes(k)); }

// ─────────────────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────────────────
export function timeAgo(ts) {
  if (!ts) return '—';
  const d=ts.toDate?ts.toDate():new Date(ts), diff=Date.now()-d.getTime();
  if(diff<60000)return'just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
}
export function fmtDate(ts) {
  if(!ts)return'—';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
export function toast(msg, type='info', ms=3500) {
  let a=document.getElementById('toast-area');
  if(!a){a=document.createElement('div');a.id='toast-area';document.body.appendChild(a);}
  const el=document.createElement('div');
  el.className=`toast ${type}`;el.textContent=msg;a.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),300);},ms);
}
