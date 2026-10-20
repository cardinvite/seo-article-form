const CONFIG = Object.freeze({
  // Lấy phần nằm giữa /d/ và /edit trong URL Google Sheet.
  SPREADSHEET_ID: '1w9xGZOy5ckw6N0cNAlDM6a46t-SpfBxh0FOMUXMpiJ0',
  SHEET_NAME: 'SEO Posts',
  TIME_ZONE: 'Asia/Ho_Chi_Minh',
  MAX_CELL_LENGTH: 45000,
});

// Đăng nhập giống repo goldhome-edu-dangky: nút "Sign in with Google" trên GitHub Pages lấy
// Google ID token, máy chủ xác minh token rồi cấp phiên HMAC riêng. Web App chạy "Execute as: Me".
// Script Properties: GOOGLE_CLIENT_ID (bắt buộc), SESSION_SECRET (tự tạo khi chạy setup()).
const AUTH = Object.freeze({
  SESSION_HOURS: 24,
  MAX_BODY_LENGTH: 500000,
  TOKEN_ISSUERS: ['accounts.google.com', 'https://accounts.google.com'],
});

// Tab Users: mỗi người một dòng. role = ADMIN (được xóa bài) hoặc EDITOR (xem, tạo, sửa).
// Đặt active = FALSE để khóa (hiệu lực sau tối đa 60 giây do cache), kể cả khi phiên còn hạn.
const USERS_SHEET_NAME = 'Users';
const USER_HEADERS = Object.freeze(['email', 'name', 'role', 'active']);
const ROLES = Object.freeze(['ADMIN', 'EDITOR']);

const LIST_HEADERS = Object.freeze([
  'submission_id',
  'created_at',
  'post_title',
  'post_name',
  'focus_keyword',
  'post_status',
  'seo_score',
  'word_count',
  'updated_at',
  'updated_by',
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

const DATE_HEADERS = Object.freeze(['created_at', 'submitted_at', 'publish_at', 'updated_at']);
const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';
const VALID_STATUSES = Object.freeze(['draft', 'pending', 'publish']);
const VALID_VISIBILITIES = Object.freeze(['public', 'password', 'private']);

// Cache (CacheService) để mỗi request đọc Sheet ít nhất có thể. Lưu/xóa bài qua API xóa cache
// danh sách ngay; sửa tay trong Sheet thì bấm "Làm mới" (bỏ qua cache) hoặc chờ hết hạn.
const CACHE = Object.freeze({
  USERS_KEY: 'users_v1',
  USERS_SECONDS: 60,
  POSTS_KEY: 'posts_v1',
  POSTS_SECONDS: 300,
  HEADERS_KEY: `headers_ok_${HEADERS.length}`,
  HEADERS_SECONDS: 21600,
  MAX_VALUE_LENGTH: 95000,
});

let spreadsheet_;

function setup() {
  validateConfig_();
  const sheet = getOrCreateSheet_();
  ensureHeaders_(sheet);
  formatSheet_(sheet);

  const users = getUsersSheet_();
  if (users.getLastRow() < 2) {
    users.appendRow([Session.getEffectiveUser().getEmail().toLowerCase(), 'Admin', 'ADMIN', true]);
  }
  sessionSecret_();
  installWarmTrigger_();
  if (!PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')) {
    Logger.log('Chưa có Script Property GOOGLE_CLIENT_ID — xem GOOGLE-SHEETS-SETUP.md.');
  }
  return `Đã sẵn sàng: ${sheet.getParent().getUrl()}#gid=${sheet.getSheetId()}`;
}

function doGet() {
  return json_({ ok: true, data: { service: 'Gold Home SEO API', message: 'Mở trang quản trị trên GitHub Pages để sử dụng.' } });
}

// Trang quản trị gửi JSON với Content-Type text/plain để tránh CORS preflight (Apps Script không xử lý OPTIONS).
function doPost(event) {
  try {
    const body = parseBody_(event);
    const user = body.action === 'login'
      ? activeUser_(verifyIdToken_(body.idToken))
      : activeUser_(verifySession_(body.token));
    return json_({ ok: true, data: dispatch_(body, user) });
  } catch (error) {
    if (error instanceof ApiError) return json_({ ok: false, code: error.code, message: error.message });
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, code: 'ERROR', message: String(error && error.message ? error.message : error) });
  }
}

