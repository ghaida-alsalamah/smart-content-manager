# Technical Details — Smart Content Manager (SCM)

---

## Architecture Overview

SCM is a **client-side single-page application** with two backend touchpoints:

- **Firebase** — authentication and real-time database
- **Vercel Serverless Function** — proxy for Claude API calls (keeps the API key server-side)

There is no custom backend server. All application logic runs in the browser using vanilla JavaScript.

```
Browser (HTML + CSS + JS)
    │
    ├── Firebase Auth          → login / register / session
    ├── Firebase Realtime DB   → user profiles, collaboration requests
    ├── EmailJS (CDN)          → sends collaboration emails
    ├── Chart.js (CDN)         → data visualizations
    └── /api/claude (Vercel)   → proxies requests to Anthropic API
```

---

## File Structure

```
Tuwaiqthon/
├── index.html              # Landing page
├── login.html              # Login form
├── register.html           # Registration with role + content type selection
├── dashboard.html          # Main application shell (896 lines)
├── vercel.json             # Serverless function config
├── firebase.json           # Firebase Hosting config (SPA rewrites)
├── .firebaserc             # Firebase project binding
│
├── css/
│   ├── styles.css          # Design system, CSS variables, base components
│   └── additions.css       # AI components, brand portal, Phase 3 UI
│
├── js/
│   ├── firebase.js         # Firebase SDK initialization
│   ├── auth.js             # Auth handlers + route guard
│   ├── dashboard.js        # Core application logic (~3,000 lines)
│   ├── i18n.js             # Translation strings (EN + AR)
│   └── theme.js            # Dark/light mode persistence
│
├── api/
│   └── claude.js           # Vercel serverless proxy for Anthropic API
│
├── test_kpis.js            # KPI unit tests (Node.js)
├── test_kpis.py            # KPI unit tests (Python)
└── test_ai_live.py         # Claude API integration tests
```

---

## Frontend Architecture

### No Framework
The application is built entirely with **vanilla JavaScript (ES6+)**. There is no React, Vue, or Angular. This was a deliberate choice for hackathon speed — no build step, no bundler, no dependencies to install.

### State Management
Global state lives on the `window` object and module-level variables in `dashboard.js`:

```javascript
// CSV data
let csvData        = [];          // parsed rows from uploaded CSV
let activePlatform = 'all';       // current platform filter
let activeDateRange = null;       // current date range filter
let currentSection = 'overview';  // active sidebar section

// AI state
window._aiResult    = null;       // active result (current language)
window._aiResultEn  = null;       // English analysis (always generated first)
window._aiResultAr  = null;       // Arabic translation (generated on demand)
window._aiLoading   = false;      // true while API call is in-flight
window._aiFailed    = false;      // true when call failed or parse error
let _aiGeneration   = 0;          // stale-call guard (incremented per upload)

// Future plan
window._futurePlanData = null;
window._futurePlanKpis = null;
window._currentPlanPeriod = 30;
```

### Section Rendering
Each dashboard section has its own render function. The section system works by calling the appropriate function when the user navigates:

```javascript
function showSection(id) {
  currentSection = id;
  if (id === 'overview')     renderOverview(data);
  if (id === 'charts')       renderCharts(data, kpis);
  if (id === 'insights')     renderInsights();
  if (id === 'future-plan')  renderFuturePlan(data, kpis);
  if (id === 'ad-pricing')   renderAdPricing(data, kpis);
}
```

All sections re-render on language switch via `i18n.afterApply()`.

---

## CSV Parsing

### Column Detection
The parser uses alias matching to accept a wide range of CSV exports:

```javascript
const aliases = {
  date:      ['date', 'month', 'period', 'week'],
  followers: ['followers', 'followers_count', 'total_followers', 'subs', 'subscribers'],
  views:     ['views', 'impressions', 'reach', 'video_views', 'plays'],
  likes:     ['likes', 'like_count', 'reactions'],
  comments:  ['comments', 'comment_count'],
  shares:    ['shares', 'share_count', 'retweets', 'reposts'],
  posts:     ['posts', 'posts_count', 'num_posts', 'count'],
  revenue:   ['revenue', 'earnings', 'income', 'revenue_usd'],
  platform:  ['platform', 'source', 'social_platform', 'network'],
};
```

