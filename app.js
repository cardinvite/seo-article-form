const siteConfig = {
  domain: 'goldhomecons.vn',
  name: 'Gold Home Construction',
};
const integrationConfig = window.GOLDHOME_SEO_CONFIG || {};

const form = document.querySelector('#seo-post-form');
const fields = {
  title: document.querySelector('#post_title'),
  slug: document.querySelector('#post_name'),
  content: document.querySelector('#content'),
  excerpt: document.querySelector('#post_excerpt'),
  keyword: document.querySelector('#rank_math_focus_keyword'),
  seoTitle: document.querySelector('#rank_math_title'),
  description: document.querySelector('#rank_math_description'),
  imageAlt: document.querySelector('#featured_image_alt'),
  imageUrl: document.querySelector('#featured_image_url'),
};

const storageKey = 'goldhomecons-seo-post-draft-v1';
let slugWasEdited = false;
let toastTimer;

function hasGoogleSheetEndpoint() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test((integrationConfig.appsScriptUrl || '').trim());
}

function updateDatabaseStatus() {
  const status = document.querySelector('#database-status');
  const title = status.querySelector('strong');
  const detail = status.querySelector('small');
  const connected = hasGoogleSheetEndpoint();

  status.classList.toggle('connected', connected);
  status.classList.toggle('error', !connected);
  title.textContent = connected ? 'Đã cấu hình Google Sheet' : 'Chưa cấu hình Google Apps Script URL';
  detail.textContent = connected
    ? 'Khi gửi, mỗi bài viết sẽ được thêm thành một dòng mới trong sheet SEO Posts.'
    : 'Mở config.js và dán URL Web App kết thúc bằng /exec.';
}

