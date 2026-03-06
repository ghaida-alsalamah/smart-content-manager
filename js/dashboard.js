/* ============================================================
   dashboard.js — Smart Content Manager (Phase 3)
   ============================================================ */

Chart.defaults.color       = '#8899BB';
Chart.defaults.borderColor = 'rgba(139,92,246,0.1)';
Chart.defaults.font.family = "'Inter','Cairo',system-ui,sans-serif";

/* ---- EmailJS Configuration — fill these in from emailjs.com ---- */
const EMAILJS_PUBLIC_KEY  = 'NDHCEmUJ7o_XoQskn';   // Account → API Keys
const EMAILJS_SERVICE_ID  = 'service_2pco3m9';   // Email Services tab
const EMAILJS_TEMPLATE_ID = 'template_8n2o2yt';  // Email Templates tab

/* ---- Claude AI Configuration ----
   All AI calls go through /api/claude (Vercel serverless proxy).
   Key is stored in Vercel environment variables — never in frontend code.
   -------------------------------------------------------------------- */
const _claudeURL     = '/api/claude';
const _claudeHeaders = { 'content-type': 'application/json' };
const _isLocal       = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

/* ---- Global state ---- */
let charts          = {};
let csvData         = [];
let userRole        = 'creator';
let activePlatform  = 'all';
let activeDateRange = 'all';
let currentSection  = 'overview';

/* ---- AI state ---- */
window._aiResult  = null;   // parsed JSON from Claude (insights + plans + summary)
window._aiLoading = false;  // true while the API call is in-flight
window._aiFailed  = false;  // true when the call completed but parsing failed
let _aiGeneration = 0;      // incremented each call; stale completions are discarded
window._currentPlanPeriod = 30;

/* ============================================================
   MATH HELPERS
   ============================================================ */
const sum   = arr => arr.reduce((a, b) => a + b, 0);
const mean  = arr => arr.length ? sum(arr) / arr.length : 0;
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}
function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
function initDashboard() {
  loadUserInfo();
  detectUserRole();
  initUploadZone();
  initCreatorSearch();
  initSidebarToggle();
  initSettings();
  initChatbot();
  loadRequestsBadge();
  loadBrandRequestsBadge();
}

window.onSectionShow = function(id) {
  currentSection = id;
  if (id === 'settings')        { renderSettings();       return; }
  if (id === 'requests')        { renderRequests();       return; }
  if (id === 'brand-requests')  { renderBrandRequests(); return; }
  const data = getFilteredData();
  if (data.length === 0) return;
  const kpis = computeKPIs(data);
  if (id === 'charts')      { renderCharts(data, kpis); }
  if (id === 'insights')    { renderInsights(); }
  if (id === 'future-plan') { renderFuturePlan(data, kpis); }
  if (id === 'ad-pricing')  { renderAdPricing(data, kpis); }
};

// Re-render all dynamic content when language changes
i18n.afterApply = function() {
  // Re-translate sidebar role label
  const roleEl = document.getElementById('sidebarRole');
  if (roleEl && userRole) roleEl.textContent = i18n.t('role.' + userRole);

  if (!csvData || csvData.length === 0) return;
  const data = getFilteredData();
  const kpis = computeKPIs(data);
  renderOverview(data);
  if (currentSection === 'charts')      renderCharts(data, kpis);
  if (currentSection === 'insights')    renderInsights();
  if (currentSection === 'future-plan') renderFuturePlan(data, kpis);
  if (currentSection === 'ad-pricing')  renderAdPricing(data, kpis);
  // Re-trigger AI so strategy text matches the selected language
  _triggerAI();
};

/* ============================================================
   USER INFO
   ============================================================ */
function loadUserInfo() {
  const user = auth.currentUser;
  if (!user) return;
  const av = document.getElementById('sidebarAvatar');
  const nm = document.getElementById('sidebarName');
  if (av && user.displayName) av.textContent = user.displayName[0].toUpperCase();
  if (nm) nm.textContent = user.displayName || user.email;
}

async function detectUserRole() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await db.ref('users/' + user.uid).once('value');
  const data = snap.val();
  if (!data) return;
  userRole = data.role || 'creator';
  const roleEl = document.getElementById('sidebarRole');
  if (roleEl) { roleEl.setAttribute('data-i18n', 'role.' + userRole); roleEl.textContent = i18n.t('role.' + userRole); }
  if (userRole === 'brand') {
    const cn = document.getElementById('creatorNav');
    const bn = document.getElementById('brandNav');
    if (cn) cn.classList.add('hidden');
    if (bn) bn.classList.remove('hidden');
    showSection('brand-overview', null);
  } else {
    // Show chatbot FAB for creators only
    const fab = document.getElementById('chatFab');
    if (fab) fab.classList.remove('hidden');
  }
}

/* ============================================================
   SIDEBAR TOGGLE (mobile)
   ============================================================ */
function initSidebarToggle() {
  const menuBtn = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!menuBtn || !sidebar) return;
  menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('show');
  });
}

/* ============================================================
   CSV UPLOAD ZONE (Creator)
   ============================================================ */
function initUploadZone() {
  const zone      = document.getElementById('uploadZone');
  const fileIn    = document.getElementById('csvFile');
  const fileMob   = document.getElementById('csvFileMobile');
  const chooseBtn = document.getElementById('chooseFileBtn');
  const sampleBtn = document.getElementById('sampleCSV');

  if (chooseBtn) chooseBtn.addEventListener('click', e => { e.stopPropagation(); fileIn && fileIn.click(); });
  if (zone) {
    zone.addEventListener('click', () => fileIn && fileIn.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0]; if (f) handleFile(f, 'creator');
    });
  }
  if (fileIn)  fileIn.addEventListener('change',  e => { const f = e.target.files[0]; if (f) handleFile(f, 'creator'); });
  if (fileMob) fileMob.addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f, 'creator'); });
  if (sampleBtn) sampleBtn.addEventListener('click', e => { e.stopPropagation(); downloadSampleCSV(); });
}

/* ============================================================
   BRAND: CREATOR SEARCH
   ============================================================ */
