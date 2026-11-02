(() => {
  const form = document.getElementById('form');
  const success = document.getElementById('success');
  const btn = document.getElementById('submit');
  const formError = document.getElementById('formError');
  document.getElementById('yr').textContent = new Date().getFullYear();

  const MIN = 20, MAX = 1500;
  const rules = {
    discord: (v) => !v ? 'Discord username is required.' :
      !/^(?!.*\.\.)[a-zA-Z0-9_.]{2,32}(#\d{4})?$/.test(v) ? 'Enter a valid Discord username.' : '',
    x: (v) => { v = v.replace(/^@/, ''); return !v ? 'X username is required.' :
      !/^[A-Za-z0-9_]{1,15}$/.test(v) ? 'Enter a valid X username (letters, numbers, _; max 15).' : ''; },
  };
  for (const k of ['why', 'value', 'about']) {
    rules[k] = (v) => !v ? 'This field is required.' :
      v.length < MIN ? `This needs at least ${MIN} characters.` :
      v.length > MAX ? `This must be under ${MAX} characters.` : '';
  }

  const setErr = (name, msg) => {
    const el = form.querySelector(`.err[data-for="${name}"]`);
    if (el) el.textContent = msg || '';
    form.elements[name].closest('.field').classList.toggle('invalid', !!msg);
  };
  const check = (name) => { const m = rules[name](form.elements[name].value.trim()); setErr(name, m); return !m; };

  for (const name of Object.keys(rules)) {
    const el = form.elements[name];
    el.addEventListener('blur', () => { if (el.value) check(name); });
    el.addEventListener('input', () => {
      if (name === 'x' && el.value.startsWith('@')) el.value = el.value.replace(/^@+/, '');
      const c = form.querySelector(`.count[data-for="${name}"]`);
      if (c) c.textContent = `${el.value.length} / ${MAX}`;
      if (el.closest('.field').classList.contains('invalid')) check(name);
    });
  }

  // ---------- deadline / countdown ----------
  const $ = (id) => document.getElementById(id);
  const closed = $('closed'), cd = $('countdown'), eyebrow = document.querySelector('.eyebrow');
  let closesAt = null, skew = 0, timer = null;
  const fmtLocal = (d) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const pad = (n) => String(n).padStart(2, '0');

  function showClosed() {
    clearInterval(timer);
    form.hidden = true; success.hidden = true; closed.hidden = false; cd.hidden = true;
    if (eyebrow) eyebrow.textContent = '✦ Applications closed';
    if (closesAt) $('closed-when').textContent = `Closed ${fmtLocal(closesAt)}`;
    const cta = document.querySelector('.ctas .cta[href="#apply"]'); if (cta) cta.hidden = true;
  }
  function tick() {
    const ms = closesAt.getTime() - (Date.now() + skew);
    if (ms <= 0) {
      clearInterval(timer);
      if (!success.hidden) { cd.hidden = true; return; }
      // Don't yank the form away from someone mid-typing; the server will reject on submit.
      const typing = ['discord', 'x', 'why', 'value', 'about'].some((k) => form.elements[k].value.trim());
      if (typing) { cd.querySelector('.cd-label').textContent = 'Applications have closed'; cd.querySelector('.cd-units').hidden = true; }
      else showClosed();
      return;
    }
    const t = Math.floor(ms / 1000);
    $('cd-d').textContent = Math.floor(t / 86400);
    $('cd-h').textContent = pad(Math.floor(t / 3600) % 24);
    $('cd-m').textContent = pad(Math.floor(t / 60) % 60);
    $('cd-s').textContent = pad(t % 60);
  }
  fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()).then((st) => {
    if (st.now) skew = new Date(st.now).getTime() - Date.now(); // align with server clock
    if (st.closesAt) closesAt = new Date(st.closesAt);
    if (!st.open) return showClosed();
    if (!closesAt) return;
    $('cd-when').textContent = `Deadline: ${fmtLocal(closesAt)}`;
    cd.hidden = false; tick(); timer = setInterval(tick, 1000);
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    const ok = Object.keys(rules).map(check).every(Boolean);
    if (!ok) { form.querySelector('.invalid input, .invalid textarea')?.focus(); return; }

    const payload = Object.fromEntries(['discord', 'x', 'why', 'value', 'about', 'website']
      .map((k) => [k, form.elements[k].value.trim()]));
    btn.disabled = true; btn.querySelector('span').textContent = 'Sending…';
    try {
      const res = await fetch('/api/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        form.hidden = true; success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (res.status === 403 && data.closed) { showClosed(); return; }
      if (data.errors) for (const [k, m] of Object.entries(data.errors)) setErr(k, m);
      formError.textContent = data.error || (data.errors ? 'Please fix the highlighted fields.' : 'Something went wrong. Please try again.');
    } catch {
      formError.textContent = 'Network error. Please check your connection and try again.';
    } finally {
      btn.disabled = false; btn.querySelector('span').textContent = 'Submit application';
    }
  });
})();