function dispatch_(body, user) {
  switch (body.action) {
    // login/me trả kèm danh sách bài để trang chỉ cần một lượt gọi khi mở.
    case 'login': {
      const session = createSession_(user.email);
      return Object.assign({ me: publicUser_(user), session: session.token, sessionExpiresAt: session.expiresAt }, cachedPosts_());
    }
    case 'me':
      return Object.assign({ me: publicUser_(user) }, cachedPosts_());
    case 'list':
      return body.force ? refreshPostsCache_() : cachedPosts_();
    case 'get':
      return getPost_(body.submission_id);
    case 'save':
      return savePost_(user.email, body.post || {});
    case 'delete':
      if (user.role !== 'ADMIN') throw new ApiError('FORBIDDEN', 'Chỉ ADMIN được xóa bài viết.');
      return deletePost_(body.submission_id, user.email);
    default:
      throw new ApiError('BAD_REQUEST', 'Thao tác không hợp lệ.');
  }
}

function listPosts_() {
  const sheet = getReadySheet_();
  // Chỉ đọc các cột cần cho danh sách, bỏ qua content/excerpt dài.
  const posts = sheet.getLastRow() < 2 ? [] : readColumns_(sheet, LIST_HEADERS)
    .map(listItem_)
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  return { posts, stats: statsOf_(posts) };
}

function listItem_(record) {
  return {
    submission_id: text_(record.submission_id),
    post_title: text_(record.post_title),
    post_name: text_(record.post_name),
    rank_math_focus_keyword: text_(record.focus_keyword),
    post_status: text_(record.post_status),
    seo_score: Number(record.seo_score) || 0,
    word_count: Number(record.word_count) || 0,
    created_at: toIso_(record.created_at),
    updated_at: toIso_(record.updated_at),
    updated_by: text_(record.updated_by),
  };
}

function statsOf_(posts) {
  return posts.reduce((stats, post) => {
    stats.total += 1;
    if (Object.prototype.hasOwnProperty.call(stats, post.post_status)) stats[post.post_status] += 1;
    return stats;
  }, { total: 0, draft: 0, pending: 0, publish: 0 });
}

function cachedPosts_() {
  const cached = CacheService.getScriptCache().get(CACHE.POSTS_KEY);
  if (cached) return JSON.parse(cached);
  return refreshPostsCache_();
}

function refreshPostsCache_() {
  const result = listPosts_();
  const json = JSON.stringify(result);
  // CacheService giới hạn 100KB mỗi key; danh sách quá lớn thì đọc thẳng Sheet.
  if (json.length <= CACHE.MAX_VALUE_LENGTH) CacheService.getScriptCache().put(CACHE.POSTS_KEY, json, CACHE.POSTS_SECONDS);
  return result;
}

function invalidatePostsCache_() {
  CacheService.getScriptCache().remove(CACHE.POSTS_KEY);
}

// Trigger 5 phút/lần (setup() tạo): nạp sẵn cache để người mở trang không phải chờ đọc Sheet.
function warmCache() {
  refreshPostsCache_();
  readUsers_(true);
}

function installWarmTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'warmCache');
  if (!exists) ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(5).create();
}

function getPost_(submissionId) {
  const sheet = getReadySheet_();
  const rowNumber = findSubmissionRow_(sheet, String(submissionId || ''));
  if (!rowNumber) throw new Error('Không tìm thấy bài viết.');
  const row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  return payloadFromRecord_(recordFromRow_(row));
}