Each row is normalized into a consistent object regardless of the original column names. Numeric fields default to `0` if missing or unparseable.

### Validation
- Minimum 2 rows required for any meaningful analysis
- Date column is required
- Followers column is required
- All other columns are optional

---

## KPI Calculation Engine

All metrics are computed in `computeKPIs(data)` from filtered CSV rows.

### Engagement Rate
```
engRate = (likes + comments + shares) / max(followers, views) × 100
```
Falls back to views as denominator if followers are zero. Averaged across all rows.

### Engagement Quality Score
A weighted engagement metric that rewards high-value interactions:
```
engQuality = (likes × 1) + (comments × 3) + (shares × 4)
```
Comments and shares are weighted higher because they signal stronger audience connection than passive likes.

### Follower Growth
```
followerGrowth = (lastFollowers - firstFollowers) / firstFollowers × 100
```

### Revenue Volatility (Coefficient of Variation)
```
revCV = stdDev(monthlyRevenues) / mean(monthlyRevenues) × 100
```
A high CV indicates unpredictable revenue — flagged as a risk in the AI insights.

### Health Score
A composite 0–100 score with four components:

| Component | Weight | Scoring Logic |
|---|---|---|
| Engagement | 35% | Scaled from avg engagement rate (benchmark: 3% = 70/100, 6% = 100/100) |
| Growth | 25% | Scaled from follower growth rate (benchmark: 5%/period = 70/100) |
| Revenue Stability | 20% | Inverted CV (low volatility = high score); 0 if no revenue data |
| Posting Consistency | 20% | Deviation from optimal posting frequency (platform-dependent) |

```javascript
healthScore = (engScore × 0.35) + (growthScore × 0.25)
            + (revScore × 0.20) + (postScore × 0.20)
```

---

## Ad Pricing Model

A multi-factor pricing model that adjusts a CPM-based baseline using engagement quality, growth momentum, and revenue stability.

### Step 1 — CPM Baseline
```
base = followers × cpmRate / 1000
```
CPM rates by follower tier:
| Tier | Followers | CPM Rate (﷼) |
|---|---|---|
| Nano | < 10K | 45 |
| Micro | 10K – 50K | 60 |
| Mid | 50K – 200K | 75 |
| Macro | 200K – 1M | 90 |
| Mega | > 1M | 110 |

### Step 2 — Engagement Multiplier
```
engMultiplier = 0.7 + (avgEngRate / 5) × 0.6   (clamped 0.7 – 1.5)
```

### Step 3 — Growth Factor
```
growthFactor = 1.0 + (followerGrowth / 100) × 0.3   (clamped 0.85 – 1.3)
```

### Step 4 — Stability Factor
```
stabilityFactor = revCV < 20  → 1.1
                  revCV < 40  → 1.0
                  otherwise   → 0.9
```

### Final Price Tiers
```
adjusted     = base × engMultiplier × growthFactor × stabilityFactor
minPrice     = adjusted × 0.70
idealPrice   = adjusted
premiumPrice = adjusted × 1.40
```

---

## Future Plan Projections

Mathematical (not AI) projections based on historical growth rates.

### Follower Projection
```
avgMonthlyGrowthRate = mean of period-over-period follower growth rates

engTrend = (avgEngRate_secondHalf - avgEngRate_firstHalf) / avgEngRate_firstHalf

// Engagement adjustment to growth rate
if engTrend < -5%  → adjRate = avgMonthlyGrowthRate × (1 - abs(engTrend) × 0.4)
if engTrend > +5%  → adjRate = avgMonthlyGrowthRate × 1.1
else               → adjRate = avgMonthlyGrowthRate

projectedFollowers = currentFollowers × (1 + adjRate)^months
```

### Revenue Projection
```
projectedRevenue = avgMonthlyRevenue × months
range_min        = projectedRevenue × max(0.5, 1 - revCV/100)
range_max        = projectedRevenue × min(2.0, 1 + revCV/100)
```

