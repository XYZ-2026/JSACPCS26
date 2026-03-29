/**
 * ═══════════════════════════════════════════════════════════════
 *  JOSAA College Predictor — Google Apps Script Backend
 *  File: Code.gs
 * ═══════════════════════════════════════════════════════════════
 *
 *  SETUP INSTRUCTIONS
 *  ──────────────────
 *  1. Open Google Sheets → Extensions → Apps Script
 *  2. Paste this entire file content into Code.gs
 *  3. Create a new Sheet named: users
 *     Columns:  A=id | B=name | C=email | D=contact | E=city | F=password | G=createdAt
 *  4. Save the project (Ctrl+S)
 *  5. Click Deploy → New Deployment
 *     - Type: Web App
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  6. Copy the Web App URL and paste it into script.js → GAS_URL
 *
 *  NOTES
 *  ──────────────────
 *  - Passwords are stored as base64-encoded strings (same encoding as frontend)
 *  - JSONP is used for cross-origin requests (callback param)
 *  - All responses are JSON wrapped in the callback function
 * ═══════════════════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════════════════════
   CONFIGURATION
   ══════════════════════════════════════════════════════════════ */

/** Name of the Sheet tab where user accounts are stored */
const USERS_SHEET = 'users';

/** Column positions in the users sheet (1-indexed) */
const COL = {
  ID:         1,   // A: Unique numeric ID
  NAME:       2,   // B: Full name
  EMAIL:      3,   // C: Email (unique, lowercase)
  CONTACT:    4,   // D: Phone number
  CITY:       5,   // E: City
  PASSWORD:   6,   // F: base64-encoded password
  CREATED_AT: 7    // G: ISO timestamp
};

/* ══════════════════════════════════════════════════════════════
   doGet — Entry Point for Web App
   ══════════════════════════════════════════════════════════════ */

/**
 * Main request handler for the Web App.
 * All requests arrive here as GET with ?action=... parameters.
 *
 * Supports JSONP for cross-origin browser requests:
 *   ?action=loginUser&email=...&password=...&callback=fn
 *   ?action=registerUser&name=...&email=...&...&callback=fn
 */
function doGet(e) {
  const params   = e.parameter || {};
  const action   = params.action;
  const callback = params.callback;   // JSONP callback function name

  let result;

  try {
    switch (action) {
      case 'registerUser':
        result = registerUser(params);
        break;
      case 'loginUser':
        result = loginUser(params);
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, message: 'Server error: ' + err.message };
    Logger.log('doGet ERROR: ' + err.message + ' | Action: ' + action);
  }

  const json = JSON.stringify(result);

  // Return as JSONP if callback is provided, else plain JSON
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════════════════════════════════════════════════
   REGISTER USER
   ══════════════════════════════════════════════════════════════ */

/**
 * Register a new user in the 'users' sheet.
 *
 * @param {Object} params - { name, email, contact, city, password }
 * @returns {{ success: boolean, message: string }}
 */
function registerUser(params) {
  const name     = (params.name     || '').trim();
  const email    = (params.email    || '').trim().toLowerCase();
  const contact  = (params.contact  || '').trim();
  const city     = (params.city     || '').trim();
  const password = (params.password || '').trim();

  // ── Server-side validation ──
  if (!name || !email || !contact || !city || !password) {
    return { success: false, message: 'All fields are required.' };
  }

  if (!isValidEmail(email)) {
    return { success: false, message: 'Invalid email address.' };
  }

  if (!/^\d{10}$/.test(contact)) {
    return { success: false, message: 'Contact must be a 10-digit number.' };
  }

  // ── Check for duplicate email ──
  const sheet = getUsersSheet();
  if (emailExists(sheet, email)) {
    return { success: false, message: 'This email is already registered. Please login.' };
  }

  // ── Generate unique ID ──
  const id = Date.now();

  // ── Append row ──
  sheet.appendRow([
    id,
    name,
    email,
    contact,
    city,
    password,
    new Date().toISOString()
  ]);

  Logger.log('New user registered: ' + email);

  return { success: true, message: 'Registration successful! You can now login.' };
}

/* ══════════════════════════════════════════════════════════════
   LOGIN USER
   ══════════════════════════════════════════════════════════════ */

/**
 * Validate login credentials.
 *
 * @param {Object} params - { email, password }
 * @returns {{ success: boolean, user?: Object, message?: string }}
 */
function loginUser(params) {
  const email    = (params.email    || '').trim().toLowerCase();
  const password = (params.password || '').trim();

  if (!email || !password) {
    return { success: false, message: 'Email and password are required.' };
  }

  const sheet = getUsersSheet();
  const data  = sheet.getDataRange().getValues();

  // Skip header row (row 0) if it exists
  const startRow = hasHeaderRow(data) ? 1 : 0;

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];

    const rowEmail    = String(row[COL.EMAIL    - 1] || '').trim().toLowerCase();
    const rowPassword = String(row[COL.PASSWORD  - 1] || '').trim();

    if (rowEmail === email && rowPassword === password) {
      // ── Match found — return safe user object (no password) ──
      return {
        success: true,
        user: {
          id:      row[COL.ID      - 1],
          name:    row[COL.NAME    - 1],
          email:   rowEmail,
          contact: row[COL.CONTACT - 1],
          city:    row[COL.CITY    - 1]
        }
      };
    }
  }

  return { success: false, message: 'Invalid email or password.' };
}

/* ══════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ══════════════════════════════════════════════════════════════ */

/**
 * Get the users sheet. Throws if not found.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getUsersSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) throw new Error('Sheet "' + USERS_SHEET + '" not found. Please create it.');
  return sheet;
}

/**
 * Check if an email already exists in the sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} email
 * @returns {boolean}
 */
function emailExists(sheet, email) {
  const data     = sheet.getDataRange().getValues();
  const startRow = hasHeaderRow(data) ? 1 : 0;

  for (let i = startRow; i < data.length; i++) {
    const rowEmail = String(data[i][COL.EMAIL - 1] || '').trim().toLowerCase();
    if (rowEmail === email) return true;
  }
  return false;
}

/**
 * Detect whether the sheet has a header row.
 * Assumes header if first cell is text like 'id', 'ID', 'name', etc.
 * @param {Array<Array>} data
 * @returns {boolean}
 */
function hasHeaderRow(data) {
  if (data.length === 0) return false;
  const firstCell = String(data[0][0] || '').toLowerCase();
  return isNaN(Number(firstCell)) && firstCell !== '';
}

/**
 * Basic email format validation.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ══════════════════════════════════════════════════════════════
   SHEET INITIALISER (run once manually to set up headers)
   ══════════════════════════════════════════════════════════════ */

/**
 * Run this function ONCE manually from Apps Script editor
 * to create the users sheet with proper column headers.
 *
 * Go to: Apps Script editor → Select 'initSheet' → Run ▶
 */
function initSheet() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  let sheet      = ss.getSheetByName(USERS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    Logger.log('Created sheet: ' + USERS_SHEET);
  }

  // Only set headers if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'name', 'email', 'contact', 'city', 'password', 'createdAt']);

    // Style the header row
    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#e6403a');
    headerRange.setFontColor('#ffffff');

    // Auto-resize columns
    sheet.autoResizeColumns(1, 7);

    Logger.log('Headers set in sheet: ' + USERS_SHEET);
  } else {
    Logger.log('Sheet already has data — headers not overwritten.');
  }

  SpreadsheetApp.flush();
  Logger.log('initSheet complete ✅');
}
