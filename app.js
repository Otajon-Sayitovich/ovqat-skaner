/* ===================================================================
 * Ovqat tarqatish — mustaqil QR skaner (PWA)
 *
 * Google Sheets bilan Apps Script API orqali gaplashadi.
 * O'quvchilar ro'yxati qurilmada saqlanadi, shuning uchun internet
 * uzilsa ham skanerlash va saqlash to'xtamaydi — yozuvlar navbatga
 * tushadi va aloqa tiklanganda o'zi yuboriladi.
 * =================================================================== */

'use strict';

var MSG = {
  duplicate: "Bu o'quvchi ovqat olgan",
  unknown: 'Bu QR kod tizimda mavjud emas',
  inactive: "Bu o'quvchi to'lov qilmagan yoki limit tugagan",
  mablag: "Bu o'quvchining hisobida mablag' yetarli emas"
};

/* ------------------------------------------------------------------ saqlash */
var Store = {
  get: function (k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};

function $(id) { return document.getElementById(id); }

/** Toshkent kuni (UTC+5) — qurilma soatidan qat'i nazar */
function today() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }
function stamp() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); }
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var toastTimer;
function toast(msg) {
  var el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3000);
}

function beep(ok) {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = beep._c || (beep._c = new Ctx());
    if (ctx.state === 'suspended') ctx.resume();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 950 : 260;
    o.type = ok ? 'sine' : 'square';
    g.gain.setValueAtTime(0.13, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.16 : 0.4));
    o.start(); o.stop(ctx.currentTime + (ok ? 0.17 : 0.42));
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(ok ? 60 : [70, 60, 70]); } catch (e) {}
}

/* ------------------------------------------------------------------ uzatish
 * Asosiy tizimdagi "Jonli skanerni ochish" tugmasi manzilning "#" qismida
 * tizim havolasi va sessiya kalitini yuboradi. Ularni saqlab olib, manzilni
 * darhol tozalaymiz — kalit brauzer tarixida qolmasin.
 * "#" qismi serverga umuman yuborilmaydi.
 */
(function handoff() {
  var h = (location.hash || '').replace(/^#/, '');
  if (!h) return;
  var p = {};
  h.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) {
      try { p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); }
      catch (e) {}
    }
  });
  if (!p.url && !p.token) return;
  if (p.url) Store.set('api_url', p.url);
  if (p.token) Store.set('token', p.token);
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { location.hash = ''; }
})();

/* ------------------------------------------------------------------ server */
var Cfg = {
  url: Store.get('api_url', ''),
  token: Store.get('token', ''),
  email: Store.get('email', '')
};

function api(action, payload, token) {
  if (!Cfg.url) return Promise.reject(new Error('Tizim havolasi kiritilmagan'));
  return fetch(Cfg.url, {
    method: 'POST',
    // text/plain — brauzer oldindan OPTIONS yubormasligi uchun
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: action,
      token: token === undefined ? Cfg.token : token,
      payload: payload || {}
    })
  }).then(function (r) {
    if (!r.ok) throw new Error('Server javobi: ' + r.status);
    return r.json();
  }).then(function (res) {
    if (!res || !res.ok) throw new Error((res && res.error) || 'Xatolik');
    return res.data;
  });
}

/**
 * Server "kalitingiz yaroqsiz" deb javob berdimi?
 * Bunda internet aybdor emas — qurilma qaytadan ulanishi kerak.
 */
function isAuthError(err) {
  return /AUTH|dostup|bloklangan/i.test(String((err && err.message) || err));
}

var KALIT_ESKIRGAN = 'Kalit eskirgan yoki bekor qilingan. Tizimdan yangi 6 xonali ' +
                     'kod olib, shu yerga kiriting.';

/* ------------------------------------------------------------------ navbat */
var Queue = {
  KEY: 'outbox',
  items: function () { return Store.get(Queue.KEY, []); },
  size: function () { return Queue.items().length; },
  push: function (item) {
    var q = Queue.items(); q.push(item); Store.set(Queue.KEY, q); UI.status();
  },
  sending: false,
  flush: function () {
    if (Queue.sending || !App.online) return Promise.resolve();
    var batch = Queue.items().slice(0, 50);
    if (!batch.length) return Promise.resolve();
    Queue.sending = true;
    return api('scans', { scans: batch }).then(function (res) {
      Queue.sending = false;
      var done = {};
      batch.forEach(function (b) { done[b.client_uuid] = true; });
      Store.set(Queue.KEY, Queue.items().filter(function (i) { return !done[i.client_uuid]; }));
      if (res && res.results) {
        var byUuid = {};
        batch.forEach(function (b) { byUuid[b.client_uuid] = b; });
        res.results.forEach(function (r) {
          var item = byUuid[r.client_uuid];
          if (!item) return;
          if (r.natija === 'ok') Snap.markServed(item.oquvchi_id);
          else if (r.natija === 'mablag' && item.natija_local === 'ok') Snap.refund(item.oquvchi_id);
        });
      }
      UI.status();
      if (Queue.size()) return Queue.flush();
    }).catch(function (err) {
      Queue.sending = false;
      if (isAuthError(err)) {
        App.logout(KALIT_ESKIRGAN);
      } else {
        App.setOnline(false);
      }
    });
  }
};

