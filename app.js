const config = window.GOLDHOME_SEO_CONFIG || {};
const SESSION_KEY = 'goldhome_seo_session';
// Bản sao danh sách bài lần trước để mở trang hiện ngay rồi cập nhật ngầm. Xóa khi đăng xuất.
const SNAPSHOT_KEY = 'goldhome_seo_snapshot';
const PUBLISH_OPEN_KEY = 'goldhome_seo_publish_open';
const state = {
  session: null,
  token: '',
  posts: [],
  slugTouched: false,
  dirty: false,
  sort: { key: 'updated_at', dir: 'desc' },
};
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
  content: $('#content'),
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

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (error) { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode / hết dung lượng */ }
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch (error) { /* ignore */ }
}

function loadSavedSession() {
  const saved = readStorage(SESSION_KEY);
  return saved && saved.token && new Date(saved.expiresAt) > new Date() ? saved.token : '';
}

function setLoginStatus(message, type = '') {
  const status = $('#login-status');
  status.textContent = message;
  status.className = 'login-status ' + type;
}

// Spinner ngay trên nút đang xử lý thay cho lớp phủ chặn cả màn hình.
function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', String(busy));
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

// login và me trả kèm danh sách bài nên chỉ cần một lượt gọi máy chủ.
async function loginWithGoogle(idToken) {
  setLoginStatus('Đang đăng nhập...', 'busy');
  try {
    const data = await api('login', { idToken });
    state.token = data.session;
    writeStorage(SESSION_KEY, { token: data.session, expiresAt: data.sessionExpiresAt });
    setLoginStatus('');
    openAuthenticatedApp(data.me);
    applyPosts(data.posts);
  } catch (error) {
    setLoginStatus(getErrorMessage(error), 'error');
  }
}

async function resumeSession(token) {
  state.token = token;
  const snapshot = readStorage(SNAPSHOT_KEY);
  const hasSnapshot = Boolean(snapshot && snapshot.me && Array.isArray(snapshot.posts));
  if (hasSnapshot) {
    openAuthenticatedApp(snapshot.me);
    applyPosts(snapshot.posts, false);
  } else {
    setLoginStatus('Đang tải phiên đăng nhập...', 'busy');
  }
  setBusy($('#refresh-button'), true);
  try {
    const data = await api('me');
    if (!state.token) return;
    openAuthenticatedApp(data.me);
    applyPosts(data.posts);
    setLoginStatus('');
  } catch (error) {
    if (!state.token) return; // phiên hết hạn: logout() đã hiện thông báo
    if (hasSnapshot) showToast(`Không cập nhật được dữ liệu mới: ${getErrorMessage(error)}`, 'error');
    else setLoginStatus(getErrorMessage(error), 'error');
  } finally {
    setBusy($('#refresh-button'), false);
  }
}

function logout(message = '') {
  state.token = '';
  state.session = null;
  state.posts = [];
  setDirty(false);
  removeStorage(SESSION_KEY);
  removeStorage(SNAPSHOT_KEY);
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  elements.tbody.textContent = '';
  elements.editorView.hidden = true;
  elements.listView.hidden = false;
  elements.adminApp.hidden = true;
  elements.loginView.hidden = false;
  setLoginStatus(message, message ? 'error' : '');
}

function applyPosts(posts, persist = true) {
  state.posts = Array.isArray(posts) ? posts : [];
  updateStats(computeStats(state.posts));
  renderPosts();
  if (persist && state.session) writeStorage(SNAPSHOT_KEY, { me: state.session, posts: state.posts });
}