function initCreatorSearch() {
  const input = document.getElementById('creatorSearchInput');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.searchCreators();
  });
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.searchCreators = async function() {
  const input      = document.getElementById('creatorSearchInput');
  const filterEl   = document.getElementById('contentTypeFilter');
  const resultsEl  = document.getElementById('creatorSearchResults');
  if (!input || !resultsEl) return;

  const query      = input.value.trim().toLowerCase();
  const typeFilter = filterEl ? filterEl.value : '';
  resultsEl.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);">${i18n.t('search.searching')}</div>`;

  try {
    const snap = await db.ref('users').orderByChild('role').equalTo('creator').once('value');
    const users = [];
    snap.forEach(child => {
      const u   = child.val();
      u.uid     = child.key; // include Firebase UID for collab request storage
      const nameMatch = !query || (u.name && u.name.toLowerCase().includes(query));
      const types     = Array.isArray(u.contentTypes) ? u.contentTypes : [];
      const typeMatch = !typeFilter || types.includes(typeFilter);
      if (nameMatch && typeMatch) users.push(u);
    });
    _renderCreatorResults(users, query, typeFilter);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="empty-section">
        <div class="empty-section-icon">⚠️</div>
        <div class="empty-section-title">${i18n.t('search.failed')}</div>
        <p class="empty-section-sub">${i18n.t('search.failed.sub')}</p>
      </div>`;
  }
};

function _renderCreatorResults(users, query, typeFilter) {
  const el = document.getElementById('creatorSearchResults');
  if (!el) return;

  if (users.length === 0) {
    el.innerHTML = `
      <div class="empty-section">
        <div class="empty-section-icon">🔍</div>
        <div class="empty-section-title">${i18n.t('search.empty')}</div>
        <p class="empty-section-sub">${(query || typeFilter)
          ? `${i18n.t('search.empty.match')} "<strong>${_escapeHtml(query || typeFilter)}</strong>". ${i18n.t('search.empty.try')}`
          : i18n.t('search.empty.none')}</p>
      </div>`;
    return;
  }

  const cards = users.map(u => {
    const types  = Array.isArray(u.contentTypes) ? u.contentTypes : [];
    const typeTags = types.map(t =>
      `<span class="creator-type-tag">${_escapeHtml(i18n.t('ctype.' + t) || t)}</span>`
    ).join('');
    return `
    <div class="creator-result-card card">
      <div class="creator-result-avatar">${_escapeHtml((u.name || '?')[0].toUpperCase())}</div>
      <div class="creator-result-info">
        <div class="creator-result-name">${_escapeHtml(u.name || 'Unknown Creator')}</div>
        <div class="creator-result-email">${_escapeHtml(u.email || '—')}</div>
        ${typeTags ? `<div class="creator-type-tags">${typeTags}</div>` : ''}
      </div>
      <button class="btn btn-primary btn-sm" style="white-space:nowrap;flex-shrink:0;"
        onclick="_openCollabModal('${_escapeHtml(u.email || '')}', '${_escapeHtml(u.name || 'Creator')}', '${_escapeHtml(u.uid || '')}')">
        ${i18n.t('search.send.request')}
      </button>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px;font-weight:600;">
      ${users.length} ${i18n.t('search.found')}
    </div>
    <div class="creator-results-grid">${cards}</div>`;
}

window._openCollabModal = function(creatorEmail, creatorName, creatorUID) {
  const modal = document.getElementById('collabModal');
  if (!modal) return;
  document.getElementById('modalCreatorName').value  = creatorName + ' — ' + creatorEmail;
  document.getElementById('modalBrandName').value    = '';
  document.getElementById('modalCampaignName').value = '';
  document.getElementById('modalFormat').value       = 'Reel / Short Video';
  document.getElementById('modalBudget').value       = 'Negotiable';
  document.getElementById('modalTimeline').value     = 'Flexible';
  document.getElementById('modalKeyMessage').value   = '';
  document.getElementById('modalRequirements').value = '';
  modal._creatorEmail = creatorEmail;
  modal._creatorName  = creatorName;
  modal._creatorUID   = creatorUID || '';
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('modalBrandName').focus(), 50);
};

window._sendCollabRequest = async function() {
  const modal        = document.getElementById('collabModal');
  const brandName    = document.getElementById('modalBrandName').value.trim();
  const campaignName = document.getElementById('modalCampaignName').value.trim();
  const format       = document.getElementById('modalFormat').value;
  const budget       = document.getElementById('modalBudget').value;
  const timeline     = document.getElementById('modalTimeline').value;
  const keyMessage   = document.getElementById('modalKeyMessage').value.trim();
  const requirements = document.getElementById('modalRequirements').value.trim();
  const sendBtn      = document.getElementById('modalSendBtn');
  const creatorEmail = modal._creatorEmail || '';
  const creatorName  = modal._creatorName  || 'Creator';
  const creatorUID   = modal._creatorUID   || '';

  if (!brandName)    { showToast(i18n.t('toast.email.brand'), 'error');       document.getElementById('modalBrandName').focus();    return; }
  if (!campaignName) { showToast(i18n.t('toast.req.campaign'), 'error');      document.getElementById('modalCampaignName').focus(); return; }
  if (!keyMessage)   { showToast(i18n.t('toast.req.keymsg'), 'error');        document.getElementById('modalKeyMessage').focus();   return; }
  if (!creatorEmail) { showToast(i18n.t('toast.no.email'), 'error'); return; }
  if (EMAILJS_PUBLIC_KEY === 'YOUR_PUBLIC_KEY') { showToast(i18n.t('toast.emailjs.config'), 'error'); return; }

  sendBtn.disabled = true;
  sendBtn.textContent = i18n.t('search.sending');

  // Build professional email body from structured fields
  const emailBody = [
    `Hi ${creatorName},`,
    '',
    `${brandName} has sent you a collaboration request via Smart Content Manager.`,
    '',
    '━━━ CAMPAIGN DETAILS ━━━',
    `Campaign: ${campaignName}`,
    `Format:   ${format}`,
    `Budget:   ${budget}`,
    `Timeline: ${timeline}`,
    `Key Message: ${keyMessage}`,
    requirements ? `Requirements: ${requirements}` : '',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    'Log in to Smart Content Manager and check your Requests section to accept or decline.',
  ].filter(l => l !== undefined).join('\n');

  try {
    emailjs.init(EMAILJS_PUBLIC_KEY);
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:  creatorEmail,
      to_name:   creatorName,
      from_name: brandName,
      message:   emailBody,
    });

    // Save request — fan-out to both creator inbox and brand sent-requests
    if (creatorUID) {
      const brandUser  = auth.currentUser;
      const brandEmail = brandUser ? brandUser.email : '';
      const brandUID   = brandUser ? brandUser.uid   : '';
      const reqData = {
        brandName, brandEmail, brandUID,
        campaignName, format, budget, timeline, keyMessage,
        requirements: requirements || '',
        status: 'pending',
        creatorUID, creatorEmail, creatorName,
        createdAt: Date.now(),
      };
      const newRef = db.ref(`collabRequests/${creatorUID}`).push();
      const reqId  = newRef.key;
      const updates = {};
      updates[`collabRequests/${creatorUID}/${reqId}`] = reqData;
      if (brandUID) updates[`brandRequests/${brandUID}/${reqId}`] = reqData;
      await db.ref().update(updates);
    }

    showToast(`${i18n.t('toast.email.sent')} ${creatorName}!`, 'success');
    modal.classList.add('hidden');
  } catch (err) {
    showToast(i18n.t('toast.email.failed'), 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = i18n.t('brand.modal.send');
  }
};

/* ============================================================
   FILE HANDLER
   ============================================================ */
function handleFile(file, mode) {
  if (!file.name.endsWith('.csv')) { showToast(i18n.t('toast.upload.type'), 'error'); return; }
  showProcessingIndicator(true, mode);
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = parseCSV(e.target.result);
      if (parsed.length < 2) throw new Error('CSV needs at least 2 data rows');

      if (mode === 'brand') {
        showProcessingIndicator(false, 'brand');
        renderBrandReport(parsed);
      } else {
        csvData = parsed;

        showProcessingIndicator(false, 'creator');
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('dashboardContent').classList.remove('hidden');
        document.getElementById('dashboardContent').classList.add('success-anim');
        buildPlatformFilter(csvData);   // sets activePlatform to first platform BEFORE AI call
        renderOverview(getFilteredData());
        _triggerAI();                   // kick off AI for the active platform
        showToast(i18n.t('toast.upload.success'), 'success');
      }
    } catch (err) {
      showProcessingIndicator(false, mode);
      showToast(i18n.t('toast.upload.error') + ': ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function showProcessingIndicator(show, mode) {
  if (mode === 'brand') {
    const el = document.getElementById('brandProcessing');
    const pr = document.getElementById('brandUploadPrompt');
    if (el) el.classList.toggle('hidden', !show);
    if (pr) pr.classList.toggle('hidden', show);
  } else {
    const el = document.getElementById('processingIndicator');
    const pr = document.getElementById('uploadPrompt');
    if (el) el.classList.toggle('hidden', !show);
    if (pr) pr.classList.toggle('hidden', show);
  }
}

window.clearData = function() {
  csvData = []; activePlatform = 'all'; activeDateRange = 'all';
  destroyCharts();
};

/* ============================================================
   CSV PARSER
   ============================================================ */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV must have header + data rows');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s\-]+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = lines[i].split(',');
    const row  = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  const num = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== '') return parseFloat(row[k]) || 0; return 0; };
  const str = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k]; return ''; };
  return rows.map(row => ({
    date:      str(row, 'date', 'week', 'month', 'period'),
    platform:  str(row, 'platform', 'channel', 'network') || 'all',
    followers: num(row, 'followers', 'followers_count', 'total_followers'),
    views:     num(row, 'views', 'views_count', 'impressions', 'reach'),
    likes:     num(row, 'likes', 'likes_count', 'reactions'),
    comments:  num(row, 'comments', 'comments_count'),
    shares:    num(row, 'shares', 'shares_count', 'retweets'),
    posts:     num(row, 'posts', 'posts_count', 'num_posts', 'count'),
    revenue:   num(row, 'revenue', 'earnings', 'income', 'revenue_usd'),
  }));
}

/* ============================================================
   PLATFORM FILTER
   ============================================================ */
function buildPlatformFilter(data) {
  const platforms = [...new Set(data.map(r => r.platform).filter(p => p && p !== 'all'))];
  const pillsEl   = document.getElementById('platformPills');
  if (!pillsEl || platforms.length === 0) return;
  pillsEl.innerHTML = '';
  platforms.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'filter-pill' + (i === 0 ? ' active' : '');
    btn.dataset.platform = p;
    btn.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    btn.setAttribute('onclick', 'setPlatform(this)');
    pillsEl.appendChild(btn);
  });
  if (platforms.length > 0) {
    activePlatform = platforms[0];
    const badge = document.getElementById('platformBadge');
    if (badge) badge.textContent = platforms[0].charAt(0).toUpperCase() + platforms[0].slice(1);
  }
}

window.setPlatform = function(btn) {
  document.querySelectorAll('#platformPills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activePlatform = btn.dataset.platform;
  const data = getFilteredData();
  if (data.length > 0) {
    renderCharts(data, computeKPIs(data));
    _triggerAI();  // re-run AI for the newly selected platform
  }
  const badge = document.getElementById('platformBadge');
  if (badge) badge.textContent = activePlatform.charAt(0).toUpperCase() + activePlatform.slice(1);
};

function getFilteredData() {
  let d = csvData;
  if (activePlatform !== 'all') d = d.filter(r => r.platform === activePlatform);
  const rangeEl = document.getElementById('dateRangeSelect');
  const range   = rangeEl ? rangeEl.value : 'all';
  if (range !== 'all') d = d.slice(-parseInt(range));
  return d;
}

document.addEventListener('DOMContentLoaded', () => {
  const rangeEl = document.getElementById('dateRangeSelect');
  if (rangeEl) {
    rangeEl.addEventListener('change', () => {
      const data = getFilteredData();
      if (data.length > 0) renderCharts(data, computeKPIs(data));
    });
  }
  const resetZoom = document.getElementById('resetZoomBtn');
  if (resetZoom) resetZoom.addEventListener('click', () => { Object.values(charts).forEach(c => c && c.resetZoom && c.resetZoom()); });
});

/* ============================================================
   KPI COMPUTATION
   ============================================================ */
function computeKPIs(data) {
  const n = data.length;
  if (n === 0) return {};
  const engRates = data.map(r => {
    const isTikTok = r.platform.toLowerCase() === 'tiktok';
    const denom = isTikTok && r.views > 0 ? r.views : r.followers;
    return denom > 0 ? ((r.likes + r.comments + r.shares) / denom) * 100 : 0;
  });
  const avgEngRate     = mean(engRates);
  const firstFollowers = data[0].followers || 1;
  const lastFollowers  = data[n - 1].followers;
  const followerGrowth = ((lastFollowers - firstFollowers) / firstFollowers) * 100;
  const revenues       = data.map(r => r.revenue).filter(v => v > 0);
  const totalRev       = sum(revenues);
  const revCV          = revenues.length > 1 ? (stdDev(revenues) / (mean(revenues) || 1)) * 100 : 0;
  // Average monthly revenue: group by year-month, sum each month, then average
  const monthMap = {};
  data.forEach(r => {
    if (!r.revenue || !r.date) return;
    const ym = r.date.slice(0, 7); // 'YYYY-MM'
    monthMap[ym] = (monthMap[ym] || 0) + r.revenue;
  });
  const monthlyRevenues  = Object.values(monthMap);
  const avgMonthlyRevenue = monthlyRevenues.length > 0 ? mean(monthlyRevenues) : 0;
  const totalPosts     = sum(data.map(r => r.posts));

  // Engagement Quality Score: weighted interactions / views (reach-based, capped at 100)
  // Uses views as denominator so viral reach to non-followers doesn't inflate the score
  const qualityRates = data.map(r => {
    const denom = r.views > 0 ? r.views : r.followers;
    return denom > 0 ? Math.min(((r.likes + r.comments * 3 + r.shares * 4) / denom) * 100, 100) : 0;
  });
  const avgEngQualityRate = mean(qualityRates);

  return {
    avgEngRate:        round(avgEngRate, 2),
    followerGrowth:    round(followerGrowth, 1),
    totalFollowers:    Math.round(lastFollowers),
    revCV:             round(revCV, 1),
    totalRevenue:      round(totalRev, 2),
    avgMonthlyRevenue: round(avgMonthlyRevenue, 2),
    totalPosts:        Math.round(totalPosts),
    avgEngQualityRate: round(avgEngQualityRate, 2),
    engRates, revenues, n,
  };
}

/* ============================================================
   CREATOR BUSINESS HEALTH SCORE
   Components: Engagement 35% | Growth Stability 25% | Revenue Stability 20% | Posting Balance 20%
   ============================================================ */
function computeHealthScore(data, kpis) {
  // 1. Engagement Strength (0–100): 8%+ = 100, 0% = 0
  const engScore     = Math.min(kpis.avgEngRate / 8 * 100, 100);

  // 2. Growth Stability (0–100): −20% or below = 0, +20% or above = 100
  const growthScore  = Math.min(Math.max((kpis.followerGrowth + 20) / 40 * 100, 0), 100);

  // 3. Revenue Stability (0–100): CV < 15 = 100, CV >= 60 = 0
  const revScore     = kpis.revenues.length > 0
    ? Math.min(Math.max((60 - kpis.revCV) / 60 * 100, 0), 100)
    : 50; // neutral when no revenue data

  // 4. Posting Balance (0–100): low CV of post counts = consistent = high score
  const postingScore = _computePostingBalance(data);

  const raw   = 0.35 * engScore + 0.25 * growthScore + 0.20 * revScore + 0.20 * postingScore;
  const score = Math.round(Math.min(Math.max(raw, 0), 100));

  let statusKey, color;
  if      (score >= 80) { statusKey = 'health.status.healthy';  color = '#34d399'; }
  else if (score >= 60) { statusKey = 'health.status.stable';   color = '#60a5fa'; }
  else if (score >= 40) { statusKey = 'health.status.moderate'; color = '#fb923c'; }
  else                  { statusKey = 'health.status.high';     color = '#f87171'; }

  return {
    score, statusKey, color,
    components: {
      eng:     Math.round(engScore),
      growth:  Math.round(growthScore),
      revenue: Math.round(revScore),
      posting: Math.round(postingScore),
    },
  };
}

function _computePostingBalance(data) {
  const posts = data.map(r => r.posts).filter(p => p > 0);
  if (posts.length < 2) return 50;
  const m = mean(posts);
  if (m === 0) return 50;
  const cv = stdDev(posts) / m;
  return Math.min(Math.max((1 - cv) * 100, 0), 100);
}

function renderHealthScore(health) {
  const card = document.getElementById('healthScoreCard');
  if (!card) return;
  card.style.display = 'block';
  const scoreEl  = document.getElementById('healthScoreValue');
  const statusEl = document.getElementById('healthScoreStatus');
  const ringEl   = document.getElementById('healthScoreRing');
  const detailEl = document.getElementById('healthScoreDetail');
  if (scoreEl)  scoreEl.textContent  = health.score;
  if (statusEl) { statusEl.textContent = i18n.t(health.statusKey); statusEl.style.color = health.color; }
  if (ringEl) {
    const circ = 2 * Math.PI * 28; // r=28
    ringEl.style.strokeDasharray  = `${circ}`;
    ringEl.style.strokeDashoffset = `${circ - (health.score / 100) * circ}`;
    ringEl.style.stroke = health.color;
  }
  if (detailEl) {
    const c = health.components;
    detailEl.innerHTML = `
      <div class="health-component"><span>${i18n.t('health.eng')}</span><span style="color:${health.color}">${c.eng}/100 × 35%</span></div>
      <div class="health-component"><span>${i18n.t('health.growth')}</span><span style="color:${health.color}">${c.growth}/100 × 25%</span></div>
      <div class="health-component"><span>${i18n.t('health.revenue')}</span><span style="color:${health.color}">${c.revenue}/100 × 20%</span></div>
      <div class="health-component"><span>${i18n.t('health.posting')}</span><span style="color:${health.color}">${c.posting}/100 × 20%</span></div>`;
  }
}

/* ============================================================
   UNIFIED CONFIDENCE SCORE
   ============================================================ */
function computeConfidenceScore(data, kpis) {
  let score = 0;
  const n = data.length;

  // Periods available — max 40 pts
  if      (n >= 12) score += 40;
  else if (n >= 8)  score += 30;
  else if (n >= 6)  score += 20;
  else if (n >= 4)  score += 10;
  else              score += 4;

  // Revenue stability — max 25 pts
  if (kpis.revenues && kpis.revenues.length > 0) {
    if      (kpis.revCV < 10) score += 25;
    else if (kpis.revCV < 20) score += 18;
    else if (kpis.revCV < 30) score += 10;
    else                      score += 3;
  } else {
    score += 8; // partial — no revenue data
  }

  // Engagement stability — max 25 pts
  const engCV = (kpis.engRates && kpis.engRates.length > 1)
    ? (stdDev(kpis.engRates) / (mean(kpis.engRates) || 1)) * 100
    : 100;
  if      (engCV < 10) score += 25;
  else if (engCV < 20) score += 18;
  else if (engCV < 30) score += 10;
  else                 score += 3;

  // Data completeness — max 10 pts
  const hasRevenue  = kpis.revenues && kpis.revenues.length > 0;
  const hasPlatform = data.some(r => r.platform && r.platform !== 'all');
  if (hasRevenue)  score += 6;
  if (hasPlatform) score += 4;

  score = Math.min(100, Math.max(0, Math.round(score)));
  const label = score >= 70 ? i18n.t('pricing.conf.high') : score >= 45 ? i18n.t('pricing.conf.medium') : i18n.t('pricing.conf.low');
  const color = score >= 70 ? 'var(--accent-green)' : score >= 45 ? 'var(--accent-orange)' : 'var(--accent-red)';
  const tooltip = `Confidence based on: ${n} data periods, revenue stability (CV ${kpis.revCV ? kpis.revCV.toFixed(0) : 'N/A'}%), engagement stability, and data completeness. Higher scores = more reliable projections.`;
  return { score, label, color, tooltip };
}

/* ============================================================
   OVERVIEW RENDER (KPIs + mini insights)
   ============================================================ */
function renderOverview(data) {
  const kpis     = computeKPIs(data);
  const insights = generateInsights(data, kpis);
  renderKPIs(data, kpis);
  renderMiniInsights(insights.slice(0, 2));
}

function renderKPIs(data, kpis) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('kpiEngRate',   kpis.avgEngRate.toFixed(2) + '%');
  set('kpiGrowth',    (kpis.followerGrowth >= 0 ? '+' : '') + kpis.followerGrowth.toFixed(1) + '%');
  set('kpiFollowers', formatNum(kpis.totalFollowers));
  set('kpiPosts',     kpis.totalPosts.toString());
  set('kpiRevenue',   kpis.avgMonthlyRevenue > 0 ? '$' + formatNum(Math.round(kpis.avgMonthlyRevenue)) : 'N/A');

  const cv = kpis.revCV;
  const volEl   = document.getElementById('kpiVolatility');
  const volChEl = document.getElementById('kpiVolatilityChange');
  // CV displayed as ratio for readability (e.g. 0.24), thresholds: <0.15 Low, 0.15-0.30 Medium, >0.30 High
  const cvRatio = cv / 100;
  if (volEl) volEl.textContent = 'CV ' + cvRatio.toFixed(2);
  if (volChEl) {
    if (cv > 30) {
      if (volEl) volEl.style.color = 'var(--accent-red)';
      volChEl.className = 'kpi-change down';
      volChEl.textContent = i18n.t('kpi.high.instability');
    } else if (cv >= 15) {
      if (volEl) volEl.style.color = 'var(--accent-orange)';
      volChEl.className = 'kpi-change down';
      volChEl.textContent = i18n.t('kpi.moderate.instability');
    } else {
      if (volEl) volEl.style.color = 'var(--accent-green)';
      volChEl.className = 'kpi-change up';
      volChEl.textContent = i18n.t('kpi.healthy.stability');
    }
  }

  // Engagement Quality Score
  set('kpiEngQuality', kpis.avgEngQualityRate.toFixed(2) + '%');
  const eqEl = document.getElementById('kpiEngQualityChange');
  if (eqEl) {
    const isHigh = kpis.avgEngQualityRate > kpis.avgEngRate;
    eqEl.className = isHigh ? 'kpi-change up' : 'kpi-change neutral';
    eqEl.textContent = isHigh ? i18n.t('kpi.quality.high') : i18n.t('kpi.quality.standard');
  }

  // Health Score
  const health = computeHealthScore(data, kpis);
  renderHealthScore(health);

  const setChange = (id, delta) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = delta >= 0 ? 'kpi-change up' : 'kpi-change down';
    el.textContent = delta >= 0 ? i18n.t('kpi.growing') : i18n.t('kpi.declining');
  };
  setChange('kpiGrowthChange',  kpis.followerGrowth);
  setChange('kpiEngRateChange', kpis.avgEngRate - 3);
}

function renderMiniInsights(insights) {
  const grid = document.getElementById('miniInsightsGrid');
  if (!grid) return;
  if (insights.length === 0) { grid.innerHTML = ''; return; }
  grid.innerHTML = insights.map(ins => buildInsightCardHTML(ins)).join('');
}

/* ============================================================
   WEEKLY AGGREGATOR — collapses daily rows into weekly buckets
   so insight thresholds aren't triggered by daily noise
   ============================================================ */
function aggregateWeekly(data) {
  const weekMap = {};
  data.forEach(r => {
    const d = new Date(r.date);
    if (isNaN(d)) return;
    const day = d.getDay() || 7;          // 1=Mon … 7=Sun
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);   // roll back to Monday
    const key = mon.toISOString().slice(0, 10);
    if (!weekMap[key]) {
      weekMap[key] = { date: key, platform: r.platform, _fols: [], views: 0, likes: 0, comments: 0, shares: 0, posts: 0, revenue: 0 };
    }
    const w = weekMap[key];
    w._fols.push(r.followers);
    w.views    += r.views;
    w.likes    += r.likes;
    w.comments += r.comments;
    w.shares   += r.shares;
    w.posts    += r.posts;
    w.revenue  += r.revenue;
  });
  return Object.keys(weekMap).sort().map(key => {
    const w = weekMap[key];
    return {
      date:      w.date,
      platform:  w.platform,
      followers: Math.round(mean(w._fols)),
      views:     w.views,
      likes:     w.likes,
      comments:  w.comments,
      shares:    w.shares,
      posts:     w.posts,
      revenue:   w.revenue,
    };
  });
}

/* ============================================================
   AI LAYER — KPI serializer + Claude API call
   ============================================================ */

/** Serializes creator KPIs into a plain-text block sent to Claude. */
function buildCreatorContext(data, kpis) {
  const platforms = [...new Set(data.map(r => r.platform))].join(', ');
  const startDate = data[0]?.date || 'N/A';
  const endDate   = data[data.length - 1]?.date || 'N/A';
  const weekly    = aggregateWeekly(data);
  const trend     = weekly.length >= 3 ? weekly : data;
  const half      = Math.max(Math.floor(trend.length / 2), 1);
  const engRates  = trend.map(r => {
    const isTikTok = r.platform.toLowerCase() === 'tiktok';
    const denom    = isTikTok && r.views > 0 ? r.views : r.followers;
    return denom > 0 ? ((r.likes + r.comments + r.shares) / denom) * 100 : 0;
  });
  const firstEng  = mean(engRates.slice(0, half));
  const lastEng   = mean(engRates.slice(half));
  const engTrend  = firstEng > 0 ? round(((lastEng - firstEng) / firstEng) * 100, 1) : 0;
  const hs        = computeHealthScore(data, kpis);
  return [
    `Platforms: ${platforms}`,
    `Data period: ${startDate} to ${endDate} (${data.length} rows, ~${trend.length} weeks of data)`,
    `Current followers: ${kpis.totalFollowers}`,
    `Avg engagement rate: ${kpis.avgEngRate}%`,
    `Engagement trend: ${engTrend >= 0 ? '+' : ''}${engTrend}% over the full period`,
    `Follower growth: ${kpis.followerGrowth >= 0 ? '+' : ''}${kpis.followerGrowth}%`,
    `Avg monthly revenue: $${Math.round(kpis.avgMonthlyRevenue)}`,
    `Revenue volatility (CV): ${round(kpis.revCV, 1)}%`,
    `Total posts: ${kpis.totalPosts}`,
    `Avg posts per data point: ${round(kpis.totalPosts / data.length, 1)}`,
    `Engagement quality score: ${kpis.avgEngQualityRate}%`,
    `Overall health score: ${hs.score}/100`,
  ].join('\n');
}

/**
 * Triggers (or re-triggers) the AI analysis for the current active platform.
 * Safe to call on upload and on every platform switch.
 */
function _triggerAI() {
  if (_isLocal || csvData.length === 0) return;
  window._aiResult  = null;
  window._aiFailed  = false;
  window._aiLoading = true;
  const platformAtStart = activePlatform; // capture so stale result is discarded if user switches again
  const generation = ++_aiGeneration;     // unique ID for this call; earlier calls are discarded
  // Immediately show spinner if the user is already on an AI section
  if (currentSection === 'insights')    renderInsights();
  if (currentSection === 'future-plan') renderFuturePlanForPeriod(window._currentPlanPeriod || 30);
  (async () => {
    let failed = false;
    try {
      const d = getFilteredData();
      const k = computeKPIs(d);
      const result = await callClaudeAI(d, k);
      // Only store if this is still the latest call and platform hasn't changed
      if (generation === _aiGeneration && activePlatform === platformAtStart) window._aiResult = result;
    } catch (_) { failed = true; }
    if (generation === _aiGeneration && activePlatform === platformAtStart) {
      window._aiLoading = false;
      if (failed) window._aiFailed = true;
      if (currentSection === 'insights')    renderInsights();
      if (currentSection === 'future-plan') renderFuturePlanForPeriod(window._currentPlanPeriod || 30);
    }
  })();
}

/**
 * Single batched Claude API call — returns insights + 30/90/180-day plans.
 * Called via _triggerAI(); result is cached in window._aiResult.
 */
async function callClaudeAI(data, kpis) {
  if (_isLocal) return null; // AI only available on deployed Vercel site
  const context = buildCreatorContext(data, kpis);
  const isAr = i18n.current === 'ar';
  const translateNote = isAr
    ? `IMPORTANT: First compose every text field with the same warm, specific, encouraging English coaching tone shown in the examples. Then translate those composed texts into natural, fluent Arabic. The Arabic must feel as warm and detailed as the English — not stiff or shortened.`
    : '';
  const prompt  = `You are a friendly and knowledgeable creator coach. Analyze the data below and return ONLY a raw JSON object — no markdown fences, no explanatory text before or after the JSON.

CREATOR ANALYTICS:
${context}

${translateNote}

Return exactly this JSON structure (write all string values in ${isAr ? 'Arabic' : 'English'}):
{
  "insights": [
    {
      "id": "short-english-slug",
      "severity": "high|medium|low",
      "title": "Clear, encouraging 5-8 word title",
      "explanation": "1-2 friendly sentences referencing specific numbers from the data",
      "action": "One clear, specific next step the creator can take today"
    }
  ],
  "plans": {
    "30": "2-3 warm, motivating sentences for a 30-day plan with concrete direction",
    "90": "2-3 sentences for a 90-day plan with measurable milestones",
    "180": "2-3 sentences for a 6-month vision with aspirational but realistic goals"
  },
  "actions": {
    "30": ["3 to 5 specific, actionable bullet points for the next 30 days"],
    "90": ["3 to 5 action steps with clear outcomes for the 90-day period"],
    "180": ["3 to 5 strategic steps that build toward the 6-month vision"]
  },
  "summary": "One warm, specific sentence summarizing overall performance using actual numbers"
}

Rules:
- 2 to 4 insights maximum. Always include at least one positive signal.
- Keep "id" as a short English slug. Keep "severity" as "high", "medium", or "low".
- Reference actual numbers from the data in every explanation and summary.
- Return ONLY the JSON object — nothing else.`;

  const res = await fetch(_claudeURL, {
    method: 'POST',
    headers: _claudeHeaders,
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      stream:     true,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);

  // Stream the response to avoid Vercel's 10s non-streaming timeout.
  // Arabic responses take longer to generate, so streaming is required.
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta')
          raw += evt.delta.text;
      } catch (_) {}
    }
  }

  // Extract the JSON object — handles any Arabic preface/suffix text
  const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return JSON.parse(stripped.slice(start, end + 1));
}

/* ============================================================
   INSIGHT ENGINE — with Micro-Intelligence Layer
   ============================================================ */
function generateInsights(data, kpis) {
  const insights = [];
  const n = data.length;
  if (n < 3) return insights;

  // Aggregate to weekly buckets so trend checks aren't triggered by daily noise.
  // Falls back to raw data if dates don't parse (e.g. non-standard formats).
  const weekly  = aggregateWeekly(data);
  const trend   = weekly.length >= 3 ? weekly : data;
  const tn      = trend.length;

  // Weekly engagement rates using same platform-aware formula as computeKPIs
  const weeklyEngRates = trend.map(r => {
    const isTikTok = r.platform.toLowerCase() === 'tiktok';
    const denom = isTikTok && r.views > 0 ? r.views : r.followers;
    return denom > 0 ? ((r.likes + r.comments + r.shares) / denom) * 100 : 0;
  });

  // Weekly revenue CV — more meaningful than daily CV for detecting structural instability
  const weeklyRevs   = trend.map(r => r.revenue).filter(v => v > 0);
  const weeklyRevCV  = weeklyRevs.length > 1 ? (stdDev(weeklyRevs) / (mean(weeklyRevs) || 1)) * 100 : 0;

  const half       = Math.max(Math.floor(tn / 2), 1);
  const firstEng   = mean(weeklyEngRates.slice(0, half));
  const lastEng    = mean(weeklyEngRates.slice(half));
  const firstPosts = mean(trend.slice(0, half).map(r => r.posts));
  const lastPosts  = mean(trend.slice(half).map(r => r.posts));
  const firstFol   = data[0].followers;
  const lastFol    = data[n - 1].followers;
  const engDecline  = lastEng < firstEng * 0.85;
  const engImproved = lastEng > firstEng * 1.10; // context: engagement is recovering
  const postingUp   = lastPosts > firstPosts * 1.2;
  const postingDown = lastPosts < firstPosts * 0.8;
  const follGrowth  = lastFol > firstFol * 1.1;
  const avgPosts    = mean(data.map(r => r.posts));
  const highRevVol  = weeklyRevCV > 30; // use weekly CV, not daily

  /* — Core Patterns — */

  // 1. Burnout Risk — severity escalates when posting surges AND engagement collapses together
  if (postingUp && engDecline) {
    const postSurge   = lastPosts > firstPosts * 1.5; // severe overpositng
    const engCollapse = lastEng < firstEng * 0.65;
    const severity    = (postSurge && engCollapse) ? 'high' : engCollapse ? 'high' : 'medium';
    insights.push({
      id: 'burnout', severity,
      titleKey: 'insight.burnout.title', bodyKey: 'insight.burnout.body', recKey: 'insight.burnout.rec',
    });
  }

  // 2. Posting Saturation (2.5x+ vs early, without decline yet) → recommend reducing
  if (lastPosts > firstPosts * 2.5 && !engDecline) {
    insights.push({
      id: 'saturation', severity: 'medium',
      titleKey: 'insight.saturation.title', bodyKey: 'insight.saturation.body', recKey: 'insight.saturation.rec',
    });
  }

  // 3. Audience Quality Drift
  if (follGrowth && engDecline && !postingUp) {
    insights.push({
      id: 'drift', severity: lastEng < firstEng * 0.70 ? 'high' : 'medium',
      titleKey: 'insight.drift.title', bodyKey: 'insight.drift.body', recKey: 'insight.drift.rec',
    });
  }

  // 4. Audience Fatigue — more sensitive when posting is already reduced and still declining
  if (engDecline && !postingUp && !follGrowth) {
    const severity = (lastEng < firstEng * 0.60 || postingDown) ? 'high' : 'medium';
    insights.push({
      id: 'fatigue', severity,
      titleKey: 'insight.fatigue.title', bodyKey: 'insight.fatigue.body', recKey: 'insight.fatigue.rec',
    });
  }

  // 5. Revenue Inconsistency — CV thresholds: >30 = High, 15–30 = Medium, <15 = Low
  // highRevVol context: when revenue is highly volatile, widen risk classification
  if (highRevVol) {
    insights.push({
      id: 'revenue', severity: kpis.revCV > 55 ? 'high' : 'medium',
      titleKey: 'insight.revenue.title', bodyKey: 'insight.revenue.body', recKey: 'insight.revenue.rec',
    });
  } else if (kpis.revCV >= 15) {
    insights.push({
      id: 'volatility', severity: 'low',
      titleKey: 'insight.volatility.title', bodyKey: 'insight.volatility.body', recKey: 'insight.volatility.rec',
    });
  }

  // 5b. Positive signal: engagement is recovering — boost morale, note in insights
  if (engImproved && !engDecline && !insights.some(i => i.id === 'stable')) {
    insights.push({
      id: 'eng-recovery', severity: 'low',
      titleKey: 'insight.eng.recovery.title',
      bodyKey:  'insight.eng.recovery.body',
      bodyVars: { pct: ((lastEng / firstEng - 1) * 100).toFixed(0) },
      recKey:   'insight.eng.recovery.rec',
    });
  }

  /* — Micro-Intelligence Layer — */

  // 6. Structural Engagement Decline (3+ consecutive WEEKLY periods declining)
  if (tn >= 4) {
    let consecutive = 0, maxConsecutive = 0;
    for (let i = 1; i < weeklyEngRates.length; i++) {
      if (weeklyEngRates[i] < weeklyEngRates[i - 1]) {
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else {
        consecutive = 0;
      }
    }
    if (maxConsecutive >= 3 && !insights.some(i => i.id === 'burnout' || i.id === 'fatigue')) {
      insights.push({
        id: 'structural-decline', severity: maxConsecutive >= 5 ? 'high' : 'medium',
        titleKey: 'insight.structural.title',
        bodyKey:  'insight.structural.body',
        bodyVars: { n: maxConsecutive },
        recKey:   'insight.structural.rec',
      });
    }
  }

  // 7. Oversaturation Risk (>12 posts/period + declining engagement)
  if (avgPosts > 12 && engDecline && !insights.some(i => i.id === 'burnout')) {
    insights.push({
      id: 'oversaturation', severity: 'high',
      titleKey: 'insight.oversat.title',
      bodyKey:  'insight.oversat.body',
      recKey:   'insight.oversat.rec',
    });
  }

  // 8. Revenue Dependency Warning (spike → sharp drop pattern)
  if (kpis.revenues.length >= 4) {
    const revs = kpis.revenues;
    let spikeThenDrop = false;
    for (let i = 1; i < revs.length - 1; i++) {
      if (revs[i] > revs[i - 1] * 1.5 && revs[i + 1] < revs[i] * 0.5) {
        spikeThenDrop = true; break;
      }
    }
    if (spikeThenDrop && !insights.some(i => i.id === 'revenue')) {
      insights.push({
        id: 'rev-dependency', severity: 'medium',
        titleKey: 'insight.rev.dep.title',
        bodyKey:  'insight.rev.dep.body',
        recKey:   'insight.rev.dep.rec',
      });
    }
  }

  // 9. Artificial Growth Pattern — tiered thresholds
  const folGrowthRate = firstFol > 0 ? (lastFol - firstFol) / firstFol : 0;
  const folGrowthPct  = folGrowthRate * 100;
  const engDropPct    = firstEng > 0 ? ((firstEng - lastEng) / firstEng) * 100 : 0;
  let artificialSeverity = null;
  if      (folGrowthPct > 40 && engDropPct > 20) artificialSeverity = 'high';
  else if (folGrowthPct > 30 && engDropPct > 10) artificialSeverity = 'medium';
  else if (folGrowthPct > 20 && engDropPct > 5)  artificialSeverity = 'low';
  if (artificialSeverity && !insights.some(i => i.id === 'drift')) {
    insights.push({
      id: 'artificial-growth', severity: artificialSeverity,
      titleKey: 'insight.artificial.title',
      bodyKey:  'insight.artificial.body',
      bodyVars: { grow: folGrowthPct.toFixed(0), drop: engDropPct.toFixed(0) },
      recKey:   'insight.artificial.rec',
    });
  }

  // Positive fallback
  if (insights.length === 0) {
    insights.push({
      id: 'stable', severity: 'low',
      titleKey: 'insight.stable.title',
      bodyKey:  'insight.stable.body',
      recKey:   'insight.stable.rec',
    });
  }

  return insights;
}

function buildInsightCardHTML(ins) {
  const title = i18n.t(ins.titleKey);
  const body  = i18n.t(ins.bodyKey, ins.bodyVars);
  const rec   = i18n.t(ins.recKey);
  const sev   = { high: i18n.t('severity.high'), medium: i18n.t('severity.medium'), low: i18n.t('severity.low') }[ins.severity] || ins.severity;
  const icon  = ins.severity === 'high' ? '🔴' : ins.severity === 'medium' ? '🟡' : '🟢';
  return `
    <div class="insight-card">
      <div class="insight-header">
        <div class="insight-title">${icon} ${title}</div>
        <span class="severity-badge severity-${ins.severity}">${sev}</span>
      </div>
      <p class="insight-body">${body}</p>
      <div class="insight-rec">
        <span class="rec-icon">💡</span>
        <span>${rec}</span>
      </div>
    </div>`;
}

/** AI-first insights renderer. Falls back to rule-based if AI is unavailable. */
function renderInsights() {
  const grid = document.getElementById('insightsGrid');
  if (!grid) return;

  // AI is still loading — show spinner
  if (window._aiLoading) {
    grid.innerHTML = `
      <div class="ai-loading-card" style="grid-column:1/-1;">
        <div class="ai-spinner"></div>
        <p class="ai-loading-text">${i18n.t('ai.loading')}</p>
      </div>`;
    return;
  }

  // AI result available — render AI insights
  if (window._aiResult && Array.isArray(window._aiResult.insights) && window._aiResult.insights.length > 0) {
    _renderAIInsights(grid, window._aiResult.insights, window._aiResult.summary);
    return;
  }

  // Fallback: rule-based insights
  const data     = getFilteredData();
  const kpis     = computeKPIs(data);
  const insights = generateInsights(data, kpis);
  if (insights.length === 0) {
    grid.innerHTML = `<div class="empty-section" style="grid-column:1/-1;"><div class="empty-section-icon">🔍</div><p>${i18n.t('dash.insights.empty')}</p></div>`;
    return;
  }
  grid.innerHTML = insights.map(i => buildInsightCardHTML(i)).join('');
}

/** Renders AI-generated insights into the grid. */
function _renderAIInsights(grid, aiInsights, summary) {
  const sevIcon  = { high: '🔴', medium: '🟡', low: '🟢' };
  const summaryHTML = summary
    ? `<div class="ai-summary-bar" style="grid-column:1/-1;">
         <span class="ai-badge-inline">${i18n.t('ai.badge')}</span>
         <span>${summary}</span>
       </div>`
    : '';
  grid.innerHTML = summaryHTML + aiInsights.map(i => `
    <div class="insight-card">
      <div class="insight-header">
        <div class="insight-title">${sevIcon[i.severity] || '🟡'} ${i.title}</div>
        <span class="severity-badge severity-${i.severity}">${i18n.t('ai.sev.' + i.severity) || i.severity}</span>
      </div>
      <p class="insight-body">${i.explanation}</p>
      <div class="insight-rec"><span class="rec-icon">💡</span><span>${i.action}</span></div>
      <div class="ai-insight-footer">${i18n.t('ai.footer')}</div>
    </div>`).join('');
}

/* ============================================================
   CHARTS (with zoom + type toggle)
   ============================================================ */
function renderCharts(data, kpis) {
  const labels = data.map(r => r.date || '');
  const hasSections = !!document.getElementById('chartsContent');

  if (hasSections) {
    const ce = document.getElementById('chartsEmpty');
    const cc = document.getElementById('chartsContent');
    if (ce) ce.classList.add('hidden');
    if (cc) cc.classList.remove('hidden');
  }

  destroyCharts();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const ctxFol = document.getElementById('chartFollowers');
  if (ctxFol) {
    charts.followers = makeChart(ctxFol, 'line', labels, [{
      label: i18n.t('dash.kpi.followers'), data: data.map(r => r.followers),
      borderColor: '#00C6FF', backgroundColor: 'rgba(0,198,255,0.07)',
      borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: '#00C6FF',
    }], isDark, '');
  }

  const ctxPost = document.getElementById('chartPosts');
  if (ctxPost) {
    charts.posts = makeChart(ctxPost, 'bar', labels, [{
      label: i18n.t('dash.kpi.posts'), data: data.map(r => r.posts),
      backgroundColor: 'rgba(251,146,60,0.65)', borderRadius: 6, hoverBackgroundColor: 'rgba(251,146,60,0.9)',
    }], isDark, '');
  }

  const ctxEng = document.getElementById('chartEngagement');
  if (ctxEng) {
    charts.engagement = makeChart(ctxEng, 'line', labels, [{
      label: i18n.t('dash.chart.eng.pct'), data: kpis.engRates.map(v => round(v, 2)),
      borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.07)',
      borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: '#8B5CF6',
    }], isDark, '%');
  }

  const hasRevenue = data.some(r => r.revenue > 0);
  const ctxRev    = document.getElementById('chartRevenue');
  const revPanel  = document.getElementById('revChartPanel');
  if (ctxRev && revPanel) {
    if (hasRevenue) {
      revPanel.classList.remove('hidden');
      const avgRev = mean(data.map(d => d.revenue));
      charts.revenue = makeChart(ctxRev, 'bar', labels, [{
        label: i18n.t('dash.chart.rev.label'), data: data.map(r => r.revenue),
        backgroundColor: data.map(r => r.revenue >= avgRev ? 'rgba(52,211,153,0.7)' : 'rgba(139,92,246,0.6)'),
        borderRadius: 6,
      }], isDark, '$');
    } else {
      revPanel.classList.add('hidden');
    }
  }
}

function makeChart(ctx, type, labels, datasets, isDark, unit) {
  const gridColor = isDark ? 'rgba(139,92,246,0.08)' : 'rgba(124,58,237,0.06)';
  return new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#1A2035' : '#fff',
          borderColor: isDark ? 'rgba(139,92,246,0.3)' : 'rgba(124,58,237,0.2)',
          borderWidth: 1, padding: 12,
          titleColor: isDark ? '#EEF2FF' : '#1E293B',
          bodyColor:  isDark ? '#8899BB' : '#475569',
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (unit === '$') return ` Revenue: $${formatNum(v)}`;
              if (unit === '%') return ` ${ctx.dataset.label}: ${v}%`;
              return ` ${ctx.dataset.label}: ${formatNum(v)}`;
            }
          }
        },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:  { enabled: true, mode: 'x' },
        }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { maxRotation: 40, font: { size: 11 } } },
        y: {
          grid: { color: gridColor }, beginAtZero: type === 'bar',
          ticks: { callback: v => unit === '$' ? '$' + formatNum(v) : v + unit, font: { size: 11 } },
        },
      },
    }
  });
}

window.setChartType = function(canvasId, type) {
  const key = canvasId.replace('chart', '').toLowerCase();
  const c   = charts[key];
  if (!c) return;
  c.config.type = type;
  c.update();
};

function destroyCharts() {
  Object.values(charts).forEach(c => c && c.destroy && c.destroy());
  charts = {};
}

/* ============================================================
   FUTURE PLAN — with confidence + explanation + simulation
   ============================================================ */
function renderFuturePlan(data, kpis) {
  const emptyEl   = document.getElementById('futurePlanEmpty');
  const contentEl = document.getElementById('futurePlanContent');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (contentEl) contentEl.classList.remove('hidden');

  window._futurePlanData = data;
  window._futurePlanKpis = kpis;
  renderFuturePlanForPeriod(30);
  renderScenarioSimulation();
}

function renderScenarioSimulation() {
  const el = document.getElementById('simulationSection');
  if (!el) return;
  el.classList.remove('hidden');
  const res = document.getElementById('simulationResult');
  if (res) res.innerHTML = `<div class="sim-placeholder">${i18n.t('sim.placeholder')}</div>`;
}

window.renderFuturePlanForPeriod = function(period) {
  window._currentPlanPeriod = period;
  const data = window._futurePlanData;
  const kpis = window._futurePlanKpis;
  if (!data || !kpis) return;

  const plan = generateFuturePlan(data, kpis, period);
  const conf = computeConfidenceScore(data, kpis);
  const el   = document.getElementById('planCards');
  if (!el) return;

  const riskClass = plan.riskLevel === 'High' ? 'risk-high' : plan.riskLevel === 'Medium' ? 'risk-medium' : 'risk-low';
  const riskLabel = plan.riskLevel === 'High' ? i18n.t('risk.high') : plan.riskLevel === 'Medium' ? i18n.t('risk.medium') : i18n.t('risk.low');
  const revHTML = plan.revenueProjection
    ? `<div class="plan-card">
        <div class="plan-card-label">${i18n.t('plan.projected.revenue')}</div>
        <div class="plan-card-value">$${formatNum(plan.revenueProjection.monthly)}<span style="font-size:1rem;font-weight:500;color:var(--text-muted)">/mo</span></div>
        <div class="plan-card-sub">${i18n.t('plan.range')}: $${formatNum(plan.revenueProjection.min)} – $${formatNum(plan.revenueProjection.max)}</div>
       </div>`
    : `<div class="plan-card"><div class="plan-card-label">${i18n.t('plan.projected.revenue')}</div><div class="plan-card-sub" style="margin-top:8px;">${i18n.t('plan.no.revenue.range')}</div></div>`;

  el.innerHTML = `
    <div class="plan-confidence-row">
      <div class="confidence-label-text">${i18n.t('plan.confidence')}</div>
      <div class="confidence-bar" style="flex:1;max-width:220px;">
        <div class="confidence-fill" style="width:${conf.score}%;background:${conf.color};"></div>
      </div>
      <div class="confidence-score-text" style="color:${conf.color};" title="${conf.tooltip}">${conf.score}% — ${conf.label}</div>
    </div>

    <div class="future-plan-grid">
      <div class="plan-card highlight">
        <div class="plan-card-label">${i18n.t('plan.expected.growth')}</div>
        <div class="plan-card-value" style="color:${plan.expectedGrowthPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
          ${plan.expectedGrowthPercent >= 0 ? '+' : ''}${plan.expectedGrowthPercent}%
        </div>
        <div class="plan-card-sub">${i18n.t('plan.projected.over')} ${plan.months} ${i18n.t('plan.months')}</div>
      </div>
      <div class="plan-card">
        <div class="plan-card-label">${i18n.t('plan.followers')}</div>
        <div class="plan-card-value">${formatNum(plan.projectedFollowers)}</div>
        <div class="plan-card-sub">${i18n.t('plan.from.current')} ${formatNum(data[data.length - 1].followers)}</div>
      </div>
      <div class="plan-card">
        <div class="plan-card-label">${i18n.t('plan.risk.level')}</div>
        <div style="margin:8px 0;"><span class="risk-badge ${riskClass}">${riskLabel} ${i18n.t('plan.risk.suffix')}</span></div>
        <div class="plan-card-sub">${i18n.t('plan.score')}: ${plan.riskScore}/5</div>
      </div>
      <div class="plan-card">
        <div class="plan-card-label">${i18n.t('plan.rec.posting')}</div>
        <div class="plan-card-value" style="font-size:1.15rem;line-height:1.3;margin-top:4px;">${plan.recommendedFreq}</div>
      </div>
      ${revHTML}
    </div>

    ${(() => {
      const pKey = period.toString();
      const aiPlan = window._aiResult && window._aiResult.plans && window._aiResult.plans[pKey];
      const periodKey = period === 30 ? 'ai.period.30' : period === 90 ? 'ai.period.90' : 'ai.period.180';
      const periodLabel = i18n.t(periodKey);
      if (window._aiLoading) {
        return `<div class="card ai-strategy-card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('ai.strategy.title')} — ${periodLabel}</h2>
            <div class="line"></div>
          </div>
          <div class="ai-loading-inline"><div class="ai-spinner-sm"></div><span>${i18n.t('ai.strategy.loading')}</span></div>
        </div>`;
      }
      if (aiPlan) {
        return `<div class="card ai-strategy-card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('ai.strategy.title')} — ${periodLabel}</h2>
            <div class="line"></div>
          </div>
          <p class="ai-strategy-body">${aiPlan}</p>
          <div class="ai-insight-footer" style="margin-top:12px;">${i18n.t('ai.footer')}</div>
        </div>`;
      }
      if (window._aiFailed) {
        return `<div class="card ai-strategy-card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('ai.strategy.title')} — ${periodLabel}</h2>
            <div class="line"></div>
          </div>
          <p class="ai-strategy-body" style="color:var(--text-secondary);">${i18n.t('ai.retry')}</p>
        </div>`;
      }
      return '';
    })()}

    ${(() => {
      const pKey = period.toString();
      const aiActions = window._aiResult && window._aiResult.actions && window._aiResult.actions[pKey];
      if (window._aiLoading) {
        return `<div class="card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('plan.action.title')}</h2>
            <div class="line"></div>
          </div>
          <div class="ai-loading-inline"><div class="ai-spinner-sm"></div><span>${i18n.t('ai.strategy.loading')}</span></div>
        </div>`;
      }
      if (aiActions && aiActions.length > 0) {
        return `<div class="card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('plan.action.title')}</h2>
            <div class="line"></div>
          </div>
          <div class="action-plan-list">
            ${aiActions.map(a => `<div class="action-item"><div class="action-dot"></div><span>${a}</span></div>`).join('')}
          </div>
          <div class="ai-insight-footer" style="margin-top:12px;">${i18n.t('ai.footer')}</div>
        </div>`;
      }
      if (window._aiFailed) {
        return `<div class="card" style="margin-bottom:20px;">
          <div class="section-heading" style="margin-bottom:16px;">
            <h2 style="font-size:1rem;">${i18n.t('plan.action.title')}</h2>
            <div class="line"></div>
          </div>
          <p style="color:var(--text-secondary);padding:8px 0;">${i18n.t('ai.retry')}</p>
        </div>`;
      }
      return '';
    })()}

    <div class="plan-explanation">
      <div class="plan-explanation-header" onclick="this.parentElement.classList.toggle('open')">
        <span>${i18n.t('plan.logic.title')}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="plan-explanation-body">
        <div class="explain-row"><span class="explain-label">${i18n.t('explain.hist.growth')}</span><span class="explain-value">${(plan.avgMonthlyGrowth * 100).toFixed(2)}%/period</span></div>
        <div class="explain-row"><span class="explain-label">${i18n.t('explain.eng.adj')}</span><span class="explain-value" style="color:${plan.engTrend < -5 ? 'var(--accent-red)' : plan.engTrend > 5 ? 'var(--accent-green)' : 'var(--text-secondary)'}">${plan.engTrend > 0 ? '+' : ''}${plan.engTrend}% → ${plan.engTrend < -5 ? '−' + Math.abs(Math.round(plan.engTrend * 0.4)) + i18n.t('explain.pct.applied') : plan.engTrend > 5 ? i18n.t('explain.boost.applied') : i18n.t('explain.no.adj')}</span></div>
        <div class="explain-row"><span class="explain-label">${i18n.t('explain.adj.proj')}</span><span class="explain-value"><strong>${(plan.adjGrowthRate * 100).toFixed(2)}%/period × ${plan.months} ${i18n.t('plan.months')}</strong></span></div>
        ${plan.revenueProjection ? `<div class="explain-row"><span class="explain-label">${i18n.t('explain.rev.vol')}</span><span class="explain-value" style="color:${kpis.revCV > 30 ? 'var(--accent-red)' : kpis.revCV >= 15 ? 'var(--accent-orange)' : 'var(--accent-green)'}">CV ${(kpis.revCV / 100).toFixed(2)} → ${kpis.revCV > 30 ? i18n.t('explain.instability.high') : kpis.revCV >= 15 ? i18n.t('explain.instability.med') : i18n.t('explain.instability.low')}</span></div>` : ''}
        <div class="explain-row"><span class="explain-label">${i18n.t('explain.risk.calc')}</span><span class="explain-value"><strong>${plan.riskScore}/5</strong> — ${i18n.t('explain.risk.factors')}</span></div>
        <p class="sim-methodology" style="margin-top:12px;">${i18n.t('plan.disclaimer')}</p>
      </div>
    </div>`;
};

function generateFuturePlan(data, kpis, period) {
  const n      = data.length;
  const months = period === 30 ? 1 : period === 90 ? 3 : 6;

  const folRates = [];
  for (let i = 1; i < n; i++) {
    if (data[i - 1].followers > 0) folRates.push((data[i].followers - data[i - 1].followers) / data[i - 1].followers);
  }
  const avgFolGrowth  = mean(folRates);
  const folVolatility = stdDev(folRates);

  const half       = Math.max(Math.floor(n / 2), 1);
  const firstEng   = mean(kpis.engRates.slice(0, half));
  const lastEng    = mean(kpis.engRates.slice(half));
  const engTrend   = firstEng > 0 ? (lastEng - firstEng) / firstEng : 0;

  const firstPosts = mean(data.slice(0, Math.min(3, n)).map(r => r.posts));
  const lastPosts  = mean(data.slice(-Math.min(3, n)).map(r => r.posts));
  const postTrend  = firstPosts > 0 ? (lastPosts - firstPosts) / firstPosts : 0;
  const avgPosts   = mean(data.map(r => r.posts));

  // Engagement dampens/boosts growth
  let engAdj;
  if      (engTrend < -0.2)  engAdj = -0.4;
  else if (engTrend < -0.1)  engAdj = -0.2;
  else if (engTrend >  0.2)  engAdj =  0.2;
  else if (engTrend >  0.1)  engAdj =  0.1;
  else                       engAdj =  0;

  const adjGrowthRate = avgFolGrowth * (1 + engAdj);
  const currentFol    = data[n - 1].followers;
  const projFol       = Math.round(currentFol * Math.pow(1 + adjGrowthRate, months));
  const growthPct     = round(((projFol - currentFol) / currentFol) * 100, 1);

  let riskScore = 0;
  if (kpis.revCV > 30)        riskScore += 2; else if (kpis.revCV > 20) riskScore += 1;
  if (engTrend < -0.2)        riskScore += 2; else if (engTrend < -0.1) riskScore += 1;
  if (folVolatility > 0.05)   riskScore += 1;
  const riskLevel = riskScore >= 4 ? 'High' : riskScore >= 2 ? 'Medium' : 'Low';

  const saturationDetected = avgPosts > 12 && engTrend < -0.1;
  let recommendedFreq;
  if (saturationDetected) {
    recommendedFreq = Math.max(2, Math.round(lastPosts * 0.55)) + ' ' + i18n.t('plan.freq.posts') + ' (' + i18n.t('plan.freq.reduce.sat') + ')';
  } else if (postTrend > 0.3 && engTrend < -0.1) {
    recommendedFreq = Math.max(2, Math.round(lastPosts * 0.7)) + ' ' + i18n.t('plan.freq.posts') + ' (' + i18n.t('plan.freq.reduce30') + ')';
  } else if (engTrend > 0 && postTrend <= 0.1) {
    recommendedFreq = Math.round(lastPosts * 1.15) + ' ' + i18n.t('plan.freq.posts') + ' (' + i18n.t('plan.freq.slight.increase') + ')';
  } else {
    recommendedFreq = Math.round(lastPosts) + ' ' + i18n.t('plan.freq.posts') + ' (' + i18n.t('plan.freq.maintain') + ')';
  }

  let revenueProjection = null;
  const revs = kpis.revenues;
  if (revs.length > 2) {
    const revRates = [];
    for (let i = 1; i < revs.length; i++) if (revs[i - 1] > 0) revRates.push((revs[i] - revs[i - 1]) / revs[i - 1]);
    const avgRevGrowth = mean(revRates);
    const recentRev    = mean(revs.slice(-Math.min(3, revs.length)));
    const projMonthly  = Math.round(recentRev * (1 + avgRevGrowth));
    const cvFactor     = kpis.revCV > 30 ? 0.7 : kpis.revCV > 20 ? 0.5 : 0.35;
    revenueProjection  = {
      monthly: projMonthly,
      min:     Math.max(0, Math.round(projMonthly * months * (1 - cvFactor))),
      max:     Math.round(projMonthly * months * (1 + cvFactor)),
    };
  }

  // Use AI-generated actions when available, fall back to rule-based
  const aiActions = window._aiResult && window._aiResult.actions && window._aiResult.actions[period.toString()];
  const actions = aiActions && aiActions.length > 0 ? aiActions : (() => {
    const a = [];
    if (engTrend < -0.15)              a.push(i18n.t('plan.action.eng.decline'));
    if (saturationDetected)            a.push(i18n.t('plan.action.saturation'));
    else if (postTrend > 0.3 && engTrend < -0.05) a.push(i18n.t('plan.action.post.high'));
    if (kpis.revCV > 20)              a.push(i18n.t('plan.action.rev.unstable'));
    if (avgFolGrowth > 0.05)          a.push(i18n.t('plan.action.growth.strong'));
    if (period === 30)                 a.push(i18n.t('plan.action.30'));
    if (period === 90)                 a.push(i18n.t('plan.action.90'));
    if (period === 180)                a.push(i18n.t('plan.action.180'));
    if (a.length === 0)               a.push(i18n.t('plan.action.healthy'));
    return a;
  })();

  return { period, months, projectedFollowers: projFol, expectedGrowthPercent: growthPct, riskLevel, riskScore, recommendedFreq, revenueProjection, actions, engTrend: round(engTrend * 100, 1), avgMonthlyGrowth: avgFolGrowth, adjGrowthRate };
}

/* ============================================================
   SCENARIO SIMULATION ENGINE
   ============================================================ */
window.runSimulation = function() {
  const data = getFilteredData();
  if (data.length === 0) { showToast(i18n.t('toast.no.csv.sim'), 'error'); return; }
  const kpis = computeKPIs(data);
  const postSel = document.getElementById('simPostingDelta');
  const engSel  = document.getElementById('simEngDelta');
  if (!postSel || !engSel) return;

  const postingDelta = parseFloat(postSel.value) || 0;
  const engDelta     = parseFloat(engSel.value)  || 0;
  const result = simulateScenario(data, kpis, postingDelta, engDelta);
  renderSimulationResult(result);
};

function simulateScenario(data, kpis, postingDeltaPct, engDeltaPct) {
  const baseline       = generateFuturePlan(data, kpis, 30);
  const adjEngRate     = Math.max(0, kpis.avgEngRate + engDeltaPct);
  const engRatioChange = kpis.avgEngRate > 0 ? adjEngRate / kpis.avgEngRate : 1;

  const n        = data.length;
  const half     = Math.max(Math.floor(n / 2), 1);
  const lastEng  = mean(kpis.engRates.slice(half));
  const firstEng = mean(kpis.engRates.slice(0, half));
  const engTrend = firstEng > 0 ? (lastEng - firstEng) / firstEng : 0;

  // Burnout: large posting increase when engagement already declining or further reduced
  const burnoutRisk = postingDeltaPct >= 20 && (engTrend < -0.1 || engDeltaPct < 0);

  // Growth multiplier from engagement change (+1% eng ≈ +0.15% growth rate boost)
  const growthMult    = 1 + (engDeltaPct * 0.15);
  const postingEffect = postingDeltaPct > 0 ? postingDeltaPct * 0.04 : postingDeltaPct * 0.03;

  const revCapped  = kpis.revCV > 30;
  const baseGrowth = baseline.expectedGrowthPercent;
  const simGrowth  = round(baseGrowth * growthMult + postingEffect, 1);

  const currentFol   = data[data.length - 1].followers;
  const simFollowers = Math.round(currentFol * (1 + simGrowth / 100));

  let riskDelta = 0;
  if (burnoutRisk)         riskDelta += 2;
  if (engDeltaPct < 0)     riskDelta += 1;
  if (postingDeltaPct < -10) riskDelta -= 1;
  const newRiskScore = Math.max(0, Math.min(5, baseline.riskScore + riskDelta));
  const newRiskLevel = newRiskScore >= 4 ? 'High' : newRiskScore >= 2 ? 'Medium' : 'Low';

  let simRevenue = null;
  if (baseline.revenueProjection) {
    const revMult    = revCapped ? Math.min(engRatioChange, 1.1) : engRatioChange;
    const simMonthly = Math.round(baseline.revenueProjection.monthly * revMult);
    simRevenue = { monthly: simMonthly, delta: simMonthly - baseline.revenueProjection.monthly };
  }

  return { baseline, simGrowth, simFollowers, simRevenue, newRiskLevel, newRiskScore, burnoutRisk, growthDelta: round(simGrowth - baseGrowth, 1), followerDelta: simFollowers - baseline.projectedFollowers, postingDeltaPct, engDeltaPct };
}

function renderSimulationResult(r) {
  const el = document.getElementById('simulationResult');
  if (!el) return;

  const baseline      = r.baseline;
  const riskClass     = r.newRiskLevel === 'High' ? 'risk-high' : r.newRiskLevel === 'Medium' ? 'risk-medium' : 'risk-low';
  const baseRiskClass = baseline.riskLevel === 'High' ? 'risk-high' : baseline.riskLevel === 'Medium' ? 'risk-medium' : 'risk-low';
  const riskLabelNew  = r.newRiskLevel  === 'High' ? i18n.t('risk.high') : r.newRiskLevel  === 'Medium' ? i18n.t('risk.medium') : i18n.t('risk.low');
  const riskLabelBase = baseline.riskLevel === 'High' ? i18n.t('risk.high') : baseline.riskLevel === 'Medium' ? i18n.t('risk.medium') : i18n.t('risk.low');
  const growthColor   = r.growthDelta >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const folColor      = r.followerDelta >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  const revHTML = r.simRevenue ? `
    <div class="sim-compare-item">
      <div class="sim-label">${i18n.t('plan.projected.revenue')}</div>
      <div class="sim-before">$${formatNum(baseline.revenueProjection.monthly)}</div>
      <div class="sim-arrow">→</div>
      <div class="sim-after" style="color:${r.simRevenue.delta >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">
        $${formatNum(r.simRevenue.monthly)}
        <span class="sim-delta">(${r.simRevenue.delta >= 0 ? '+' : ''}$${formatNum(r.simRevenue.delta)})</span>
      </div>
    </div>` : '';

  const burnoutHTML = r.burnoutRisk ? `
    <div class="sim-warning">
      <strong>${i18n.t('sim.burnout.warning')}</strong> ${i18n.t('sim.burnout.sub')}
    </div>` : '';

  el.innerHTML = `
    ${burnoutHTML}
    <div class="sim-compare-grid">
      <div class="sim-compare-item">
        <div class="sim-label">${i18n.t('plan.30day.growth')}</div>
        <div class="sim-before">${baseline.expectedGrowthPercent >= 0 ? '+' : ''}${baseline.expectedGrowthPercent}%</div>
        <div class="sim-arrow">→</div>
        <div class="sim-after" style="color:${growthColor};">
          ${r.simGrowth >= 0 ? '+' : ''}${r.simGrowth}%
          <span class="sim-delta">(${r.growthDelta >= 0 ? '+' : ''}${r.growthDelta}%)</span>
        </div>
      </div>
      <div class="sim-compare-item">
        <div class="sim-label">${i18n.t('plan.followers')}</div>
        <div class="sim-before">${formatNum(baseline.projectedFollowers)}</div>
        <div class="sim-arrow">→</div>
        <div class="sim-after" style="color:${folColor};">
          ${formatNum(r.simFollowers)}
          <span class="sim-delta">(${r.followerDelta >= 0 ? '+' : ''}${formatNum(Math.abs(r.followerDelta))})</span>
        </div>
      </div>
      <div class="sim-compare-item">
        <div class="sim-label">${i18n.t('plan.risk.level')}</div>
        <div class="sim-before"><span class="risk-badge ${baseRiskClass}" style="font-size:0.78rem;padding:4px 10px;">${riskLabelBase}</span></div>
        <div class="sim-arrow">→</div>
        <div class="sim-after"><span class="risk-badge ${riskClass}" style="font-size:0.78rem;padding:4px 10px;">${riskLabelNew}</span></div>
      </div>
      ${revHTML}
    </div>
    <div class="sim-methodology">
      <strong>${i18n.t('sim.methodology.label')}</strong> ${i18n.t('sim.methodology.body')}${r.simRevenue && r.simRevenue.delta !== 0 ? ' ' + i18n.t('sim.methodology.rev') : ''}
    </div>`;
}

/* ============================================================
   AD PRICING — Multi-Factor Model
   ============================================================ */
function renderAdPricing(data, kpis) {
  const emptyEl   = document.getElementById('adPricingEmpty');
  const contentEl = document.getElementById('adPricingContent');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (contentEl) contentEl.classList.remove('hidden');

  const p         = calculateAdPricing(data, kpis);
  const classMap  = { Underpriced: 'underpriced', 'Fairly Priced': 'fair', Overpriced: 'overpriced' };
  const classKey  = classMap[p.classification] || 'fair';
  const classTxt  = {
    underpriced: i18n.t('pricing.underpriced'),
    fair:        i18n.t('pricing.fair'),
    overpriced:  i18n.t('pricing.overpriced'),
  };
  const confColor = p.confidenceScore >= 70 ? 'var(--accent-green)' : p.confidenceScore >= 45 ? 'var(--accent-orange)' : 'var(--accent-red)';
  const gfLabel   = p.growthFactor > 1.1 ? i18n.t('pricing.gf.strong') : p.growthFactor < 1 ? i18n.t('pricing.gf.decline') : i18n.t('pricing.gf.neutral');
  const sfLabel   = p.stabilityFactor > 1.05 ? i18n.t('pricing.sf.premium') : p.stabilityFactor < 0.95 ? i18n.t('pricing.sf.discount') : i18n.t('pricing.sf.neutral');

  contentEl.innerHTML = `
    <div class="pricing-result-grid">
      <div class="pricing-main-card">
        <div class="plan-card-label">${i18n.t('pricing.class')}</div>
        <div class="pricing-class-badge class-${classKey}">${classTxt[classKey]}</div>

        <div class="plan-card-label" style="margin-bottom:12px;">${i18n.t('pricing.range')}</div>
        <div class="price-range">
          <div class="price-tier">
            <div class="price-tier-label">${i18n.t('pricing.min.label')}</div>
            <div class="price-tier-value">$${formatNum(p.minPrice)}</div>
          </div>
          <div class="price-tier ideal">
            <div class="price-tier-label">${i18n.t('pricing.ideal.label')}</div>
            <div class="price-tier-value">$${formatNum(p.idealPrice)}</div>
          </div>
          <div class="price-tier">
            <div class="price-tier-label">${i18n.t('pricing.premium.label')}</div>
            <div class="price-tier-value">$${formatNum(p.premiumPrice)}</div>
          </div>
        </div>

        <div class="confidence-row">
          <div style="font-size:0.78rem;color:var(--text-muted);font-weight:600;" title="${p.confidenceTooltip}">${i18n.t('pricing.confidence')}</div>
          <div class="confidence-bar" style="flex:1;">
            <div class="confidence-fill" style="width:${p.confidenceScore}%;background:${confColor};"></div>
          </div>
          <div class="confidence-label" style="color:${confColor};">${p.confidenceScore}% — ${p.confidence}</div>
        </div>

        <div class="pricing-breakdown">
          <div class="pricing-breakdown-title">${i18n.t('pricing.breakdown.title')}</div>
          <div class="pricing-breakdown-row">
            <span>${i18n.t('pricing.base.price')} (${formatNum(p.followers)} followers × $${p.cpmRate} CPM ÷ 1K)</span>
            <span>$${formatNum(p.base)}</span>
          </div>
          <div class="pricing-breakdown-row">
            <span>${i18n.t('pricing.eng.mult')} (${p.engMultiplier}×) — ${p.tier}</span>
            <span>${p.engMultiplier >= 1 ? '+' : ''}$${formatNum(Math.round(Math.abs(p.engMultiplier - 1) * p.base))}</span>
          </div>
          <div class="pricing-breakdown-row">
            <span>${i18n.t('pricing.growth.factor.row')} (${p.growthFactor}×) — ${gfLabel}</span>
            <span>${p.growthFactor >= 1 ? '+' : '-'}$${formatNum(Math.round(Math.abs(p.growthFactor - 1) * p.base * p.engMultiplier))}</span>
          </div>
          <div class="pricing-breakdown-row">
            <span>${i18n.t('pricing.stability.factor')} (${p.stabilityFactor}×) — ${sfLabel}</span>
            <span>${p.stabilityFactor >= 1 ? '+' : '-'}$${formatNum(Math.round(Math.abs(p.stabilityFactor - 1) * p.base * p.engMultiplier * p.growthFactor))}</span>
          </div>
          <div class="pricing-breakdown-row total">
            <span>${i18n.t('pricing.adjusted.base')}</span>
            <span>$${formatNum(p.adjusted)}</span>
          </div>
          <div class="pricing-breakdown-row" style="font-size:0.75rem;color:var(--text-muted);padding-top:4px;">
            <span>Min = ×0.65 &nbsp;·&nbsp; Ideal = ×1.0 &nbsp;·&nbsp; Premium = ×1.55</span>
            <span></span>
          </div>
        </div>

        <div class="pricing-disclaimer">
          ${i18n.t('pricing.disclaimer.text')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card">
          <div class="plan-card-label">${i18n.t('pricing.engagement.tier')}</div>
          <div style="font-size:1.4rem;font-weight:800;margin:8px 0;">${p.tier}</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);">${i18n.t('pricing.avg.rev')}: ${kpis.avgEngRate.toFixed(2)}%</div>
        </div>
        <div class="card">
          <div class="plan-card-label">${i18n.t('pricing.growth.momentum')}</div>
          <div style="font-size:1.4rem;font-weight:800;margin:8px 0;color:${kpis.followerGrowth >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${kpis.followerGrowth >= 0 ? '+' : ''}${kpis.followerGrowth.toFixed(1)}%
          </div>
          <div style="font-size:0.82rem;color:var(--text-secondary);">${i18n.t('pricing.growth.factor')}: ${p.growthFactor}×</div>
        </div>
        <div class="card">
          <div class="plan-card-label">${i18n.t('pricing.current.rev')}</div>
          <div style="font-size:1.4rem;font-weight:800;margin:8px 0;">
            ${p.avgRevPerPost !== null ? '$' + Math.round(p.avgRevPerPost) : i18n.t('pricing.no.data')}
          </div>
          <div style="font-size:0.82rem;color:var(--text-secondary);">
            ${p.avgRevPerPost !== null
              ? (p.avgRevPerPost < p.minPrice
                  ? i18n.t('pricing.below.min')
                  : p.avgRevPerPost > p.premiumPrice
                    ? i18n.t('pricing.above.premium')
                    : i18n.t('pricing.in.range'))
              : i18n.t('pricing.upload.revenue')}
          </div>
        </div>
      </div>
    </div>`;
}

function calculateAdPricing(data, kpis) {
  const followers     = data[data.length - 1].followers;
  const engRate       = kpis.avgEngRate;
  const revenues      = kpis.revenues;
  const totalPosts    = kpis.totalPosts || 1;
  const avgRevPerPost = revenues.length > 0 ? sum(revenues) / totalPosts : null;

  let cpmRate, tier;
  if      (engRate >= 8) { cpmRate = 12; tier = i18n.t('tier.excellent'); }
  else if (engRate >= 5) { cpmRate = 9;  tier = i18n.t('tier.strong'); }
  else if (engRate >= 3) { cpmRate = 6;  tier = i18n.t('tier.good'); }
  else if (engRate >= 1) { cpmRate = 3;  tier = i18n.t('tier.average'); }
  else                   { cpmRate = 1;  tier = i18n.t('tier.below'); }

  const engMultiplier = Math.round(Math.min(Math.max(engRate / 3, 0.5), 2.5) * 100) / 100;

  // Growth factor
  let growthFactor;
  if      (kpis.followerGrowth > 15) growthFactor = 1.25;
  else if (kpis.followerGrowth > 10) growthFactor = 1.15;
  else if (kpis.followerGrowth > 5)  growthFactor = 1.05;
  else if (kpis.followerGrowth > 0)  growthFactor = 1.00;
  else                               growthFactor = 0.85;

  // Stability factor
  let stabilityFactor;
  if (revenues.length === 0)  stabilityFactor = 1.0;
  else if (kpis.revCV < 15)   stabilityFactor = 1.15;
  else if (kpis.revCV < 25)   stabilityFactor = 1.00;
  else if (kpis.revCV < 35)   stabilityFactor = 0.90;
  else                        stabilityFactor = 0.75;

  const base     = Math.round((followers / 1000) * cpmRate);
  const adjusted = Math.round(base * engMultiplier * growthFactor * stabilityFactor);
  const minP     = Math.round(adjusted * 0.65);
  const ideal    = adjusted;
  const prem     = Math.round(adjusted * 1.55);

  let classification = 'Fairly Priced';
  if (avgRevPerPost !== null) {
    if      (avgRevPerPost < minP * 0.75) classification = 'Underpriced';
    else if (avgRevPerPost > prem * 1.20) classification = 'Overpriced';
  }

  const conf = computeConfidenceScore(data, kpis);
  return {
    followers, engRate, tier, cpmRate,
    base, engMultiplier, growthFactor, stabilityFactor,
    adjusted, minPrice: minP, idealPrice: ideal, premiumPrice: prem,
    classification, avgRevPerPost,
    confidence: conf.label, confidenceScore: conf.score, confidenceTooltip: conf.tooltip,
  };
}

/* ============================================================
   BRAND REPORT — with Campaign Fit Score
   ============================================================ */
function computeCampaignFitScore(kpis) {
  let score = 0;

  // Engagement strength (35 pts)
  if      (kpis.avgEngRate >= 8) score += 35;
  else if (kpis.avgEngRate >= 5) score += 28;
  else if (kpis.avgEngRate >= 3) score += 18;
  else if (kpis.avgEngRate >= 1) score += 8;

  // Audience size (25 pts)
  const fol = kpis.totalFollowers;
  if      (fol >= 1_000_000) score += 25;
  else if (fol >= 100_000)   score += 22;
  else if (fol >= 10_000)    score += 18;
  else if (fol >= 1_000)     score += 12;
  else                       score += 5;

  // Growth momentum (20 pts)
  if      (kpis.followerGrowth > 20) score += 20;
  else if (kpis.followerGrowth > 10) score += 15;
  else if (kpis.followerGrowth > 5)  score += 10;
  else if (kpis.followerGrowth > 0)  score += 5;

  // Revenue stability (20 pts)
  if      (kpis.revenues.length === 0) score += 10; // unknown
  else if (kpis.revCV < 15)            score += 20;
  else if (kpis.revCV < 25)            score += 14;
  else if (kpis.revCV < 35)            score += 8;
  else                                 score += 2;

  score = Math.min(100, Math.max(0, Math.round(score)));

  let label, color;
  if      (score >= 80) { label = 'Excellent Fit';  color = 'var(--accent-green)'; }
  else if (score >= 60) { label = 'Good Fit';        color = 'var(--accent-blue)'; }
  else if (score >= 40) { label = 'Moderate Fit';   color = 'var(--accent-orange)'; }
  else                  { label = 'Limited Fit';    color = 'var(--accent-red)'; }

  let creatorTier;
  if      (fol >= 1_000_000) creatorTier = 'Mega Creator (1M+)';
  else if (fol >= 100_000)   creatorTier = 'Macro Creator (100K+)';
  else if (fol >= 10_000)    creatorTier = 'Micro Creator (10K+)';
  else if (fol >= 1_000)     creatorTier = 'Nano Creator (1K+)';
  else                       creatorTier = 'Emerging Creator';

  return { score, label, color, creatorTier };
}

function renderBrandReport(data) {
  const zone   = document.getElementById('brandUploadZone');
  const mobBtn = document.querySelector('label[for="brandCsvMobile"]');
  const report = document.getElementById('brandReport');
  if (zone)   zone.classList.add('hidden');
  if (mobBtn) mobBtn.classList.add('hidden');
  if (report) { report.classList.remove('hidden'); report.classList.add('success-anim'); }

  const kpis         = computeKPIs(data);
  const pricing      = calculateAdPricing(data, kpis);
  const insightsList = generateInsights(data, kpis);
  const fitScore     = computeCampaignFitScore(kpis);
  const conf         = computeConfidenceScore(data, kpis);

  // ROI Score
  let roiScore = 50;
  if (kpis.avgEngRate >= 5)    roiScore += 25;
  else if (kpis.avgEngRate >= 3) roiScore += 10;
  if (kpis.followerGrowth > 5) roiScore += 10;
  if (kpis.revCV < 20)         roiScore += 10;
  if (insightsList.some(i => ['burnout', 'fatigue', 'structural-decline'].includes(i.id))) roiScore -= 15;
  if (insightsList.some(i => i.id === 'artificial-growth')) roiScore -= 10;
  roiScore = Math.min(100, Math.max(0, roiScore));
  const roiLabel = roiScore >= 75 ? 'Excellent ROI Potential' : roiScore >= 50 ? 'Moderate ROI Potential' : 'Review Before Investing';

  const highRiskInsights = insightsList.filter(i => i.severity === 'high' || i.severity === 'medium');

  // Engagement score for breakdown display
  const engPts = kpis.avgEngRate >= 8 ? 35 : kpis.avgEngRate >= 5 ? 28 : kpis.avgEngRate >= 3 ? 18 : kpis.avgEngRate >= 1 ? 8 : 0;
  const folPts = fol => fol >= 1_000_000 ? 25 : fol >= 100_000 ? 22 : fol >= 10_000 ? 18 : fol >= 1_000 ? 12 : 5;
  const groPts = kpis.followerGrowth > 20 ? 20 : kpis.followerGrowth > 10 ? 15 : kpis.followerGrowth > 5 ? 10 : kpis.followerGrowth > 0 ? 5 : 0;
  const stbPts = kpis.revenues.length === 0 ? 10 : kpis.revCV < 15 ? 20 : kpis.revCV < 25 ? 14 : kpis.revCV < 35 ? 8 : 2;

  const emailTemplate =
`Subject: Partnership Inquiry — Brand Collaboration

Hi [Creator Name],

I evaluated your analytics profile and I'm interested in exploring a potential collaboration. Your engagement rate of ${kpis.avgEngRate.toFixed(1)}% (${pricing.tier}) and follower growth of ${kpis.followerGrowth > 0 ? '+' : ''}${kpis.followerGrowth.toFixed(1)}% stood out.

Based on our evaluation, we'd like to propose:
• Sponsored post: $${pricing.minPrice}–$${pricing.idealPrice} per post
• Content series (3 posts): $${Math.round(pricing.idealPrice * 2.6)}
• Long-term retainer (monthly): $${Math.round(pricing.idealPrice * 3.5)}

Please reply to discuss details, deliverables, and timelines.

Best regards,
[Your Name / Brand]`;

  if (report) {
    report.innerHTML = `
      <div class="brand-report-header">
        <div>
          <h2 style="font-size:1.4rem;font-weight:800;">Creator Evaluation Report</h2>
          <p style="font-size:0.85rem;color:var(--text-secondary);">Generated from uploaded CSV · ${data.length} data periods analyzed</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="window.print()">Print Report</button>
          <button class="btn btn-ghost btn-sm" onclick="resetBrandDashboard()">New Evaluation</button>
        </div>
      </div>

      <!-- Three Score Cards -->
      <div class="brand-scores-row">
        <div class="brand-score-card">
          <div class="brand-score-label">ROI Score</div>
          <div class="brand-score-value grad-text">${roiScore}/100</div>
          <div class="brand-score-sub">${roiLabel}</div>
        </div>
        <div class="brand-score-card">
          <div class="brand-score-label">Campaign Fit Score</div>
          <div class="brand-score-value" style="color:${fitScore.color};">${fitScore.score}/100</div>
          <div class="brand-score-sub" style="color:${fitScore.color};">${fitScore.label}</div>
        </div>
        <div class="brand-score-card">
          <div class="brand-score-label">Data Confidence</div>
          <div class="brand-score-value" style="color:${conf.color};">${conf.score}%</div>
          <div class="brand-score-sub">${conf.label} · ${data.length} periods</div>
        </div>
      </div>

      <!-- Creator Tier Badge -->
      <div style="margin-bottom:24px;">
        <span class="brand-tier-badge">${fitScore.creatorTier}</span>
      </div>

      <!-- Report Grid -->
      <div class="brand-report-grid">
        <!-- Engagement Analysis -->
        <div class="brand-report-card">
          <div class="settings-card-title">Engagement Analysis</div>
          <div class="brand-metric-row"><span class="brand-metric-label">Avg. Engagement Rate</span><span class="brand-metric-value" style="color:var(--accent-blue)">${kpis.avgEngRate.toFixed(2)}%</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Engagement Tier</span><span class="brand-metric-value">${pricing.tier}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Follower Growth</span><span class="brand-metric-value" style="color:${kpis.followerGrowth > 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${kpis.followerGrowth > 0 ? '+' : ''}${kpis.followerGrowth.toFixed(1)}%</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Total Followers</span><span class="brand-metric-value">${formatNum(kpis.totalFollowers)}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Revenue Stability</span><span class="brand-metric-value" style="color:${kpis.revCV > 30 ? 'var(--accent-red)' : kpis.revCV > 20 ? 'var(--accent-orange)' : 'var(--accent-green)'};">${kpis.revCV > 30 ? i18n.t('kpi.high.instability') : kpis.revCV > 20 ? i18n.t('kpi.moderate.instability') : i18n.t('kpi.stable')}</span></div>
        </div>

        <!-- Pricing Recommendation -->
        <div class="brand-report-card">
          <div class="settings-card-title">Pricing Recommendation</div>
          <div class="brand-metric-row"><span class="brand-metric-label">Classification</span><span class="brand-metric-value">${pricing.classification}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Min Budget / Post</span><span class="brand-metric-value">$${formatNum(pricing.minPrice)}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Ideal Budget / Post</span><span class="brand-metric-value" style="color:var(--accent-purple);">$${formatNum(pricing.idealPrice)}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Premium Budget / Post</span><span class="brand-metric-value">$${formatNum(pricing.premiumPrice)}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Engagement ×</span><span class="brand-metric-value">${pricing.engMultiplier}×</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Growth ×</span><span class="brand-metric-value">${pricing.growthFactor}×</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Stability ×</span><span class="brand-metric-value">${pricing.stabilityFactor}×</span></div>
        </div>

        <!-- Risk Assessment -->
        <div class="brand-report-card">
          <div class="settings-card-title">Risk Assessment</div>
          ${highRiskInsights.length === 0
            ? '<div class="brand-metric-row" style="color:var(--accent-green);">No significant risks detected in this dataset.</div>'
            : highRiskInsights.map(ins => {
                const title = i18n.t(ins.titleKey);
                const body  = i18n.t(ins.bodyKey, ins.bodyVars);
                const icon  = ins.severity === 'high' ? '🔴' : '🟡';
                return `<div class="brand-risk-item"><div class="brand-risk-title">${icon} ${title}</div><div class="brand-risk-body">${body}</div></div>`;
              }).join('')}
        </div>

        <!-- Campaign Fit Breakdown -->
        <div class="brand-report-card">
          <div class="settings-card-title">Campaign Fit Breakdown</div>
          <div class="brand-metric-row"><span class="brand-metric-label">Creator Tier</span><span class="brand-metric-value">${fitScore.creatorTier}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Overall Fit Score</span><span class="brand-metric-value" style="color:${fitScore.color};">${fitScore.score}/100 — ${fitScore.label}</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Engagement Score</span><span class="brand-metric-value">${engPts}/35 pts</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Audience Size Score</span><span class="brand-metric-value">${folPts(kpis.totalFollowers)}/25 pts</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Growth Score</span><span class="brand-metric-value">${groPts}/20 pts</span></div>
          <div class="brand-metric-row"><span class="brand-metric-label">Stability Score</span><span class="brand-metric-value">${stbPts}/20 pts${kpis.revenues.length === 0 ? ' (no data)' : ''}</span></div>
        </div>
      </div>

      <!-- Email Template -->
      <div class="card" style="margin-top:4px;">
        <div class="settings-card-title">Outreach Email Template</div>
        <textarea class="form-input" rows="12" id="emailTemplateArea" style="font-family:monospace;font-size:0.8rem;line-height:1.65;resize:vertical;">${emailTemplate}</textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="copyEmailTemplate()">Copy to Clipboard</button>
      </div>

      <div class="pricing-disclaimer" style="margin-top:16px;">
        ${i18n.t('pricing.disclaimer.text')} ${i18n.t('plan.confidence')}: ${conf.score}% (${conf.label}).
      </div>`;
  }
}

function copyEmailTemplate() {
  const area = document.getElementById('emailTemplateArea');
  if (!area) return;
  navigator.clipboard.writeText(area.value).then(() => showToast(i18n.t('toast.copied'), 'success'));
}

window.resetBrandDashboard = function() {
  const zone   = document.getElementById('brandUploadZone');
  const report = document.getElementById('brandReport');
  const prompt = document.getElementById('brandUploadPrompt');
  const mobBtn = document.querySelector('label[for="brandCsvMobile"]');
  if (zone)   zone.classList.remove('hidden');
  if (mobBtn) mobBtn.classList.remove('hidden');
  if (report) { report.classList.add('hidden'); report.innerHTML = ''; }
  if (prompt) prompt.classList.remove('hidden');
  const fi = document.getElementById('brandCsvFile');
  if (fi) fi.value = '';
};

/* ============================================================
   SETTINGS
   ============================================================ */
function initSettings() {}

function renderSettings() {
  const user = auth.currentUser;
  if (!user) return;

  const nameEl  = document.getElementById('settingName');
  const emailEl = document.getElementById('settingEmail');
  if (nameEl)  nameEl.value  = user.displayName || '';
  if (emailEl) emailEl.value = user.email       || '';

  db.ref('users/' + user.uid).once('value').then(snap => {
    const data = snap.val() || {};
    const s    = data.settings || {};

    // Notifications
    const ne = document.getElementById('notifEmail');
    const nm = document.getElementById('notifMarketing');
    if (ne) ne.checked = !!s.emailNotifications;
    if (nm) nm.checked = !!s.marketingEmails;

    // Content types — show card only for creators
    const ctCard = document.getElementById('contentTypeSettingsCard');
    if (ctCard) {
      if (data.role === 'brand') {
        ctCard.style.display = 'none';
      } else {
        ctCard.style.display = '';
        const saved = Array.isArray(data.contentTypes) ? data.contentTypes : [];
        document.querySelectorAll('#settingsContentChips .content-chip').forEach(chip => {
          chip.classList.toggle('selected', saved.includes(chip.dataset.type));
        });
      }
    }
  });

  // Content type chips toggle
  document.querySelectorAll('#settingsContentChips .content-chip').forEach(chip => {
    if (!chip._bound) {
      chip._bound = true;
      chip.addEventListener('click', () => chip.classList.toggle('selected'));
    }
  });

  // Save content types button
  const saveCtBtn = document.getElementById('saveContentTypesBtn');
  if (saveCtBtn && !saveCtBtn._bound) {
    saveCtBtn._bound = true;
    saveCtBtn.addEventListener('click', async () => {
      const types = [...document.querySelectorAll('#settingsContentChips .content-chip.selected')]
        .map(c => c.dataset.type);
      await db.ref('users/' + user.uid).update({ contentTypes: types });
      showToast(i18n.t('toast.content.type.saved'), 'success');
    });
  }

  const form = document.getElementById('settingsForm');
  if (form && !form._bound) {
    form._bound = true;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const newName = document.getElementById('settingName').value.trim();
      if (newName && newName !== user.displayName) {
        await user.updateProfile({ displayName: newName });
        await db.ref('users/' + user.uid).update({ name: newName });
        const sn = document.getElementById('sidebarName');
        if (sn) sn.textContent = newName;
        const av = document.getElementById('sidebarAvatar');
        if (av) av.textContent = newName[0].toUpperCase();
        showToast(i18n.t('toast.profile.saved'), 'success');
      }
    });
  }

  const resetBtn = document.getElementById('resetPasswordBtn');
  if (resetBtn && !resetBtn._bound) {
    resetBtn._bound = true;
    resetBtn.addEventListener('click', async () => {
      await auth.sendPasswordResetEmail(user.email);
      showToast(i18n.t('toast.password.sent'), 'success');
    });
  }

  ['notifEmail', 'notifMarketing'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._bound) {
      el._bound = true;
      el.addEventListener('change', async () => {
        const field    = id === 'notifEmail' ? 'emailNotifications' : 'marketingEmails';
        await db.ref('users/' + user.uid + '/settings').update({ [field]: el.checked });
        const smtpMsg  = document.getElementById('smtpMessage');
        if (id === 'notifEmail' && smtpMsg) smtpMsg.classList.toggle('hidden', !el.checked);
      });
    }
  });
}

/* ============================================================
   COLLABORATION REQUESTS (creator inbox)
   ============================================================ */
function renderRequests() {
  const user = auth.currentUser;
  if (!user) return;
  const el = document.getElementById('requestsList');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${i18n.t('loading')}</div>`;

  db.ref(`collabRequests/${user.uid}`).once('value').then(snap => {
    const requests = [];
    snap.forEach(child => { requests.push({ id: child.key, ...child.val() }); });
    requests.sort((a, b) => b.createdAt - a.createdAt);

    // Update sidebar badge
    const pending = requests.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('requestsBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }

    if (requests.length === 0) {
      el.innerHTML = `
        <div class="empty-section">
          <div class="empty-section-icon">📬</div>
          <div class="empty-section-title">${i18n.t('requests.empty')}</div>
          <p class="empty-section-sub">${i18n.t('requests.empty.sub')}</p>
        </div>`;
      return;
    }

    el.innerHTML = requests.map(r => {
      const isPending  = r.status === 'pending';
      const isAccepted = r.status === 'accepted';
      const statusLabel = isAccepted ? i18n.t('req.status.accepted') : isPending ? i18n.t('req.status.pending') : i18n.t('req.status.declined');
      const statusClass = isAccepted ? 'req-status-accepted' : isPending ? 'req-status-pending' : 'req-status-declined';
      const date = new Date(r.createdAt).toLocaleDateString();
      return `
        <div class="request-card card">
          <div class="request-card-header">
            <div>
              <div class="request-brand">${_escapeHtml(r.brandName)}</div>
              <div class="request-campaign">${_escapeHtml(r.campaignName)}</div>
            </div>
            <span class="request-status-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="request-meta">
            <span>🎬 ${_escapeHtml(r.format)}</span>
            <span>💰 ${_escapeHtml(r.budget)}</span>
            <span>📅 ${_escapeHtml(r.timeline)}</span>
          </div>
          <div class="request-keymsg">"${_escapeHtml(r.keyMessage)}"</div>
          ${r.requirements ? `<div class="request-req">📝 ${_escapeHtml(r.requirements)}</div>` : ''}
          <div class="request-date">${date}</div>
          ${isPending ? `
          <div class="request-actions">
            <button class="btn btn-primary btn-sm" onclick="respondToRequest('${r.id}','accepted')">${i18n.t('req.accept')}</button>
            <button class="btn btn-ghost btn-sm"    onclick="respondToRequest('${r.id}','declined')">${i18n.t('req.decline')}</button>
          </div>` : ''}
        </div>`;
    }).join('');
  });
}

window.respondToRequest = async function(requestId, status) {
  const user = auth.currentUser;
  if (!user) return;

  // Read request data first (need brandEmail, brandUID, campaign info)
  const snap = await db.ref(`collabRequests/${user.uid}/${requestId}`).once('value');
  const req  = snap.val();
  if (!req) return;

  // Update status in both Firebase paths atomically
  const updates = {};
  updates[`collabRequests/${user.uid}/${requestId}/status`] = status;
  if (req.brandUID) updates[`brandRequests/${req.brandUID}/${requestId}/status`] = status;
  await db.ref().update(updates);

  // Email the brand if we have their email
  if (req.brandEmail && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
    const creatorName = user.displayName || i18n.t('creator.default.name') || 'The Creator';
    const isAccepted  = status === 'accepted';
    const emailBody   = [
      `Hi ${req.brandName},`,
      '',
      `${creatorName} has ${isAccepted ? 'accepted' : 'declined'} your collaboration request on Smart Content Manager.`,
      '',
      `Campaign: ${req.campaignName}`,
      `Format: ${req.format}`,
      `Budget: ${req.budget}`,
      '',
      isAccepted
        ? `Great news! ${creatorName} is interested. You can now coordinate the next steps directly.`
        : `Don't be discouraged — there are many other creators on the platform who may be a great fit.`,
    ].join('\n');

    try {
      emailjs.init(EMAILJS_PUBLIC_KEY);
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email:  req.brandEmail,
        to_name:   req.brandName,
        from_name: 'Smart Content Manager',
        message:   emailBody,
      });
    } catch (_) { /* email failure is non-blocking */ }
  }

  showToast(status === 'accepted' ? i18n.t('req.accepted.toast') : i18n.t('req.declined.toast'), 'success');
  renderRequests();
};