/* ------------------------------------------------------------------ nusxa */
var Snap = {
  KEY: 'snapshot',
  data: null,
  load: function () {
    Snap.data = Store.get(Snap.KEY, null);
    if (Snap.data && Snap.data.day !== today()) {
      Snap.data.day = today();
      Snap.data.served = {};
      Snap.save();
    }
    return Snap.data;
  },
  save: function () { Store.set(Snap.KEY, Snap.data); },
  sync: function () {
    return api('snapshot').then(function (d) {
      var byId = {}, served = {};
      d.students.forEach(function (s) { byId[s.id] = s; });
      (d.served_today || []).forEach(function (id) { served[id] = true; });
      Queue.items().forEach(function (q) {
        if (q.sana === d.day && q.natija_local === 'ok') served[q.oquvchi_id] = true;
      });
      Snap.data = { day: d.day, students: byId, served: served, synced: stamp() };
      Snap.save();
      App.setOnline(true);
      UI.status();
      return Snap.data;
    });
  },
  student: function (id) { return (Snap.data && Snap.data.students[id]) || null; },
  isServed: function (id) { return !!(Snap.data && Snap.data.served[id]); },
  markServed: function (id) {
    if (Snap.data && id) { Snap.data.served[id] = true; Snap.save(); }
  },
  /** Lokal balansdan 1 kunlik narxni yechadi (yakuniy qarorni server qiladi). */
  charge: function (id) {
    var s = Snap.student(id);
    if (!s || s.balans === null || s.balans === undefined || !(s.narx > 0)) return;
    s.balans = s.balans - s.narx;
    Snap.save();
  },
  /** Server "mablag' yetmadi" desa - lokal "ok" qaytariladi. */
  refund: function (id) {
    var s = Snap.student(id);
    if (Snap.data) delete Snap.data.served[id];
    if (s) {
      if (s.balans !== null && s.balans !== undefined && s.narx > 0) s.balans = s.balans + s.narx;
      s.status = 'mablag';
    }
    Snap.save();
  },
  servedCount: function () { return Snap.data ? Object.keys(Snap.data.served).length : 0; },
  count: function () { return Snap.data ? Object.keys(Snap.data.students).length : 0; }
};

/* ------------------------------------------------------------------ interfeys */
var UI = {
  show: function (name) {
    ['setup', 'scan'].forEach(function (n) {
      $(n).classList.toggle('hidden', n !== name);
    });
  },
  status: function () {
    var pending = Queue.size();
    var dot = App.online ? '<span class="dot"></span>' : '<span class="dot off"></span>';
    $('net').innerHTML = dot;
    var parts = [];
    parts.push(App.online ? 'online' : 'aloqa yo\'q');
    parts.push('bugun: ' + Snap.servedCount());
    if (pending) parts.push('navbatda: ' + pending);
    if (Snap.data) parts.push(Snap.count() + ' o\'quvchi');
    $('stat').textContent = parts.join(' · ');
  }
};

