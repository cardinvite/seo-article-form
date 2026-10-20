const config = window.GOLDHOME_SEO_CONFIG || {};
const SESSION_KEY = 'goldhome_seo_session';
const state = { session: null, token: '', posts: [], slugTouched: false };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  loginView: $('#login-view'),
  adminApp: $('#admin-app'),
  listView: $('#list-view'),
  editorView: $('#editor-view'),
  tbody: $('#posts-table-body'),
  empty: $('#posts-empty'),
  form: $('#post-form'),
  overlay: $('#loading-overlay'),
  loadingText: $('#loading-text'),
  toast: $('#toast')
};

// text/plain để tránh CORS preflight — Apps Script không xử lý OPTIONS và luôn 302 sang
// script.googleusercontent.com, fetch tự đi theo.
async function api(action, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs || 20000);
  let text;
  try {
    const response = await fetch(config.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: state.token, ...params }),
      signal: controller.signal,
    });
    text = await response.text();
    if (!response.ok) throw new Error(`Máy chủ Google trả lỗi tạm thời (HTTP ${response.status}). Vui lòng thử lại.`);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
    if (text !== undefined) throw error;
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng và Web App đã deploy với Who has access = Anyone.');
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    console.error('Phản hồi không phải JSON:', text.slice(0, 500));
    throw new Error('Máy chủ trả về HTML thay vì dữ liệu — kiểm tra Web App deploy với Execute as: Me và Who has access: Anyone.');
  }
  if (!body.ok) {
    if (body.code === 'AUTH' || body.code === 'NOT_ALLOWED') logout(body.message);
    throw Object.assign(new Error(body.message || 'Lỗi máy chủ.'), { code: body.code });
  }
  return body.data;
}

function loadSavedSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved && saved.token && new Date(saved.expiresAt) > new Date()) return saved.token;
  } catch (error) { /* private mode / dữ liệu hỏng */ }
  return '';
}

function saveSession(token, expiresAt) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); } catch (error) { /* ignore */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (error) { /* ignore */ }
}

function setLoginStatus(message, type = '') {
  const status = $('#login-status');
  status.textContent = message;
  status.className = 'login-status ' + type;
}

function setLoading(active, text = 'Đang xử lý...') {
  elements.loadingText.textContent = text;
  elements.overlay.hidden = !active;
}

let toastTimer;
function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = 'toast ' + type;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function getErrorMessage(error) {
  return String(error && error.message ? error.message : error).replace(/^Exception:\s*/, '');
}

function openAuthenticatedApp(me) {
  state.session = me;
  $('#account-email').textContent = `${me.email} · ${me.role}`;
  elements.loginView.hidden = true;
  elements.adminApp.hidden = false;
}

function initGoogle() {
  if (!config.googleClientId || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.appsScriptUrl || '')) {
    setLoginStatus('Chưa cấu hình googleClientId hoặc appsScriptUrl trong config.js.', 'error');
    return;
  }
  if (!(window.google && google.accounts && google.accounts.id)) {
    setTimeout(initGoogle, 150);
    return;
  }
  google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: (response) => loginWithGoogle(response.credential),
    auto_select: true,
  });
  google.accounts.id.renderButton($('#google-button'), {
    theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'vi',
  });
  if (!state.token) google.accounts.id.prompt();
}

async function loginWithGoogle(idToken) {
  setLoginStatus('Đang đăng nhập...');
  setLoading(true, 'Đang xác thực tài khoản Google...');
  try {
    const data = await api('login', { idToken });
    state.token = data.session;
    saveSession(data.session, data.sessionExpiresAt);
    setLoginStatus('');
    openAuthenticatedApp(data.me);
    await loadPosts();
  } catch (error) {
    setLoginStatus(getErrorMessage(error), 'error');
  } finally {
    setLoading(false);
  }
}

async function resumeSession(token) {
  state.token = token;
  setLoading(true, 'Đang tải phiên đăng nhập...');
  try {
    const data = await api('me');
    openAuthenticatedApp(data.me);
    await loadPosts();
  } catch (error) {
    setLoginStatus(getErrorMessage(error), 'error');
  } finally {
    setLoading(false);
  }
}

