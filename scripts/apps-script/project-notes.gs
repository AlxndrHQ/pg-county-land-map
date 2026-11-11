/**
 * Real Estate Map → "Project Notes" Google Doc
 *
 * A tiny web endpoint, bound to the Project Notes doc, that appends notes and
 * questions sent from the map's Projects panel. Newest entries go to the top,
 * right under the "Notes, newest first" heading.
 *
 * One-time setup (about 3 minutes), done from inside the Project Notes doc:
 *   1. Extensions › Apps Script. Replace everything in Code.gs with this file. Save.
 *   2. Choose the function "setup" in the toolbar and click Run. Approve the
 *      permission prompt (it asks to edit this document). Open "Execution log"
 *      and copy the key it prints.
 *   3. Deploy › New deployment › type "Web app".
 *        Execute as: Me.   Who has access: Anyone.
 *      Deploy, then copy the Web app URL (ends in /exec).
 *   4. On the map: Projects › "Connect Google Doc", paste the URL and the key, Test.
 *
 * Answers: write an answer as a paragraph under the note that starts with "↳" or "Answer"
 * (e.g. "↳ Answer (Claude): ..."). The map reads them back and shows them under the note.
 *
 * Automatic answers by Claude (Max plan, no API key): posting a question opens an empty issue
 * in a private GitHub repo, which starts the Claude Code routine "Real Estate Map: answer new
 * questions"; it answers every open question in this doc a few minutes later. Script Properties:
 *   GITHUB_TOKEN = fine-grained token, only that repo, Issues: read and write
 *   GITHUB_REPO  = AlxndrHQ/rem-answer-queue
 * The issue holds no question text. When these are set, Gemini (below) is not used.
 *
 * Automatic answers by Gemini (alternative): questions get answered by Gemini with Google Search
 * a minute or so after you post them. Needs a key with quota (the free tier may have none).
 *   1. Get a free key at https://aistudio.google.com/apikey (Create API key).
 *   2. Here: Project Settings (gear) › Script Properties › Add property
 *        GEMINI_API_KEY = <your key>   › Save.
 *   3. Choose "setupAnswers" in the toolbar, Run, approve the new permissions
 *      (it now also needs to reach the internet and schedule a short job).
 *   4. Deploy a new version (below).
 * A note counts as a question if it has a "?" or starts with who/what/why/how/etc.
 * Answers start "↳ Answer (Gemini):" and list their sources; treat them as leads to check.
 *
 * Updating: paste the new version over Code.gs, save, then Deploy › Manage deployments ›
 * Edit (pencil) › Version: New version › Deploy. The URL and key stay the same; don't run
 * setup() again unless you want a new key.
 *
 * Security: the endpoint accepts a note only with the right key, and can only
 * add text to this one document. The URL and key live in your browser only;
 * neither is in the public repo. To revoke access, run setup() again (new key)
 * or archive the deployment.
 */

// Filled in when the script is created as a standalone Drive file; empty when bound to the doc.
const DOC_ID = '';
const KEY_PROP = 'NOTES_KEY';
const DOC_PROP = 'NOTES_DOC_ID';
const MARKER = 'Notes, newest first';
const TZ = 'America/New_York';
const MAX_TEXT = 5000;

/** Run once from the editor: creates the key and remembers this doc. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  props.setProperty(KEY_PROP, key);
  props.setProperty(DOC_PROP, DOC_ID || DocumentApp.getActiveDocument().getId());
  Logger.log('Paste this key into the map (Projects › Connect Google Doc): ' + key);
}

/** Health check used by the map's "Test" button; with answers=1, also returns every note and its answers. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!keyOk_(p.key)) return json_({ ok: false, error: 'bad key' });
  const doc = openDoc_();
  if (p.answers !== '1') return json_({ ok: true, doc: doc.getName() });
  return json_({ ok: true, doc: doc.getName(), auto: claudeTrigger_() ? 'claude' : geminiKey_() ? 'gemini' : '', entries: entries_(doc.getBody()) });
}

const FOLLOW = /^\s*↳\s*follow-?up\b/i;
const ANSWER = /^\s*(↳(?!\s*follow-?up)|answer\b|a:)/i;

/** Adds "↳ Follow-up: …" at the end of a note's thread (after its answers, before its parcel bullets). */
function addFollowUp_(parent, text) {
  const minute = Utilities.formatDate(new Date(parent.at), TZ, 'yyyy-MM-dd HH:mm');
  const ptext = String(parent.text || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(String).join('\n');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const doc = openDoc_(), body = doc.getBody();
    const notes = notes_(body);
    const note = notes.filter(function (x) { return x.head.indexOf(minute) === 0 && x.text.join('\n') === ptext; })[0];
    if (!note) return json_({ ok: false, error: 'original note not found in the doc' });
    const para = body.insertParagraph(note.last + 1, '↳ Follow-up: ' + text.replace(/\s*\n+\s*/g, ' '))
      .setHeading(DocumentApp.ParagraphHeading.NORMAL);
    para.setIndentStart(18).setIndentFirstLine(18).setSpacingBefore(4);
    para.editAsText().setBold(false).setItalic(false).setBold(0, '↳ Follow-up:'.length - 1, true);
    doc.saveAndClose();
  } finally { lock.releaseLock(); }
  if (claudeTrigger_()) pingClaude_();
  return json_({ ok: true });
}

