/**
 * guides.luxandland.com -> Follow Up Boss (Cindy Litzinger's account, realcindylitz.followupboss.com)
 * Deploy as a Web App (Execute as: Me · Who has access: Anyone) from felicia@luxandland.com or cindy@luxandland.com.
 * Paste the /exec URL into the site: python build_site_cindy.py --endpoint <url>  (then push).
 *
 * MODES (one Script Property):
 *   LOG ONLY (default) – no FUB_API_KEY property: every submission is appended to the log sheet (if LOG_SHEET_ID is set), nothing goes to FUB.
 *   LIVE               – Project Settings -> Script Properties -> FUB_API_KEY = Cindy's Follow Up Boss API key. Never put the key in the HTML.
 *
 * What LIVE does per submission: create-or-merge the FUB person (FUB dedupes on email/phone), add one-word tags, set the stage,
 * write a note (which guide, address, consent, page + ?src=cN), and enroll the matching action plan. One QR plan per person:
 * a second guide request adds tags + a note but does not enroll a second plan (the first plan already sends the other pieces).
 */
const FUB = 'https://api.followupboss.com/v1/';
const LOG_SHEET_ID = '';            // optional: a Google Sheet id for a paper trail. Blank = no sheet logging.
const LOG_TAB = 'Leads';
const LOG_HEADERS = ['Timestamp', 'Offer', 'Name', 'Email', 'Phone', 'Address', 'Interest', 'Message', 'Consent', 'Page', 'Src', 'FUB result', 'FUB id'];

// Plan ids are filled in by _build/fub_build_cindy.py (it prints them). Keep in sync with the FUB account.
const PLAN_ID_QR_GUIDE     = 33;     // "QR: Why Didn't It Sell"
const PLAN_ID_QR_PLAN      = 34;      // "QR: Relaunch Plan"
const PLAN_ID_QR_TIMELINE  = 35;  // "QR: Fall-to-Spring Timeline"
const PLAN_ID_QR_NEXTYEAR  = 36;  // "QR: Thinking About Next Year"
const PLAN_ID_WEBSITE      = 37;   // "Website Contact (guides.luxandland.com)"
const QR_PLAN_IDS = [PLAN_ID_QR_GUIDE, PLAN_ID_QR_PLAN, PLAN_ID_QR_TIMELINE, PLAN_ID_QR_NEXTYEAR];