async function loadPosts(force = false) {
  const button = $('#refresh-button');
  setBusy(button, true);
  if (!state.posts.length) renderSkeleton();
  try {
    const data = await api('list', force ? { force: true } : {});
    applyPosts(data.posts);
  } catch (error) {
    if (!state.posts.length) renderPosts();
    showToast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function computeStats(posts) {
  return posts.reduce((stats, post) => {
    stats.total += 1;
    if (Object.prototype.hasOwnProperty.call(stats, post.post_status)) stats[post.post_status] += 1;
    return stats;
  }, { total: 0, draft: 0, pending: 0, publish: 0 });
}

function updateStats(stats) {
  $('#stat-total').textContent = stats.total || 0;
  $('#stat-draft').textContent = stats.draft || 0;
  $('#stat-pending').textContent = stats.pending || 0;
  $('#stat-published').textContent = stats.publish || 0;
}

function renderSkeleton() {
  elements.empty.hidden = true;
  const row = '<tr class="skeleton-row">' + '<td><span class="skeleton"></span></td>'.repeat(6) + '</tr>';
  elements.tbody.innerHTML = row.repeat(5);
}

function sortValue(post, key) {
  if (key === 'seo_score') return Number(post.seo_score) || 0;
  return String(post.updated_at || post.created_at || '');
}

function renderPosts() {
  const query = normalize($('#search-input').value);
  const status = $('#status-filter').value;
  const { key, dir } = state.sort;
  const direction = dir === 'asc' ? 1 : -1;
  const posts = state.posts
    .filter((post) => {
      const haystack = normalize([post.post_title, post.post_name, post.rank_math_focus_keyword].join(' '));
      return (!query || haystack.includes(query)) && (!status || post.post_status === status);
    })
    .sort((a, b) => {
      const left = sortValue(a, key);
      const right = sortValue(b, key);
      return (left > right ? 1 : left < right ? -1 : 0) * direction;
    });

  $$('[data-sort]').forEach((button) => {
    const active = button.dataset.sort === key;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    else button.removeAttribute('aria-sort');
  });

  const canDelete = Boolean(state.session && state.session.role === 'ADMIN');
  elements.empty.hidden = posts.length > 0;
  elements.tbody.innerHTML = posts.map((post) => {
    const score = Math.max(0, Math.min(100, Number(post.seo_score) || 0));
    const scoreClass = score >= 80 ? 'score-good' : score >= 50 ? 'score-mid' : 'score-low';
    const safeId = escapeHtml(post.submission_id || '');
    return `<tr>
      <td><div class="post-title">${escapeHtml(post.post_title || '(Chưa có tiêu đề)')}<small>/${escapeHtml(post.post_name || '')}</small></div></td>
      <td>${escapeHtml(post.rank_math_focus_keyword || '—')}</td>
      <td><span class="badge badge-${escapeHtml(post.post_status || 'draft')}">${statusLabel(post.post_status)}</span></td>
      <td><div class="score-cell ${scoreClass}"><span class="score">${score}</span><span class="score-bar"><span style="width:${score}%"></span></span></div></td>
      <td>${escapeHtml(formatDate(post.updated_at || post.created_at))}</td>
      <td><div class="actions"><button class="btn btn-outline btn-small" type="button" data-edit="${safeId}">Sửa</button>${canDelete ? `<button class="btn btn-danger btn-small" type="button" data-delete="${safeId}">Xóa</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

function setDirty(dirty) {
  state.dirty = dirty;
  $('#dirty-dot').classList.toggle('active', dirty);
  $('#dirty-text').textContent = dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi';
}

function confirmDiscard() {
  return !state.dirty || window.confirm('Bài viết có thay đổi chưa lưu. Rời đi và bỏ các thay đổi?');
}

function showList() {
  elements.editorView.hidden = true;
  elements.listView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function leaveEditor() {
  if (!confirmDiscard()) return;
  setDirty(false);
  showList();
}

function openEditor(title) {
  $('#editor-title').textContent = title;
  syncPasswordField();
  updateEditorMetrics();
  setDirty(false);
  elements.listView.hidden = true;
  elements.editorView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function newPost() {
  elements.form.reset();
  state.slugTouched = false;
  $('#submission-id').value = '';
  $('#base-updated-at').value = '';
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
  openEditor('Viết bài mới');
}

async function editPost(submissionId, button) {
  setBusy(button, true);
  try {
    const post = await api('get', { submission_id: submissionId });
    elements.form.reset();
    fillForm(post);
    state.slugTouched = Boolean(post.post_name);
    openEditor('Chỉnh sửa bài viết');
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deletePost(submissionId, button) {
  const post = state.posts.find((item) => item.submission_id === submissionId);
  const title = post ? post.post_title : submissionId;
  if (!window.confirm(`Xóa vĩnh viễn bài “${title}” khỏi Google Sheet?`)) return;

  setBusy(button, true);
  try {
    await api('delete', { submission_id: submissionId });
    applyPosts(state.posts.filter((item) => item.submission_id !== submissionId));
    showToast('Đã xóa bài viết.');
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
    setBusy(button, false);
  }
}

async function savePost(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const button = $('#save-button');
  if (button.disabled) return;
  setBusy(button, true);
  try {
    const payload = serializeForm(elements.form);
    payload.target_site = 'https://goldhomecons.vn/';
    payload.site_name = 'Gold Home Construction';
    payload.page_url = window.location.href;
    payload.client_user_agent = navigator.userAgent;
    payload.submitted_at = new Date().toISOString();
    const result = await api('save', { post: payload });
    // Máy chủ trả về dòng vừa lưu: cập nhật danh sách tại chỗ, không tải lại cả danh sách.
    const others = state.posts.filter((item) => item.submission_id !== result.submission_id);
    applyPosts(result.post ? [result.post, ...others] : others);
    showToast(result.mode === 'updated' ? 'Đã cập nhật bài viết.' : 'Đã tạo bài viết mới.');
    setDirty(false);
    showList();
  } catch (error) {
    showToast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
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

// Ô cần sửa cho từng tiêu chí: bấm vào tiêu chí chưa đạt sẽ nhảy tới đây.
const CHECK_TARGETS = Object.freeze({
  keyword: 'focus-keyword',
  'title-keyword': 'post-title',
  'seo-title': 'seo-title',
  description: 'seo-description',
  'description-keyword': 'seo-description',
  slug: 'post-name',
  'content-length': 'content',
  'intro-keyword': 'content',
  heading: 'content',
  image: 'featured-image',
  'image-alt': 'featured-alt',
  'internal-link': 'content',
  'external-link': 'content',
});

function lengthHint(length, min, max, emptyText) {
  if (!length) return emptyText;
  if (length < min) return `Đang ${length} ký tự, cần thêm ${min - length}.`;
  return `Đang ${length} ký tự, bớt ${length - max}.`;
}

function focusField(id) {
  const field = $('#' + id);
  if (!field) return;
  const details = field.closest('details');
  if (details) details.open = true;
  if (field.closest('#publish-body')) setPublishOpen(true);
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field.focus({ preventScroll: true });
}

let metricsFrame = 0;
// Gộp các lần gõ phím trong cùng một khung hình thành một lần chấm điểm.
function scheduleMetrics() {
  if (metricsFrame) return;
  metricsFrame = requestAnimationFrame(() => {
    metricsFrame = 0;
    updateEditorMetrics();
  });
}

function updateEditorMetrics() {
  const title = $('#post-title').value.trim();
  const slug = $('#post-name').value.trim();
  const content = $('#content').value;
  const keyword = $('#focus-keyword').value.split(',')[0].trim();
  const seoTitle = renderSeoVariables($('#seo-title').value.trim(), title) || title;
  const description = $('#seo-description').value.trim() || $('#post-excerpt').value.trim();
  const alt = $('#featured-alt').value.trim();
  const imageUrl = $('#featured-image').value.trim();
  const plainContent = stripHtml(content).trim();
  const wordCount = plainContent ? plainContent.split(/\s+/).filter(Boolean).length : 0;
  const firstWords = plainContent.split(/\s+/).slice(0, 160).join(' ');
  updateSerpPreview({ slug, seoTitle, description: description || plainContent, keyword });
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
  const quotedKeyword = keyword ? `“${keyword}”` : 'từ khóa chính';
  const hints = {
    keyword: 'Nhập từ khóa chính để bắt đầu chấm điểm.',
    'title-keyword': `Thêm ${quotedKeyword} vào tiêu đề bài viết.`,
    'seo-title': lengthHint(seoTitle.length, 30, 60, 'Chưa có tiêu đề SEO.'),
    description: lengthHint(description.length, 120, 160, 'Chưa có mô tả SEO.'),
    'description-keyword': `Thêm ${quotedKeyword} vào mô tả SEO.`,
    slug: !slug ? 'Chưa có slug.' : slug.length > 75 ? `Slug dài ${slug.length} ký tự, nên tối đa 75.` : `Slug nên chứa “${keywordSlug}”.`,
    'content-length': `Đang ${wordCount} từ, cần thêm ${Math.max(0, 600 - wordCount)} từ.`,
    'intro-keyword': `Đưa ${quotedKeyword} vào khoảng 160 từ đầu tiên.`,
    heading: 'Thêm ít nhất một tiêu đề phụ bằng nút H2/H3.',
    image: 'Nhập URL ảnh đại diện.',
    'image-alt': 'Mô tả ảnh đại diện, nên chứa từ khóa.',
    'internal-link': 'Thêm liên kết tới trang khác của goldhomecons.vn.',
    'external-link': 'Thêm liên kết tới một nguồn uy tín bên ngoài.',
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round(passed / total * 100);
  Object.entries(checks).forEach(([name, pass]) => {
    const item = $(`[data-seo-check="${name}"]`);
    if (!item) return;
    item.classList.toggle('pass', pass);
    const hint = item.querySelector('.seo-hint');
    hint.textContent = pass ? '' : hints[name];
    hint.hidden = pass;
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

const SERP = Object.freeze({
  siteUrl: 'https://goldhomecons.vn/',
  siteName: 'Gold Home',
  separator: '-',
  // Google cắt tiêu đề theo độ rộng (~580px chữ Arial 20px), mô tả theo số ký tự.
  desktop: { titleWidth: 580, titleFont: '20px Arial', descriptionLength: 160 },
  mobile: { titleWidth: 330, titleFont: '18px Arial', descriptionLength: 120 },
});
let serpDevice = 'desktop';
let measureContext;

// Biến Rank Math thường dùng trong tiêu đề SEO, ví dụ "%title% %sep% %sitename%".
function renderSeoVariables(template, title) {
  return String(template || '')
    .replace(/%title%/g, title)
    .replace(/%sitename%/g, SERP.siteName)
    .replace(/%sep%/g, SERP.separator)
    .replace(/%currentyear%/g, String(new Date().getFullYear()))
    .replace(/\s+/g, ' ')
    .trim();
}

function textWidth(text, font) {
  measureContext = measureContext || document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

// Cắt ở ranh giới từ gần nhất rồi thêm "..." giống Google.
function truncateWords(text, fits) {
  if (fits(text)) return text;
  const words = text.split(' ');
  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (!fits(`${next}...`)) break;
    result = next;
  }
  return `${result.replace(/[\s,.;:–-]+$/, '')}...`;
}

// Tô đậm từ khóa (không phân biệt dấu/hoa thường) bằng DOM node, không dùng innerHTML.
function renderHighlighted(element, text, keyword) {
  element.textContent = '';
  const normalizedKeyword = normalize(keyword).replace(/đ/g, 'd');
  if (!normalizedKeyword) {
    element.textContent = text;
    return;
  }
  let normalizedText = '';
  const indexMap = [];
  Array.from(text).forEach((char, index) => {
    const normalizedChar = normalize(char).replace(/đ/g, 'd');
    for (const part of normalizedChar) {
      normalizedText += part;
      indexMap.push(index);
    }
  });
  const chars = Array.from(text);
  let cursor = 0;
  let found = normalizedText.indexOf(normalizedKeyword);
  while (found >= 0) {
    const start = indexMap[found];
    const end = indexMap[found + normalizedKeyword.length - 1] + 1;
    if (start > cursor) element.append(chars.slice(cursor, start).join(''));
    const strong = document.createElement('strong');
    strong.textContent = chars.slice(start, end).join('');
    element.append(strong);
    cursor = end;
    found = normalizedText.indexOf(normalizedKeyword, found + normalizedKeyword.length);
  }
  if (cursor < chars.length) element.append(chars.slice(cursor).join(''));
}

function updateSerpPreview({ slug, seoTitle, description, keyword }) {
  const device = SERP[serpDevice];
  const title = seoTitle || 'Tiêu đề bài viết sẽ hiển thị tại đây';
  const snippet = String(description || 'Mô tả SEO sẽ xuất hiện ở đây. Hãy viết nội dung súc tích, chứa từ khóa chính và hấp dẫn người tìm kiếm.')
    .replace(/\s+/g, ' ').trim();
  $('#serp-url').textContent = `${SERP.siteUrl}${slug ? `${slug}/` : ''}`;
  renderHighlighted($('#serp-title'), truncateWords(title, (text) => textWidth(text, device.titleFont) <= device.titleWidth), keyword);
  renderHighlighted($('#serp-description'), truncateWords(snippet, (text) => text.length <= device.descriptionLength), keyword);
  $('#serp-card').classList.toggle('mobile', serpDevice === 'mobile');
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

// ---------- Thanh công cụ nội dung HTML ----------

// Dùng execCommand('insertText') để Ctrl+Z hoàn tác được; trình duyệt không hỗ trợ thì ghi thẳng.
function insertIntoContent(text, selectStart, selectEnd) {
  const input = elements.content;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.focus();
  const inserted = document.execCommand && document.execCommand('insertText', false, text);
  if (!inserted) {
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selectStart !== undefined) input.setSelectionRange(start + selectStart, start + selectEnd);
}

function selectedContent(fallback) {
  const input = elements.content;
  return input.value.slice(input.selectionStart, input.selectionEnd) || fallback;
}

function wrapContent(tag) {
  const selected = selectedContent('văn bản');
  const open = `<${tag}>`;
  insertIntoContent(`${open}${selected}</${tag}>`, open.length, open.length + selected.length);
}

// Khối (danh sách, ảnh) luôn bắt đầu ở dòng mới.
function blockPrefix() {
  const before = elements.content.value.slice(0, elements.content.selectionStart);
  return before && !before.endsWith('\n') ? '\n' : '';
}

function insertList(tag) {
  const items = selectedContent('Mục 1\nMục 2').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  insertIntoContent(`${blockPrefix()}<${tag}>\n${items.map((item) => `  <li>${item}</li>`).join('\n')}\n</${tag}>`);
}

function askUrl(message) {
  const url = (window.prompt(message, 'https://') || '').trim();
  if (!url || url === 'https://') return '';
  if (!/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(url)) {
    showToast('URL phải bắt đầu bằng https://, /, #, mailto: hoặc tel:', 'error');
    return '';
  }
  return url;
}

function insertLink() {
  const url = askUrl('Nhập URL liên kết:');
  if (!url) return;
  const selected = selectedContent('văn bản liên kết');
  const open = `<a href="${escapeHtml(url)}">`;
  insertIntoContent(`${open}${selected}</a>`, open.length, open.length + selected.length);
}

function insertImage() {
  const url = askUrl('Nhập URL ảnh:');
  if (!url) return;
  const alt = (window.prompt('Mô tả ảnh (alt):', selectedContent($('#focus-keyword').value.trim())) || '').trim();
  insertIntoContent(`${blockPrefix()}<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
}

function setPublishOpen(open) {
  $('#publish-toggle').setAttribute('aria-expanded', String(open));
  $('#publish-body').hidden = !open;
  writeStorage(PUBLISH_OPEN_KEY, open);
}

// ---------- Sự kiện ----------

$('#logout-button').addEventListener('click', () => {
  if (!elements.editorView.hidden && !confirmDiscard()) return;
  logout();
});
$('#new-post-button').addEventListener('click', newPost);
$('#back-button').addEventListener('click', leaveEditor);
$('#cancel-button').addEventListener('click', leaveEditor);
$('#refresh-button').addEventListener('click', () => loadPosts(true));
$('#search-input').addEventListener('input', renderPosts);
$('#status-filter').addEventListener('change', renderPosts);
$('#visibility').addEventListener('change', syncPasswordField);
$('#publish-toggle').addEventListener('click', () => setPublishOpen($('#publish-body').hidden));
elements.form.addEventListener('submit', savePost);
elements.form.addEventListener('input', () => setDirty(true));
elements.form.addEventListener('change', () => setDirty(true));
elements.tbody.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (editButton) editPost(editButton.dataset.edit, editButton);
  if (deleteButton) deletePost(deleteButton.dataset.delete, deleteButton);
});
$$('[data-sort]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' };
    renderPosts();
  });
});

$('#post-title').addEventListener('input', () => {
  if (!state.slugTouched) $('#post-name').value = slugify($('#post-title').value);
  scheduleMetrics();
});
$('#post-name').addEventListener('input', () => {
  state.slugTouched = true;
  $('#post-name').value = slugify($('#post-name').value);
  scheduleMetrics();
});
$('#edit-snippet').addEventListener('click', () => focusField('seo-title'));
$$('[data-serp-device]').forEach((button) => {
  button.addEventListener('click', () => {
    serpDevice = button.dataset.serpDevice;
    $$('[data-serp-device]').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    updateEditorMetrics();
  });
});
['content', 'post-excerpt', 'focus-keyword', 'seo-title', 'seo-description', 'featured-alt', 'featured-image'].forEach((id) => {
  $('#' + id).addEventListener('input', scheduleMetrics);
});
$$('[data-robot-pair]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    const pair = $(`[name="rank_math_robots[]"][value="${input.dataset.robotPair}"]`);
    if (pair) pair.checked = false;
  });
});

$$('.editor-toolbar [data-wrap]').forEach((button) => button.addEventListener('click', () => wrapContent(button.dataset.wrap)));
$$('.editor-toolbar [data-list]').forEach((button) => button.addEventListener('click', () => insertList(button.dataset.list)));
$('.editor-toolbar [data-insert="link"]').addEventListener('click', insertLink);
$('.editor-toolbar [data-insert="image"]').addEventListener('click', insertImage);
elements.content.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  const actions = { b: () => wrapContent('strong'), i: () => wrapContent('em'), k: insertLink };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});

// Tiêu chí SEO: thêm dòng gợi ý và cho phép bấm để nhảy tới ô cần sửa.
$$('[data-seo-check]').forEach((item) => {
  const target = CHECK_TARGETS[item.dataset.seoCheck];
  const hint = document.createElement('small');
  hint.className = 'seo-hint';
  hint.hidden = true;
  item.lastElementChild.append(hint);
  if (!target) return;
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.addEventListener('click', () => focusField(target));
  item.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    focusField(target);
  });
});

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
  if (elements.editorView.hidden || elements.adminApp.hidden) return;
  event.preventDefault();
  elements.form.requestSubmit();
});
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty || elements.editorView.hidden) return;
  event.preventDefault();
  event.returnValue = '';
});

setPublishOpen(readStorage(PUBLISH_OPEN_KEY) !== false);
const savedToken = loadSavedSession();
if (savedToken) resumeSession(savedToken);
initGoogle();
