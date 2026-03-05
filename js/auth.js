/* ============================================================
   auth.js — Authentication logic
   register / login / logout / route guard
   ============================================================ */

/* ---- Toast helper ---- */
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ---- Error code → human message ---- */
function firebaseErrorMsg(code) {
  const map = {
    'auth/email-already-in-use':  i18n.t('error.email.taken'),
    'auth/invalid-email':         'Invalid email address.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/user-not-found':        i18n.t('error.auth'),
    'auth/wrong-password':        i18n.t('error.auth'),
    'auth/invalid-credential':    i18n.t('error.auth'),
    'auth/too-many-requests':     'Too many attempts. Try again later.',
  };
  return map[code] || i18n.t('error.generic');
}

/* ============================================================
   REGISTER
   ============================================================ */

// Flag: prevents the route guard from redirecting mid-registration
// (createUserWithEmailAndPassword fires onAuthStateChanged before DB write completes)
let _registering = false;

function initRegister() {
  const form      = document.getElementById('registerForm');
  const nameEl    = document.getElementById('regName');
  const emailEl   = document.getElementById('regEmail');
  const passEl    = document.getElementById('regPassword');
  const alertEl   = document.getElementById('regAlert');
  const submitBtn = document.getElementById('regBtn');
  let selectedRole = 'creator';

  // Role selector
  document.querySelectorAll('.role-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedRole = card.dataset.role;
    });
  });

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = nameEl.value.trim();
    const email    = emailEl.value.trim();
    const password = passEl.value;

    if (!name || !email || !password) {
      showAlert(alertEl, 'All fields are required.', 'error');
      return;
    }
    if (password.length < 6) {
      showAlert(alertEl, 'Password must be at least 6 characters.', 'error');
      return;
    }

    setLoading(submitBtn, true);
    hideAlert(alertEl);
    _registering = true; // block route guard redirect until DB write is done

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid  = cred.user.uid;

      // Update display name
      await cred.user.updateProfile({ displayName: name });

      // Collect selected content types (creators only)
      const contentTypes = selectedRole === 'creator'
        ? [...document.querySelectorAll('.content-chip.selected')].map(c => c.dataset.type)
        : [];

      // Save to Realtime Database — MUST complete before redirect
      await db.ref(`users/${uid}`).set({
        name,
        email,
        role: selectedRole,
        contentTypes,
        createdAt: Date.now(),
      });

      _registering = false;
      showAlert(alertEl, i18n.t('success.registered'), 'success');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1200);
    } catch (err) {
      _registering = false;
      showAlert(alertEl, firebaseErrorMsg(err.code), 'error');
      setLoading(submitBtn, false);
    }
  });
}

/* ============================================================
   LOGIN
   ============================================================ */
function initLogin() {
  const form      = document.getElementById('loginForm');
  const emailEl   = document.getElementById('loginEmail');
  const passEl    = document.getElementById('loginPassword');
  const alertEl   = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('loginBtn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = emailEl.value.trim();
    const password = passEl.value;

    if (!email || !password) {
      showAlert(alertEl, 'Please fill in all fields.', 'error');
      return;
    }

    setLoading(submitBtn, true);
    hideAlert(alertEl);

    try {
      await auth.signInWithEmailAndPassword(email, password);
      showAlert(alertEl, i18n.t('success.loggedin'), 'success');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 900);
    } catch (err) {
      showAlert(alertEl, firebaseErrorMsg(err.code), 'error');
      setLoading(submitBtn, false);
    }
  });
}

/* ============================================================
   LOGOUT
   ============================================================ */
function initLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = 'index.html';
  });
}

/* ============================================================
   ROUTE GUARD
   Redirects unauthenticated users away from dashboard.html
   Redirects authenticated users away from login/register
   ============================================================ */
function routeGuard() {
  const page        = window.location.pathname.split('/').pop() || 'index.html';
  const protectedPages = ['dashboard.html'];
  const authPages      = ['login.html', 'register.html'];

  auth.onAuthStateChanged(user => {
    if (protectedPages.includes(page) && !user) {
      window.location.href = 'login.html';
    }
    if (authPages.includes(page) && user && !_registering) {
      window.location.href = 'dashboard.html';
    }

    // Update navbar buttons visibility
    const navLogin    = document.getElementById('navLogin');
    const navRegister = document.getElementById('navRegister');
    const navDash     = document.getElementById('navDash');
    const navLogout   = document.getElementById('navLogout');

    if (user) {
      if (navLogin)    navLogin.classList.add('hidden');
      if (navRegister) navRegister.classList.add('hidden');
      if (navDash)     navDash.classList.remove('hidden');
      if (navLogout)   navLogout.classList.remove('hidden');
    } else {
      if (navLogin)    navLogin.classList.remove('hidden');
      if (navRegister) navRegister.classList.remove('hidden');
      if (navDash)     navDash.classList.add('hidden');
      if (navLogout)   navLogout.classList.add('hidden');
    }

    // Hide page loader after auth check
    const loader = document.getElementById('pageLoader');
    if (loader) {
      setTimeout(() => loader.classList.add('hide'), 400);
    }
  });
}

/* ============================================================
   Helpers
   ============================================================ */
function showAlert(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
}
function hideAlert(el) {
  if (!el) return;
  el.classList.remove('show');
}
function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.origText = btn.dataset.origText || btn.textContent;
  btn.textContent = loading ? i18n.t('loading') : btn.dataset.origText;
}

/* ============================================================
   Auto-init on DOMContentLoaded
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  routeGuard();
  initRegister();
  initLogin();
  initLogout();
});