/** Notes under the marker: heading, text paragraphs, thread items, index of the last non-bullet paragraph. */
function notes_(body) {
  const out = [];
  let cur = null, started = false;
  for (let k = 0; k < body.getNumChildren(); k++) {
    const el = body.getChild(k), type = el.getType();
    if (type !== DocumentApp.ElementType.PARAGRAPH && type !== DocumentApp.ElementType.LIST_ITEM) continue;
    const text = el.asText().getText().trim();
    if (!started) { started = text === MARKER; continue; }
    if (type === DocumentApp.ElementType.PARAGRAPH && el.asParagraph().getHeading() === DocumentApp.ParagraphHeading.HEADING3) {
      cur = { head: text, text: [], thread: [], last: k }; out.push(cur); continue;
    }
    if (!cur || !text || type === DocumentApp.ElementType.LIST_ITEM) continue;
    cur.last = k;
    if (FOLLOW.test(text)) cur.thread.push({ k: 'f', t: text.replace(FOLLOW, '').replace(/^\s*:\s*/, '') });
    else if (ANSWER.test(text)) cur.thread.push({ k: 'a', t: text.replace(/^\s*↳\s*/, '') });
    else if (!cur.thread.length) cur.text.push(text);
  }
  return out;
}

/** Notes under the marker: [{head, text, answers}]. The map matches them by heading and text. */
function entries_(body) {
  return notes_(body).map(function (x) {
    return { head: x.head, text: x.text.join('\n'), thread: x.thread,
             answers: x.thread.filter(function (i) { return i.k === 'a'; }).map(function (i) { return i.t; }) };
  });
}

/** Append one note. Body: JSON {key, project, kind, text, at, parcels:[{label, url}]}. */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!keyOk_(d.key)) return json_({ ok: false, error: 'bad key' });
  const text = String(d.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return json_({ ok: false, error: 'empty note' });
  if (d.parent) return addFollowUp_(d.parent, text);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const doc = openDoc_();
    const body = doc.getBody();
    let i = markerIndex_(body) + 1;
    const when = Utilities.formatDate(d.at ? new Date(d.at) : new Date(), TZ, 'yyyy-MM-dd HH:mm');
    const kind = d.kind === 'question' ? 'Question' : 'Note';
    const project = String(d.project || 'Untitled project').slice(0, 120);

    body.insertParagraph(i++, when + ' · ' + project + ' · ' + kind)
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
    text.split(/\n+/).forEach(function (line) {
      body.insertParagraph(i++, line).setHeading(DocumentApp.ParagraphHeading.NORMAL);
    });
    (Array.isArray(d.parcels) ? d.parcels.slice(0, 50) : []).forEach(function (p) {
      const label = String(p.label || 'Parcel').slice(0, 200);
      const item = body.insertListItem(i++, label).setGlyphType(DocumentApp.GlyphType.BULLET);
      if (/^https:\/\/alxndrhq\.github\.io\//.test(String(p.url || ''))) item.setLinkUrl(String(p.url));
    });
    doc.saveAndClose();
  } finally {
    lock.releaseLock();
  }
  if (isQuestion_(text)) {
    if (claudeTrigger_()) pingClaude_();
    else if (geminiKey_()) scheduleAnswers_();
  }
  return json_({ ok: true });
}

// ---------- automatic answers (Gemini + Google Search) ----------
const QUESTION = /\?|^\s*(who|what|why|how|when|where|which|is|are|does|do|did|can|could|should|was|were|has|have)\b/i;
const MAX_PER_RUN = 3;
const SYSTEM = [
  'You answer research questions about land ownership in Prince George\'s County, Maryland, for a private research map.',
  'Search the web. Answer in 2 to 5 plain sentences, no markdown, no lists.',
  'Keep facts separate from inference: say "SDAT lists..." or "reporting says..." for facts, and "likely" or "probably" for inferences.',
  'Name a source for every factual claim (outlet or agency name in the text). If you cannot find a reliable answer, say what is unknown and what record to check next (deed, LLC filing on Maryland Business Express, SDAT).',
  'Never name, describe or speculate about a private individual homeowner. People who are public figures, executives or developers acting in business are fine.',
].join(' ');