function deletePost_(submissionId, userEmail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getReadySheet_();
    const rowNumber = findSubmissionRow_(sheet, String(submissionId || ''));
    if (!rowNumber) throw new Error('Không tìm thấy bài viết hoặc bài đã được xóa.');
    const title = sheet.getRange(rowNumber, HEADERS.indexOf('post_title') + 1).getDisplayValue();
    sheet.deleteRow(rowNumber);
    invalidatePostsCache_();
    return { success: true, submission_id: submissionId, post_title: title, deleted_by: userEmail };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function savePost_(adminEmail, payload) {
  validatePayload_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getReadySheet_();
    const isUpdate = Boolean(String(payload.submission_id || '').trim());
    const submissionId = isUpdate ? String(payload.submission_id).trim() : Utilities.getUuid();
    const existingRow = isUpdate ? findSubmissionRow_(sheet, submissionId) : 0;
    if (isUpdate && !existingRow) {
      throw new Error('Bài viết đã bị xóa bởi quản trị viên khác. Hãy sao chép nội dung cần giữ rồi tạo bài mới.');
    }
    const existingRecord = existingRow
      ? recordFromRow_(sheet.getRange(existingRow, 1, 1, HEADERS.length).getValues()[0])
      : null;
    if (existingRecord && toIso_(existingRecord.updated_at) !== String(payload.base_updated_at || '')) {
      const editor = text_(existingRecord.updated_by) || 'quản trị viên khác';
      throw new Error(`Bài viết vừa được ${editor} cập nhật. Hãy tải lại bài trước khi lưu để không ghi đè thay đổi của họ.`);
    }
    const record = buildRecord_(payload, submissionId, adminEmail);

    if (existingRecord && existingRecord.created_at) record.created_at = existingRecord.created_at;
    validateRecordLengths_(record);
    const values = HEADERS.map(header => safeCell_(record[header]));
    const targetRow = existingRow || sheet.getLastRow() + 1;
    if (targetRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    const range = sheet.getRange(targetRow, 1, 1, HEADERS.length);

    // Định dạng trước khi ghi để Sheet không tự đổi chuỗi thành số/ngày (vd: mật khẩu "0123").
    range.setNumberFormats([values.map(numberFormatFor_)]);
    range.setValues([values]);
    invalidatePostsCache_();

    // Trả về dòng danh sách để trang cập nhật tại chỗ, không phải tải lại toàn bộ.
    return {
      success: true,
      operation: existingRow ? 'updated' : 'created',
      mode: existingRow ? 'updated' : 'created',
      submission_id: submissionId,
      row: targetRow,
      post: listItem_(record),
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
    post_password: payload.visibility === 'password' ? payload.post_password || '' : '',
    sticky: toBoolean_(payload.sticky),
    comment_status: payload.comment_status || 'closed',
    ping_status: payload.ping_status || 'closed',
    seo_score: Math.min(100, Math.max(0, Math.round(Number(payload.seo_score) || 0))),
    word_count: Number(payload.word_count) || countWords_(payload.content),
    page_url: payload.page_url || '',
    client_user_agent: payload.client_user_agent || '',
    updated_at: new Date(Math.floor(Date.now() / 1000) * 1000),
    updated_by: adminEmail,
  };
}

function payloadFromRecord_(record) {
  return {
    submission_id: text_(record.submission_id),
    post_title: text_(record.post_title),
    post_name: text_(record.post_name),
    content: text_(record.content),
    post_excerpt: text_(record.post_excerpt),
    'post_category[]': splitValue_(text_(record.categories)),
    rank_math_primary_category: text_(record.primary_category),
    'tax_input[post_tag]': text_(record.tags),
    featured_image_url: text_(record.featured_image_url),
    featured_image_alt: text_(record.featured_image_alt),
    rank_math_focus_keyword: text_(record.focus_keyword),
    rank_math_title: text_(record.seo_title),
    rank_math_description: text_(record.seo_description),
    rank_math_canonical_url: text_(record.canonical_url),
    'rank_math_robots[]': splitValue_(text_(record.robots)),
    rank_math_schema_type: text_(record.schema_type) || 'BlogPosting',
    rank_math_pillar_content: toBoolean_(record.pillar_content) ? '1' : '',
    rank_math_facebook_title: text_(record.facebook_title),
    rank_math_facebook_description: text_(record.facebook_description),
    rank_math_facebook_image: text_(record.facebook_image),
    rank_math_twitter_card_type: text_(record.twitter_card_type) || 'summary_large_image',
    rank_math_twitter_use_facebook: toBoolean_(record.twitter_use_facebook) ? '1' : '',
    rank_math_twitter_title: text_(record.twitter_title),
    rank_math_twitter_description: text_(record.twitter_description),
    rank_math_twitter_image: text_(record.twitter_image),
    post_status: text_(record.post_status) || 'draft',
    publish_at: toLocalInput_(record.publish_at),
    post_author: text_(record.post_author),
    visibility: text_(record.visibility) || 'public',
    post_password: text_(record.post_password),
    sticky: toBoolean_(record.sticky) ? '1' : '',
    comment_status: text_(record.comment_status) || 'closed',
    ping_status: text_(record.ping_status) || 'closed',
    seo_score: Number(record.seo_score) || 0,
    word_count: Number(record.word_count) || 0,
    created_at: toIso_(record.created_at),
    updated_at: toIso_(record.updated_at),
    base_updated_at: toIso_(record.updated_at),
    updated_by: text_(record.updated_by),
  };
}

function ApiError(code, message) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

function parseBody_(event) {
  const raw = event && event.postData ? String(event.postData.contents || '') : '';
  if (!raw) throw new ApiError('BAD_REQUEST', 'Request body trống.');
  if (raw.length > AUTH.MAX_BODY_LENGTH) throw new ApiError('BAD_REQUEST', 'Dữ liệu gửi lên quá lớn.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw new ApiError('BAD_REQUEST', 'Dữ liệu gửi lên không phải JSON hợp lệ.');
  }
  if (!body || typeof body.action !== 'string') throw new ApiError('BAD_REQUEST', 'Thiếu thao tác.');
  return body;
}

// Xác minh Google ID token từ nút "Sign in with Google"; kết quả cache theo token (tối đa 10 phút).
function verifyIdToken_(idToken) {
  if (!idToken) throw new ApiError('AUTH', 'Vui lòng đăng nhập.');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new ApiError('CONFIG', 'Chưa cấu hình GOOGLE_CLIENT_ID trong Script Properties.');

  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken))).slice(0, 43);
  const cached = cache.get(key);
  if (cached) return cached;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'post',
    payload: { id_token: String(idToken) },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new ApiError('AUTH', 'Phiên đăng nhập Google đã hết hạn, vui lòng đăng nhập lại.');
  }
  const info = JSON.parse(response.getContentText());
  if (info.aud !== clientId) throw new ApiError('AUTH', 'Token không dành cho ứng dụng này.');
  if (!AUTH.TOKEN_ISSUERS.includes(info.iss)) throw new ApiError('AUTH', 'Token không do Google phát hành.');
  if (String(info.email_verified) !== 'true') throw new ApiError('AUTH', 'Email Google chưa được xác minh.');

  const email = String(info.email || '').trim().toLowerCase();
  if (!email) throw new ApiError('AUTH', 'Token không có email.');
  const ttl = Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000));
  if (ttl > 30) cache.put(key, email, ttl);
  return email;
}

