(function () {
  const galleryEl = document.querySelector('[data-gallery]');
  const lightboxEl = document.querySelector('[data-lightbox]');
  const lightboxImg = lightboxEl?.querySelector('.lightbox__image');
  const closeBtn = lightboxEl?.querySelector('.lightbox__close');
  const prevBtn = lightboxEl?.querySelector('.lightbox__nav--prev');
  const nextBtn = lightboxEl?.querySelector('.lightbox__nav--next');
  const themeLinkEl = document.getElementById('themeStylesheet');
  const themeSwitchForm = document.querySelector('[data-theme-switcher]');
  const themeOptions = themeSwitchForm ? Array.from(themeSwitchForm.querySelectorAll('.theme-option')) : [];
  const themeRadios = themeSwitchForm ? Array.from(themeSwitchForm.querySelectorAll("input[name='theme']")) : [];
  const globalManifest = Array.isArray(window.__PHOTO_MANIFEST__) ? window.__PHOTO_MANIFEST__ : null;
  let currentItems = [];
  let currentIndex = -1;
  const prefetchCache = new Set();
  const THEME_STORAGE_KEY = 'photo-zone-theme';
  const THEME_MAP = {
    blue: 'styles/theme-blue.css',
    neon: 'styles/theme-neon.css',
    sepia: 'styles/theme-sepia.css',
    sunny: 'styles/theme-sunny.css',
  };

  function initializeContactReveal() {
    const container = document.querySelector('[data-contact-container]');
    if (!container) return;

    const trigger = container.querySelector('[data-contact-trigger]');
    const target = container.querySelector('[data-contact-target]');
    const link = container.querySelector('[data-contact-link]');

    if (!trigger || !target || !link) return;

    const user = link.getAttribute('data-user');
    const domain = link.getAttribute('data-domain');
    if (!user || !domain) return;

    const email = `${user}@${domain}`;

    function revealEmail() {
      if (!target.hidden) return;
      target.hidden = false;
      link.textContent = email;
      link.setAttribute('href', `mailto:${email}`);
      link.setAttribute('aria-label', `Email ${email}`);
      trigger.setAttribute('aria-expanded', 'true');
      trigger.hidden = true;
    }

    trigger.addEventListener('click', revealEmail);
  }

  initializeContactReveal();

  if (!galleryEl) {
    return;
  }

  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'];

  function setLightboxVisibility(visible) {
    if (!lightboxEl) return;

    if (visible) {
      lightboxEl.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
    } else {
      lightboxEl.setAttribute('hidden', '');
      document.body.style.overflow = '';
    }
  }

  function showImageAt(index) {
    if (!lightboxImg || !currentItems.length) return;

    const total = currentItems.length;
    const normalizedIndex = ((index % total) + total) % total;
    currentIndex = normalizedIndex;

    const item = currentItems[normalizedIndex];
    if (!item) return;

    lightboxImg.src = item.full;
    lightboxImg.alt = item.title;
    lightboxImg.dataset.index = String(normalizedIndex);

    prefetchImage(normalizedIndex + 1);
    prefetchImage(normalizedIndex - 1);
  }

  function openLightbox(index) {
    if (!lightboxImg || !currentItems.length) return;
    setLightboxVisibility(true);
    showImageAt(index);
  }

  function closeLightbox() {
    if (lightboxImg) {
      lightboxImg.src = '';
      lightboxImg.alt = '';
    }
    currentIndex = -1;
    setLightboxVisibility(false);
  }

  function changeImage(step) {
    if (!currentItems.length) return;
    showImageAt(currentIndex + step);
  }

  function setActiveThemeOption(theme) {
    themeOptions.forEach((option) => {
      const input = option.querySelector("input[name='theme']");
      const isMatch = input?.value === theme;
      option.classList.toggle('is-active', Boolean(isMatch));
      if (input) {
        input.checked = Boolean(isMatch);
      }
    });
  }

  function applyTheme(theme, { persist = true } = {}) {
    const normalized = THEME_MAP[theme] ? theme : 'blue';
    const href = THEME_MAP[normalized];

    if (themeLinkEl && themeLinkEl.getAttribute('href') !== href) {
      themeLinkEl.setAttribute('href', href);
    }

    document.body.dataset.theme = normalized;
    setActiveThemeOption(normalized);

    if (persist) {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalized);
      } catch (err) {
        // Storage might be unavailable; ignore.
      }
    }
  }

  function initializeTheme() {
    const defaultTheme = themeLinkEl?.dataset.defaultTheme || 'blue';
    let desiredTheme = defaultTheme;

    try {
      const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
      if (stored && THEME_MAP[stored]) {
        desiredTheme = stored;
      }
    } catch (err) {
      desiredTheme = defaultTheme;
    }

    applyTheme(desiredTheme, { persist: false });
  }

  function createGallery(items) {
    galleryEl.innerHTML = '';
    currentItems = Array.isArray(items) ? items.slice() : [];
    prefetchCache.clear();
    currentIndex = -1;
    if (!Array.isArray(items) || items.length === 0) {
      const emptyMessage = document.createElement('p');
      emptyMessage.textContent = 'No photos found in the vault. Drop some files into the photos folder!';
      emptyMessage.className = 'instructions';
      galleryEl.appendChild(emptyMessage);
      return;
    }

    currentItems.forEach((item, index) => {
      const figure = document.createElement('figure');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gallery__trigger';

      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';

      button.appendChild(img);
      figure.appendChild(button);
      galleryEl.appendChild(figure);

      button.addEventListener('click', () => {
        openLightbox(index);
      });
    });
  }

  async function fetchJsonList(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`${url} did not return an array`);
    }
    return data;
  }

  async function fetchFromDirectoryListing() {
    const response = await fetch('photos/', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Directory listing unavailable');
    }
    const html = await response.text();
    const regex = /href="([^"?#]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff))"/gi;
    const files = new Set();
    let match;
    while ((match = regex.exec(html)) !== null) {
      const file = decodeURIComponent(match[1]);
      const lower = file.toLowerCase();
      const valid = imageExtensions.some((ext) => lower.endsWith(`.${ext}`));
      if (valid) {
        files.add(`photos/${file}`);
      }
    }
    return Array.from(files);
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];

    return items
      .map((raw, index) => {
        if (!raw) return null;
        if (typeof raw === 'string') {
          const fullPath = normalizePath(raw, 'photos/');
          return {
            filename: extractFilename(fullPath) || `image-${index + 1}`,
            full: fullPath,
            thumb: fullPath,
            title: buildTitleFromFilename(fullPath, index),
          };
        }
        if (typeof raw === 'object') {
          const fullPath = normalizePath(raw.full ?? raw.path ?? raw.src ?? raw.url ?? '', 'photos/');
          const thumbPath = normalizePath(raw.thumb ?? raw.thumbnail ?? raw.thumbUrl ?? '', 'thumbnails/');
          const fallbackFull = fullPath || normalizePath(raw.filename ?? raw.name ?? '', 'photos/');
          const finalFull = fullPath || fallbackFull;
          const finalThumb = thumbPath || finalFull;
          const filename = raw.filename ?? raw.name ?? extractFilename(finalFull) ?? `image-${index + 1}`;
          const title = raw.title ?? buildTitleFromFilename(filename, index);
          if (!finalFull) {
            return null;
          }
          return {
            filename,
            full: finalFull,
            thumb: finalThumb,
            title,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  function normalizePath(value, basePrefix) {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(?:https?:)?\//i.test(trimmed) || trimmed.startsWith('./') || trimmed.startsWith('../')) {
      return trimmed;
    }
    if (trimmed.startsWith('photos/') || trimmed.startsWith('thumbnails/')) {
      return trimmed;
    }
    return `${basePrefix || ''}${trimmed.replace(/^\.\/?/, '')}`;
  }

  function extractFilename(path) {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || '';
  }

  function buildTitleFromFilename(filename, index) {
    const stem = filename.replace(/\.[^.]+$/, '');
    const cleaned = stem.replace(/[-_]+/g, ' ').trim();
    if (cleaned) {
      return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
    }
    return `Gallery Image ${index + 1}`;
  }

  function prefetchImage(index) {
    if (!currentItems.length) return;
    const total = currentItems.length;
    const normalizedIndex = ((index % total) + total) % total;
    const item = currentItems[normalizedIndex];
    if (!item) return;
    const url = item.full;
    if (prefetchCache.has(url)) {
      return;
    }
    const img = new Image();
    img.src = url;
    prefetchCache.add(url);
  }

  async function loadGallery() {
    const manifestCandidates = ['photos/photos.json', 'photos/manifest.json'];

    if (globalManifest?.length) {
      createGallery(normalizeItems(globalManifest));
      return;
    }

    for (const manifest of manifestCandidates) {
      try {
        const list = await fetchJsonList(manifest);
        if (list.length) {
          createGallery(normalizeItems(list));
          return;
        }
      } catch (err) {
        // Continue to next candidate or fallback
      }
    }

    try {
      const list = await fetchFromDirectoryListing();
      createGallery(normalizeItems(list));
    } catch (err) {
      createGallery([]);
    }
  }

  closeBtn?.addEventListener('click', closeLightbox);
  prevBtn?.addEventListener('click', () => changeImage(-1));
  nextBtn?.addEventListener('click', () => changeImage(1));
  lightboxEl?.addEventListener('click', (event) => {
    if (event.target === lightboxEl) {
      closeLightbox();
    }
  });
  themeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        applyTheme(radio.value);
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    const isLightboxOpen = lightboxEl && !lightboxEl.hasAttribute('hidden');
    if (!isLightboxOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      changeImage(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      changeImage(-1);
    }
  });

  initializeTheme();
  loadGallery();
})();
