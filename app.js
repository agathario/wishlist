// Where the wishlist lives on GitHub. The owner form saves changes here.
const OWNER = 'agathario';
const REPO = 'wishlist';
const BRANCH = 'main';
const DATA_PATH = 'data/wishlist.json';

const PRIORITIES = [
  { key: 'omg', label: 'OMG PLEASE' },
  { key: 'love', label: 'love' },
  { key: 'nice', label: 'nice to have' },
];
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p.key, i]));
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label]));

const $ = (sel) => document.querySelector(sel);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

let data = { title: 'Wishlist', notice: '', items: [] };
let token = store.get('wishlist-token');
let editingId = null;

// ---------- Building elements ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

function siteName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function badge(priority) {
  return el('span', { class: `badge p-${priority}` }, PRIORITY_LABEL[priority] || priority);
}

function card(item) {
  const site = siteName(item.url);
  const name = item.name || site || 'Untitled';
  const link = { href: item.url, target: '_blank', rel: 'noopener' };

  const thumb = el('a', { ...link, class: 'thumb', tabindex: '-1', 'aria-hidden': 'true' },
    item.image
      ? el('img', { src: item.image, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(placeholder(site)) })
      : placeholder(site));

  return el('article', { class: 'card' },
    thumb,
    el('div', { class: 'card-body' },
      el('div', { class: 'card-meta' }, el('span', { class: 'site' }, site), badge(item.priority)),
      el('h3', {}, el('a', link, name)),
      item.price != null && item.price !== '' && el('p', { class: 'price' }, money.format(item.price)),
      item.notes && el('p', { class: 'notes' }, item.notes),
      token && el('div', { class: 'card-actions' },
        el('button', { class: 'button small', type: 'button', onclick: () => openItemDialog(item) }, 'Edit'))));
}

function placeholder(site) {
  return el('div', { class: 'placeholder' }, (site || '?')[0]);
}

// ---------- Rendering ----------

function render() {
  document.title = data.title || 'Wishlist';
  $('#title').textContent = data.title || 'Wishlist';

  const notice = $('#notice');
  notice.textContent = data.notice || '';
  notice.hidden = !data.notice;

  $('#admin-bar').hidden = !token;
  $('#owner-link').textContent = token ? 'Signed in · sign out' : 'Owner sign-in';

  const items = [...data.items];
  const n = items.length;
  $('#count').textContent = n === 1 ? '1 item' : `${n} items`;

  const list = $('#list');
  list.replaceChildren();
  if (!n) {
    list.append(el('p', { class: 'empty' }, token ? 'Nothing here yet. Add your first item!' : 'Nothing here yet.'));
    return;
  }

  const sort = $('#sort').value;
  const newest = (a, b) => (b.added || '').localeCompare(a.added || '');
  const price = (i) => (i.price == null || i.price === '' ? null : Number(i.price));

  if (sort === 'priority') {
    list.className = 'grouped';
    for (const p of PRIORITIES) {
      const group = items.filter((i) => (i.priority || 'love') === p.key).sort(newest);
      if (!group.length) continue;
      list.append(el('section', { class: 'group' },
        el('h2', {}, badge(p.key), el('span', {}, `${group.length}`)),
        el('div', { class: 'grid' }, group.map(card))));
    }
    return;
  }

  list.className = '';
  if (sort === 'newest') items.sort(newest);
  else {
    const dir = sort === 'price-asc' ? 1 : -1;
    items.sort((a, b) => {
      const pa = price(a), pb = price(b);
      if (pa == null && pb == null) return newest(a, b);
      if (pa == null) return 1; // no price always goes last
      if (pb == null) return -1;
      return (pa - pb) * dir || newest(a, b);
    });
  }
  list.append(el('div', { class: 'grid' }, items.map(card)));
}

// ---------- Theme ----------

function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
$('#theme-toggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('wishlist-theme', next);
});

// ---------- GitHub saving ----------

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function github(path, options = {}, authToken = token) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${authToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub didn't accept your token. It may have expired. Sign out and sign in with a new one.");
  return res;
}