// Phiên dạng "<payload>.<chữ ký HMAC>", payload = {e: email, x: hạn (ms)}.
// Không lưu phiên ở đâu cả; đổi SESSION_SECRET là mọi phiên cũ mất hiệu lực.
function createSession_(email) {
  const expiresAt = Date.now() + AUTH.SESSION_HOURS * 3600 * 1000;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: expiresAt }), Utilities.Charset.UTF_8);
  return { token: `${payload}.${signSession_(payload)}`, expiresAt: new Date(expiresAt).toISOString() };
}

function verifySession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !safeEqual_(parts[1], signSession_(parts[0]))) {
    throw new ApiError('AUTH', 'Vui lòng đăng nhập.');
  }
  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (error) {
    throw new ApiError('AUTH', 'Vui lòng đăng nhập.');
  }
  if (!data.e || !(data.x > Date.now())) {
    throw new ApiError('AUTH', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }
  return data.e;
}

function signSession_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sessionSecret_()));
}

// So sánh không dừng sớm để không lộ chữ ký qua thời gian phản hồi.
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

// Kiểm tra tab Users (qua cache 60 giây) ở mọi request, kể cả khi phiên còn hạn.
function activeUser_(email) {
  const user = readUsers_().find(item => item.email === email);
  if (!user || !user.active) {
    throw new ApiError('NOT_ALLOWED', `Tài khoản ${email} chưa được cấp quyền. Liên hệ ADMIN.`);
  }
  return user;
}

// Cache 60 giây: đặt active = FALSE trong Sheet có hiệu lực sau tối đa CACHE.USERS_SECONDS.
function readUsers_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const cached = cache.get(CACHE.USERS_KEY);
    if (cached) return JSON.parse(cached);
  }
  const users = readUsersFromSheet_();
  cache.put(CACHE.USERS_KEY, JSON.stringify(users), CACHE.USERS_SECONDS);
  return users;
}

function readUsersFromSheet_() {
  const sheet = getUsersSheet_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, USER_HEADERS.length).getValues()
    .map(([email, name, role, active]) => {
      const normalizedEmail = text_(email).trim().toLowerCase();
      const normalizedRole = text_(role).trim().toUpperCase();
      const activeText = text_(active).trim().toLowerCase();
      return {
        email: normalizedEmail,
        name: text_(name).trim() || normalizedEmail,
        role: ROLES.includes(normalizedRole) ? normalizedRole : 'EDITOR',
        active: activeText !== 'false' && activeText !== '0',
      };
    })
    .filter(user => user.email);
}