function isQuestion_(t) { return QUESTION.test(String(t || '')); }

function claudeTrigger_() {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('GITHUB_TOKEN'), repo = p.getProperty('GITHUB_REPO');
  return token && /^[\w.-]+\/[\w.-]+$/.test(repo || '') ? { token: token, repo: repo } : null;
}

/** Starts the Claude routine. At most one start per 30 s; one run answers every open question. */
function pingClaude_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('CLAUDE_LAST_PING') || 0);
  if (Date.now() - last < 30 * 1000) return;
  props.setProperty('CLAUDE_LAST_PING', String(Date.now()));
  const t = claudeTrigger_();
  try {
    const when = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    const r = UrlFetchApp.fetch('https://api.github.com/repos/' + t.repo + '/issues', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + t.token, Accept: 'application/vnd.github+json' },
      payload: JSON.stringify({ title: 'New question ' + when, body: 'Answer every open question in Project Notes.' }),
    });
    Logger.log('Claude routine trigger: HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  } catch (err) { Logger.log('Claude routine trigger failed: ' + err.message); }
}

/** Run from the editor to check the Claude trigger without posting a question. */
function testClaudeTrigger() {
  if (!claudeTrigger_()) throw new Error('Add GITHUB_TOKEN and GITHUB_REPO under Project Settings › Script Properties first.');
  PropertiesService.getScriptProperties().deleteProperty('CLAUDE_LAST_PING');
  pingClaude_();
}
function geminiKey_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'); }

/** Run once from the editor after adding GEMINI_API_KEY: approves permissions and picks a model. */
function setupAnswers() {
  if (!geminiKey_()) throw new Error('Add GEMINI_API_KEY under Project Settings › Script Properties first.');
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('GEMINI_MODEL'); props.deleteProperty('GEMINI_MODELS');
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('tried_') === 0) props.deleteProperty(k); });
  Logger.log('Models to try, in order: ' + models_().join(', '));
  scheduleAnswers_(); ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'answerPending') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Automatic answers are on. Deploy a new version of the web app.');
}

/** A one-off job a few seconds out, so posting a note returns right away. */
function scheduleAnswers_() {
  const busy = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'answerPending'; });
  if (!busy) ScriptApp.newTrigger('answerPending').timeBased().after(5 * 1000).create();
}

/** Answers questions under the marker that have no "↳ Answer" yet. */
function answerPending() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'answerPending') ScriptApp.deleteTrigger(t);
  });
  const props = PropertiesService.getScriptProperties();
  for (let n = 0; n < MAX_PER_RUN; n++) {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    let job;
    try { job = nextQuestion_(openDoc_().getBody(), props); } finally { lock.releaseLock(); }
    if (!job) return;
    const tries = Number(props.getProperty(job.tag) || 0) + 1;
    props.setProperty(job.tag, String(tries));
    let ans;
    try { ans = askGemini_(job); } catch (err) {
      Logger.log('Gemini failed: ' + err.message);
      if (err.quota) props.setProperty(job.tag, String(tries - 1));   // not this question's fault; it stays queued
      else if (tries < 2) scheduleAnswers_();
      return;
    }
    lock.waitLock(30000);
    try {
      const doc = openDoc_(), body = doc.getBody();
      const again = nextQuestion_(body, props, job.tag);   // re-find it: the doc may have changed meanwhile
      if (again) insertAnswer_(body, again.after, ans);
      doc.saveAndClose();
    } finally { lock.releaseLock(); }
  }
  scheduleAnswers_();   // more may be waiting: keep going in short runs until none are left
}

/** The newest unanswered question (or the one with this tag), with the index of its last text paragraph. */
function nextQuestion_(body, props, wantTag) {
  let cur = null, started = false;
  const found = [];
  for (let k = 0; k < body.getNumChildren(); k++) {
    const el = body.getChild(k), type = el.getType();
    if (type !== DocumentApp.ElementType.PARAGRAPH && type !== DocumentApp.ElementType.LIST_ITEM) continue;
    const text = el.asText().getText().trim();
    if (!started) { started = text === MARKER; continue; }
    if (type === DocumentApp.ElementType.PARAGRAPH && el.asParagraph().getHeading() === DocumentApp.ParagraphHeading.HEADING3) {
      cur = { head: text, text: [], answered: false, after: k, parcels: [] }; found.push(cur); continue;
    }
    if (!cur || !text) continue;
    if (type === DocumentApp.ElementType.LIST_ITEM) { cur.parcels.push(text); continue; }
    if (ANSWER.test(text)) { cur.answered = true; continue; }
    if (!cur.parcels.length) { cur.text.push(text); cur.after = k; }
  }
  for (const q of found) {
    const qt = q.text.join('\n');
    q.tag = 'tried_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, q.head + '|' + qt)).slice(0, 16);
    if (wantTag) { if (q.tag === wantTag) return q; continue; }
    if (!q.answered && qt && isQuestion_(qt) && Number(props.getProperty(q.tag) || 0) < 2) { q.question = qt; return q; }
  }
  return null;
}

