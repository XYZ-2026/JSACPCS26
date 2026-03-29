/**
 * JOSAA College Predictor — script.js
 * ─────────────────────────────────────────────────────────────
 * Handles: Auth, Theme, Navigation, Data Loading,
 *          Rank Prediction, College Filtering, UI Rendering
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════════════
   CONFIGURATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Replace this URL with your deployed Google Apps Script Web App URL.
 * After deploying Code.gs, paste the deployment URL here.
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwDQ7yEl7OFIqFNNHX58QouAinz7nbUY5Vc1q5aVd-IVWd-ayH9M79ZV5eOxydg5w9QmA/exec';

/* ══════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════ */
let josaaData = [];   // Full JOSAA dataset (loaded from josaa.json)
let shiftDataCache = {};   // Cached shift JSON files
let allResults = [];   // Last prediction results (for filter)
let currentPage = 'home';

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  restoreSession();
  loadJosaaData();
});

/* ══════════════════════════════════════════════════════════════
   THEME
   ══════════════════════════════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.checked = (saved === 'dark');
}

function toggleTheme(checkbox) {
  const theme = checkbox.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

/* ══════════════════════════════════════════════════════════════
   PAGE NAVIGATION
   ══════════════════════════════════════════════════════════════ */
function showPage(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const el = document.getElementById('page' + capitalise(page));
  if (el) el.classList.add('active');
  currentPage = page;

  // Update nav active state
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('nav' + capitalise(page));
  if (activeBtn) activeBtn.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Route to page — redirect to auth if not logged in */
function requireAuth(page) {
  if (!getSession()) {
    showPage('auth');
    toast('Please login to access this feature', 'info');
    return;
  }
  showPage(page);
  if (page === 'history') renderHistory();
}

/* ══════════════════════════════════════════════════════════════
   MOBILE MENU
   ══════════════════════════════════════════════════════════════ */
function toggleMobileMenu() {
  const nav = document.getElementById('mobNav');
  const btn = document.getElementById('hamburger');
  const open = nav.classList.toggle('open');
  btn.classList.toggle('open', open);
}

function closeMobNav() {
  document.getElementById('mobNav').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}

/* ══════════════════════════════════════════════════════════════
   SESSION (localStorage)
   ══════════════════════════════════════════════════════════════ */
function getSession() {
  try { return JSON.parse(localStorage.getItem('josaa_session')); }
  catch { return null; }
}

function setSession(user) {
  localStorage.setItem('josaa_session', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('josaa_session');
}

/** Update the UI to reflect logged-in state */
function restoreSession() {
  const user = getSession();
  if (user) {
    updateUILoggedIn(user);
  } else {
    updateUILoggedOut();
  }
}

function updateUILoggedIn(user) {
  const initial = (user.name || '?')[0].toUpperCase();

  // Desktop
  document.getElementById('authBtnDesktop').style.display = 'none';
  document.getElementById('userPillDesktop').style.display = 'flex';
  document.getElementById('avatarDesktop').textContent = initial;
  document.getElementById('userNameDesktop').textContent = user.name;

  // Predictor + History nav links
  ['navPredictor', 'navHistory', 'mobNavPredictor', 'mobNavHistory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });

  // Mobile auth btn → hide
  const mobAuth = document.getElementById('mobNavAuth');
  if (mobAuth) mobAuth.style.display = 'none';

  // Mobile footer
  const footer = document.getElementById('mobNavFooter');
  if (footer) {
    footer.style.display = 'flex';
    document.getElementById('mobAvatar').textContent = initial;
    document.getElementById('mobUserName').textContent = user.name;
    document.getElementById('mobUserEmail').textContent = user.email;
  }
}

function updateUILoggedOut() {
  document.getElementById('authBtnDesktop').style.display = '';
  document.getElementById('userPillDesktop').style.display = 'none';

  ['navPredictor', 'navHistory', 'mobNavPredictor', 'mobNavHistory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const mobAuth = document.getElementById('mobNavAuth');
  if (mobAuth) mobAuth.style.display = '';

  const footer = document.getElementById('mobNavFooter');
  if (footer) footer.style.display = 'none';
}

function handleLogout() {
  clearSession();
  updateUILoggedOut();
  showPage('home');
  toast('Logged out successfully', 'ok');
}

/* ══════════════════════════════════════════════════════════════
   AUTH TAB SWITCH
   ══════════════════════════════════════════════════════════════ */
function switchAuthTab(tab) {
  ['login', 'register'].forEach(t => {
    document.getElementById('tab' + capitalise(t)).classList.toggle('active', t === tab);
    document.getElementById('pane' + capitalise(t)).classList.toggle('active', t === tab);
  });
  // Clear errors
  ['loginErr', 'regErr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  });
}

/* ══════════════════════════════════════════════════════════════
   AUTH — LOGIN
   ══════════════════════════════════════════════════════════════ */
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginErr');
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  // Basic validation
  if (!email || !password) {
    showErr(err, 'Please fill all fields.');
    return;
  }

  setLoading(btn, true, 'Logging in…');

  try {
    const response = await gasRequest('loginUser', { email, password: encodePassword(password) });

    if (response.success) {
      const user = response.user;
      setSession(user);
      updateUILoggedIn(user);
      toast(`Welcome back, ${user.name}! 👋`, 'ok');
      showPage('predictor');
    } else {
      showErr(err, response.message || 'Invalid email or password.');
    }
  } catch (_) {
    showErr(err, 'Could not connect. Check your Apps Script URL.');
  }

  setLoading(btn, false, 'Login');
}

/* ══════════════════════════════════════════════════════════════
   AUTH — REGISTER
   ══════════════════════════════════════════════════════════════ */
async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const err = document.getElementById('regErr');
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const contact = document.getElementById('regContact').value.trim();
  const city = document.getElementById('regCity').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;

  // Validation
  if (!name || !email || !contact || !city || !password) {
    showErr(err, 'Please fill all fields.');
    return;
  }
  if (password !== confirm) {
    showErr(err, 'Passwords do not match.');
    return;
  }
  if (password.length < 6) {
    showErr(err, 'Password must be at least 6 characters.');
    return;
  }
  if (!/^[0-9]{10}$/.test(contact)) {
    showErr(err, 'Enter a valid 10-digit contact number.');
    return;
  }

  setLoading(btn, true, 'Creating account…');

  try {
    const response = await gasRequest('registerUser', {
      name, email, contact, city,
      password: encodePassword(password)
    });

    if (response.success) {
      toast('Account created! Please login. 🎉', 'ok');
      switchAuthTab('login');
      document.getElementById('loginEmail').value = email;
    } else {
      showErr(err, response.message || 'Registration failed. Try again.');
    }
  } catch (_) {
    showErr(err, 'Could not connect. Check your Apps Script URL.');
  }

  setLoading(btn, false, 'Create Account');
}

/* ══════════════════════════════════════════════════════════════
   LOAD JOSAA DATA
   ══════════════════════════════════════════════════════════════ */
async function loadJosaaData() {
  try {
    const res = await fetch('josaa.json');
    const json = await res.json();
    josaaData = json['JOSAA DATA'] || [];
    console.log(`✅ JOSAA data loaded: ${josaaData.length} records`);
  } catch (err) {
    console.error('❌ Failed to load josaa.json:', err);
    toast('Failed to load JOSAA data. Refresh and try again.', 'err');
  }
}

/**
 * Load a shift difficulty JSON file (cached after first load)
 * @param {string} shift - e.g. 'easy_to_moderate'
 * @returns {Array} Array of {Marks, Percentile} objects
 */
async function loadShiftData(shift) {
  if (shiftDataCache[shift]) return shiftDataCache[shift];

  const fileMap = {
    easy_to_moderate: 'easy_to_moderate.json',
    moderate: 'moderate.json',
    moderate_to_difficult: 'moderate_to_difficult.json',
    difficult: 'difficult.json'
  };

  const filename = fileMap[shift];
  if (!filename) throw new Error(`Unknown shift: ${shift}`);

  const res = await fetch(filename);
  const json = await res.json();

  // Each JSON has one top-level key; get the array
  const key = Object.keys(json)[0];
  const data = json[key];
  shiftDataCache[shift] = data;
  return data;
}

/* ══════════════════════════════════════════════════════════════
   RANK PREDICTION LOGIC
   ══════════════════════════════════════════════════════════════ */

/**
 * Parse a percentile range string like "99.50-99.60" → [99.50, 99.60]
 * Also handles unicode dash (–)
 */
function parsePercentileRange(str) {
  const cleaned = str.replace(/\u2013/g, '-').replace(/\s/g, '');
  const parts = cleaned.split('-');
  if (parts.length < 2) return null;
  return [parseFloat(parts[0]), parseFloat(parts[1])];
}

/**
 * Parse a marks range string like "200 – 191" → midpoint value
 * Also handles unicode dash (–)
 */
function parseMidMarks(str) {
  const cleaned = str.replace(/\u2013/g, '-').replace(/\s/g, '');
  const parts = cleaned.split('-');
  if (parts.length < 2) return null;
  const high = parseFloat(parts[0]);
  const low = parseFloat(parts[1]);
  return (high + low) / 2;
}

/**
 * Find the estimated marks for a given percentile in the shift data.
 * Returns the midpoint marks of the matching percentile range.
 * @param {number} percentile
 * @param {Array}  shiftRows
 * @returns {number} estimated marks
 */
function estimateMarks(percentile, shiftRows) {
  let bestRow = null;
  let bestDist = Infinity;

  for (const row of shiftRows) {
    const range = parsePercentileRange(row.Percentile);
    if (!range) continue;
    const [low, high] = range;

    // Check if percentile falls within this range
    if (percentile >= low && percentile <= high) {
      return parseMidMarks(row.Marks) || 0;
    }

    // Track nearest row if no exact match
    const mid = (low + high) / 2;
    const dist = Math.abs(percentile - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestRow = row;
    }
  }

  // Fallback: use nearest row
  if (bestRow) return parseMidMarks(bestRow.Marks) || 0;
  return 0;
}

/**
 * Convert marks → JEE Main rank (approximation formula).
 * Formula: rank ≈ (100 - percentile) × 11000
 *   (calibrated against known data points for 10 lakh candidates)
 * For very high percentiles we use a more granular formula.
 */
function marksToRank(percentile) {
  // Total approximate candidates = 11,00,000
  const total = 1100000;
  const rank = Math.round((100 - percentile) / 100 * total);
  return Math.max(1, rank);
}

/* ══════════════════════════════════════════════════════════════
   BRANCH GROUP KEYWORDS
   ══════════════════════════════════════════════════════════════ */
const BRANCH_KEYWORDS = {
  computer: ['computer', 'cse', 'information technology', 'artificial intelligence', 'data science', 'machine learning', 'software', 'it '],
  electronics: ['electronics', 'communication', 'electrical', 'ece', 'eee', 'electronic', 'instrumentation'],
  core: ['mechanical', 'civil', 'chemical', 'production', 'manufacturing', 'metallurgy', 'mining', 'textile'],
  others: [] // match everything not covered above
};

/**
 * Check if a branch name matches the selected branch group.
 * @param {string} branchName  - JOSAA "Academic Program Name"
 * @param {string} group       - 'computer' | 'electronics' | 'core' | 'others'
 */
function matchesBranchGroup(branchName, group) {
  const lower = branchName.toLowerCase();

  if (group === 'others') {
    // 'others' = does NOT match computer, electronics, or core
    const allKeywords = [
      ...BRANCH_KEYWORDS.computer,
      ...BRANCH_KEYWORDS.electronics,
      ...BRANCH_KEYWORDS.core
    ];
    return !allKeywords.some(kw => lower.includes(kw));
  }

  return BRANCH_KEYWORDS[group].some(kw => lower.includes(kw));
}

/* ══════════════════════════════════════════════════════════════
   INSTITUTE TYPE DETECTION
   ══════════════════════════════════════════════════════════════ */
/**
 * Detect whether an institute is NIT, IIIT, or GFTI.
 * @param {string} instituteName
 * @returns {string} 'NIT' | 'IIIT' | 'GFTI'
 */
function detectInstituteType(instituteName) {
  const lower = instituteName.toLowerCase();
  if (lower.includes('national institute of technology') || lower.includes(' nit ') || lower.startsWith('nit '))
    return 'NIT';
  if (lower.includes('indian institute of information technology') || lower.includes(' iiit') || lower.startsWith('iiit'))
    return 'IIIT';
  return 'GFTI';
}

/* ══════════════════════════════════════════════════════════════
   COLLEGE FILTERING
   ══════════════════════════════════════════════════════════════ */
/**
 * Filter JOSAA data based on user inputs.
 * @param {Object} params
 * @returns {Array} filtered + annotated results
 */
function filterColleges({ rank, gender, category, homeState, instTypes, branchGroup }) {
  const results = [];

  for (const row of josaaData) {
    const institute = row['Institute'] || '';
    const program = row['Academic Program Name'] || '';
    const quota = row['Quota'] || '';
    const seatType = row['Seat Type'] || '';
    const rowGender = row['Gender'] || '';
    const opening = parseInt(row['Opening Rank'] || '0', 10);
    const closing = parseInt(row['Closing Rank'] || '0', 10);

    if (!opening || !closing) continue;

    // ── 1. Rank filter ──
    // Student's rank must be ≤ closing rank (within consideration)
    // Allow a 20% buffer above closing for near-matches
    if (rank > closing * 1.05) continue;

    // ── 2. Gender filter ──
    // 'Gender-Neutral' seats are open to all
    const genderMatch = rowGender === 'Gender-Neutral' || rowGender === gender;
    if (!genderMatch) continue;

    // ── 3. Category (Seat Type) filter ──
    if (seatType !== category) continue;

    // ── 4. Quota filter ──
    // Home State quota: institute state should match student's state
    // All India quota: always eligible
    // Other State quota: if not from home state
    const instituteState = extractStateFromInstitute(institute);
    if (quota === 'Home State') {
      if (!homeState || !instituteState.toLowerCase().includes(homeState.toLowerCase().slice(0, 6))) continue;
    } else if (quota === 'Other State') {
      if (homeState && instituteState.toLowerCase().includes(homeState.toLowerCase().slice(0, 6))) continue;
    }
    // 'All India' quota — always include

    // ── 5. Institute type filter ──
    const instType = detectInstituteType(institute);
    if (!instTypes.includes(instType)) continue;

    // ── 6. Branch group filter ──
    if (!matchesBranchGroup(program, branchGroup)) continue;

    // ── 7. Compute confidence ──
    const confidence = computeConfidence(rank, opening, closing);

    results.push({
      institute,
      program,
      quota,
      category: seatType,
      gender: rowGender,
      opening,
      closing,
      confidence,
      instType
    });
  }

  // Sort: Safe first → Moderate → Dream
  const order = { safe: 0, moderate: 1, dream: 2 };
  results.sort((a, b) => order[a.confidence] - order[b.confidence] || a.opening - b.opening);

  return results;
}

/**
 * Compute match confidence based on rank vs opening/closing.
 * - Safe:     rank ≤ (opening + (closing - opening) * 0.40)
 * - Dream:    rank < opening
 * - Moderate: everything else
 */
function computeConfidence(rank, opening, closing) {
  if (rank < opening) return 'dream';
  const safeThreshold = opening + (closing - opening) * 0.45;
  if (rank <= safeThreshold) return 'safe';
  return 'moderate';
}

/**
 * Extract state from institute name (approximate matching).
 * This covers most JOSAA institute location patterns.
 */
const STATE_PATTERNS = [
  ['Andhra Pradesh', ['andhra', 'warangal', 'tirupati', 'surathkal']],
  ['Karnataka', ['karnataka', 'surathkal']],
  ['Tamil Nadu', ['tamil', 'trichy', 'tiruchirappalli', 'madurai']],
  ['Maharashtra', ['maharashtra', 'nagpur', 'mumbai', 'pune']],
  ['Rajasthan', ['rajasthan', 'jaipur', 'jodhpur', 'kota']],
  ['Uttar Pradesh', ['allahabad', 'bhopal', 'agra', 'lucknow', 'uttar pradesh']],
  ['West Bengal', ['durgapur', 'west bengal', 'kolkata', 'shibpur']],
  ['Bihar', ['bihar', 'patna']],
  ['Odisha', ['odisha', 'rourkela', 'odisa']],
  ['Madhya Pradesh', ['bhopal', 'madhya pradesh', 'jabalpur']],
  ['Kerala', ['kerala', 'calicut', 'kozhikode']],
  ['Gujarat', ['gujarat', 'surat', 'ahmedabad']],
  ['Haryana', ['haryana', 'kurukshetra', 'faridabad']],
  ['Punjab', ['punjab', 'jalandhar', 'chandigarh']],
  ['Himachal Pradesh', ['hamirpur', 'himachal']],
  ['Jharkhand', ['jharkhand', 'jamshedpur']],
  ['Uttarakhand', ['uttarakhand', 'roorkee', 'srinagar uttara']],
  ['Arunachal Pradesh', ['arunachal', 'itanagar']],
  ['Nagaland', ['nagaland']],
  ['Manipur', ['manipur', 'imphal']],
  ['Tripura', ['tripura', 'agartala']],
  ['Meghalaya', ['meghalaya', 'shillong']],
  ['Mizoram', ['mizoram', 'aizawl']],
  ['Sikkim', ['sikkim', 'gangtok']],
  ['Goa', ['goa']],
  ['Delhi', ['delhi']],
  ['Jammu and Kashmir', ['srinagar', 'jammu', 'kashmir']],
];

function extractStateFromInstitute(name) {
  const lower = name.toLowerCase();
  for (const [state, patterns] of STATE_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) return state;
  }
  return '';
}

/* ══════════════════════════════════════════════════════════════
   PREDICTOR FORM SUBMIT
   ══════════════════════════════════════════════════════════════ */
async function handlePredict(e) {
  e.preventDefault();

  const errEl = document.getElementById('predictErr');
  errEl.style.display = 'none';

  // ── Read inputs ──
  const percentile = parseFloat(document.getElementById('inPercentile').value);
  const shift = document.getElementById('inShift').value;
  const gender = document.getElementById('inGender').value;
  const category = document.getElementById('inCategory').value;
  const homeState = document.getElementById('inState').value;
  const branchGroup = document.getElementById('inBranch').value;

  const instTypeCheckboxes = document.querySelectorAll('input[name="instType"]:checked');
  const instTypes = Array.from(instTypeCheckboxes).map(cb => cb.value);

  // ── Validation ──
  if (isNaN(percentile) || percentile < 0 || percentile > 100) {
    showErr(errEl, 'Please enter a valid percentile between 0 and 100.');
    return;
  }
  if (!shift || !gender || !category || !homeState || !branchGroup) {
    showErr(errEl, 'Please fill in all fields before predicting.');
    return;
  }
  if (instTypes.length === 0) {
    showErr(errEl, 'Please select at least one institute type (NIT / IIIT / GFTI).');
    return;
  }
  if (josaaData.length === 0) {
    showErr(errEl, 'JOSAA data not loaded yet. Please refresh the page.');
    return;
  }

  // ── Show loading ──
  showLoading(true);
  const btn = document.getElementById('predictBtn');
  setLoading(btn, true, 'Predicting…');

  // Tiny delay so the UI can paint the loader
  await sleep(300);

  try {
    // ── Load shift data & compute rank ──
    const shiftRows = await loadShiftData(shift);
    const estMarks = estimateMarks(percentile, shiftRows);
    const predictedRank = marksToRank(percentile);

    // ── Filter colleges ──
    allResults = filterColleges({ rank: predictedRank, gender, category, homeState, instTypes, branchGroup });

    // ── Save to history ──
    saveSearchToHistory({
      percentile, shift, gender, category, homeState, branchGroup, instTypes,
      predictedRank, estMarks,
      count: allResults.length,
      time: new Date().toISOString()
    });

    // ── Update summary bar ──
    document.getElementById('rssPercentile').textContent = percentile.toFixed(2) + '%';
    document.getElementById('rssMarks').textContent = Math.round(estMarks);
    document.getElementById('rssRank').textContent = predictedRank.toLocaleString('en-IN');
    document.getElementById('rssCount').textContent = allResults.length;

    // ── Render results ──
    document.getElementById('resultsSection').style.display = '';

    // Reset filter chips
    document.querySelectorAll('.fchip').forEach(c => c.classList.toggle('active', c.dataset.f === 'all'));
    renderResults(allResults);

    // Scroll to results
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (allResults.length === 0) {
      toast('No colleges matched your filters. Try widening your preferences.', 'info');
    } else {
      toast(`Found ${allResults.length} matching college-branch combinations! 🎉`, 'ok');
    }

  } catch (err) {
    console.error(err);
    showErr(errEl, 'Prediction failed: ' + err.message);
    toast('Something went wrong. Please try again.', 'err');
  }

  showLoading(false);
  setLoading(btn, false, '🔮 Predict My Colleges');
}

/* ══════════════════════════════════════════════════════════════
   RENDER RESULTS
   ══════════════════════════════════════════════════════════════ */
function renderResults(results) {
  const grid = document.getElementById('resultsGrid');
  const empty = document.getElementById('emptyState');

  grid.innerHTML = '';

  if (results.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  results.forEach(r => {
    const card = document.createElement('div');
    card.className = `cc ${r.confidence}`;
    card.innerHTML = `
      <div class="cc-hdr">
        <div class="cc-name">${escHtml(r.institute)}</div>
        <span class="chip ${confidenceChip(r.confidence)}" style="flex-shrink:0;">${r.instType}</span>
      </div>
      <div class="cc-branch">${escHtml(r.program)}</div>
      <div class="cc-meta">
        <span class="chip chip-gray">${escHtml(r.quota)}</span>
        <span class="chip chip-gray">${escHtml(r.category)}</span>
        <span class="chip chip-gray">${escHtml(r.gender === 'Gender-Neutral' ? 'GN' : 'Female')}</span>
      </div>
      <div class="cc-foot">
        <div class="cc-rank-info">
          <div class="cc-rank-block">
            <div class="cc-rank-label">Opening</div>
            <div class="cc-rank-val opening">${r.opening.toLocaleString('en-IN')}</div>
          </div>
          <div class="cc-rank-block">
            <div class="cc-rank-label">Closing</div>
            <div class="cc-rank-val closing">${r.closing.toLocaleString('en-IN')}</div>
          </div>
        </div>
        <div class="conf-badge conf-${r.confidence}">
          ${confidenceEmoji(r.confidence)} ${capitalise(r.confidence)}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function confidenceChip(confidence) {
  return { safe: 'chip-green', moderate: 'chip-orange', dream: 'chip-red' }[confidence] || '';
}

function confidenceEmoji(confidence) {
  return { safe: '✅', moderate: '⚡', dream: '🌟' }[confidence] || '';
}

/* ══════════════════════════════════════════════════════════════
   RESULTS FILTER
   ══════════════════════════════════════════════════════════════ */
function applyFilter(filter, clickedChip) {
  document.querySelectorAll('.fchip').forEach(c => c.classList.remove('active'));
  clickedChip.classList.add('active');

  const filtered = filter === 'all'
    ? allResults
    : allResults.filter(r => r.confidence === filter);

  renderResults(filtered);
}

/* ══════════════════════════════════════════════════════════════
   EXPORT RESULTS (CSV)
   ══════════════════════════════════════════════════════════════ */
function exportResults() {
  if (allResults.length === 0) {
    toast('No results to export.', 'info');
    return;
  }

  const header = ['Institute', 'Program', 'Quota', 'Category', 'Gender', 'Opening Rank', 'Closing Rank', 'Type', 'Confidence'];
  const rows = allResults.map(r => [
    r.institute, r.program, r.quota, r.category,
    r.gender, r.opening, r.closing, r.instType, r.confidence
  ]);

  const csv = [header, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'josaa_predictions.csv';
  a.click();
  toast('Results exported as CSV ✅', 'ok');
}

/* ══════════════════════════════════════════════════════════════
   SEARCH HISTORY (localStorage)
   ══════════════════════════════════════════════════════════════ */
function saveSearchToHistory(entry) {
  const history = getHistory();
  history.unshift(entry);                    // Latest first
  const trimmed = history.slice(0, 20);      // Keep max 20
  localStorage.setItem('josaa_history', JSON.stringify(trimmed));
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('josaa_history')) || []; }
  catch { return []; }
}

function clearHistory() {
  localStorage.removeItem('josaa_history');
  renderHistory();
  toast('Search history cleared.', 'ok');
}

function renderHistory() {
  const container = document.getElementById('historyList');
  const history = getHistory();

  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <h3>No searches yet</h3>
        <p>Run your first prediction to see results here.</p>
      </div>`;
    return;
  }

  const rows = history.map((h, i) => {
    const d = new Date(h.time);
    const dateStr = isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="card" style="margin-bottom:10px;cursor:pointer;" onclick="replaySearch(${i})" title="Click to re-run this search">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div>
            <div style="font-family:'Poppins',sans-serif;font-weight:700;font-size:14px;">
              ${escHtml(h.percentile)}% — ${shiftLabel(h.shift)}
            </div>
            <div class="muted" style="font-size:12px;margin-top:3px;">
              ${escHtml(h.category)} · ${escHtml(h.gender === 'Gender-Neutral' ? 'General/Male' : 'Female')} · ${escHtml(h.homeState)} · ${branchLabel(h.branchGroup)}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-family:'Poppins',sans-serif;font-weight:800;font-size:15px;color:var(--brand);">Rank ~${Number(h.predictedRank).toLocaleString('en-IN')}</div>
            <div class="muted" style="font-size:11px;">${h.count} colleges · ${dateStr} ${timeStr}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = rows;
}

/** Re-fill the predictor form with a past search entry */
function replaySearch(index) {
  const h = getHistory()[index];
  if (!h) return;

  showPage('predictor');

  // Fill form
  document.getElementById('inPercentile').value = h.percentile;
  document.getElementById('inShift').value = h.shift;
  document.getElementById('inGender').value = h.gender;
  document.getElementById('inCategory').value = h.category;
  document.getElementById('inState').value = h.homeState;
  document.getElementById('inBranch').value = h.branchGroup;

  // Set institute type checkboxes
  document.querySelectorAll('input[name="instType"]').forEach(cb => {
    cb.checked = (h.instTypes || []).includes(cb.value);
  });

  toast('Form filled with past search. Click Predict! 🔮', 'info');
}

function shiftLabel(shift) {
  const map = {
    easy_to_moderate: 'Easy–Moderate',
    moderate: 'Moderate',
    moderate_to_difficult: 'Moderate–Difficult',
    difficult: 'Difficult'
  };
  return map[shift] || shift;
}

function branchLabel(group) {
  const map = {
    computer: 'Computer',
    electronics: 'Electronics',
    core: 'Core',
    others: 'Others'
  };
  return map[group] || group;
}

/* ══════════════════════════════════════════════════════════════
   GOOGLE APPS SCRIPT REQUEST
   ══════════════════════════════════════════════════════════════ */
/**
 * Send a request to Google Apps Script via JSONP (no-cors workaround).
 * GAS deployed as "Execute as: Me, Who has access: Anyone".
 * @param {string} action  - 'loginUser' | 'registerUser'
 * @param {Object} payload - data object
 * @returns {Promise<Object>} parsed response JSON
 */
function gasRequest(action, payload) {
  return new Promise((resolve, reject) => {
    if (!GAS_URL || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE') {
      reject(new Error('Apps Script URL not configured. Please update GAS_URL in script.js.'));
      return;
    }

    const callbackName = 'gasCallback_' + Date.now();
    const params = new URLSearchParams({ action, ...payload, callback: callbackName });
    const url = `${GAS_URL}?${params.toString()}`;

    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Request timed out.'));
    }, 15000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.src = url;
    script.onerror = () => { cleanup(); reject(new Error('Network error calling Apps Script.')); };
    document.head.appendChild(script);
  });
}

/* ══════════════════════════════════════════════════════════════
   UTILITY HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Encode password (base64 — lightweight obfuscation for Apps Script) */
function encodePassword(password) {
  return btoa(unescape(encodeURIComponent(password)));
}

/** Show/hide a loading overlay */
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('open', show);
}

/** Set button loading state */
function setLoading(btn, isLoading, label) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = label;
}

/** Show an inline error message */
function showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

/** Simple sleep */
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/** Escape HTML to prevent XSS */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════════ */
/**
 * Show a toast notification.
 * @param {string} message
 * @param {'ok'|'err'|'info'} type
 * @param {number} duration - milliseconds
 */
function toast(message, type = 'info', duration = 3500) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;

  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${escHtml(message)}</span>`;
  wrap.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(110%)';
    el.style.transition = 'opacity .3s, transform .3s';
    setTimeout(() => el.remove(), 350);
  }, duration);
}
