/**
 * Meta Instant Form leads: Google Sheet -> Integrallys CRM.
 *
 * Meta's Lead Ads integration writes each submission into this sheet through the Sheets
 * API. That means the simple onEdit/onFormSubmit triggers never fire — they only run for
 * edits made by a person in the UI. So this polls instead, on a 1-minute time-driven
 * trigger, and POSTs unsynced rows to the CRM, which stores them and notifies Slack.
 *
 * Setup lives in scripts/apps-script/README.md. Config is read from Script Properties,
 * never hard-coded here — this file is committed to a git repo.
 *
 * Quota note: a 1-minute trigger runs 1440x/day against a 90 min/day budget on consumer
 * Google accounts. syncNewLeads() therefore does the cheapest possible check first
 * (getLastRow() vs a cached count) and returns in well under a second when nothing was
 * added, which keeps daily use near 10% of that budget instead of ~40%.
 */

var MARKER_HEADER = 'Sincronizado'; // appended column; a timestamp here means "sent"
var MAX_ROWS_PER_RUN = 50;          // keeps a backlog run inside the 6-minute limit
var PROP_LAST_ROW = 'lastRow';
var PROP_PENDING = 'pendingRetries';

/** The 1-minute trigger's entry point. */
function syncNewLeads() {
  // Non-blocking: if the previous minute's run is still going, skip this one entirely
  // rather than queue up behind it.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;

  try {
    var props = PropertiesService.getScriptProperties();
    var config = readConfig_(props);
    var sheet = getSheet_(config.sheetName);
    var lastRow = sheet.getLastRow();

    // --- the cheap early exit ---
    var cachedLastRow = Number(props.getProperty(PROP_LAST_ROW) || 0);
    var hasPending = props.getProperty(PROP_PENDING) === 'true';
    if (lastRow <= cachedLastRow && !hasPending) return;

    if (lastRow < 2) { // header only
      props.setProperty(PROP_LAST_ROW, String(lastRow));
      return;
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var markerCol = ensureMarkerColumn_(sheet, headers);

    // Read the marker column alone first: on a normal run only the last row or two are
    // unsynced, so this avoids pulling the whole sheet into memory every minute.
    var markers = sheet.getRange(2, markerCol, lastRow - 1, 1).getValues();
    var unsyncedRows = [];
    for (var i = 0; i < markers.length; i++) {
      if (String(markers[i][0]).trim() === '') unsyncedRows.push(i + 2); // 1-based, +header
      if (unsyncedRows.length >= MAX_ROWS_PER_RUN) break;
    }

    if (unsyncedRows.length === 0) {
      props.setProperty(PROP_LAST_ROW, String(lastRow));
      props.deleteProperty(PROP_PENDING);
      return;
    }

    var width = sheet.getLastColumn();
    var anyFailed = false;

    for (var r = 0; r < unsyncedRows.length; r++) {
      var rowNumber = unsyncedRows[r];
      var values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
      var ok = postLead_(config, rowNumber, headers, values, markerCol);

      if (ok) {
        // Only mark AFTER a 2xx. A row left unmarked is simply retried next minute; a row
        // marked too early would be lost silently.
        sheet.getRange(rowNumber, markerCol).setValue(new Date());
      } else {
        anyFailed = true;
      }
    }

    // Flush the marker writes before the lock is released.
    SpreadsheetApp.flush();

    props.setProperty(PROP_LAST_ROW, String(lastRow));
    if (anyFailed) {
      // Force the next run past the early exit so failures get retried even when the
      // sheet hasn't grown since.
      props.setProperty(PROP_PENDING, 'true');
    } else {
      props.deleteProperty(PROP_PENDING);
    }
  } catch (err) {
    // Let it surface in the Executions log, but always release the lock.
    console.error('syncNewLeads failed: ' + (err && err.stack ? err.stack : err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** POST one row. Returns true only on a 2xx. */
function postLead_(config, rowNumber, headers, values, markerCol) {
  var fields = {};
  for (var c = 0; c < headers.length; c++) {
    if (c + 1 === markerCol) continue; // don't echo our own bookkeeping column back
    var header = String(headers[c]).trim();
    if (header === '') continue;
    var value = values[c];
    // Sheets hands back Date objects for date-formatted cells; ISO is what the CRM parses.
    fields[header] = (value instanceof Date) ? value.toISOString() : String(value);
  }

  var payload = {
    row: rowNumber,
    submitted_at: new Date().toISOString(), // fallback; the sheet's own date column wins
    fields: fields
  };

  var response;
  try {
    response = UrlFetchApp.fetch(config.crmUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true // inspect the status ourselves instead of throwing
    });
  } catch (err) {
    console.error('Row ' + rowNumber + ': request failed — ' + err);
    return false;
  }

  var status = response.getResponseCode();
  if (status >= 200 && status < 300) return true;

  console.error('Row ' + rowNumber + ': CRM responded ' + status + ' — ' + response.getContentText());
  return false;
}

function readConfig_(props) {
  var crmUrl = props.getProperty('CRM_URL');
  var secret = props.getProperty('FORM_LEADS_SECRET');
  var sheetName = props.getProperty('SHEET_NAME');
  if (!crmUrl || !secret) {
    throw new Error('Missing Script Properties: set CRM_URL and FORM_LEADS_SECRET (see README).');
  }
  return { crmUrl: crmUrl, secret: secret, sheetName: sheetName };
}

/** The configured tab, or the first one if SHEET_NAME isn't set. */
function getSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheetName) return ss.getSheets()[0];
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('No sheet named "' + sheetName + '" in this spreadsheet.');
  return sheet;
}

/**
 * Find the marker column, appending it if this is the first run. Returns its 1-based index.
 * A column (rather than a stored list of row numbers) is what makes dedupe idempotent and
 * survive rows being sorted or inserted.
 */
function ensureMarkerColumn_(sheet, headers) {
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).trim() === MARKER_HEADER) return c + 1;
  }
  var col = headers.length + 1;
  sheet.getRange(1, col).setValue(MARKER_HEADER);
  SpreadsheetApp.flush(); // so the caller's getLastColumn() sees the new column
  headers.push(MARKER_HEADER);
  return col;
}