async function readRemote() {
  const res = await github(`/contents/${DATA_PATH}?ref=${BRANCH}`);
  if (!res.ok) throw new Error(`Couldn't read the wishlist from GitHub (${res.status}).`);
  const file = await res.json();
  return { sha: file.sha, data: JSON.parse(fromBase64(file.content)) };
}

// Re-reads the latest file from GitHub, applies the change, and saves it.
// Retries if something else (like the preview bot) saved in between.
async function save(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data: latest } = await readRemote();
    change(latest);
    const res = await github(`/contents/${DATA_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: toBase64(JSON.stringify(latest, null, 2) + '\n'),
        sha,
        branch: BRANCH,
      }),
    });
    if (res.ok) {
      data = latest;
      render();
      toast('Saved! The live site will update in a minute or two.');
      return;
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error("Your token isn't allowed to change the wishlist. On GitHub, edit the token and set Contents to \"Read and write\" for the wishlist repo.");
    }
    if (res.status !== 409 && res.status !== 422) {
      throw new Error(`GitHub wouldn't save the change (${res.status}).`);
    }
  }
  throw new Error('GitHub kept rejecting the save. Try again in a moment.');
}

// ---------- Dialogs ----------

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

function showError(id, message) {
  const node = $(id);
  node.textContent = message || '';
  node.hidden = !message;
}

async function withBusy(form, work) {
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try { await work(); } finally { buttons.forEach((b) => (b.disabled = false)); }
}

// Sign in / out
$('#repo-name').textContent = `${OWNER}/${REPO}`;
$('#owner-link').addEventListener('click', () => {
  if (token) return signOut();
  showError('#signin-error', '');
  $('#token-input').value = '';
  $('#signin-dialog').showModal();
});

$('#signin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const candidate = $('#token-input').value.trim();
  withBusy(e.target, async () => {
    try {
      const res = await github('', {}, candidate);
      const repo = res.ok ? await res.json() : null;
      if (!repo?.permissions?.push) {
        throw new Error("That token can't edit this repo. Check that it has Contents: Read and write access to wishlist.");
      }
      token = candidate;
      store.set('wishlist-token', token);
      $('#signin-dialog').close();
      await loadData();
      toast('Signed in. You can add and edit items now.');
    } catch (err) {
      showError('#signin-error', err.message);
    }
  });
});

function signOut() {
  if (!confirm('Sign out of editing on this device?')) return;
  token = null;
  store.remove('wishlist-token');
  $('#settings-dialog').close();
  render();
}
$('#sign-out').addEventListener('click', signOut);

// Add / edit item
const itemForm = $('#item-form');
let lookupTimer;
let lookupFor = '';
let lookedUpImage = '';

function openItemDialog(item) {
  editingId = item?.id || null;
  itemForm.reset();
  $('#item-dialog-title').textContent = item ? 'Edit item' : 'Add item';
  $('#delete-item').hidden = !item;
  showError('#item-error', '');
  $('#lookup').hidden = true;
  lookupFor = item?.url || '';
  lookedUpImage = '';
  if (item) {
    itemForm.url.value = item.url;
    itemForm.name.value = item.name || '';
    itemForm.price.value = item.price ?? '';
    itemForm.priority.value = item.priority || 'love';
    itemForm.notes.value = item.notes || '';
    // Only show picture links you typed yourself, not the automatic previews.
    itemForm.image.value = item.customImage ? item.imageSource || item.image : '';
  }
  $('#item-dialog').showModal();
}

// When a link is pasted, try to show its preview right away.
// Some stores (like Etsy) block this, but the preview bot will still get them after saving.
itemForm.url.addEventListener('input', () => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(lookUp, 500);
});

