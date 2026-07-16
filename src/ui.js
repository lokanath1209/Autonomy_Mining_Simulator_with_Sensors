// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// Control-panel construction: sliders for sim + sensor rig config.
import { DEFAULT_RIG } from './sensors.js';

const SENSOR_SCHEMA = {
  camera: {
    title: 'CAMERA', dot: 'cam',
    fields: [
      { k: 'x', label: 'Lateral offset', min: -4.5, max: 4.5, step: 0.1, unit: 'm' },
      { k: 'y', label: 'Height', min: 2, max: 12, step: 0.1, unit: 'm' },
      { k: 'z', label: 'Forward offset', min: -7, max: 8, step: 0.1, unit: 'm' },
      { k: 'pitch', label: 'Pitch (tilt)', min: -45, max: 30, step: 1, unit: '°' },
      { k: 'yaw', label: 'Yaw (pan)', min: -180, max: 180, step: 1, unit: '°' },
      { k: 'fov', label: 'Field of view', min: 30, max: 120, step: 1, unit: '°' },
    ],
  },
  lidar: {
    title: 'LIDAR', dot: 'lidar',
    fields: [
      { k: 'x', label: 'Lateral offset', min: -4.5, max: 4.5, step: 0.1, unit: 'm' },
      { k: 'y', label: 'Height', min: 3, max: 14, step: 0.1, unit: 'm' },
      { k: 'z', label: 'Forward offset', min: -7, max: 8, step: 0.1, unit: 'm' },
      { k: 'yaw', label: 'Yaw offset', min: -180, max: 180, step: 1, unit: '°' },
      { k: 'range', label: 'Max range', min: 40, max: 200, step: 5, unit: 'm' },
    ],
  },
  radar: {
    title: 'RADAR', dot: 'radar',
    fields: [
      { k: 'x', label: 'Lateral offset', min: -4.5, max: 4.5, step: 0.1, unit: 'm' },
      { k: 'y', label: 'Height', min: 1, max: 10, step: 0.1, unit: 'm' },
      { k: 'z', label: 'Forward offset', min: -7, max: 8, step: 0.1, unit: 'm' },
      { k: 'pitch', label: 'Pitch (tilt)', min: -30, max: 30, step: 1, unit: '°' },
      { k: 'yaw', label: 'Yaw (pan)', min: -180, max: 180, step: 1, unit: '°' },
      { k: 'range', label: 'Max range', min: 40, max: 250, step: 5, unit: 'm' },
      { k: 'fov', label: 'Field of view', min: 20, max: 160, step: 2, unit: '°' },
    ],
  },
};

export function buildSensorConfigUI(container, rig, onChange) {
  container.innerHTML = '';
  const inputs = {};
  for (const [sensor, schema] of Object.entries(SENSOR_SCHEMA)) {
    const head = document.createElement('div');
    head.className = 'acc-head';
    head.innerHTML = `<span><span class="dot ${schema.dot}"></span> ${schema.title}</span><span class="acc-arrow">▾</span>`;
    const body = document.createElement('div');
    body.className = 'acc-body' + (sensor === 'camera' ? '' : ' closed');
    head.onclick = () => body.classList.toggle('closed');
    container.append(head, body);

    inputs[sensor] = {};
    for (const f of schema.fields) {
      const row = document.createElement('div');
      row.className = 'slider-row';
      const val = rig[sensor][f.k];
      row.innerHTML = `<div class="lbl"><span>${f.label}</span><b data-v>${fmt(val, f)}</b></div>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.value = val;
      const vEl = row.querySelector('[data-v]');
      input.oninput = () => {
        rig[sensor][f.k] = parseFloat(input.value);
        vEl.textContent = fmt(rig[sensor][f.k], f);
        onChange(sensor);
      };
      row.appendChild(input);
      body.appendChild(row);
      inputs[sensor][f.k] = { input, vEl, f };
    }
  }
  return {
    refresh() {
      for (const [sensor, fields] of Object.entries(inputs)) {
        for (const [k, { input, vEl, f }] of Object.entries(fields)) {
          input.value = rig[sensor][k];
          vEl.textContent = fmt(rig[sensor][k], f);
        }
      }
    },
  };
}

function fmt(v, f) {
  return `${f.step < 1 ? v.toFixed(1) : Math.round(v)}${f.unit}`;
}

export function buildSimSliders(container, sim, onChange) {
  container.innerHTML = '';
  const defs = [
    { k: 'simSpeed', label: 'Sim speed', min: 0.25, max: 3, step: 0.25, unit: '×' },
    { k: 'cruise', label: 'Cruise speed', min: 4, max: 25, step: 0.5, unit: ' m/s' },
  ];
  for (const f of defs) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.style.padding = '4px 2px 0';
    row.innerHTML = `<div class="lbl"><span>${f.label}</span><b data-v>${sim[f.k]}${f.unit}</b></div>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = f.min; input.max = f.max; input.step = f.step;
    input.value = sim[f.k];
    const vEl = row.querySelector('[data-v]');
    input.oninput = () => {
      sim[f.k] = parseFloat(input.value);
      vEl.textContent = `${sim[f.k]}${f.unit}`;
      onChange();
    };
    row.appendChild(input);
    container.appendChild(row);
  }
}

export function freshRig() {
  return JSON.parse(JSON.stringify(DEFAULT_RIG));
}

