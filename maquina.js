// Simulador de la máquina expendedora. Reproduce las máquinas de estados del
// sketch (StartupMode, ServiceMode, ServiceMenu, AdminMode, Button) con los
// mismos textos de LCD, tiempos y umbrales que las cabeceras del sketch.
document.documentElement.classList.add('js');

(() => {
  const C = {
    CUSTOMER_DISTANCE_CM: 100,
    MONITORING_DURATION_MS: 5000,
    DHT_INTERVAL_MS: 2000,
    PREPARATION_MIN_MS: 4000,
    PREPARATION_MAX_MS: 8000,
    PICKUP_DURATION_MS: 3000,
    RESET_MIN_MS: 2000,
    RESET_MAX_MS: 3000,
    ADMIN_HOLD_MS: 5000,
  };

  const sim = document.querySelector('.sim');
  if (!sim) return;

  // ---------- LCD 16x2 ----------
  const rows = [...sim.querySelectorAll('.lcd__row')].map((row) => {
    const cells = [];
    for (let i = 0; i < 16; i++) { const s = document.createElement('span'); row.append(s); cells.push(s); }
    return cells;
  });
  const buffer = [Array(16).fill(' '), Array(16).fill(' ')];
  const lcdText = sim.querySelector('[data-lcd-text]');
  let lcdAnnounce = 0;
  function flushLcd() {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
      const ch = buffer[r][c];
      if (rows[r][c].textContent !== ch) rows[r][c].textContent = ch === ' ' ? ' ' : ch;
    }
    clearTimeout(lcdAnnounce);
    lcdAnnounce = setTimeout(() => { lcdText.textContent = buffer.map((b) => b.join('').trim()).join(' '); }, 250);
  }
  function writeLine(row, text) {
    const t = String(text).slice(0, 16).padEnd(16, ' ');
    for (let c = 0; c < 16; c++) buffer[row][c] = t[c];
    flushLcd();
  }
  function printAt(row, col, text) {
    for (let i = 0; i < text.length && col + i < 16; i++) buffer[row][col + i] = text[i];
    flushLcd();
  }

  // ---------- LEDs y serie ----------
  const led1 = sim.querySelector('[data-led="1"] .led__lamp');
  const led2 = sim.querySelector('[data-led="2"] .led__lamp');
  const led2Pct = sim.querySelector('[data-led2-pct]');
  const serial = sim.querySelector('[data-serial]');
  const setLed1 = (on) => led1.style.setProperty('--level', on ? 1 : 0);
  const setLed2 = (pwm) => {
    led2.style.setProperty('--level', (pwm / 255).toFixed(3));
    led2Pct.textContent = `${Math.round((pwm / 255) * 100)} %`;
  };
  const log = (msg) => { serial.textContent = msg; };

  // ---------- Sensores simulados ----------
  const distInput = document.getElementById('dist');
  const distOut = sim.querySelector('[data-dist-out]');
  let distanceCm = Number(distInput.value);
  distInput.addEventListener('input', () => {
    distanceCm = Number(distInput.value);
    distOut.textContent = `${distanceCm} cm`;
  });
  // DHT11 simulado: valores de muestra con una deriva pequeña.
  let temp = 22.0, hum = 45.0;
  const readDht = () => {
    temp = Math.min(30, Math.max(18, temp + (Math.random() - 0.5) * 0.4));
    hum = Math.min(70, Math.max(30, hum + (Math.random() - 0.5) * 1.0));
    return [temp, hum];
  };
  const fmt1 = (n) => n.toFixed(1);
  const price = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

  // ---------- Catálogo (ProductCatalog.h) ----------
  const products = [
    { name: 'Cafe Solo', cents: 100 },
    { name: 'Cafe Cortado', cents: 110 },
    { name: 'Cafe Doble', cents: 125 },
    { name: 'Cafe Premium', cents: 150 },
    { name: 'Chocolate', cents: 200 },
  ];

  // ---------- Estado global ----------
  let bootMs = performance.now();
  let mode = 'Startup';
  const now = () => performance.now();

  // StartupMode
  // setup() ya pinta CARGANDO...; loop() espera 500 ms antes de los destellos
  const startup = { mark: 0, toggles: 0, on: false, started: false };
  function startupEnter(t) {
    startup.mark = t; startup.toggles = 0; startup.on = false; startup.started = false;
    setLed1(false); setLed2(0);
    writeLine(0, 'CARGANDO...'); writeLine(1, '');
  }
  function startupUpdate(t) {
    if (!startup.started) {
      if (t - startup.mark < 500) return false;
      startup.started = true; startup.mark = t; startup.on = true;
      setLed1(true);
      log('MODO ARRANQUE');
      return false;
    }
    if (t - startup.mark < 500) return false;
    startup.mark = t; startup.on = !startup.on; setLed1(startup.on);
    if (++startup.toggles < 6) return false;
    setLed1(false);
    return true;
  }

  // ServiceMode + ServiceMenu
  const svc = { state: 'Waiting', monStart: 0, prepStart: 0, prepDur: 0, prevDur: 0, pickStart: 0, lastDht: 0, first: 0 };
  function serviceEnter() {
    svc.state = 'Waiting';
    setLed2(0);
    writeLine(0, 'ESPERANDO'); writeLine(1, 'CLIENTE');
    log('SERVICIO: ESPERANDO CLIENTE');
  }
  function drawMenu() {
    for (let r = 0; r < 2; r++) {
      const p = products[(svc.first + r) % products.length];
      writeLine(r, p.name.slice(0, 12).padEnd(12, ' ') + price(p.cents));
    }
  }
  function showEnv() {
    const [t, h] = readDht();
    writeLine(0, 'Temp:'); printAt(0, 6, `${fmt1(t)} C`);
    writeLine(1, 'Hum:'); printAt(1, 5, `${fmt1(h)} %`);
    log(`DHT11 Temp: ${fmt1(t)} C Hum: ${fmt1(h)} %`);
  }
  function serviceUpdate(t) {
    if (svc.state === 'Waiting') {
      if (distanceCm > 0 && distanceCm < C.CUSTOMER_DISTANCE_CM) {
        svc.state = 'Monitoring'; svc.monStart = t; svc.lastDht = t - C.DHT_INTERVAL_MS;
        log(`CLIENTE DETECTADO A ${distanceCm} cm`);
      }
    } else if (svc.state === 'Monitoring') {
      if (t - svc.lastDht >= C.DHT_INTERVAL_MS) { svc.lastDht = t; showEnv(); }
      if (t - svc.monStart >= C.MONITORING_DURATION_MS) {
        svc.state = 'Catalog'; svc.first = 0; drawMenu();
        log('SERVICIO: CATALOGO');
      }
    } else if (svc.state === 'Preparing') {
      const elapsed = t - svc.prepStart;
      if (elapsed >= svc.prepDur) {
        setLed2(0); svc.state = 'Pickup'; svc.pickStart = t;
        writeLine(0, 'RETIRE BEBIDA'); writeLine(1, '');
        log('SERVICIO: RETIRE BEBIDA');
      } else {
        setLed2(Math.floor((elapsed * 255) / svc.prepDur));
      }
    } else if (svc.state === 'Pickup' && t - svc.pickStart >= C.PICKUP_DURATION_MS) {
      serviceEnter();
    }
  }
  function serviceHandle(ev) {
    if (svc.state !== 'Catalog') return;
    const n = products.length;
    if (ev === 'Up') { svc.first = (svc.first + n - 1) % n; drawMenu(); return; }
    if (ev === 'Down') { svc.first = (svc.first + 1) % n; drawMenu(); return; }
    if (ev !== 'Press') return;
    const p = products[svc.first];
    svc.state = 'Preparing'; svc.prepStart = now();
    let d = C.PREPARATION_MIN_MS + Math.floor(Math.random() * (C.PREPARATION_MAX_MS - C.PREPARATION_MIN_MS + 1));
    if (d === svc.prevDur) d = d === C.PREPARATION_MAX_MS ? C.PREPARATION_MIN_MS : d + 1;
    svc.prevDur = d; svc.prepDur = d;
    setLed2(0);
    writeLine(0, 'Preparando Cafe'); writeLine(1, '...');
    log(`SELECCIONADO: ${p.name} ${p.cents} centimos; preparacion ${d} ms`);
  }

  // AdminMode
  const options = ['Ver temperatura', 'Ver distancia', 'Ver contador', 'Editar precios'];
  const adm = { view: 'Menu', opt: 0, prod: 0, edit: 0, lastDht: 0, lastDist: 0, envValid: false, shownSecond: -1 };
  function adminEnter() {
    Object.assign(adm, { view: 'Menu', opt: 0, prod: 0, envValid: false, shownSecond: -1 });
    setLed1(true); setLed2(255);
    adminDraw(now());
    log('BOTON EXTERNO: ENTRAR ADMIN');
  }
  function adminHandle(ev) {
    if (adm.view === 'Menu') {
      if (ev === 'Up') adm.opt = (adm.opt + 3) % 4;
      else if (ev === 'Down') adm.opt = (adm.opt + 1) % 4;
      else if (ev === 'Press') {
        log(`ADMIN: ${options[adm.opt]}`);
        adm.view = ['Temperature', 'Distance', 'Counter', 'PriceList'][adm.opt];
        adm.envValid = false; adm.prod = 0; adm.lastDht = now() - C.DHT_INTERVAL_MS; adm.lastDist = 0;
      } else return;
    } else if (adm.view === 'PriceList') {
      const n = products.length;
      if (ev === 'Left') adm.view = 'Menu';
      else if (ev === 'Up') adm.prod = (adm.prod + n - 1) % n;
      else if (ev === 'Down') adm.prod = (adm.prod + 1) % n;
      else if (ev === 'Press') { adm.edit = products[adm.prod].cents; adm.view = 'PriceEdit'; }
      else return;
    } else if (adm.view === 'PriceEdit') {
      if (ev === 'Left') adm.view = 'PriceList';
      else if (ev === 'Up' && adm.edit <= 9990) adm.edit += 5;
      else if (ev === 'Down' && adm.edit >= 5) adm.edit -= 5;
      else if (ev === 'Press') {
        products[adm.prod].cents = adm.edit;
        log(`ADMIN PRECIO: ${products[adm.prod].name} = ${price(adm.edit)}`);
        adm.view = 'PriceList';
      } else return;
    } else if (ev === 'Left') {
      adm.view = 'Menu';
    } else return;
    adminDraw(now());
  }
  function adminUpdate(t) {
    if (adm.view === 'Temperature' && t - adm.lastDht >= C.DHT_INTERVAL_MS) {
      adm.lastDht = t; readDht(); adm.envValid = true; adminDraw(t);
    } else if (adm.view === 'Distance' && t - adm.lastDist >= 100) {
      adm.lastDist = t; adminDraw(t);
    } else if (adm.view === 'Counter') {
      const s = Math.floor((t - bootMs) / 1000);
      if (s !== adm.shownSecond) { adm.shownSecond = s; adminDraw(t); }
    }
  }
  function adminDraw(t) {
    switch (adm.view) {
      case 'Menu': writeLine(0, options[adm.opt]); writeLine(1, options[(adm.opt + 1) % 4]); break;
      case 'Temperature':
        if (!adm.envValid) { writeLine(0, 'Temp: -- C'); writeLine(1, 'Hum: -- %'); }
        else { writeLine(0, 'Temp:'); printAt(0, 6, `${fmt1(temp)} C`); writeLine(1, 'Hum:'); printAt(1, 5, `${fmt1(hum)} %`); }
        break;
      case 'Distance': writeLine(0, 'Distancia:'); writeLine(1, `${distanceCm} cm`); break;
      case 'Counter': writeLine(0, 'Segundos:'); writeLine(1, String(Math.floor((t - bootMs) / 1000))); break;
      case 'PriceList': writeLine(0, products[adm.prod].name); writeLine(1, `${price(products[adm.prod].cents)} EUR SW=OK`); break;
      case 'PriceEdit': writeLine(0, products[adm.prod].name); writeLine(1, `${price(adm.edit)} +/-5 SW=OK`); break;
    }
  }

  // ---------- Botón externo (Button.h) ----------
  const holdBtn = sim.querySelector('[data-hold]');
  const holdTime = sim.querySelector('[data-hold-time]');
  const btn = { down: false, start: 0, longDone: false };
  function press() {
    if (btn.down) return;
    btn.down = true; btn.start = now(); btn.longDone = false;
    holdBtn.classList.add('is-held');
    log('BOTON EXTERNO: pulsado');
  }
  function release() {
    if (!btn.down) return;
    btn.down = false; holdBtn.classList.remove('is-held');
    const d = now() - btn.start;
    holdTime.textContent = `Soltado a los ${(d / 1000).toFixed(1).replace('.', ',')} s`;
    if (btn.longDone) return;
    if (d >= C.ADMIN_HOLD_MS) { toggleAdmin(); return; }
    if (d >= C.RESET_MIN_MS && d <= C.RESET_MAX_MS) {
      if (mode === 'Service') { log('BOTON EXTERNO: RESET SERVICIO'); enterService(); }
      else log('BOTON EXTERNO: RESET ignorado fuera de Servicio');
      return;
    }
    log(`BOTON EXTERNO: liberado tras ${Math.round(d)} ms, sin accion`);
  }
  function toggleAdmin() {
    if (mode === 'Admin') { log('BOTON EXTERNO: SALIR ADMIN'); enterService(); }
    else { mode = 'Admin'; adminEnter(); }
  }
  holdBtn.addEventListener('pointerdown', (e) => { holdBtn.setPointerCapture(e.pointerId); press(); });
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);
  holdBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
  holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release(); } });
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  function enterService() {
    mode = 'Service';
    setLed1(false);
    serviceEnter();
  }

  // ---------- Joystick ----------
  function joystick(ev) {
    if (mode === 'Admin') adminHandle(ev);
    else if (mode === 'Service') serviceHandle(ev);
  }
  sim.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => joystick(b.dataset.ev)));
  const keyMap = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Press' };
  sim.addEventListener('keydown', (e) => {
    if (e.target.closest('button, input')) return;
    const ev = keyMap[e.key];
    if (!ev) return;
    e.preventDefault();
    const b = sim.querySelector(`[data-ev="${ev}"]`);
    b.classList.add('is-active'); setTimeout(() => b.classList.remove('is-active'), 120);
    joystick(ev);
  });

  // ---------- Reinicio de la placa ----------
  sim.querySelector('[data-boot]').addEventListener('click', () => {
    bootMs = now(); mode = 'Startup'; startupEnter(bootMs);
  });

  // ---------- loop() ----------
  function loop() {
    const t = now();
    if (btn.down) {
      const d = t - btn.start;
      holdTime.textContent = `Mantenido ${(d / 1000).toFixed(1).replace('.', ',')} s`;
      if (!btn.longDone && d >= C.ADMIN_HOLD_MS) { btn.longDone = true; toggleAdmin(); }
    }
    if (mode === 'Startup') { if (startupUpdate(t)) enterService(); }
    else if (mode === 'Service') serviceUpdate(t);
    else adminUpdate(t);
  }
  startupEnter(bootMs);
  setInterval(loop, 20);
})();

// Selector de modos (pestañas con flechas)
(() => {
  const root = document.querySelector('[data-switch]');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      select(next); next.focus({ preventScroll: true });
    });
  });
  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0]);
})();