function normalizeText(value = '') {
  return value
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function slugify(value = '') {
  return normalizeText(value)
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

function plainText(value = '') {
  const temp = document.createElement('div');
  temp.innerHTML = value;
  return (temp.textContent || '').replace(/\s+/g, ' ').trim();
}

function countWords(value = '') {
  const clean = plainText(value);
  return clean ? clean.split(/\s+/).length : 0;
}

function primaryKeyword() {
  return fields.keyword.value.split(',')[0].trim();
}

function includesKeyword(value, keyword = primaryKeyword()) {
  if (!keyword) return false;
  return normalizeText(value).includes(normalizeText(keyword));
}

function setText(id, value) {
  document.querySelector(id).textContent = value;
}

function effectiveSeoTitle() {
  return fields.seoTitle.value.trim() || fields.title.value.trim();
}

function effectiveDescription() {
  return fields.description.value.trim() || fields.excerpt.value.trim();
}

function updateCounts() {
  const wordCount = countWords(fields.content.value);
  setText('#post-title-count', fields.title.value.length);
  setText('#excerpt-count', fields.excerpt.value.length);
  setText('#seo-title-count', effectiveSeoTitle().length);
  setText('#meta-description-count', effectiveDescription().length);
  setText('#word-count', wordCount.toLocaleString('vi-VN'));
  setText('#reading-time', wordCount ? Math.max(1, Math.ceil(wordCount / 220)) : 0);

  const seoTitleFeedback = document.querySelector('#seo-title-feedback');
  const metaFeedback = document.querySelector('#meta-description-feedback');
  const titleLength = effectiveSeoTitle().length;
  const descriptionLength = effectiveDescription().length;
  seoTitleFeedback.style.color = titleLength >= 30 && titleLength <= 60 ? 'var(--green)' : titleLength > 60 ? 'var(--red)' : '';
  metaFeedback.style.color = descriptionLength >= 120 && descriptionLength <= 160 ? 'var(--green)' : descriptionLength > 160 ? 'var(--red)' : '';
}

function updatePreview() {
  const title = effectiveSeoTitle() || 'Tiêu đề bài viết sẽ hiển thị tại đây';
  const description = effectiveDescription() || 'Mô tả SEO sẽ xuất hiện ở đây. Hãy viết nội dung súc tích, rõ ràng và hấp dẫn người tìm kiếm.';
  const slug = fields.slug.value.trim();
  setText('#serp-title', title);
  setText('#serp-description', description);
  setText('#serp-url', `${siteConfig.domain}/${slug ? `${slug}/` : ''}`);
}

function calculateChecks() {
  const keyword = primaryKeyword();
  const contentText = plainText(fields.content.value);
  const words = countWords(contentText);
  const seoTitle = effectiveSeoTitle();
  const description = effectiveDescription();
  const firstWords = contentText.split(/\s+/).slice(0, 160).join(' ');
  const keywordSlug = slugify(keyword);
  const links = [...fields.content.value.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]);
  const escapedDomain = siteConfig.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sitePattern = new RegExp(`^(https?:\\/\\/)?(www\\.)?${escapedDomain}`, 'i');
  const externalSitePattern = new RegExp(`(^|\\/\\/)(www\\.)?${escapedDomain}`, 'i');
  const hasInternalLink = links.some(url => url.startsWith('/') || url.startsWith('#') || sitePattern.test(url));
  const hasExternalLink = links.some(url => /^https?:\/\//i.test(url) && !externalSitePattern.test(url));

  return {
    keyword: Boolean(keyword),
    'title-keyword': includesKeyword(fields.title.value, keyword),
    'seo-title': seoTitle.length >= 30 && seoTitle.length <= 60,
    description: description.length >= 120 && description.length <= 160,
    'description-keyword': includesKeyword(description, keyword),
    slug: Boolean(fields.slug.value) && fields.slug.value.length <= 75 && (!keywordSlug || fields.slug.value.includes(keywordSlug)),
    'content-length': words >= 600,
    'intro-keyword': includesKeyword(firstWords, keyword),
    heading: /<h[23][^>]*>/i.test(fields.content.value),
    'image-alt': Boolean(fields.imageAlt.value.trim()),
    'internal-link': hasInternalLink,
    'external-link': hasExternalLink,
  };
}

function updateScore() {
  const checks = calculateChecks();
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round((passed / total) * 100);
  const scoreRing = document.querySelector('#score-ring');
  const checklist = document.querySelector('#seo-checklist');

  Object.entries(checks).forEach(([name, pass]) => {
    checklist.querySelector(`[data-check="${name}"]`).classList.toggle('pass', pass);
  });

  scoreRing.style.setProperty('--score', score);
  scoreRing.style.setProperty('--score-color', score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)');
  setText('#seo-score', score);
  setText('#check-count', `${passed}/${total} đạt`);

  if (score >= 80) {
    setText('#score-label', 'Tối ưu tốt');
    setText('#score-message', 'Bài viết đã đáp ứng phần lớn tiêu chí SEO cơ bản.');
  } else if (score >= 50) {
    setText('#score-label', 'Có thể cải thiện');
    setText('#score-message', 'Hoàn thiện các mục còn thiếu trước khi xuất bản.');
  } else {
    setText('#score-label', 'Cần bổ sung');
    setText('#score-message', 'Hoàn thiện các trường quan trọng để tăng điểm SEO.');
  }

  const completionFields = [fields.title, fields.slug, fields.content, fields.keyword, fields.seoTitle, fields.description, fields.imageAlt];
  const completed = completionFields.filter(field => field.value.trim()).length;
  const completion = Math.round((completed / completionFields.length) * 100);
  setText('#completion-value', `${completion}%`);
  document.querySelector('#completion-bar').style.width = `${completion}%`;
}

function updateDensity() {
  const keyword = primaryKeyword();
  const content = normalizeText(plainText(fields.content.value));
  const words = countWords(content);
  let density = 0;

  if (keyword && content && words) {
    const normalizedKeyword = normalizeText(keyword);
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = content.match(new RegExp(`(^|\\s)${escaped}(?=\\s|[.,!?;:]|$)`, 'g')) || [];
    density = (matches.length * countWords(normalizedKeyword) / words) * 100;
  }

  const displayDensity = Math.min(density, 99);
  setText('#keyword-density', `${density.toFixed(1).replace('.', ',')}%`);
  const bar = document.querySelector('#density-bar');
  bar.style.width = `${Math.min(displayDensity / 3 * 100, 100)}%`;
  bar.style.background = density >= .5 && density <= 2.5 ? 'var(--green)' : density > 2.5 ? 'var(--red)' : 'var(--amber)';
}

function updateAll() {
  updateCounts();
  updatePreview();
  updateScore();
  updateDensity();
}

function markChanged() {
  const status = document.querySelector('.header-status');
  status.classList.remove('saved');
  status.classList.add('changed');
  setText('#save-status', 'Có thay đổi chưa lưu');
}

function serializeForm() {
  const data = new FormData(form);
  const result = {
    target_site: `https://${siteConfig.domain}/`,
    site_name: siteConfig.name,
  };

  for (const [key, value] of data.entries()) {
    if (value instanceof File) continue;
    if (Object.hasOwn(result, key)) {
      result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
    } else {
      result[key] = value;
    }
  }

  result.seo_score = Number(document.querySelector('#seo-score').textContent);
  result.word_count = countWords(fields.content.value);
  const featuredFile = document.querySelector('#featured_image').files[0];
  result.featured_image_file_name = featuredFile ? featuredFile.name : '';
  return result;
}

function createSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `seo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function submitToGoogleSheet() {
  if (!hasGoogleSheetEndpoint()) {
    throw new Error('Chưa cấu hình Google Apps Script URL trong file config.js.');
  }

  const payload = serializeForm();
  payload.submission_id = createSubmissionId();
  payload.submitted_at = new Date().toISOString();
  payload.page_url = window.location.href;
  payload.client_user_agent = navigator.userAgent;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), integrationConfig.requestTimeoutMs || 20000);

  try {
    await fetch(integrationConfig.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return payload.submission_id;
  } finally {
    window.clearTimeout(timeout);
  }
}

function saveDraft(showMessage = true) {
  localStorage.setItem(storageKey, JSON.stringify(serializeForm()));
  const status = document.querySelector('.header-status');
  status.classList.remove('changed');
  status.classList.add('saved');
  setText('#save-status', `Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
  if (showMessage) showToast('Đã lưu bản nháp vào trình duyệt.');
}

function restoreDraft() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    Object.entries(data).forEach(([name, value]) => {
      if (['seo_score', 'word_count'].includes(name)) return;
      const elements = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
      elements.forEach(element => {
        if (element.type === 'checkbox' || element.type === 'radio') {
          const values = Array.isArray(value) ? value : [value];
          element.checked = values.includes(element.value);
        } else if (elements.length === 1) {
          element.value = value;
        }
      });
    });
    slugWasEdited = Boolean(fields.slug.value);
    showToast('Đã khôi phục bản nháp gần nhất.');
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function showToast(message, isError = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function insertAroundSelection(openTag, closeTag) {
  const input = fields.content;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = input.value.slice(start, end) || 'văn bản';
  input.setRangeText(`${openTag}${selected}${closeTag}`, start, end, 'end');
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

document.querySelector('#regenerate-slug').addEventListener('click', () => {
  fields.slug.value = slugify(fields.title.value);
  slugWasEdited = false;
  fields.slug.dispatchEvent(new Event('input', { bubbles: true }));
});

fields.title.addEventListener('input', () => {
  if (!slugWasEdited) fields.slug.value = slugify(fields.title.value);
});

fields.slug.addEventListener('input', event => {
  event.target.value = slugify(event.target.value);
  slugWasEdited = true;
});

document.querySelectorAll('[data-wrap]').forEach(button => {
  button.addEventListener('click', () => insertAroundSelection(`<${button.dataset.wrap}>`, `</${button.dataset.wrap}>`));
});

document.querySelectorAll('[data-block]').forEach(button => {
  button.addEventListener('click', () => {
    const tag = button.dataset.block;
    if (tag === 'ul') insertAroundSelection('<ul>\n  <li>', '</li>\n</ul>');
    else insertAroundSelection(`<${tag}>`, `</${tag}>`);
  });
});

document.querySelector('[data-link]').addEventListener('click', () => {
  const url = window.prompt('Nhập URL liên kết:', 'https://');
  if (url) insertAroundSelection(`<a href="${url.replace(/"/g, '&quot;')}">`, '</a>');
});

document.querySelector('#featured_image').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector('#featured-preview');
  preview.src = URL.createObjectURL(file);
  preview.closest('.upload-zone').classList.add('has-preview');
});

document.querySelectorAll('[data-robot-pair]').forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    const pair = form.querySelector(`[name="rank_math_robots[]"][value="${input.dataset.robotPair}"]`);
    if (pair) pair.checked = false;
  });
});