async function lookUp() {
  const url = itemForm.url.value.trim();
  if (!/^https?:\/\/\S+\.\S+/.test(url) || url === lookupFor) return;
  lookupFor = url;
  lookedUpImage = '';
  const img = $('#lookup-image');
  img.removeAttribute('src');
  $('#lookup-status').textContent = 'Looking up a preview…';
  $('#lookup').hidden = false;
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    const { status, data: found } = await res.json();
    if (url !== lookupFor) return; // a newer link was pasted meanwhile
    if (status !== 'success' || !found.image?.url) throw new Error();
    lookedUpImage = found.image.url;
    img.src = lookedUpImage;
    $('#lookup-status').textContent = found.title || 'Found it!';
  } catch {
    if (url !== lookupFor) return;
    $('#lookup-status').textContent = "Couldn't preview it here, but the picture and name will be filled in automatically after you save.";
  }
}

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = itemForm;
  const url = f.url.value.trim();
  const customImage = f.image.value.trim();
  const fields = {
    url,
    name: f.name.value.trim(),
    price: f.price.value === '' ? null : Math.round(Number(f.price.value) * 100) / 100,
    priority: f.priority.value || 'love',
    notes: f.notes.value.trim(),
  };

  withBusy(f, async () => {
    try {
      if (editingId) {
        await save((d) => {
          const item = d.items.find((i) => i.id === editingId);
          if (!item) throw new Error('That item was deleted somewhere else.');
          const urlChanged = item.url !== url;
          Object.assign(item, fields);
          if (customImage) {
            if (customImage !== (item.imageSource || item.image)) {
              item.image = customImage;
              delete item.imageSource;
            }
            item.customImage = true;
          } else if (urlChanged || item.customImage) {
            // New link (or custom picture removed): fetch a fresh preview.
            item.image = urlChanged ? lookedUpImage : '';
            item.customImage = false;
            delete item.imageSource;
          }
          if (urlChanged || !item.name || !item.image) item.previewFetched = false;
        }, `Edit ${fields.name || siteName(url)}`);
      } else {
        await save((d) => {
          d.items.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            ...fields,
            image: customImage || lookedUpImage,
            customImage: !!customImage,
            added: new Date().toISOString(),
            previewFetched: false,
          });
        }, `Add ${fields.name || siteName(url)}`);
      }
      $('#item-dialog').close();
    } catch (err) {
      showError('#item-error', err.message);
    }
  });
});

$('#delete-item').addEventListener('click', () => {
  const item = data.items.find((i) => i.id === editingId);
  if (!confirm(`Delete "${item?.name || 'this item'}" from your wishlist?`)) return;
  withBusy(itemForm, async () => {
    try {
      await save((d) => { d.items = d.items.filter((i) => i.id !== editingId); },
        `Remove ${item?.name || 'item'}`);
      $('#item-dialog').close();
    } catch (err) {
      showError('#item-error', err.message);
    }
  });
});

$('#add-item').addEventListener('click', () => openItemDialog(null));

// Title & note
$('#edit-settings').addEventListener('click', () => {
  const f = $('#settings-form');
  f.title.value = data.title || '';
  f.notice.value = data.notice || '';
  showError('#settings-error', '');
  $('#settings-dialog').showModal();
});

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  withBusy(f, async () => {
    try {
      await save((d) => {
        d.title = f.title.value.trim();
        d.notice = f.notice.value.trim();
      }, 'Update title and note');
      $('#settings-dialog').close();
    } catch (err) {
      showError('#settings-error', err.message);
    }
  });
});

// ---------- Toast ----------

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 4000);
}

// ---------- Start ----------

$('#sort').value = store.get('wishlist-sort') || 'priority';
$('#sort').addEventListener('change', () => {
  store.set('wishlist-sort', $('#sort').value);
  render();
});

async function loadData() {
  // Signed-in owners read straight from GitHub so they see changes that
  // haven't reached the live site yet. Everyone else reads the published file.
  if (token) {
    try {
      data = (await readRemote()).data;
      render();
      return;
    } catch (err) {
      toast(err.message);
    }
  }
  try {
    const res = await fetch(`${DATA_PATH}?v=${Date.now()}`);
    data = await res.json();
  } catch {
    $('#list').replaceChildren(el('p', { class: 'empty' }, "Couldn't load the wishlist. Try refreshing."));
    return;
  }
  render();
}

loadData();