function publicUser_(user) {
  return { email: user.email, name: user.name, role: user.role };
}

function getSpreadsheet_() {
  validateConfig_();
  if (!spreadsheet_) spreadsheet_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return spreadsheet_;
}

function getUsersSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(USERS_SHEET_NAME);
    sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS])
      .setBackground('#171717').setFontColor('#FFC31A').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:B').setNumberFormat('@');
  }
  return sheet;
}

// Kiểm tra header tối đa mỗi 6 giờ (cờ trong cache) thay vì ở mọi request.
function getReadySheet_() {
  const sheet = getOrCreateSheet_();
  const cache = CacheService.getScriptCache();
  if (!cache.get(CACHE.HEADERS_KEY)) {
    ensureHeaders_(sheet);
    cache.put(CACHE.HEADERS_KEY, '1', CACHE.HEADERS_SECONDS);
  }
  return sheet;
}

function getOrCreateSheet_() {
  const spreadsheet = getSpreadsheet_();
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
  if (sheet.getMaxRows() > 1) {
    const dataRows = sheet.getRange(2, 1, sheet.getMaxRows() - 1, HEADERS.length);
    dataRows.setNumberFormats(Array.from({ length: dataRows.getNumRows() }, () => HEADERS.map(columnFormatFor_)));
  }

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

function readColumns_(sheet, headers) {
  const rowCount = sheet.getLastRow() - 1;
  const indexes = headers.map(header => HEADERS.indexOf(header)).sort((a, b) => a - b);
  const records = Array.from({ length: rowCount }, () => ({}));

  // Gom các cột liền nhau thành một lần đọc để giảm số lần gọi Sheet.
  for (let start = 0; start < indexes.length;) {
    let end = start;
    while (end + 1 < indexes.length && indexes[end + 1] === indexes[end] + 1) end += 1;
    const firstColumn = indexes[start];
    const values = sheet.getRange(2, firstColumn + 1, rowCount, indexes[end] - firstColumn + 1).getValues();
    values.forEach((row, rowIndex) => {
      row.forEach((value, offset) => { records[rowIndex][HEADERS[firstColumn + offset]] = value; });
    });
    start = end + 1;
  }
  return records;
}

function recordFromRow_(row) {
  return HEADERS.reduce((record, header, index) => {
    record[header] = row[index];
    return record;
  }, {});
}

function validatePayload_(payload) {
  const required = ['post_title', 'content', 'rank_math_focus_keyword'];
  const missing = required.filter(key => !String(payload[key] || '').trim());
  if (missing.length) throw new Error(`Thiếu trường bắt buộc: ${missing.join(', ')}`);
  if (payload.post_status && !VALID_STATUSES.includes(payload.post_status)) {
    throw new Error('Trạng thái bài viết không hợp lệ.');
  }
  if (payload.visibility && !VALID_VISIBILITIES.includes(payload.visibility)) {
    throw new Error('Chế độ hiển thị không hợp lệ.');
  }

  const robots = splitValue_(payload['rank_math_robots[]']).map(value => value.toLowerCase());
  if (robots.includes('index') && robots.includes('noindex')) {
    throw new Error('Robots Meta không thể đồng thời chọn index và noindex.');
  }
  if (robots.includes('follow') && robots.includes('nofollow')) {
    throw new Error('Robots Meta không thể đồng thời chọn follow và nofollow.');
  }
}

function validateRecordLengths_(record) {
  const oversized = HEADERS.filter(header => {
    const value = record[header];
    return !(value instanceof Date) && typeof value !== 'number' && typeof value !== 'boolean'
      && String(value == null ? '' : value).length > CONFIG.MAX_CELL_LENGTH;
  });
  if (oversized.length) {
    throw new Error(`Dữ liệu vượt quá ${CONFIG.MAX_CELL_LENGTH.toLocaleString('vi-VN')} ký tự ở trường: ${oversized.join(', ')}.`);
  }
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

function text_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  return value == null ? '' : String(value);
}

function columnFormatFor_(header) {
  if (DATE_HEADERS.includes(header)) return DATE_FORMAT;
  if (header === 'seo_score' || header === 'word_count') return '0';
  return '@';
}

function numberFormatFor_(value) {
  if (value instanceof Date) return DATE_FORMAT;
  if (typeof value === 'number' || typeof value === 'boolean') return '0';
  return '@';
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