/** Flash models to try, newest first; the last one that worked goes first. */
function models_() {
  const props = PropertiesService.getScriptProperties();
  let list = JSON.parse(props.getProperty('GEMINI_MODELS') || 'null');
  if (!list) {
    list = listFlash_();
    props.setProperty('GEMINI_MODELS', JSON.stringify(list));
  }
  const good = props.getProperty('GEMINI_MODEL');
  return good ? [good].concat(list.filter(function (m) { return m !== good; })) : list;
}

function listFlash_() {
  // newest "flash" models that can generate text, so the script survives model retirements
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Gemini key rejected: ' + r.getContentText().slice(0, 200));
  const names = (JSON.parse(r.getContentText()).models || [])
    .filter(function (x) { return (x.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (x) { return x.name.replace(/^models\//, ''); })
    .filter(function (n) { return /^gemini-[\d.]+-flash(-lite)?$/.test(n); })
    .sort(function (a, b) {
      const v = parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]);
      return v || (a.indexOf('-lite') >= 0 ? 1 : 0) - (b.indexOf('-lite') >= 0 ? 1 : 0);
    });
  return names.length ? names.slice(0, 8) : ['gemini-2.5-flash'];
}

function askGemini_(q) {
  const ctx = q.head + (q.parcels.length ? '\nParcels it is about: ' + q.parcels.join('; ') : '');
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: 'Note heading: ' + ctx + '\nQuestion: ' + q.question }] }],
    tools: [{ google_search: {} }],
  });
  let r = null, last = '';
  const models = models_();
  for (let i = 0; i < models.length; i++) {
    r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': geminiKey_() }, payload: payload,
    });
    const code = r.getResponseCode();
    if (code === 200) { PropertiesService.getScriptProperties().setProperty('GEMINI_MODEL', models[i]); Logger.log('Answered with ' + models[i]); break; }
    last = models[i] + ' HTTP ' + code + ': ' + r.getContentText().slice(0, 200);
    Logger.log('Skipping ' + last);
    if (code !== 429 && code !== 404 && code !== 400 && code !== 403) throw new Error(last);
    r = null;
  }
  if (!r) { const e = new Error('no model with free quota left today (' + last + ')'); e.quota = true; throw e; }
  const c = (JSON.parse(r.getContentText()).candidates || [])[0] || {};
  const text = ((c.content && c.content.parts) || []).map(function (p) { return p.text || ''; }).join('').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('empty answer');
  const seen = {}, sources = [];
  (((c.groundingMetadata || {}).groundingChunks) || []).forEach(function (g) {
    if (g.web && g.web.uri && !seen[g.web.title || g.web.uri] && sources.length < 5) {
      seen[g.web.title || g.web.uri] = 1; sources.push({ title: g.web.title || 'source', url: g.web.uri });
    }
  });
  return { text: text.slice(0, 2500), sources: sources };
}

function insertAnswer_(body, after, ans) {
  const label = '↳ Answer (Gemini): ';
  const srcText = ans.sources.length ? ' Sources: ' + ans.sources.map(function (s) { return s.title; }).join(', ') + '.' : ' (No sources returned; treat as unverified.)';
  const para = body.insertParagraph(after + 1, label + ans.text + srcText).setHeading(DocumentApp.ParagraphHeading.NORMAL);
  para.setIndentStart(18).setIndentFirstLine(18).setSpacingBefore(4);
  const t = para.editAsText();
  t.setBold(false).setItalic(false).setBold(0, label.length - 2, true);
  let pos = (label + ans.text + ' Sources: ').length;
  ans.sources.forEach(function (s) {
    if (ans.sources.length) { t.setLinkUrl(pos, pos + s.title.length - 1, s.url); pos += s.title.length + 2; }
  });
}

function keyOk_(k) {
  const key = PropertiesService.getScriptProperties().getProperty(KEY_PROP);
  return !!key && typeof k === 'string' && k === key;
}

function openDoc_() {
  const id = PropertiesService.getScriptProperties().getProperty(DOC_PROP);
  if (!id) throw new Error('Run setup() first.');
  return DocumentApp.openById(id);
}

/** Index of the "Notes, newest first" heading; adds it at the end if missing. */
function markerIndex_(body) {
  const n = body.getNumChildren();
  for (let k = 0; k < n; k++) {
    const el = body.getChild(k);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH && el.asParagraph().getText().trim() === MARKER) return k;
  }
  body.appendParagraph(MARKER).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  return body.getNumChildren() - 1;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