function logout(message = '') {
  state.token = '';
  state.session = null;
  state.posts = [];
  clearSession();
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  elements.tbody.textContent = '';
  elements.editorView.hidden = true;
  elements.listView.hidden = false;
  elements.adminApp.hidden = true;
  elements.loginView.hidden = false;
  setLoginStatus(message, message ? 'error' : '');
}

async function loadPosts(showLoader = false) {
  if (showLoader) setLoading(true, 'Đang tải danh sách bài viết...');
  try {
    const result = await api('list');
    state.posts = result.posts || [];
    updateStats(result.stats || {});
    renderPosts();
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    if (showLoader) setLoading(false);
  }
}

function updateStats(stats) {
  $('#stat-total').textContent = stats.total || 0;
  $('#stat-draft').textContent = stats.draft || 0;
  $('#stat-pending').textContent = stats.pending || 0;
  $('#stat-published').textContent = stats.publish || 0;
}

function renderPosts() {
  const query = normalize($('#search-input').value);
  const status = $('#status-filter').value;
  const posts = state.posts.filter((post) => {
    const haystack = normalize([post.post_title, post.post_name, post.rank_math_focus_keyword].join(' '));
    return (!query || haystack.includes(query)) && (!status || post.post_status === status);
  });

  elements.empty.hidden = posts.length > 0;
  elements.tbody.innerHTML = posts.map((post) => {
    const score = Number(post.seo_score || 0);
    const scoreClass = score >= 80 ? 'score-good' : score >= 50 ? 'score-mid' : 'score-low';
    const safeId = escapeHtml(post.submission_id || '');
    const canDelete = Boolean(state.session && state.session.role === 'ADMIN');
    return `<tr>
      <td><div class="post-title">${escapeHtml(post.post_title || '(Chưa có tiêu đề)')}<small>/${escapeHtml(post.post_name || '')}</small></div></td>
      <td>${escapeHtml(post.rank_math_focus_keyword || '—')}</td>
      <td><span class="badge badge-${escapeHtml(post.post_status || 'draft')}">${statusLabel(post.post_status)}</span></td>
      <td><span class="score ${scoreClass}">${score}/100</span></td>
      <td>${escapeHtml(formatDate(post.updated_at || post.created_at))}</td>
      <td><div class="actions"><button class="btn btn-outline btn-small" type="button" data-edit="${safeId}">Sửa</button>${canDelete ? `<button class="btn btn-danger btn-small" type="button" data-delete="${safeId}">Xóa</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

function showList() {
  elements.editorView.hidden = true;
  elements.listView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function newPost() {
  elements.form.reset();
  state.slugTouched = false;
  $('#submission-id').value = '';
  $('#base-updated-at').value = '';
  $('#editor-title').textContent = 'Viết bài mới';
  $('#post-author').value = state.session ? state.session.email : '';
  $('#post-status').value = 'draft';
  $('#visibility').value = 'public';
  $('#schema-type').value = 'BlogPosting';
  $('#twitter-card').value = 'summary_large_image';
  setCheckedValues('rank_math_robots[]', ['index', 'follow']);
  setCheckedValues('comment_status', ['open']);
  setCheckedValues('ping_status', ['open']);
  setCheckedValues('rank_math_twitter_use_facebook', ['1']);
  $('#publish-at').value = toLocalDateTime(new Date());
  syncPasswordField();
  updateEditorMetrics();
  elements.listView.hidden = true;
  elements.editorView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function editPost(submissionId) {
  setLoading(true, 'Đang tải bài viết...');
  try {
    const post = await api('get', { submission_id: submissionId });
    elements.form.reset();
    fillForm(post);
    state.slugTouched = Boolean(post.post_name);
    syncPasswordField();
    $('#editor-title').textContent = 'Chỉnh sửa bài viết';
    elements.listView.hidden = true;
    elements.editorView.hidden = false;
    updateEditorMetrics();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    setLoading(false);
  }
}

async function deletePost(submissionId) {
  const post = state.posts.find((item) => item.submission_id === submissionId);
  const title = post ? post.post_title : submissionId;
  if (!window.confirm(`Xóa vĩnh viễn bài “${title}” khỏi Google Sheet?`)) return;

  setLoading(true, 'Đang xóa bài viết...');
  try {
    await api('delete', { submission_id: submissionId });
    showToast('Đã xóa bài viết.');
    await loadPosts();
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    setLoading(false);
  }
}

async function savePost(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  setLoading(true, 'Đang lưu bài viết vào Google Sheet...');
  try {
    const payload = serializeForm(elements.form);
    payload.target_site = 'https://goldhomecons.vn/';
    payload.site_name = 'Gold Home Construction';
    payload.page_url = window.location.href;
    payload.client_user_agent = navigator.userAgent;
    payload.submitted_at = new Date().toISOString();
    const result = await api('save', { post: payload });
    showToast(result.mode === 'updated' ? 'Đã cập nhật bài viết.' : 'Đã tạo bài viết mới.');
    await loadPosts();
    showList();
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    setLoading(false);
  }
}

function serializeForm(form) {
  const payload = {};
  const repeated = new Set(['post_category[]', 'rank_math_robots[]']);
  new FormData(form).forEach((value, key) => {
    if (repeated.has(key)) {
      if (!Array.isArray(payload[key])) payload[key] = [];
      payload[key].push(value);
    } else {
      payload[key] = value;
    }
  });
  payload['post_category[]'] = payload['post_category[]'] || [];
  payload['rank_math_robots[]'] = payload['rank_math_robots[]'] || [];
  payload.sticky = payload.sticky || '';
  payload.comment_status = payload.comment_status || 'closed';
  payload.ping_status = payload.ping_status || 'closed';
  payload.rank_math_pillar_content = payload.rank_math_pillar_content || '';
  payload.rank_math_twitter_use_facebook = payload.rank_math_twitter_use_facebook || '';
  return payload;
}

function fillForm(data) {
  Object.keys(data || {}).forEach((name) => {
    const controls = $$(`[name="${cssEscape(name)}"]`);
    if (!controls.length) return;
    const values = Array.isArray(data[name]) ? data[name].map(String) : [String(data[name] == null ? '' : data[name])];
    controls.forEach((control) => {
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = values.includes(control.value);
      else control.value = values[0];
    });
  });
}

function setCheckedValues(name, values) {
  $$(`[name="${cssEscape(name)}"]`).forEach((input) => { input.checked = values.includes(input.value); });
}

function updateEditorMetrics() {
  const title = $('#post-title').value.trim();
  const slug = $('#post-name').value.trim();
  const content = $('#content').value;
  const keyword = $('#focus-keyword').value.split(',')[0].trim();
  const seoTitle = $('#seo-title').value.trim() || title;
  const description = $('#seo-description').value.trim() || $('#post-excerpt').value.trim();
  const alt = $('#featured-alt').value.trim();
  const imageUrl = $('#featured-image').value.trim();
  const plainContent = stripHtml(content).trim();
  const wordCount = plainContent ? plainContent.split(/\s+/).filter(Boolean).length : 0;
  const firstWords = plainContent.split(/\s+/).slice(0, 160).join(' ');
  const normalizedKeyword = normalize(keyword);
  const keywordSlug = slugify(keyword);
  const links = Array.from(content.matchAll(/href=["']([^"']+)["']/gi), match => match[1]);
  const hasInternalLink = links.some((url) => url.startsWith('/') || url.startsWith('#') || /^https?:\/\/(www\.)?goldhomecons\.vn(?:\/|$)/i.test(url));
  const hasExternalLink = links.some((url) => /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?goldhomecons\.vn(?:\/|$)/i.test(url));

  $('#word-count').textContent = wordCount;
  $('#word-count-input').value = wordCount;
  $('#seo-title-count').textContent = seoTitle.length;
  $('#seo-description-count').textContent = description.length;
  $('#slug-preview').textContent = slug || 'duong-dan-bai-viet';

  const checks = {
    keyword: Boolean(keyword),
    'title-keyword': Boolean(keyword) && normalize(title).includes(normalizedKeyword),
    'seo-title': seoTitle.length >= 30 && seoTitle.length <= 60,
    description: description.length >= 120 && description.length <= 160,
    'description-keyword': Boolean(keyword) && normalize(description).includes(normalizedKeyword),
    slug: Boolean(slug) && slug.length <= 75 && (!keywordSlug || slug.includes(keywordSlug)),
    'content-length': wordCount >= 600,
    'intro-keyword': Boolean(keyword) && normalize(firstWords).includes(normalizedKeyword),
    heading: /<h[23][\s>]/i.test(content),
    image: Boolean(imageUrl),
    'image-alt': Boolean(alt),
    'internal-link': hasInternalLink,
    'external-link': hasExternalLink
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round(passed / total * 100);
  Object.entries(checks).forEach(([name, pass]) => {
    const item = $(`[data-seo-check="${name}"]`);
    if (item) item.classList.toggle('pass', pass);
  });
  $('#seo-check-count').textContent = `${passed}/${total} đạt`;
  $('#seo-score').value = score;
  $('#score-value').textContent = score;
  $('#score-ring').style.setProperty('--score-angle', `${score * 3.6}deg`);
  $('#score-ring').style.setProperty('--score-color', score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)');
  $('#score-label').textContent = score >= 80 ? 'Tối ưu tốt' : score >= 50 ? 'Có thể cải thiện' : 'Cần tối ưu';

  let density = 0;
  if (normalizedKeyword && plainContent && wordCount) {
    const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = normalize(plainContent).match(new RegExp(`(^|\\s)${escapedKeyword}(?=\\s|[.,!?;:]|$)`, 'g')) || [];
    const keywordWordCount = normalizedKeyword.split(/\s+/).filter(Boolean).length;
    density = matches.length * keywordWordCount / wordCount * 100;
  }
  $('#keyword-density').textContent = `${density.toFixed(1).replace('.', ',')}%`;
  $('#density-bar').style.width = `${Math.min(density / 3 * 100, 100)}%`;
  $('#density-bar').style.background = density >= 0.5 && density <= 2.5 ? 'var(--success)' : density > 2.5 ? 'var(--danger)' : 'var(--warning)';
}

function slugify(value) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 220);
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function stripHtml(value) {
  // DOMParser không tải ảnh hay chạy handler như onerror, tránh thực thi HTML trong nội dung bài.
  return new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent || '';
}

function syncPasswordField() {
  $('#post-password').closest('.field').hidden = $('#visibility').value !== 'password';
}

function statusLabel(status) {
  return { draft: 'Bản nháp', pending: 'Chờ duyệt', publish: 'Đã xuất bản' }[status] || escapeHtml(status || 'Bản nháp');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function toLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

$('#logout-button').addEventListener('click', () => logout());
$('#new-post-button').addEventListener('click', newPost);
$('#back-button').addEventListener('click', showList);
$('#cancel-button').addEventListener('click', showList);
$('#refresh-button').addEventListener('click', () => loadPosts(true));
$('#search-input').addEventListener('input', renderPosts);
$('#status-filter').addEventListener('change', renderPosts);
$('#visibility').addEventListener('change', syncPasswordField);
elements.form.addEventListener('submit', savePost);
elements.tbody.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (editButton) editPost(editButton.dataset.edit);
  if (deleteButton) deletePost(deleteButton.dataset.delete);
});

$('#post-title').addEventListener('input', () => {
  if (!state.slugTouched) $('#post-name').value = slugify($('#post-title').value);
  updateEditorMetrics();
});
$('#post-name').addEventListener('input', () => {
  state.slugTouched = true;
  $('#post-name').value = slugify($('#post-name').value);
  updateEditorMetrics();
});
['content', 'post-excerpt', 'focus-keyword', 'seo-title', 'seo-description', 'featured-alt', 'featured-image'].forEach((id) => {
  $('#' + id).addEventListener('input', updateEditorMetrics);
});
$$('[data-robot-pair]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    const pair = $(`[name="rank_math_robots[]"][value="${input.dataset.robotPair}"]`);
    if (pair) pair.checked = false;
  });
});

const savedToken = loadSavedSession();
if (savedToken) resumeSession(savedToken);
initGoogle();