document.querySelectorAll('[name="visibility"]').forEach(input => {
  input.addEventListener('change', () => {
    document.querySelector('#password-field').hidden = input.value !== 'password' || !input.checked;
  });
});

document.querySelectorAll('.social-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.social-tab').forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.social-panel').forEach(panel => {
      const active = panel.id === `social-${tab.dataset.socialTab}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  });
});

document.querySelector('#rank_math_twitter_use_facebook').addEventListener('change', event => {
  document.querySelector('#twitter-custom-fields').hidden = event.target.value === 'on';
});

document.querySelectorAll('[data-device]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-device]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('#serp-preview').classList.toggle('mobile', button.dataset.device === 'mobile');
  });
});

form.addEventListener('input', () => {
  updateAll();
  markChanged();
});

form.addEventListener('change', () => {
  updateAll();
  markChanged();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) {
    showToast('Vui lòng hoàn thiện các trường bắt buộc.', true);
    return;
  }

  const submitButton = document.querySelector('#submit-button');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Đang lưu...';

  try {
    saveDraft(false);
    const submissionId = await submitToGoogleSheet();
    const status = document.querySelector('.header-status');
    status.classList.remove('changed');
    status.classList.add('saved');
    setText('#save-status', 'Đã gửi tới Google Sheet');
    localStorage.setItem(`${storageKey}-last-submission`, submissionId);
    showToast(`Đã gửi bài viết tới Google Sheet · SEO ${document.querySelector('#seo-score').textContent}/100`);
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Kết nối Google Sheet quá thời gian. Bản nháp vẫn đã được lưu.'
      : error.message;
    showToast(message, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

document.querySelector('#save-button').addEventListener('click', () => saveDraft());

document.querySelector('#export-button').addEventListener('click', () => {
  const payload = JSON.stringify(serializeForm(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fields.slug.value || 'wordpress-seo-post'}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Đã tạo tệp JSON của bài viết.');
});

const now = new Date();
now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
document.querySelector('#publish_at').value = now.toISOString().slice(0, 16);

restoreDraft();
updateDatabaseStatus();
updateAll();

window.setInterval(() => {
  if (document.querySelector('.header-status').classList.contains('changed')) saveDraft(false);
}, 30000);