### Risk Score (0–5)
Accumulates risk points:
- High revenue volatility (CV > 40%) → +2
- Negative engagement trend → +1
- Negative or very low follower growth → +1
- Inconsistent posting → +1

### Confidence Score (0–100)
```
confidence = dataPointScore + revStabilityScore + engStabilityScore + completenessScore
```
More data periods, stable revenue, and complete columns → higher confidence.

---

## AI Integration

### Architecture
Claude API is never called directly from the browser. All requests go through a Vercel serverless function that injects the API key server-side:

```
Browser → POST /api/claude → Vercel Function → Anthropic API
```

The Vercel function (`api/claude.js`) is a transparent proxy that:
1. Reads `CLAUDE_API_KEY` from Vercel environment variables
2. Forwards the request body to `https://api.anthropic.com/v1/messages`
3. Streams the response back to the browser

### Streaming (SSE)
All Claude calls use `stream: true` to avoid Vercel's 10-second gateway timeout. The browser reads the SSE stream and assembles the full response:

```javascript
const reader  = res.body.getReader();
const decoder = new TextDecoder();
let raw = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const evt = JSON.parse(line.slice(6));
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta')
      raw += evt.delta.text;
  }
}
```

### Stale Call Prevention
A generation counter prevents older in-flight API calls from overwriting results when a new upload happens mid-call:

```javascript
const generation = ++_aiGeneration;
// ... after response:
if (generation === _aiGeneration) {
  window._aiResultEn = result; // only update if still the latest call
}
```

### EN/AR Caching Strategy
AI content is generated **once in English**, then translated on demand. This avoids re-running the full analysis on every language switch:

```
CSV Upload
    → callClaudeAI()          → English JSON → cache as _aiResultEn
    → _applyLanguageToAI()
        if Arabic selected:
            if _aiResultAr cached  → use instantly
            else → _translateAIResult(_aiResultEn) → cache as _aiResultAr
        if English selected:
            use _aiResultEn instantly

Language Switch
    → _applyLanguageToAI()    → instant from cache (no API call)
```

### JSON Response Parsing
The model sometimes prepends Arabic text before the JSON block. The parser is robust to this:

```javascript
const stripped = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
const start = stripped.indexOf('{');
const end   = stripped.lastIndexOf('}');
return JSON.parse(stripped.slice(start, end + 1));
```

### Model Used
`claude-haiku-4-5-20251001` — chosen for speed and cost efficiency. Max tokens: 4000.

---

## Chatbot

The chatbot uses a **hybrid architecture**:

1. **Local engine** (rule-based) — handles common questions offline using computed KPIs and insights: engagement, followers, revenue, health score, posts, recommendations
2. **Claude fallback** — for questions the local engine cannot answer, the full Claude API is called with the creator's live data as system context

The local engine is tried first to keep response times fast. Only complex or open-ended questions reach the API.

### Chatbot System Prompt
```
You are a friendly creator coach inside Smart Content Manager, based in Saudi Arabia.
All monetary values are in Saudi Riyals (SAR, ﷼).
You have the creator's live data — use it to give warm, specific answers.
Keep replies short (2–4 sentences), reference their actual numbers,
and always end with encouragement or a clear next step.
```

---

## Internationalization (i18n)

### System
Custom-built translation system with no external library:

```javascript
i18n.t('key')                    // returns translated string
i18n.t('key', { var: value })    // with variable interpolation
i18n.apply('ar')                 // switches language + applies RTL
i18n.afterApply = function() {}  // hook called after every language switch
```

### RTL Support
Switching to Arabic sets `dir="rtl"` on `<html>` and applies RTL-specific CSS rules (flex-direction reversals, text-align overrides, border-side flips).

### AI Language Strategy
The AI always generates content in English. For Arabic display, a separate translation call is made and cached. This ensures the Arabic output has the same quality and warmth as English — direct Arabic generation from the model tends to produce shorter, stiffer content.

---

## Authentication & Authorization

### Firebase Auth
- Email/password only
- Session persisted via Firebase SDK (`onAuthStateChanged`)
- Route guard in `auth.js` protects `dashboard.html`; unauthenticated users are redirected to `login.html`