// Tags are ONE WORD (BoldTrail splits hashtags on spaces; the FUB->BoldTrail Zap carries them over).
const OFFERS = {
  guide:    { tags: ['luxuryexpired', 'qrguide'],    stage: 'Luxury', plan: PLAN_ID_QR_GUIDE },
  plan:     { tags: ['luxuryexpired', 'qrplan'],     stage: 'Luxury', plan: PLAN_ID_QR_PLAN },
  timeline: { tags: ['luxuryexpired', 'qrtimeline'], stage: 'Luxury', plan: PLAN_ID_QR_TIMELINE },
  nextyear: { tags: ['luxury', 'qrnextyear'],        stage: 'Luxury', plan: PLAN_ID_QR_NEXTYEAR },
  contact:  { tags: ['websitecontact'],              stage: null,     plan: PLAN_ID_WEBSITE }
};

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { d = {}; }
  const offer = OFFERS[d.offer] ? d.offer : 'guide';
  const src = ((d.page || '').match(/[?&]src=([^&#]+)/) || [])[1] || (offer === 'contact' ? 'website' : '');
  const key = PropertiesService.getScriptProperties().getProperty('FUB_API_KEY');
  let fub = { result: 'not sent (log-only mode: FUB_API_KEY not set)', id: '' };
  if (key) fub = sendToFub_(d, offer, src, key);
  let logged = false;
  if (LOG_SHEET_ID) {
    try {
      logToSheet_([new Date(), offer, d.name || '', d.email || '', d.phone || '', d.address || '', d.interest || '', d.message || '',
                   d.consent ? 'YES' : 'no', d.page || '', src, fub.result, fub.id]);
      logged = true;
    } catch (err) { fub.result += ' | LOG ERROR ' + err; }
  }
  return out_({ ok: true, logged: logged, fub: fub.result, id: fub.id });
}

function doGet() { return out_({ ok: true, service: 'guides.luxandland.com-to-fub', mode: PropertiesService.getScriptProperties().getProperty('FUB_API_KEY') ? 'live' : 'log-only' }); }

function sendToFub_(d, offer, src, key) {
  try {
    const cfg = OFFERS[offer];
    const name = (d.name || '').trim().split(/\s+/);
    const first = name.shift() || '', last = name.join(' ');
    const addr = (d.address || '').split(',').map(s => s.trim());
    const person = {
      firstName: first, lastName: last,
      emails: d.email ? [{ value: d.email, type: 'home' }] : [],
      phones: d.phone ? [{ value: d.phone, type: 'mobile' }] : [],
      addresses: d.address ? [{ street: addr[0] || '', city: addr[1] || '', state: 'CA' }] : [],
      tags: cfg.tags,
      source: offer === 'contact' ? 'guides.luxandland.com' : 'Postcard QR'
    };
    if (cfg.stage) person.stage = cfg.stage;
    const auth = { Authorization: 'Basic ' + Utilities.base64Encode(key + ':'), 'X-System': 'LuxAndLand-Guides', 'X-System-Key': 'luxandland-guides' };
    const r = UrlFetchApp.fetch(FUB + 'people?deduplicate=true', { method: 'post', contentType: 'application/json', headers: auth, payload: JSON.stringify(person), muteHttpExceptions: true });
    const body = JSON.parse(r.getContentText() || '{}');
    const id = body.id;
    if (!id) return { result: 'FUB ERROR ' + r.getResponseCode() + ' ' + (body.errorMessage || r.getContentText()).slice(0, 200), id: '' };
    UrlFetchApp.fetch(FUB + 'notes', { method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
      payload: JSON.stringify({ personId: id, subject: (offer === 'contact' ? 'Website contact' : 'Guide request: ' + offer),
        body: 'Requested: ' + offer + '\nProperty: ' + (d.address || '') + (d.interest ? '\nInterest: ' + d.interest : '') + (d.message ? '\nMessage: ' + d.message : '') +
              '\nConsent to call/text: ' + (d.consent ? 'YES' : 'no') + '\nPage: ' + (d.page || '') + (src ? '\nPostcard: ' + src : '') + '\nSubmitted: ' + (d.ts || new Date().toISOString()) }) });
    let result = 'created/merged';
    if (cfg.plan) {
      const already = QR_PLAN_IDS.indexOf(cfg.plan) >= 0 ? currentQrPlan_(id, auth) : null;
      if (already) {
        UrlFetchApp.fetch(FUB + 'notes', { method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
          payload: JSON.stringify({ personId: id, subject: 'Second guide request: ' + offer, body: 'Also requested "' + offer + '" but is already in QR plan ' + already + '. Not re-enrolled (one QR plan per person). Send the piece by hand if they ask.' }) });
        result += ', already in plan ' + already + ' (not re-enrolled)';
      } else {
        const en = UrlFetchApp.fetch(FUB + 'actionPlansPeople', { method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true, payload: JSON.stringify({ personId: id, actionPlanId: cfg.plan }) });
        result += en.getResponseCode() < 300 ? ', enrolled in plan ' + cfg.plan : ', plan enroll FAILED ' + en.getResponseCode();
      }
    }
    return { result: result, id: String(id) };
  } catch (err) { return { result: 'FUB ERROR ' + err, id: '' }; }
}

function currentQrPlan_(personId, auth) {
  try {
    const r = UrlFetchApp.fetch(FUB + 'actionPlansPeople?personId=' + personId + '&limit=100', { headers: auth, muteHttpExceptions: true });
    const b = JSON.parse(r.getContentText() || '{}');
    const list = b.actionplanspeople || b.actionPlansPeople || [];
    for (let i = 0; i < list.length; i++) if (QR_PLAN_IDS.indexOf(list[i].actionPlanId) >= 0) return list[i].actionPlanId;
  } catch (err) {}
  return null;
}

function logToSheet_(row) {
  const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) { sh = ss.getSheets()[0]; sh.setName(LOG_TAB); }
  if (sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue()).trim() !== LOG_HEADERS[0]) {
    sh.insertRowBefore(1); sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1);
  }
  sh.appendRow(row);
}

function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

// Run from the editor once LIVE to confirm the key: logs Cindy's FUB identity.
function testIdentity() {
  const key = PropertiesService.getScriptProperties().getProperty('FUB_API_KEY');
  const r = UrlFetchApp.fetch(FUB + 'identity', { headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':'), 'X-System': 'LuxAndLand-Guides', 'X-System-Key': 'luxandland-guides' }, muteHttpExceptions: true });
  Logger.log(r.getContentText());
}
