const CONFIG = Object.freeze({
  // Lấy phần nằm giữa /d/ và /edit trong URL Google Sheet.
  SPREADSHEET_ID: 'PASTE_GOOGLE_SHEET_ID_HERE',
  SHEET_NAME: 'SEO Posts',
  TIME_ZONE: 'Asia/Ho_Chi_Minh',
  MAX_CELL_LENGTH: 45000,
});

const ADMIN_EMAILS = Object.freeze([
  'dannguyen22993@gmail.com',
  'thanhdieuhr211@gmail.com',
  'nguyenthienhoang0412000@gmail.com',
]);

const HEADERS = Object.freeze([
  'submission_id',
  'created_at',
  'submitted_at',
  'target_site',
  'site_name',
  'post_title',
  'post_name',
  'content',
  'post_excerpt',
  'categories',
  'primary_category',
  'tags',
  'featured_image_url',
  'featured_image_file_name',
  'featured_image_alt',
  'focus_keyword',
  'seo_title',
  'seo_description',
  'canonical_url',
  'robots',
  'schema_type',
  'pillar_content',
  'facebook_title',
  'facebook_description',
  'facebook_image',
  'twitter_card_type',
  'twitter_use_facebook',
  'twitter_title',
  'twitter_description',
  'twitter_image',
  'post_status',
  'publish_at',
  'post_author',
  'visibility',
  'post_password',
  'sticky',
  'comment_status',
  'ping_status',
  'seo_score',
  'word_count',
  'page_url',
  'client_user_agent',
  'updated_at',
  'updated_by',
]);

function setup() {
  validateConfig_();
  const sheet = getOrCreateSheet_();
  ensureHeaders_(sheet);
  formatSheet_(sheet);
  return `Đã sẵn sàng: ${sheet.getParent().getUrl()}#gid=${sheet.getSheetId()}`;
}

function doGet() {
  validateConfig_();
  const template = HtmlService.createTemplateFromFile('Admin');
  template.appTitle = 'Gold Home SEO Studio';
  return template
    .evaluate()
    .setTitle('Gold Home SEO Studio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(event) {
  const admin = requireAdmin_();
  const payload = parsePayload_(event);
  return json_(savePost_(admin.email, payload));
}

function apiSession() {
  const admin = requireAdmin_();
  return {
    success: true,
    email: admin.email,
    displayName: admin.email.split('@')[0],
  };
}

function apiListPosts() {
  requireAdmin_();
  const sheet = getReadySheet_();
  if (sheet.getLastRow() < 2) {
    return { posts: [], stats: { total: 0, draft: 0, pending: 0, publish: 0 } };
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  const posts = rows
    .map(row => recordFromRow_(row))
    .map(record => ({
      submission_id: record.submission_id,
      post_title: record.post_title,
      post_name: record.post_name,
      rank_math_focus_keyword: record.focus_keyword,
      post_status: record.post_status,
      seo_score: Number(record.seo_score) || 0,
      word_count: Number(record.word_count) || 0,
      created_at: toIso_(record.created_at),
      updated_at: toIso_(record.updated_at),
      updated_by: record.updated_by || '',
    }))
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));

  return {
    posts,
    stats: posts.reduce((stats, post) => {
      stats.total += 1;
      if (Object.prototype.hasOwnProperty.call(stats, post.post_status)) stats[post.post_status] += 1;
      return stats;
    }, { total: 0, draft: 0, pending: 0, publish: 0 }),
  };
}

function apiGetPost(submissionId) {
  requireAdmin_();
  const sheet = getReadySheet_();
  const rowNumber = findSubmissionRow_(sheet, String(submissionId || ''));
  if (!rowNumber) throw new Error('Không tìm thấy bài viết.');
  const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  return payloadFromRecord_(recordFromRow_(row));
}

function apiSavePost(payload) {
  const admin = requireAdmin_();
  return savePost_(admin.email, payload || {});
}

