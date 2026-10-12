// Login page. Same flow and rules as the app (src/auth/*), plus Google sign-in.
// Signed in, it forwards to the personal page (/du/).
(function () {
  'use strict';

  const OTP_LENGTH = 6;
  const RESEND_COOLDOWN_S = 60;
  const client = window.ghostrunClient;

  // --- Rules and messages (same as src/auth/validation.ts and errors.ts) ---

  function validateEmail(email) {
    const e = email.trim();
    if (!e) return 'Bitte gib deine E-Mail-Adresse ein.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Diese E-Mail-Adresse sieht nicht richtig aus.';
    return null;
  }
  function validatePassword(pw) {
    if (pw.length < 8) return 'Das Passwort braucht mindestens 8 Zeichen.';
    if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) return 'Das Passwort braucht mindestens einen Buchstaben und eine Ziffer.';
    return null;
  }
  function validateName(name) {
    const n = name.trim();
    if (!n) return 'Wie sollen andere dich in der Rangliste sehen?';
    if (n.length > 40) return 'Der Name darf höchstens 40 Zeichen haben.';
    return null;
  }

  const MESSAGES = {
    invalid_credentials: 'E-Mail oder Passwort stimmt nicht.',
    email_not_confirmed: 'Bitte bestätige zuerst deine E-Mail-Adresse.',
    user_already_exists: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    email_exists: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    weak_password: 'Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen mit Buchstaben und Ziffern.',
    otp_expired: 'Der Code ist falsch oder abgelaufen. Fordere einen neuen an.',
    over_email_send_rate_limit: 'Zu viele E-Mails in kurzer Zeit. Bitte warte ein paar Minuten.',
    over_request_rate_limit: 'Zu viele Versuche. Bitte warte einen Moment.',
    same_password: 'Das neue Passwort muss sich vom alten unterscheiden.',
    email_address_invalid: 'Diese E-Mail-Adresse ist ungültig.',
    provider_disabled: 'Die Anmeldung mit Google ist noch nicht eingerichtet.',
    validation_failed: 'Die Anmeldung mit Google ist noch nicht eingerichtet.',
  };
  function errorMessage(err) {
    if (err && err.name === 'AuthRetryableFetchError') return 'Keine Verbindung. Prüf dein Internet und versuch es noch einmal.';
    if (err && err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    return 'Das hat nicht geklappt. Bitte versuch es noch einmal.';
  }

  // --- Views ---

  const $ = (id) => document.getElementById(id);
  const VIEWS = ['entry', 'code', 'forgot', 'newpw', 'loading'];
  function show(name) {
    for (const v of VIEWS) $('view-' + v).hidden = v !== name;
    const first = $('view-' + name).querySelector('form:not([hidden]) input, input');
    if (first && name !== 'entry') first.focus();
  }
  function setError(form, msg) { form.querySelector('.error').textContent = msg || ''; }
  async function busy(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  function selectTab(which) {
    const signup = which === 'signup';
    $('tab-signup').setAttribute('aria-selected', String(signup));
    $('tab-signin').setAttribute('aria-selected', String(!signup));
    $('form-signup').hidden = !signup;
    $('form-signin').hidden = signup;
    $('entry-title').textContent = signup ? 'Konto erstellen' : 'Willkommen zurück';
  }
  $('tab-signin').addEventListener('click', () => selectTab('signin'));
  $('tab-signup').addEventListener('click', () => selectTab('signup'));
  if (location.hash === '#registrieren') selectTab('signup');

  // --- Google ---

  $('google').addEventListener('click', async () => {
    $('oauth-error').textContent = '';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/login/' },
    });
    if (error) $('oauth-error').textContent = errorMessage(error);
  });

  // Errors come back in the URL after an aborted or failed Google sign-in.
  const params = new URLSearchParams(location.search + '&' + location.hash.slice(1));
  if (params.get('error')) {
    $('oauth-error').textContent = params.get('error') === 'access_denied'
      ? 'Anmeldung mit Google abgebrochen.'
      : 'Die Anmeldung mit Google hat nicht geklappt. Bitte versuch es noch einmal.';
    history.replaceState(null, '', location.pathname);
  }

  // --- Code boxes ---

  const boxes = [];
  for (let i = 0; i < OTP_LENGTH; i++) {
    const input = document.createElement('input');
    input.inputMode = 'numeric';
    input.autocomplete = i === 0 ? 'one-time-code' : 'off';
    input.maxLength = OTP_LENGTH;
    input.setAttribute('aria-label', 'Ziffer ' + (i + 1));
    $('code-boxes').appendChild(input);
    boxes.push(input);
  }
  const codeValue = () => boxes.map((b) => b.value).join('');
  const clearCode = () => boxes.forEach((b) => { b.value = ''; });
  function fillFrom(index, text) {
    const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH - index);
    digits.split('').forEach((d, k) => { boxes[index + k].value = d; });
    boxes[Math.min(index + digits.length, OTP_LENGTH - 1)].focus();
    if (codeValue().length === OTP_LENGTH) $('view-code').requestSubmit();
  }
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => { const v = box.value; box.value = ''; fillFrom(i, v); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); }
    });
    box.addEventListener('paste', (e) => { e.preventDefault(); fillFrom(i, e.clipboardData.getData('text')); });
  });

  let codeContext = { email: '', type: 'signup' };
  let cooldownTimer = null;
  function startCooldown() {
    let s = RESEND_COOLDOWN_S;
    const btn = $('resend');
    clearInterval(cooldownTimer);
    const tick = () => {
      btn.disabled = s > 0;
      btn.textContent = s > 0 ? 'Code erneut senden (' + s + ' s)' : 'Code erneut senden';
      if (s-- <= 0) clearInterval(cooldownTimer);
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }
  function openCode(email, type, intro) {
    codeContext = { email, type };
    $('code-intro').textContent = intro || 'Wir haben dir einen 6-stelligen Code an ' + email + ' geschickt.';
    setError($('view-code'), '');
    $('view-code').querySelector('.info').textContent = '';
    clearCode();
    show('code');
    boxes[0].focus();
    startCooldown();
  }

  // --- E-mail flows ---

  // Verifying a reset code already signs in; stay in the flow until the new password is set.
  let recovering = false;

  $('form-signup').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = $('su-name').value;
    const email = $('su-email').value.trim().toLowerCase();
    const pw = $('su-password').value;
    const err = validateName(name) || validateEmail(email) || validatePassword(pw);
    setError(form, err);
    if (err) return;
    busy(form, async () => {
      const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { display_name: name.trim() } } });
      if (error) return setError(form, errorMessage(error));
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        return setError(form, 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.');
      }
      openCode(email, 'signup');
    });
  });

  $('form-signin').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = $('si-email').value.trim().toLowerCase();
    const pw = $('si-password').value;
    const err = validateEmail(email) || (pw ? null : 'Bitte gib dein Passwort ein.');
    setError(form, err);
    if (err) return;
    busy(form, async () => {
      const { error } = await client.auth.signInWithPassword({ email, password: pw });
      if (!error) return;
      if (error.code === 'email_not_confirmed') {
        await client.auth.resend({ type: 'signup', email });
        return openCode(email, 'signup');
      }
      setError(form, errorMessage(error));
    });
  });

  $('view-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const token = codeValue();
    if (token.length !== OTP_LENGTH) return setError(form, 'Bitte gib alle 6 Ziffern ein.');
    busy(form, async () => {
      if (codeContext.type === 'recovery') recovering = true;
      const { error } = await client.auth.verifyOtp({ email: codeContext.email, token, type: codeContext.type });
      if (error) {
        recovering = false;
        clearCode();
        boxes[0].focus();
        return setError(form, errorMessage(error));
      }
      if (codeContext.type === 'recovery') show('newpw');
    });
  });

  $('resend').addEventListener('click', async () => {
    const form = $('view-code');
    setError(form, '');
    const { error } = codeContext.type === 'recovery'
      ? await client.auth.resetPasswordForEmail(codeContext.email)
      : await client.auth.resend({ type: 'signup', email: codeContext.email });
    if (error) return setError(form, errorMessage(error));
    form.querySelector('.info').textContent = 'Neuer Code ist unterwegs.';
    startCooldown();
  });

  $('view-forgot').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = $('fp-email').value.trim().toLowerCase();
    const err = validateEmail(email);
    setError(form, err);
    if (err) return;
    busy(form, async () => {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) return setError(form, errorMessage(error));
      openCode(email, 'recovery', 'Falls es für ' + email + ' ein Konto gibt, ist ein 6-stelliger Code unterwegs.');
    });
  });

  $('view-newpw').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = $('np-password').value;
    const err = validatePassword(pw);
    setError(form, err);
    if (err) return;
    busy(form, async () => {
      const { error } = await client.auth.updateUser({ password: pw });
      if (error) return setError(form, errorMessage(error));
      recovering = false;
      render((await client.auth.getSession()).data.session);
    });
  });

  // --- Session ---

  function render(session) {
    if (recovering) return;
    if (!session) {
      if (!$('view-loading').hidden) show('entry');
      return;
    }
    show('loading');
    location.replace('/du/');
  }

  client.auth.onAuthStateChange((_event, session) => {
    // Deferred: Supabase advises against awaiting auth calls inside this callback.
    setTimeout(() => render(session), 0);
  });
})();
