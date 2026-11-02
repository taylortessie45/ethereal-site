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
      if (data.errors) for (const [k, m] of Object.entries(data.errors)) setErr(k, m);
      formError.textContent = data.error || (data.errors ? 'Please fix the highlighted fields.' : 'Something went wrong. Please try again.');
    } catch {
      formError.textContent = 'Network error. Please check your connection and try again.';
    } finally {
      btn.disabled = false; btn.querySelector('span').textContent = 'Submit application';
    }
  });
})();