function apiDeletePost(submissionId) {
  const admin = requireAdmin_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getReadySheet_();
    const rowNumber = findSubmissionRow_(sheet, String(submissionId || ''));
    if (!rowNumber) throw new Error('Không tìm thấy bài viết hoặc bài đã được xóa.');
    const title = sheet.getRange(rowNumber, HEADERS.indexOf('post_title') + 1).getDisplayValue();
    sheet.deleteRow(rowNumber);
    return { success: true, submission_id: submissionId, post_title: title, deleted_by: admin.email };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function savePost_(adminEmail, payload) {
  if (payload._gotcha) return { success: true, ignored: true };
  validatePayload_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getReadySheet_();
    const submissionId = String(payload.submission_id || Utilities.getUuid());
    const existingRow = findSubmissionRow_(sheet, submissionId);
    const existingRecord = existingRow
      ? recordFromRow_(sheet.getRange(existingRow, 1, 1, HEADERS.length).getValues()[0])
      : null;
    const record = buildRecord_(payload, submissionId, adminEmail);

    if (existingRecord && existingRecord.created_at) record.created_at = existingRecord.created_at;
    const values = HEADERS.map(header => safeCell_(record[header]));

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    return {
      success: true,
      operation: existingRow ? 'updated' : 'created',
      mode: existingRow ? 'updated' : 'created',
      submission_id: submissionId,
      row: existingRow || sheet.getLastRow(),
      post_title: record.post_title,
      updated_by: adminEmail,
    };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function buildRecord_(payload, submissionId, adminEmail) {
  return {
    submission_id: submissionId,
    created_at: new Date(),
    submitted_at: toDate_(payload.submitted_at) || new Date(),
    target_site: payload.target_site || 'https://goldhomecons.vn/',
    site_name: payload.site_name || 'Gold Home Construction',
    post_title: payload.post_title || '',
    post_name: payload.post_name || '',
    content: payload.content || '',
    post_excerpt: payload.post_excerpt || '',
    categories: joinValue_(payload['post_category[]']),
    primary_category: payload.rank_math_primary_category || '',
    tags: payload['tax_input[post_tag]'] || '',
    featured_image_url: payload.featured_image_url || '',
    featured_image_file_name: payload.featured_image_file_name || '',
    featured_image_alt: payload.featured_image_alt || '',
    focus_keyword: payload.rank_math_focus_keyword || '',
    seo_title: payload.rank_math_title || '',
    seo_description: payload.rank_math_description || '',
    canonical_url: payload.rank_math_canonical_url || '',
    robots: joinValue_(payload['rank_math_robots[]']),
    schema_type: payload.rank_math_schema_type || 'BlogPosting',
    pillar_content: toBoolean_(payload.rank_math_pillar_content),
    facebook_title: payload.rank_math_facebook_title || '',
    facebook_description: payload.rank_math_facebook_description || '',
    facebook_image: payload.rank_math_facebook_image || '',
    twitter_card_type: payload.rank_math_twitter_card_type || 'summary_large_image',
    twitter_use_facebook: toBoolean_(payload.rank_math_twitter_use_facebook),
    twitter_title: payload.rank_math_twitter_title || '',
    twitter_description: payload.rank_math_twitter_description || '',
    twitter_image: payload.rank_math_twitter_image || '',
    post_status: payload.post_status || 'draft',
    publish_at: toDate_(payload.publish_at),
    post_author: payload.post_author || adminEmail,
    visibility: payload.visibility || 'public',
    post_password: payload.post_password || '',
    sticky: toBoolean_(payload.sticky),
    comment_status: payload.comment_status || 'closed',
    ping_status: payload.ping_status || 'closed',
    seo_score: Number(payload.seo_score) || 0,
    word_count: Number(payload.word_count) || countWords_(payload.content),
    page_url: payload.page_url || '',
    client_user_agent: payload.client_user_agent || '',
    updated_at: new Date(),
    updated_by: adminEmail,
  };
}

function payloadFromRecord_(record) {
  return {
    submission_id: record.submission_id || '',
    post_title: record.post_title || '',
    post_name: record.post_name || '',
    content: record.content || '',
    post_excerpt: record.post_excerpt || '',
    'post_category[]': splitValue_(record.categories),
    rank_math_primary_category: record.primary_category || '',
    'tax_input[post_tag]': record.tags || '',
    featured_image_url: record.featured_image_url || '',
    featured_image_alt: record.featured_image_alt || '',
    rank_math_focus_keyword: record.focus_keyword || '',
    rank_math_title: record.seo_title || '',
    rank_math_description: record.seo_description || '',
    rank_math_canonical_url: record.canonical_url || '',
    'rank_math_robots[]': splitValue_(record.robots),
    rank_math_schema_type: record.schema_type || 'BlogPosting',
    rank_math_pillar_content: record.pillar_content ? '1' : '',
    rank_math_facebook_title: record.facebook_title || '',
    rank_math_facebook_description: record.facebook_description || '',
    rank_math_facebook_image: record.facebook_image || '',
    rank_math_twitter_card_type: record.twitter_card_type || 'summary_large_image',
    rank_math_twitter_use_facebook: record.twitter_use_facebook ? '1' : '',
    rank_math_twitter_title: record.twitter_title || '',
    rank_math_twitter_description: record.twitter_description || '',
    rank_math_twitter_image: record.twitter_image || '',
    post_status: record.post_status || 'draft',
    publish_at: toLocalInput_(record.publish_at),
    post_author: record.post_author || '',
    visibility: record.visibility || 'public',
    post_password: record.post_password || '',
    sticky: record.sticky ? '1' : '',
    comment_status: record.comment_status || 'closed',
    ping_status: record.ping_status || 'closed',
    seo_score: Number(record.seo_score) || 0,
    word_count: Number(record.word_count) || 0,
    created_at: toIso_(record.created_at),
    updated_at: toIso_(record.updated_at),
    updated_by: record.updated_by || '',
  };
}

function requireAdmin_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Không xác định được tài khoản Google. Hãy đăng nhập và triển khai Web App với Execute as: User accessing the web app.');
  }
  if (!ADMIN_EMAILS.includes(email)) {
    throw new Error(`Tài khoản ${email} không có quyền truy cập.`);
  }
  return { email };
}