### Role-Based UI
After login, the user's role (`creator` or `brand`) is read from Firebase Realtime Database. The dashboard then shows or hides the appropriate sidebar navigation sections.

```javascript
// /users/{uid}/role = "creator" | "brand"
db.ref(`users/${uid}/role`).once('value', snap => {
  userRole = snap.val();
  applyRoleUI(userRole);
});
```

---

## Firebase Database Schema

```
/users/{uid}
  name:         string
  email:        string
  role:         "creator" | "brand"
  contentTypes: string[]      # creators only (up to 9 categories)
  createdAt:    timestamp

/collabRequests/{creatorUID}/{requestID}
  brandName:    string
  brandEmail:   string
  brandUID:     string
  campaignName: string
  format:       string
  budget:       string        # SAR range label e.g. "﷼2,000 – ﷼7,500"
  timeline:     string
  keyMessage:   string
  requirements: string
  status:       "pending" | "accepted" | "declined"
  createdAt:    timestamp

/brandRequests/{brandUID}/{requestID}
  # mirror of collabRequests — allows both sides to query their own requests
```

---

## Collaboration System

When a brand submits a collaboration request:

1. Data is validated client-side
2. Request is written to `/collabRequests/{creatorUID}/{id}` and `/brandRequests/{brandUID}/{id}` simultaneously
3. EmailJS sends a notification email to the creator using a pre-configured template
4. The brand's "Sent Requests" panel updates in real time

### EmailJS Configuration
- Service: `service_2pco3m9`
- Template: `template_8n2o2yt`
- Public key stored in client JS (EmailJS design — public key is safe to expose)

---

## CSS Architecture

### Design Tokens (CSS Variables)
All colors, radii, shadows, and transitions are defined as CSS custom properties on `:root` with a `[data-theme="light"]` override block. This makes theme switching instant (one attribute change on `<html>`).

Key variables:
```css
--bg-base, --bg-secondary, --bg-card, --bg-input
--text-primary, --text-secondary, --text-muted
--accent-blue, --accent-purple, --accent-cyan
--accent-green, --accent-red, --accent-orange
--border, --border-strong
--radius-sm (8px), --radius-md (14px), --radius-lg (20px), --radius-xl (28px)
--transition (0.2s ease)
```

### Two-File Strategy
- `styles.css` — foundation: design system, layout, auth pages, marketing page
- `additions.css` — dashboard-specific: AI components, charts, brand portal, simulation, pricing, RTL overrides, print styles

---

## Vercel Configuration

```json
{
  "functions": {
    "api/claude.js": {
      "maxDuration": 60
    }
  }
}
```

`maxDuration: 60` is required because Arabic AI responses (4000 max tokens, streamed) can take longer than Vercel Hobby's default 10-second limit.

---

## Security Considerations

| Concern | Approach |
|---|---|
| Claude API key exposure | Never in client code — only in Vercel environment variables |
| XSS prevention | `_escapeHtml()` applied to all user-generated content rendered as HTML |
| Firebase rules | Auth-gated reads/writes (users can only write to their own paths) |
| EmailJS key | Public key by design (EmailJS rate-limits by domain) |
| CSV injection | CSV content is parsed to numbers; string fields are escaped before rendering |

---

## Running Tests

```bash
# KPI calculation tests
node test_kpis.js
python test_kpis.py

# Live Claude API test (requires CLAUDE_API_KEY in environment)
python test_ai_live.py
```

Tests cover:
- KPI computation across multiple CSV shapes
- Health score calculation with edge cases (no revenue, zero followers)
- Claude API connectivity and JSON response parsing

---

## Known Limitations

- **No social media API integration** — data must be manually exported and uploaded as CSV
- **Self-reported data** — the platform cannot verify the accuracy of uploaded analytics
- **Pricing model weights are heuristic** — CPM rates and multipliers are approximations, not derived from market data
- **AI insights quality depends on data volume** — fewer than 6 data points produce low-confidence results
- **Single currency** — all monetary values are in SAR; multi-currency support is not implemented