/* -- Load pending badge on dashboard init -- */
function loadRequestsBadge() {
  const user = auth.currentUser;
  if (!user) return;
  db.ref(`collabRequests/${user.uid}`).on('value', snap => {
    let pending = 0;
    snap.forEach(child => { if (child.val().status === 'pending') pending++; });
    const badge = document.getElementById('requestsBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }
  });
}

/* ============================================================
   BRAND SENT REQUESTS VIEW
   ============================================================ */
function renderBrandRequests() {
  const user = auth.currentUser;
  if (!user) return;
  const el = document.getElementById('brandRequestsList');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${i18n.t('loading')}</div>`;

  db.ref(`brandRequests/${user.uid}`).once('value').then(snap => {
    const requests = [];
    snap.forEach(child => { requests.push({ id: child.key, ...child.val() }); });
    requests.sort((a, b) => b.createdAt - a.createdAt);

    // Update badge
    const pending = requests.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('brandPendingBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }

    if (requests.length === 0) {
      el.innerHTML = `
        <div class="empty-section">
          <div class="empty-section-icon">📤</div>
          <div class="empty-section-title">${i18n.t('brand.requests.empty')}</div>
          <p class="empty-section-sub">${i18n.t('brand.requests.empty.sub')}</p>
        </div>`;
      return;
    }

    el.innerHTML = requests.map(r => {
      const isAccepted = r.status === 'accepted';
      const isPending  = r.status === 'pending';
      const statusLabel = isAccepted ? i18n.t('req.status.accepted') : isPending ? i18n.t('req.status.pending') : i18n.t('req.status.declined');
      const statusClass = isAccepted ? 'req-status-accepted' : isPending ? 'req-status-pending' : 'req-status-declined';
      const date = new Date(r.createdAt).toLocaleDateString();
      return `
        <div class="request-card card">
          <div class="request-card-header">
            <div>
              <div class="request-brand">${_escapeHtml(r.creatorName)}</div>
              <div class="request-campaign">${_escapeHtml(r.campaignName)}</div>
            </div>
            <span class="request-status-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="request-meta">
            <span>🎬 ${_escapeHtml(r.format)}</span>
            <span>💰 ${_escapeHtml(r.budget)}</span>
            <span>📅 ${_escapeHtml(r.timeline)}</span>
          </div>
          <div class="request-keymsg">"${_escapeHtml(r.keyMessage)}"</div>
          ${r.requirements ? `<div class="request-req">📝 ${_escapeHtml(r.requirements)}</div>` : ''}
          <div class="request-date">${date}</div>
        </div>`;
    }).join('');
  });
}

function loadBrandRequestsBadge() {
  const user = auth.currentUser;
  if (!user) return;
  db.ref(`brandRequests/${user.uid}`).on('value', snap => {
    let pending = 0;
    snap.forEach(child => { if (child.val().status === 'pending') pending++; });
    const badge = document.getElementById('brandPendingBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }
  });
}

/* ============================================================
   SAMPLE CSV DOWNLOAD
   ============================================================ */
function downloadSampleCSV() {
  const rows = [
    'date,platform,followers,views,likes,comments,shares,posts,revenue',
    '2024-01-01,instagram,10000,25000,800,120,200,4,1200',
    '2024-02-01,instagram,10800,28000,900,130,220,5,1350',
    '2024-03-01,instagram,11600,26000,840,110,190,6,1100',
    '2024-04-01,instagram,12500,30000,870,105,200,7,900',
    '2024-05-01,instagram,13200,27000,790,90,180,8,850',
    '2024-06-01,instagram,14000,31000,760,85,175,9,1500',
    '2024-07-01,instagram,14800,29000,720,78,160,10,1800',
    '2024-08-01,instagram,15200,27500,680,70,150,10,700',
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'sample_analytics.csv' });
  a.click(); URL.revokeObjectURL(url);
}

/* ============================================================
   LOCAL RULE-BASED CHATBOT
   No API needed — uses already-computed KPIs and insights.
   ============================================================ */

let _chatHistory = []; // { role: 'user'|'model', parts: [{ text }] }
let _lastTopic   = null; // tracks last discussed topic for follow-up handling

function initChatResize() {
  const panel  = document.getElementById('chatPanel');
  const handle = document.getElementById('chatResizeHandle');
  if (!handle || !panel) return;

  let startX, startY, startW, startH;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
  });

  function onResize(e) {
    const isRTL = document.body.getAttribute('dir') === 'rtl';
    const dx = isRTL ? e.clientX - startX : startX - e.clientX;
    const dy = startY - e.clientY;
    const newW = Math.min(Math.max(startW + dx, 390), 700);
    const newH = Math.min(Math.max(startH + dy, 400), 780);
    panel.style.width  = newW + 'px';
    panel.style.height = newH + 'px';
    const msgs = document.getElementById('chatMessages');
    if (msgs) { msgs.style.maxHeight = 'none'; msgs.style.minHeight = '0'; }
  }

  function stopResize() {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
  }
}

function initChatbot() {
  const btn   = document.getElementById('chatFab');
  const panel = document.getElementById('chatPanel');
  const close = document.getElementById('chatClose');
  const form  = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  if (!btn) return;

  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
    const bubble = document.getElementById('chatFabBubble');
    if (panel.classList.contains('open')) {
      if (bubble) bubble.style.display = 'none';
      const msgs = document.getElementById('chatMessages');
      if (msgs && msgs.children.length === 0) {
        _appendChatMsg('bot', i18n.t('chat.welcome'));
        _appendChatSuggestions();
      }
      setTimeout(() => input.focus(), 50);
    } else {
      if (bubble) bubble.style.display = '';
    }
  });

  if (close) close.addEventListener('click', () => panel.classList.remove('open'));

  initChatResize();

  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await _sendChat(text);
  });
}


async function _sendChat(text) {
  const chips = document.getElementById('chatSuggestions');
  if (chips) chips.remove();
  _appendChatMsg('user', text);

  // Use Claude streaming if API key is set and data is loaded
  if (!_isLocal && csvData.length > 0) {
    const msgEl = _appendChatMsg('bot', '▋');
    try {
      await _streamClaudeChat(text, msgEl);
    } catch (_) {
      // API failed — fall back to local logic
      const reply = _localChat(text);
      if (msgEl) msgEl.textContent = reply;
      _chatHistory.push({ role: 'user',  parts: [{ text }] });
      _chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    }
    return;
  }

  // Local fallback (no API key or no CSV)
  _appendChatTyping();
  await new Promise(r => setTimeout(r, 350));
  _removeTyping();
  const reply = _localChat(text);
  _chatHistory.push({ role: 'user',  parts: [{ text }] });
  _chatHistory.push({ role: 'model', parts: [{ text: reply }] });
  _appendChatMsg('bot', reply);
}

/** Streams a Claude response into msgEl character-by-character. */
async function _streamClaudeChat(userText, msgEl) {
  const data    = getFilteredData();
  const kpis    = computeKPIs(data);
  const context = buildCreatorContext(data, kpis);

  const systemPrompt = `You are a friendly creator coach inside Smart Content Manager. You have the creator's live data below — use it to give warm, specific, and helpful answers. Keep replies short (2–4 sentences), reference their actual numbers, and always end with encouragement or a clear next step. Avoid jargon and write like a supportive friend who knows data.

CREATOR'S LIVE DATA:
${context}`;

  const messages = [
    ..._chatHistory.slice(-6).map(m => ({
      role:    m.role === 'model' ? 'assistant' : 'user',
      content: m.parts[0].text,
    })),
    { role: 'user', content: userText },
  ];

  const res = await fetch(_claudeURL, {
    method: 'POST',
    headers: _claudeHeaders,
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      stream:     true,
      system:     systemPrompt,
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';
  const msgsList = document.getElementById('chatMessages');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw);
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          fullText += evt.delta.text;
          if (msgEl) {
            msgEl.textContent = fullText;
            if (msgsList) msgsList.scrollTop = msgsList.scrollHeight;
          }
        }
      } catch (_) {}
    }
  }

  // Remove trailing cursor; show fallback if stream returned nothing
  if (msgEl) {
    if (!fullText) {
      msgEl.textContent = i18n.t('chat.error') || 'Sorry, I could not get a response. Please try again.';
    } else if (msgEl.textContent.endsWith('▋')) {
      msgEl.textContent = fullText;
    }
  }

  if (fullText) {
    _chatHistory.push({ role: 'user',  parts: [{ text: userText }] });
    _chatHistory.push({ role: 'model', parts: [{ text: fullText }] });
  }
}

function _localChat(text) {
  const isAr = i18n.current === 'ar';
  const q    = text.toLowerCase().trim();

  if (!csvData || csvData.length === 0) {
    return isAr
      ? 'يرجى رفع ملف CSV أولاً للحصول على إجابات مبنية على بياناتك.'
      : 'Please upload a CSV file first to get data-driven answers.';
  }

  const data     = getFilteredData();
  const kpis     = computeKPIs(data);
  const insights = generateInsights(data, kpis);
  const hs       = computeHealthScore(data, kpis);

  // Follow-up detection — "explain it", "tell me more", "why", etc.
  const isFollowUp = _lastTopic && /^(explain it|tell me more|more|why|how|what does|elaborate|اشرح أكثر|لماذا|كيف|المزيد|أخبرني أكثر|وضح)/.test(q);
  if (isFollowUp) return _deepDive(_lastTopic, { isAr, data, kpis, insights, hs });

  // Greeting
  if (/^(hi|hello|hey|مرحب|أهل|السلام)/.test(q)) {
    _lastTopic = null;
    return isAr
      ? 'مرحباً! يمكنك سؤالي عن التفاعل، المتابعين، الإيرادات، درجة الصحة، أو قل "اشرح الرؤى".'
      : 'Hello! Ask me about engagement, followers, revenue, health score, or try "explain insights".';
  }

  // Help
  if (/help|مساعد|can you|what can|ماذا تستطيع|بماذا/.test(q)) {
    _lastTopic = null;
    return isAr
      ? 'يمكنني مساعدتك في:\n• اشرح الرؤى\n• ماذا أفعل؟\n• معدل التفاعل\n• المتابعين\n• الإيرادات\n• درجة الصحة\n• المنشورات'
      : 'I can help with:\n• Explain insights\n• What should I do?\n• Engagement rate\n• Followers\n• Revenue\n• Health score\n• Posts';
  }

  // Recommendations / action plan
  if (/what should|recommend|advice|action|نصيح|ماذا أفعل|improve|تحسين/.test(q)) {
    _lastTopic = 'recommendations';
    if (insights.length === 0)
      return isAr ? 'أداؤك جيد! لا توجد مشاكل تحتاج معالجة حالياً.' : 'Your performance looks good! No issues need immediate attention.';
    const sorted = [...insights].sort((a, b) =>
      ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
    let msg = isAr ? 'أولويات التحسين بناءً على بياناتك:\n\n' : 'Improvement priorities based on your data:\n\n';
    sorted.forEach((ins, i) => {
      msg += `${i + 1}. ${i18n.t(ins.titleKey)}\n   → ${i18n.t(ins.recKey)}\n\n`;
    });
    msg += isAr ? 'اسأل "اشرح أكثر" لفهم كل مشكلة بعمق.' : 'Ask "explain it" to understand each issue in depth.';
    return msg.trim();
  }

  // Insights / analysis
  if (/insight|رؤ|explain|تفسير|analysis|تحليل|what.*wrong|مشكل/.test(q)) {
    _lastTopic = 'insights';
    if (insights.length === 0)
      return isAr ? 'بياناتك تبدو في حالة جيدة — لا توجد رؤى سلبية حالياً.' : 'Your data looks healthy — no critical issues found.';
    const high = insights.filter(i => i.severity === 'high').length;
    let msg = isAr
      ? `وجدت ${insights.length} رؤية${high ? ` (${high} خطيرة تحتاج اهتماماً فورياً)` : ''}:\n\n`
      : `Found ${insights.length} insight${insights.length > 1 ? 's' : ''}${high ? ` (${high} high severity)` : ''}:\n\n`;
    insights.forEach(ins => {
      const icon = ins.severity === 'high' ? '🔴' : ins.severity === 'medium' ? '🟡' : '🟢';
      msg += `${icon} ${i18n.t(ins.titleKey)}: ${i18n.t(ins.bodyKey, ins.bodyVars)}\n`;
    });
    msg += isAr
      ? '\nاسأل "ماذا أفعل؟" للتوصيات، أو "اشرح أكثر" لمزيد من التفاصيل.'
      : '\nAsk "what should I do?" for recommendations, or "explain it" for more detail.';
    return msg;
  }

  // Health score
  if (/health|صح|score|درجة/.test(q)) {
    _lastTopic = 'health';
    const status = i18n.t(hs.statusKey);
    const worst  = Object.entries(hs.components).sort((a, b) => a[1] - b[1])[0];
    const wLabel = { eng: isAr ? 'التفاعل' : 'engagement', growth: isAr ? 'نمو المتابعين' : 'follower growth', revenue: isAr ? 'استقرار الإيرادات' : 'revenue stability', posting: isAr ? 'اتساق النشر' : 'posting consistency' }[worst[0]];
    return isAr
      ? `درجة صحة حسابك: ${hs.score}/100 (${status}).\n\n• التفاعل: ${hs.components.eng}/100\n• نمو المتابعين: ${hs.components.growth}/100\n• استقرار الإيرادات: ${hs.components.revenue}/100\n• اتساق النشر: ${hs.components.posting}/100\n\nأضعف نقطة: ${wLabel} (${worst[1]}/100). اسأل "اشرح أكثر" لنصائح التحسين.`
      : `Health score: ${hs.score}/100 (${status}).\n\n• Engagement: ${hs.components.eng}/100\n• Follower growth: ${hs.components.growth}/100\n• Revenue stability: ${hs.components.revenue}/100\n• Posting consistency: ${hs.components.posting}/100\n\nWeakest area: ${wLabel} (${worst[1]}/100). Ask "explain it" for improvement tips.`;
  }

  // Engagement
  if (/engag|تفاعل/.test(q)) {
    _lastTopic = 'engagement';
    const avg    = kpis.avgEngRate;
    const qual   = avg >= 5 ? (isAr ? 'ممتاز' : 'excellent') : avg >= 3 ? (isAr ? 'جيد' : 'good') : (isAr ? 'يحتاج تحسين' : 'needs improvement');
    const engIns = insights.find(i => ['structural-decline', 'oversaturation', 'eng-recovery'].includes(i.id));
    let msg = isAr
      ? `معدل التفاعل: ${avg}% (${qual}).${avg < 3 ? ' أقل من المتوسط الصناعي ~3%.' : avg >= 5 ? ' فوق المتوسط الصناعي.' : ''}`
      : `Engagement rate: ${avg}% (${qual}).${avg < 3 ? ' Below the ~3% industry average.' : avg >= 5 ? ' Above industry average.' : ''}`;
    if (engIns) msg += '\n\n' + i18n.t(engIns.bodyKey, engIns.bodyVars) + '\n→ ' + i18n.t(engIns.recKey);
    else        msg += isAr ? '\n\nاسأل "اشرح أكثر" لمعرفة كيفية تحسين تفاعلك.' : '\n\nAsk "explain it" for tips on improving engagement.';
    return msg;
  }

  // Followers
  if (/follower|متابع/.test(q)) {
    _lastTopic = 'followers';
    const g      = kpis.followerGrowth;
    const artIns = insights.find(i => i.id === 'artificial-growth');
    let msg = isAr
      ? `إجمالي المتابعين: ${formatNum(kpis.totalFollowers)}.\nنسبة النمو: ${g > 0 ? '+' : ''}${g}% خلال الفترة.`
      : `Total followers: ${formatNum(kpis.totalFollowers)}.\nGrowth rate: ${g > 0 ? '+' : ''}${g}% over the data period.`;
    if (artIns) msg += '\n\n' + (isAr ? 'تحذير: ' : 'Warning: ') + i18n.t(artIns.bodyKey, artIns.bodyVars) + '\n→ ' + i18n.t(artIns.recKey);
    else        msg += g > 10 ? (isAr ? '\n\nنمو ممتاز!' : '\n\nExcellent growth!') : g < 0 ? (isAr ? '\n\nتراجع يحتاج اهتماماً. اسأل "اشرح أكثر".' : '\n\nDeclining — ask "explain it" for next steps.') : (isAr ? '\n\nنمو معتدل. اسأل "اشرح أكثر" لنصائح التسريع.' : '\n\nModerate growth. Ask "explain it" to accelerate it.');
    return msg;
  }

  // Revenue
  if (/revenue|إيراد|عائد|money|ربح/.test(q)) {
    _lastTopic = 'revenue';
    const vol    = kpis.revCV;
    const stab   = vol < 20 ? (isAr ? 'مستقرة' : 'stable') : vol < 40 ? (isAr ? 'متذبذبة' : 'volatile') : (isAr ? 'غير مستقرة' : 'highly volatile');
    const revIns = insights.find(i => i.id === 'revenue' || i.id === 'rev-dependency');
    let msg = isAr
      ? `متوسط الإيرادات الشهرية: $${formatNum(Math.round(kpis.avgMonthlyRevenue))}.\nتقلب الإيرادات: ${vol}% (${stab}).`
      : `Avg monthly revenue: $${formatNum(Math.round(kpis.avgMonthlyRevenue))}.\nRevenue volatility: ${vol}% (${stab}).`;
    if (revIns) msg += '\n\n' + i18n.t(revIns.bodyKey, revIns.bodyVars) + '\n→ ' + i18n.t(revIns.recKey);
    else        msg += vol < 20 ? (isAr ? '\n\nإيراداتك مستقرة — مؤشر ممتاز.' : '\n\nRevenue is stable — great sign of recurring partnerships.') : (isAr ? '\n\nاسأل "اشرح أكثر" لاستراتيجيات تثبيت الإيراد.' : '\n\nAsk "explain it" for revenue stabilization strategies.');
    return msg;
  }

  // Posts / content
  if (/post|نشر|منشور|content|محتوى/.test(q)) {
    _lastTopic = 'posts';
    const avg    = round(kpis.totalPosts / data.length, 1);
    const satIns = insights.find(i => i.id === 'oversaturation');
    let msg = isAr
      ? `إجمالي المنشورات: ${kpis.totalPosts}. متوسط ${avg} لكل فترة.`
      : `Total posts: ${kpis.totalPosts}. Average ${avg} per period.`;
    if (satIns) msg += '\n\n' + i18n.t(satIns.bodyKey, satIns.bodyVars) + '\n→ ' + i18n.t(satIns.recKey);
    else if (avg > 15) msg += isAr ? '\n\nمعدل النشر مرتفع جداً — قد يؤثر سلباً على التفاعل.' : '\n\nVery high posting frequency — may hurt engagement.';
    else if (avg < 3)  msg += isAr ? '\n\nمعدل النشر منخفض. جرب الزيادة لتحسين الوصول.' : '\n\nLow frequency. Try posting more to improve reach.';
    else               msg += isAr ? '\n\nمعدل النشر متوازن.' : '\n\nPosting frequency looks balanced.';
    return msg;
  }

  // Default fallback
  _lastTopic = null;
  return isAr
    ? 'جرب سؤالي عن: "اشرح الرؤى"، "ماذا أفعل؟"، "التفاعل"، "المتابعين"، أو "الإيرادات".'
    : 'Try asking: "explain insights", "what should I do?", "engagement", "followers", or "revenue".';
}

function _deepDive(topic, { isAr, data, kpis, insights, hs }) {
  const tips = {
    eng:     isAr ? 'الرد على التعليقات، طرح أسئلة في المحتوى، واستخدام الاستطلاعات والتحديات.'
                  : 'Reply to comments, ask questions in your content, and use polls or challenges.',
    growth:  isAr ? 'التعاون مع منشئين آخرين، تحسين استخدام الهاشتاقات، والتوافق مع خوارزمية المنصة.'
                  : 'Collaborate with other creators, improve hashtag usage, and align with platform algorithms.',
    revenue: isAr ? 'تنوّع مصادر الدخل واسعَ للحصول على عقود شهرية بدلاً من صفقات لمرة واحدة.'
                  : 'Diversify income sources and negotiate monthly retainers instead of one-off deals.',
    posting: isAr ? 'ضع جدول نشر أسبوعي ثابت واحتفظ بمخزون محتوى جاهز مسبقاً.'
                  : 'Set a fixed weekly posting schedule and maintain a content buffer prepared in advance.',
  };

  switch (topic) {
    case 'insights': {
      // Drill down → show recommendations
      if (insights.length === 0)
        return isAr ? 'لا توجد مشاكل للتوصية بحلول لها.' : 'No issues to recommend solutions for.';
      const sorted = [...insights].sort((a, b) =>
        ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
      let msg = isAr ? 'إليك ما يجب فعله لكل رؤية:\n\n' : "Here's what to do for each insight:\n\n";
      sorted.forEach((ins, i) => {
        msg += `${i + 1}. ${i18n.t(ins.titleKey)}\n   ${i18n.t(ins.bodyKey, ins.bodyVars)}\n   → ${i18n.t(ins.recKey)}\n\n`;
      });
      _lastTopic = 'recommendations';
      return msg.trim();
    }

    case 'recommendations': {
      // Drill back → show insight details
      if (insights.length === 0) return isAr ? 'لا توجد مشاكل.' : 'No issues found.';
      let msg = isAr ? 'تفاصيل المشاكل الموجودة:\n\n' : 'Details of the issues found:\n\n';
      insights.forEach(ins => {
        const icon = ins.severity === 'high' ? '🔴' : ins.severity === 'medium' ? '🟡' : '🟢';
        msg += `${icon} ${i18n.t(ins.titleKey)}\n${i18n.t(ins.bodyKey, ins.bodyVars)}\n\n`;
      });
      _lastTopic = 'insights';
      return msg.trim();
    }

    case 'health': {
      const worst = Object.entries(hs.components).sort((a, b) => a[1] - b[1]);
      let msg = isAr ? 'نصائح تحسين كل مكوّن:\n\n' : 'Tips to improve each component:\n\n';
      worst.forEach(([key, val]) => {
        const label = { eng: isAr ? 'التفاعل' : 'Engagement', growth: isAr ? 'نمو المتابعين' : 'Follower Growth', revenue: isAr ? 'الإيرادات' : 'Revenue', posting: isAr ? 'النشر' : 'Posting' }[key];
        msg += `${label} (${val}/100)\n→ ${tips[key]}\n\n`;
      });
      return msg.trim();
    }

    case 'engagement': {
      const avg    = kpis.avgEngRate;
      const engIns = insights.filter(i => ['structural-decline', 'oversaturation', 'eng-recovery'].includes(i.id));
      if (isAr) {
        let msg = `معيار معدل التفاعل:\n• أقل من 1%: ضعيف\n• 1-3%: متوسط\n• 3-6%: جيد\n• أكثر من 6%: ممتاز\n\nمعدلك الحالي: ${avg}%\n\n`;
        if (engIns.length) engIns.forEach(i => { msg += `${i18n.t(i.titleKey)}: ${i18n.t(i.recKey)}\n`; });
        else msg += tips.eng;
        return msg;
      } else {
        let msg = `Engagement rate benchmarks:\n• Below 1%: Poor\n• 1-3%: Average\n• 3-6%: Good\n• Above 6%: Excellent\n\nYour rate: ${avg}%\n\n`;
        if (engIns.length) engIns.forEach(i => { msg += `${i18n.t(i.titleKey)}: ${i18n.t(i.recKey)}\n`; });
        else msg += tips.eng;
        return msg;
      }
    }

    case 'followers': {
      const g      = kpis.followerGrowth;
      const artIns = insights.find(i => i.id === 'artificial-growth');
      if (isAr) {
        let msg = `معيار النمو الشهري الجيد: 2-10%، ممتاز: 10%+\nنموك: ${g}%\n\n`;
        if (artIns) msg += i18n.t(artIns.titleKey) + ': ' + i18n.t(artIns.recKey);
        else        msg += tips.growth;
        return msg;
      } else {
        let msg = `Monthly growth benchmarks: good = 2-10%, excellent = 10%+\nYour growth: ${g}%\n\n`;
        if (artIns) msg += i18n.t(artIns.titleKey) + ': ' + i18n.t(artIns.recKey);
        else        msg += tips.growth;
        return msg;
      }
    }

    case 'revenue': {
      const vol    = kpis.revCV;
      const revIns = insights.find(i => i.id === 'revenue' || i.id === 'rev-dependency');
      if (isAr) {
        let msg = `دليل تقلب الإيرادات:\n• CV أقل من 20%: مستقر\n• 20-40%: متذبذب\n• أكثر من 40%: غير مستقر\n\nتقلبك: ${vol}%\n\n`;
        if (revIns) msg += i18n.t(revIns.titleKey) + ': ' + i18n.t(revIns.recKey);
        else        msg += tips.revenue;
        return msg;
      } else {
        let msg = `Revenue volatility guide:\n• CV below 20%: Stable\n• 20-40%: Volatile\n• Above 40%: Unstable\n\nYour volatility: ${vol}%\n\n`;
        if (revIns) msg += i18n.t(revIns.titleKey) + ': ' + i18n.t(revIns.recKey);
        else        msg += tips.revenue;
        return msg;
      }
    }

    case 'posts': {
      const avg    = round(kpis.totalPosts / data.length, 1);
      const satIns = insights.find(i => i.id === 'oversaturation');
      if (isAr) {
        let msg = `المعيار الموصى به: 3-10 منشورات أسبوعياً حسب المنصة.\nمتوسطك: ${avg}\n\n`;
        if (satIns) msg += i18n.t(satIns.titleKey) + ': ' + i18n.t(satIns.recKey);
        else        msg += tips.posting;
        return msg;
      } else {
        let msg = `Recommended frequency: 3-10 posts/week depending on platform.\nYour average: ${avg}\n\n`;
        if (satIns) msg += i18n.t(satIns.titleKey) + ': ' + i18n.t(satIns.recKey);
        else        msg += tips.posting;
        return msg;
      }
    }

    default:
      return isAr ? 'اسألني بشكل أكثر تحديداً.' : 'Ask me something more specific.';
  }
}

const _BOT_AVATAR_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="11" rx="2.5"/><circle cx="9.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M9.5 15.5h5"/><path d="M12 7V4"/><circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none"/></svg>';

function _appendChatMsg(role, text) {
  const el = document.getElementById('chatMessages');
  if (!el) return null;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role}`;
  div.textContent = text;
  if (role === 'bot') {
    const row = document.createElement('div');
    row.className = 'chat-msg-row';
    const av = document.createElement('div');
    av.className = 'chat-msg-avatar-sm';
    av.innerHTML = _BOT_AVATAR_SVG;
    row.appendChild(av);
    row.appendChild(div);
    el.appendChild(row);
  } else {
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
  return div; // returned so streaming can update the element in-place
}

function _appendChatTyping() {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  const row = document.createElement('div');
  row.className = 'chat-msg-row';
  row.id = 'chatTypingRow';
  const av = document.createElement('div');
  av.className = 'chat-msg-avatar-sm';
  av.innerHTML = _BOT_AVATAR_SVG;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-bot chat-typing';
  div.id = 'chatTyping';
  div.innerHTML = '<span></span><span></span><span></span>';
  row.appendChild(av);
  row.appendChild(div);
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function _removeTyping() {
  const row = document.getElementById('chatTypingRow');
  if (row) { row.remove(); return; }
  const t = document.getElementById('chatTyping');
  if (t) t.remove();
}

function _appendChatSuggestions() {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  const chips = [
    i18n.t('chat.chip1') || "What's my best performer?",
    i18n.t('chat.chip2') || 'Show revenue trend',
    i18n.t('chat.chip3') || 'How am I doing?',
  ];
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-chips';
  wrapper.id = 'chatSuggestions';
  chips.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'chat-chip';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      wrapper.remove();
      _sendChat(label);
    });
    wrapper.appendChild(btn);
  });
  el.appendChild(wrapper);
  el.scrollTop = el.scrollHeight;
}

/* ============================================================
   INIT — fires after Firebase auth is confirmed
   ============================================================ */
auth.onAuthStateChanged(user => {
  if (user && window.location.pathname.includes('dashboard')) {
    initDashboard();
  }
});