// --- one-off setup helpers, run by hand from the Apps Script editor ---------------------

/**
 * Install the 1-minute trigger. Deletes any existing syncNewLeads triggers first, so
 * re-running this can never stack duplicates (which would double every notification).
 */
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('syncNewLeads').timeBased().everyMinutes(1).create();
  console.log('Installed: syncNewLeads every 1 minute.');
}

function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncNewLeads') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  console.log('Removed ' + removed + ' existing trigger(s).');
}

/**
 * Mark every existing row as already synced, without sending anything. Run this once
 * before installTrigger() if the sheet already holds old leads you don't want blasted
 * into Slack.
 */
function markAllRowsAsSynced() {
  var props = PropertiesService.getScriptProperties();
  var sheet = getSheet_(props.getProperty('SHEET_NAME'));
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { console.log('Nothing to mark.'); return; }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var markerCol = ensureMarkerColumn_(sheet, headers);
  var now = new Date();
  var stamps = [];
  for (var i = 0; i < lastRow - 1; i++) stamps.push([now]);

  sheet.getRange(2, markerCol, lastRow - 1, 1).setValues(stamps);
  props.setProperty(PROP_LAST_ROW, String(lastRow));
  props.deleteProperty(PROP_PENDING);
  console.log('Marked ' + (lastRow - 1) + ' existing row(s) as synced.');
}

/** Send the most recent row again, ignoring its marker. Useful for verifying setup. */
function testSendLastRow() {
  var props = PropertiesService.getScriptProperties();
  var config = readConfig_(props);
  var sheet = getSheet_(config.sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { console.log('No data rows to send.'); return; }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var markerCol = ensureMarkerColumn_(sheet, headers);
  var values = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  console.log(postLead_(config, lastRow, headers, values, markerCol) ? 'Sent OK.' : 'Failed — see the error above.');
}