/* ------------------------------------------------------------------ skaner */
var Scanner = {
  stream: null, video: null, canvas: null, ctx: null,
  running: false, raf: null, last: 0, lastCode: '', lastAt: 0, paused: false,

  start: function () {
    Scanner.video = $('video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Scanner.fail('Bu brauzerda kamera qo\'llab-quvvatlanmaydi.');
    }
    $('start-text').textContent = 'Kamera so\'ralmoqda…';
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (s) {
      Scanner.stream = s;
      Scanner.video.srcObject = s;
      return Scanner.video.play();
    }).then(function () {
      $('startbox').classList.add('hidden');
      $('frame').classList.remove('hidden');
      $('hint').classList.remove('hidden');
      Scanner.canvas = document.createElement('canvas');
      Scanner.ctx = Scanner.canvas.getContext('2d', { willReadFrequently: true });
      Scanner.running = true;
      Scanner.paused = false;
      Scanner.loop();
      App.keepAwake();
    }).catch(function (err) {
      Scanner.fail('Kamera ochilmadi (' + (err && err.name ? err.name : 'xato') + '). ' +
                   'Brauzer sozlamalarida kameraga ruxsat bering.');
    });
  },

  fail: function (message) {
    $('startbox').classList.remove('hidden');
    $('start-text').textContent = message;
    $('btn-start').classList.remove('hidden');
    $('btn-start').textContent = 'Qayta urinish';
  },

  stop: function () {
    Scanner.running = false;
    if (Scanner.raf) cancelAnimationFrame(Scanner.raf);
    if (Scanner.stream) {
      Scanner.stream.getTracks().forEach(function (t) { t.stop(); });
      Scanner.stream = null;
    }
  },

  loop: function () {
    if (!Scanner.running) return;
    Scanner.raf = requestAnimationFrame(Scanner.loop);
    if (Scanner.paused) return;
    var now = Date.now();
    if (now - Scanner.last < 80) return;       // ~12 kadr/sek
    Scanner.last = now;

    var v = Scanner.video;
    if (!v || v.readyState !== v.HAVE_ENOUGH_DATA) return;
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;

    var scale = Math.min(1, 640 / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);
    Scanner.canvas.width = cw; Scanner.canvas.height = ch;
    Scanner.ctx.drawImage(v, 0, 0, cw, ch);
    var img;
    try { img = Scanner.ctx.getImageData(0, 0, cw, ch); } catch (e) { return; }

    var code = null;
    try { code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); }
    catch (e) { return; }
    if (code && code.data) Scanner.hit(code.data);
  },

  hit: function (text) {
    var now = Date.now();
    // Bir xil kartani ketma-ket o'qimaymiz. 2026-09-11 da 12 ta "ovqat olgan"
    // xabarining 7 tasi shundan edi: saqlangandan keyin karta hali kamera
    // oldida turgan, skaner uni darhol qayta o'qib qizil xabar chiqargan.
    if (text === Scanner.lastCode && now - Scanner.lastAt < Scanner.TAKROR_MS) return;
    Scanner.lastCode = text; Scanner.lastAt = now;
    Scanner.paused = true;
    App.decide(text);
  },

  // Qaror qabul qilingandan keyin (Saqlash / Bekor qilish) o'sha karta shuncha
  // vaqt e'tiborsiz qoldiriladi - odam kartani olib ketishga ulgursin.
  TAKROR_MS: 4000,

  resume: function () {
    // lastCode ni TOZALAMAYMIZ (ilgari tozalanardi va shu sabab karta darhol
    // qayta o'qilardi). Aksincha, hisobni hozirdan boshlaymiz.
    Scanner.lastAt = Date.now();
    Scanner.paused = false;
    if (!Scanner.running && !Scanner.stream) Scanner.start();
  }
};

