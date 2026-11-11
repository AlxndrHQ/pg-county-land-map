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

/** Health check used by the map's "Test" button. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!keyOk_(p.key)) return json_({ ok: false, error: 'bad key' });
  return json_({ ok: true, doc: openDoc_().getName() });
}

/** Append one note. Body: JSON {key, project, kind, text, at, parcels:[{label, url}]}. */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!keyOk_(d.key)) return json_({ ok: false, error: 'bad key' });
  const text = String(d.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return json_({ ok: false, error: 'empty note' });

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
  return json_({ ok: true });
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
