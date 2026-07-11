// HUD: compass strip with extraction bearing, threat pips, run info, ammo,
// health, hitmarker, toasts, extraction channel bar. All DOM - crisp at any
// resolution, zero WebGL cost.

import { WORLD } from '../world/heightmap.js';

const PX_PER_RAD = 420 / (Math.PI * 0.9); // compass strip scale

export function createHud(playerRef, weapons, game, director, grenades, sim) {
  const els = {
    hud: document.getElementById('hud'),
    compassStrip: document.getElementById('compass-strip'),
    runInfo: document.getElementById('run-info'),
    threatPips: document.getElementById('threat-pips'),
    ammo: document.getElementById('ammo'),
    weaponName: document.getElementById('weapon-name'),
    reloadHint: document.getElementById('reload-hint'),
    healthBar: document.getElementById('health-bar'),
    hitmarker: document.getElementById('hitmarker'),
    toast: document.getElementById('toast'),
    objective: document.getElementById('objective'),
    extractChannel: document.getElementById('extract-channel'),
    extractBar: document.getElementById('extract-bar'),
    extractLabel: document.getElementById('extract-label'),
    lowhp: document.getElementById('lowhp-pulse'),
    crosshair: document.getElementById('crosshair'),
    grenades: document.getElementById('grenades'),
    buff: document.getElementById('buff-timer'),
  };

  // build compass marks once: cardinals + ticks every 45deg + extraction marker
  const marks = [];
  const CARDS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  for (const [label, deg] of CARDS) {
    const el = document.createElement('div');
    el.className = 'cmp' + (label.length === 1 ? ' card' : '');
    el.textContent = label;
    els.compassStrip.appendChild(el);
    marks.push({ el, bearing: (deg * Math.PI) / 180 });
  }
  const extractMark = document.createElement('div');
  extractMark.className = 'cmp extract';
  extractMark.textContent = '◆';
  els.compassStrip.appendChild(extractMark);

  // threat pips
  const pips = [];
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div');
    el.className = 'pip';
    els.threatPips.appendChild(el);
    pips.push(el);
  }

  let hitmarkerT = 0;
  let toastT = 0;

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function update(dt) {
    const p = playerRef.p;
    // compass: player world bearing = atan2(-x, -z) of look dir; our yaw 0 = north(-z)
    const heading = -p.yaw; // increasing east
    for (const m of marks) {
      const d = angleDiff(m.bearing, heading);
      m.el.style.left = `${210 + d * PX_PER_RAD}px`;
      m.el.style.opacity = Math.abs(d) < 1.35 ? 1 : 0;
    }
    // extraction bearing
    const ex = WORLD.extraction.x - p.pos.x;
    const ez = WORLD.extraction.z - p.pos.z;
    const extBearing = Math.atan2(ex, -ez);
    const dExt = angleDiff(extBearing, heading);
    extractMark.style.left = `${210 + Math.max(-200, Math.min(200, dExt * PX_PER_RAD))}px`;
    extractMark.style.opacity = 1;

    // run info
    const t = game.time;
    const mm = Math.floor(t / 60);
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    const distExt = Math.round(Math.hypot(ex, ez));
    const diffLabel = sim ? sim.difficulty.label : '';
    els.runInfo.innerHTML = `<b>${mm}:${ss}</b> ${diffLabel}<br/>BEACON <b>${distExt}m</b><br/>KILLS <b>${game.kills}</b>`;

    // threat pips
    const threat = director.threat();
    const lit = Math.round(threat * 8);
    pips.forEach((el, i) => el.classList.toggle('on', i < lit));

    // ammo
    const st = weapons.state;
    const mag = st.mag[st.current];
    const res = st.reserve[st.current];
    els.ammo.innerHTML = `${mag} <span class="reserve">/ ${res}</span>`;
    els.ammo.classList.toggle('empty', mag === 0);
    els.weaponName.textContent = weapons.def().name;
    els.reloadHint.style.opacity =
      (mag <= (st.current === 'carbine' ? 6 : 1) && res > 0 && st.reloading <= 0) ? 1 : 0;

    // health
    const frac = p.hp / p.maxHp;
    els.healthBar.style.width = `${frac * 100}%`;
    els.healthBar.classList.toggle('low', frac < 0.33);
    els.lowhp.style.opacity = frac < 0.3 ? (0.4 + 0.3 * Math.sin(performance.now() / 180)) : 0;

    // grenades
    if (els.grenades && grenades) {
      let pips = '';
      for (let i = 0; i < grenades.state.max; i++) {
        pips += `<span class="gpip${i < grenades.state.count ? ' on' : ''}"></span>`;
      }
      els.grenades.innerHTML = `${pips} <span class="glabel">[G]</span>`;
    }

    // ayahuasca timer
    if (els.buff) {
      const bt = p.buffT || 0;
      els.buff.style.opacity = bt > 0 ? 1 : 0;
      if (bt > 0) els.buff.textContent = `THE VINE · ${Math.ceil(bt)}s`;
    }

    // crosshair spread (fades away as the sights come up)
    const spread = weapons.spreadNow;
    const gap = 6 + spread * 5;
    positionCrosshairArms(gap);
    const ads = weapons.state.adsBlend;
    els.crosshair.style.opacity = Math.max(0, 1 - ads * 1.8);

    // hitmarker fade
    if (hitmarkerT > 0) {
      hitmarkerT -= dt;
      els.hitmarker.style.opacity = Math.max(0, hitmarkerT / 0.22);
      if (hitmarkerT <= 0) els.hitmarker.classList.remove('kill', 'crit');
    }
    // toast fade
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) els.toast.style.opacity = 0;
    }
  }

  // four crosshair arms that breathe with spread
  const arms = [];
  for (let i = 0; i < 4; i++) {
    const a = document.createElement('div');
    a.className = 'ch-arm';
    els.crosshair.appendChild(a);
    arms.push(a);
  }
  function positionCrosshairArms(gap) {
    const L = 7;
    const W = 2;
    // top, bottom, left, right
    arms[0].style.cssText = `left:${1 - W / 2}px;top:${-gap - L}px;width:${W}px;height:${L}px;`;
    arms[1].style.cssText = `left:${1 - W / 2}px;top:${gap + 2}px;width:${W}px;height:${L}px;`;
    arms[2].style.cssText = `left:${-gap - L}px;top:${1 - W / 2}px;width:${L}px;height:${W}px;`;
    arms[3].style.cssText = `left:${gap + 2}px;top:${1 - W / 2}px;width:${L}px;height:${W}px;`;
  }

  function hitmarker(kill, crit) {
    hitmarkerT = kill ? 0.34 : crit ? 0.3 : 0.22;
    els.hitmarker.style.opacity = 1;
    if (kill) els.hitmarker.classList.add('kill');
    else if (crit) els.hitmarker.classList.add('crit');
  }

  function toast(msg, seconds = 1.6) {
    els.toast.textContent = msg;
    els.toast.style.opacity = 1;
    toastT = seconds;
  }

  function setObjective(text) {
    els.objective.textContent = text;
  }

  function showExtract(progress) {
    els.extractChannel.style.display = progress === null ? 'none' : 'block';
    if (progress !== null) {
      els.extractBar.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  return { update, hitmarker, toast, setObjective, showExtract };
}