/* ------------------------------------------------------------------ ilova */
var App = {
  online: navigator.onLine !== false,
  pending: null,
  wakeLock: null,

  start: function () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    window.addEventListener('online', function () { App.setOnline(true); Queue.flush(); });
    window.addEventListener('offline', function () { App.setOnline(false); });

    $('setup-form').addEventListener('submit', App.connect);
    $('btn-start').addEventListener('click', function () { Scanner.start(); });
    $('btn-exit').addEventListener('click', function () {
      if (confirm('Skanerdan chiqasizmi? Yuborilmagan yozuvlar saqlanib qoladi.')) App.logout();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { App.keepAwake(); Queue.flush(); }
    });

    if (!Cfg.url || !Cfg.token) { UI.show('setup'); $('s-url').value = Cfg.url || ''; return; }
    App.enterScanner();
  },

  connect: function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button');
    var err = $('s-err');
    err.classList.add('hidden');
    btn.disabled = true;

    var url = $('s-url').value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      err.textContent = "Havola noto'g'ri. U .../exec bilan tugashi kerak.";
      err.classList.remove('hidden'); btn.disabled = false; return;
    }
    Cfg.url = url;

    var code = $('s-code').value.replace(/\D/g, '');
    if (code.length !== 6) {
      err.textContent = 'Kod 6 xonali bo\'lishi kerak.';
      err.classList.remove('hidden'); btn.disabled = false; return;
    }

    api('pair', { code: code }, null)
      .then(function (d) {
        Cfg.token = d.token; Cfg.email = d.user.email;
        Store.set('api_url', Cfg.url);
        Store.set('token', Cfg.token);
        Store.set('email', Cfg.email);
        btn.disabled = false;
        App.enterScanner();
      })
      .catch(function (ex) {
        btn.disabled = false;
        err.textContent = ex.message;
        err.classList.remove('hidden');
      });
  },

  enterScanner: function () {
    UI.show('scan');
    Snap.load();
    UI.status();

    if (Snap.data) {
      Scanner.start();
      Snap.sync().catch(function (err) {
        if (isAuthError(err)) { App.logout(KALIT_ESKIRGAN); return; }
        App.setOnline(false); UI.status();
      });
    } else {
      $('start-text').textContent = "O'quvchilar ro'yxati yuklanmoqda…";
      Snap.sync().then(function () {
        UI.status();
        Scanner.start();
      }).catch(function (err) {
        // Kalit yaroqsiz bo'lsa, "internetni tekshiring" deb aldamaymiz —
        // odam nima qilishini bilishi uchun darhol ulash oynasini ochamiz.
        if (isAuthError(err)) { App.logout(KALIT_ESKIRGAN); return; }
        Scanner.fail("Ro'yxatni yuklab bo'lmadi: " + err.message +
                     ' — internetni tekshirib, qayta urining.');
      });
    }

    setInterval(function () {
      Queue.flush();
      if (Snap.data && Snap.data.day !== today()) { Snap.load(); UI.status(); }
    }, 15000);
    // Ro'yxatni vaqti-vaqti bilan yangilab turamiz (yangi o'quvchilar, statuslar)
    setInterval(function () {
      if (App.online && !App.pending) Snap.sync().catch(function (err) {
        if (isAuthError(err)) App.logout(KALIT_ESKIRGAN);
      });
    }, 300000);
  },

  setOnline: function (v) {
    if (App.online === v) return;
    App.online = v;
    UI.status();
  },

  keepAwake: function () {
    try {
      if (navigator.wakeLock && !App.wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          App.wakeLock = l;
          l.addEventListener('release', function () { App.wakeLock = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  },

  /** QR mazmunidan ID ajratib, qaror chiqaradi — hammasi qurilmada */
  decide: function (text) {
    if (!Snap.data) { toast("Ro'yxat hali yuklanmadi"); Scanner.resume(); return; }
    var m = String(text).trim().match(/(\d{3,7})/);
    var id = m ? Number(m[1]) : null;
    var st = id ? Snap.student(id) : null;

    // Tartib muhim: "ovqat olgan" mablag'dan oldin - bugun yegan o'quvchining
    // puli tugagan bo'lsa ham, unga "ovqat olgan" deyiladi.
    var natija;
    if (!st) natija = 'unknown';
    else if (st.status !== 'faol' && st.status !== 'mablag') natija = 'inactive';
    else if (Snap.isServed(id)) natija = 'duplicate';
    else if (st.status === 'mablag' ||
             (st.balans !== null && st.balans !== undefined &&
              st.narx > 0 && st.balans < st.narx)) natija = 'mablag';
    else natija = 'ok';

    App.pending = {
      client_uuid: uuid(),
      xom_kod: String(text).slice(0, 200),
      oquvchi_id: st ? id : '',
      sana: today(),
      skaner_vaqti: stamp(),
      natija_local: natija
    };
    beep(natija === 'ok');
    App.showResult(natija, st, text);
  },

  showResult: function (natija, st, raw) {
    var ok = natija === 'ok';
    var el = $('result');
    var html = '';
    if (st) {
      html += '<div class="id">ID ' + esc(st.id) + '</div>' +
              '<div class="name">' + esc(st.familiya) + ' ' + esc(st.ism) + '</div>' +
              '<div class="meta">' + esc(st.filial) + ' · ' + esc(st.sinf) + '-sinf</div>';
    } else {
      html += '<div class="id">KOD: ' + esc(String(raw).slice(0, 30)) + '</div>' +
              '<div class="name">Noma\'lum</div>';
    }
    if (!ok) html += '<div class="msg">' + esc(MSG[natija]) + '</div>';
    html += '<div class="acts">' +
              '<button class="cancel" id="r-cancel">Bekor qilish</button>' +
              '<button class="' + (ok ? 'save-ok' : 'save-bad') + '" id="r-save">Saqlash</button>' +
            '</div>';
    el.className = 'result ' + (ok ? 'ok' : 'bad');
    el.innerHTML = html;
    el.classList.remove('hidden');

    $('r-save').onclick = App.save;
    $('r-cancel').onclick = function () {
      App.pending = null;
      $('result').classList.add('hidden');
      Scanner.resume();
    };
  },

  save: function () {
    var item = App.pending;
    App.pending = null;
    $('result').classList.add('hidden');
    if (item) {
      if (item.natija_local === 'ok' && item.oquvchi_id) {
        Snap.markServed(item.oquvchi_id);
        Snap.charge(item.oquvchi_id);
      }
      Queue.push(item);
      Queue.flush();
    }
    UI.status();
    Scanner.resume();
  },

  logout: function (message) {
    Store.del('token');
    Cfg.token = '';
    Scanner.stop();
    UI.show('setup');
    $('s-url').value = Cfg.url || '';
    $('s-code').value = '';
    if (message) {
      var err = $('s-err');
      err.textContent = message;
      err.classList.remove('hidden');
    }
  }
};

App.start();