function getReadySheet_() {
  validateConfig_();
  const sheet = getOrCreateSheet_();
  ensureHeaders_(sheet);
  return sheet;
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return spreadsheet.getSheetByName(CONFIG.SHEET_NAME) || spreadsheet.insertSheet(CONFIG.SHEET_NAME);
}

function ensureHeaders_(sheet) {
  ensureCapacity_(sheet);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    formatSheet_(sheet);
    return;
  }

  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  const usedHeaderCount = existing.reduce((last, value, index) => value ? index + 1 : last, 0);
  const mismatch = existing.slice(0, usedHeaderCount).some((header, index) => header !== HEADERS[index]);
  if (mismatch) throw new Error(`Header của sheet "${CONFIG.SHEET_NAME}" không đúng cấu trúc.`);

  if (usedHeaderCount < HEADERS.length) {
    const missing = HEADERS.slice(usedHeaderCount);
    sheet.getRange(1, usedHeaderCount + 1, 1, missing.length).setValues([missing]);
    formatSheet_(sheet);
  }
}

function formatSheet_(sheet) {
  ensureCapacity_(sheet);
  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  header.setBackground('#171717').setFontColor('#FFC31A').setFontWeight('bold').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(6, 280);
  sheet.setColumnWidth(8, 500);
  sheet.setColumnWidth(9, 320);
  sheet.setColumnWidth(17, 280);
  sheet.setColumnWidth(18, 360);
  sheet.getRange('B:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('AF:AF').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('AQ:AQ').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  const filter = sheet.getFilter();
  if (filter && filter.getRange().getNumColumns() !== HEADERS.length) filter.remove();
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).createFilter();
}

function ensureCapacity_(sheet) {
  const missingColumns = HEADERS.length - sheet.getMaxColumns();
  if (missingColumns > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
}

function findSubmissionRow_(sheet, submissionId) {
  if (!submissionId || sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(submissionId).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function recordFromRow_(row) {
  return HEADERS.reduce((record, header, index) => {
    record[header] = row[index];
    return record;
  }, {});
}

function parsePayload_(event) {
  if (!event || !event.postData || !event.postData.contents) throw new Error('Request body trống.');
  if (event.postData.contents.length > 500000) throw new Error('Payload vượt quá giới hạn 500 KB.');
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('Payload không phải JSON hợp lệ.');
  }
}

function validatePayload_(payload) {
  const required = ['post_title', 'content', 'rank_math_focus_keyword'];
  const missing = required.filter(key => !String(payload[key] || '').trim());
  if (missing.length) throw new Error(`Thiếu trường bắt buộc: ${missing.join(', ')}`);
}

function validateConfig_() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'PASTE_GOOGLE_SHEET_ID_HERE') {
    throw new Error('Chưa cấu hình SPREADSHEET_ID trong Code.gs.');
  }
}

function joinValue_(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value || '';
}

function splitValue_(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function toBoolean_(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'on', 'yes', 'sticky', 'open'].includes(String(value || '').toLowerCase());
}

function toDate_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function toIso_(value) {
  const date = toDate_(value);
  return date ? date.toISOString() : '';
}

function toLocalInput_(value) {
  const date = toDate_(value);
  if (!date) return '';
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
}

function countWords_(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function safeCell_(value) {
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  let text = String(value == null ? '' : value).slice(0, CONFIG.MAX_CELL_LENGTH);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
