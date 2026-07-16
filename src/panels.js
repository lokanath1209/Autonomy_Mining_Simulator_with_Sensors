// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// 2D instrument panels drawn on <canvas> elements.
import * as THREE from 'three';

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { g: canvas.getContext('2d'), w, h, dpr };
}

const CLS_COLOR = {
  haul_truck: '#ffd83d', water_truck: '#8fd3ff', dozer: '#ff9e3d',
  excavator: '#ff6a6a', grader: '#c0f06a', scom_unit: '#66e6ff',
  light_tower: '#e0b0ff', clutter: '#667', rock: '#998', ground: '#555',
};

// ------------------------------------------------------------- camera boxes
export function drawDetections(canvas, dets) {
  const { g, w, h, dpr } = fitCanvas(canvas);
  g.clearRect(0, 0, w, h);
  g.lineWidth = 1.6 * dpr;
  g.font = `${10 * dpr}px Consolas, monospace`;
  for (const d of dets) {
    const x = d.x0 * w, y = d.y0 * h, bw = (d.x1 - d.x0) * w, bh = (d.y1 - d.y0) * h;
    if (bw < 3 || bh < 3) continue;
    const col = CLS_COLOR[d.cls] || '#7dff9b';
    g.strokeStyle = col;
    g.strokeRect(x, y, bw, bh);
    const label = `${d.cls} ${(d.conf * 100).toFixed(0)}% ${d.dist.toFixed(0)}m`;
    const tw = g.measureText(label).width + 8 * dpr;
    g.fillStyle = col;
    g.fillRect(x - 0.8 * dpr, y - 13 * dpr, tw, 13 * dpr);
    g.fillStyle = '#10131a';
    g.fillText(label, x + 3 * dpr, y - 3.5 * dpr);
  }
  // reticle + frame furniture
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(w / 2 - 10 * dpr, h / 2); g.lineTo(w / 2 + 10 * dpr, h / 2);
  g.moveTo(w / 2, h / 2 - 10 * dpr); g.lineTo(w / 2, h / 2 + 10 * dpr);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = `${9 * dpr}px Consolas, monospace`;
  g.fillText('● REC', 8 * dpr, 14 * dpr);
}

// ------------------------------------------------------------- LiDAR BEV
export function drawLidarBEV(canvas, lidar) {
  const { g, w, h, dpr } = fitCanvas(canvas);
  g.fillStyle = '#06090c';
  g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.62;
  const scale = (Math.min(w, h) * 0.92) / (lidar.range * 1.35);

  // range rings
  g.strokeStyle = 'rgba(56,224,123,0.16)';
  g.fillStyle = 'rgba(56,224,123,0.5)';
  g.lineWidth = dpr;
  g.font = `${8.5 * dpr}px Consolas, monospace`;
  for (let r = 30; r <= lidar.range; r += 30) {
    g.beginPath(); g.arc(cx, cy, r * scale, 0, Math.PI * 2); g.stroke();
    g.fillText(`${r}`, cx + 2 * dpr, cy - r * scale - 2 * dpr);
  }

  // points (ego frame: meta = [right, forward, height, intensity])
  for (let i = 0; i < lidar.maxPoints; i++) {
    if (!lidar.valid[i]) continue;
    const rx = lidar.meta[i * 4], fz = lidar.meta[i * 4 + 1], py = lidar.meta[i * 4 + 2], inten = lidar.meta[i * 4 + 3];
    if (py < 0.25 && inten < 0.5) {   // ground returns: dim
      g.fillStyle = 'rgba(30,90,60,0.5)';
    } else {
      const t = Math.min(1, py / 9);
      g.fillStyle = `hsl(${140 - t * 140}, 95%, ${45 + inten * 20}%)`;
    }
    g.fillRect(cx + rx * scale, cy - fz * scale, 1.6 * dpr, 1.6 * dpr);
  }

  // ego
  g.fillStyle = '#5ad0ff';
  g.beginPath();
  g.moveTo(cx, cy - 7 * dpr); g.lineTo(cx - 4.5 * dpr, cy + 5 * dpr); g.lineTo(cx + 4.5 * dpr, cy + 5 * dpr);
  g.closePath(); g.fill();
}

// ------------------------------------------------------------- Radar PPI
export function drawRadarPPI(canvas, radar) {
  const { g, w, h, dpr } = fitCanvas(canvas);
  g.fillStyle = '#0a0505';
  g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.9;
  const R = Math.min(w * 0.48, h * 0.82);
  const half = THREE.MathUtils.degToRad(radar.fov / 2);

  // wedge + rings
  g.strokeStyle = 'rgba(255,93,93,0.35)';
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
  g.closePath(); g.stroke();
  g.fillStyle = 'rgba(255,93,93,0.5)';
  g.font = `${8.5 * dpr}px Consolas, monospace`;
  for (let i = 1; i <= 3; i++) {
    const r = (R * i) / 3;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 - half, -Math.PI / 2 + half); g.stroke();
    g.fillText(`${Math.round((radar.range * i) / 3)}m`, cx + r * Math.sin(half) * 0.98 - 16 * dpr, cy - r * Math.cos(half) + 10 * dpr);
  }

  // sweep line
  const sw = -half + ((radar.sweep % (Math.PI * 2)) / (Math.PI * 2)) * 2 * half;
  const grad = g.createLinearGradient(cx, cy, cx + R * Math.sin(sw), cy - R * Math.cos(sw));
  grad.addColorStop(0, 'rgba(255,120,80,0)');
  grad.addColorStop(1, 'rgba(255,120,80,0.8)');
  g.strokeStyle = grad;
  g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.sin(sw), cy - R * Math.cos(sw)); g.stroke();

  // targets
  g.font = `${9 * dpr}px Consolas, monospace`;
  for (const t of radar.tracks) {
    const r = (t.range / radar.range) * R;
    const x = cx + r * Math.sin(t.bearing), y = cy - r * Math.cos(t.bearing);
    const col = t.cls === 'clutter' ? 'rgba(140,140,150,0.6)' : (t.vr > 0.5 ? '#ff5d5d' : '#ffb04d');
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y, (t.cls === 'clutter' ? 2 : 3.4) * dpr, 0, Math.PI * 2); g.fill();
    if (t.cls !== 'clutter') {
      g.fillStyle = 'rgba(255,200,160,0.85)';
      g.fillText(`${t.range.toFixed(0)}m ${t.vr > 0 ? '+' : ''}${t.vr.toFixed(1)}`, x + 5 * dpr, y - 3 * dpr);
    }
  }
  // boresight
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.setLineDash([4 * dpr, 4 * dpr]);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - R); g.stroke();
  g.setLineDash([]);
}

// ------------------------------------------------------------- IMU charts
const IMU_SERIES = [
  { key: 'ax', label: 'accel X (lat)', unit: 'm/s²', color: '#b18cff', min: -3, max: 3 },
  { key: 'az', label: 'accel Z (long)', unit: 'm/s²', color: '#35d6e8', min: -3, max: 3 },
  { key: 'gy', label: 'gyro Y (yaw)', unit: 'rad/s', color: '#ffd83d', min: -0.5, max: 0.5 },
];
export function drawIMU(canvas, imu) {
  const { g, w, h, dpr } = fitCanvas(canvas);
  g.fillStyle = '#080a10';
  g.fillRect(0, 0, w, h);
  const rows = IMU_SERIES.length;
  const rowH = h / rows;
  g.font = `${8.5 * dpr}px Consolas, monospace`;
  IMU_SERIES.forEach((s, ri) => {
    const y0 = ri * rowH, mid = y0 + rowH / 2;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = dpr;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
    const data = imu.history[s.key];
    g.strokeStyle = s.color;
    g.lineWidth = 1.2 * dpr;
    g.beginPath();
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (imu.histLen - 1)) * w;
      const v = THREE.MathUtils.clamp(data[i], s.min, s.max);
      const y = mid - (v / (s.max - s.min)) * (rowH * 0.86);
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    const last = data[n - 1] ?? 0;
    g.fillStyle = s.color;
    g.fillText(`${s.label}  ${last >= 0 ? '+' : ''}${last.toFixed(2)} ${s.unit}`, 6 * dpr, y0 + 11 * dpr);
  });
}

// ------------------------------------------------------------- GPS map
export function drawGPS(canvas, gps, truck, path) {
  const { g, w, h, dpr } = fitCanvas(canvas);
  g.fillStyle = '#080c08';
  g.fillRect(0, 0, w, h);

  // world bounds -> canvas
  const pad = 14 * dpr;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of path) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  minX -= 40; maxX += 40; minZ -= 40; maxZ += 40;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const px = v => pad + (v.x - minX) * sc + (w - pad * 2 - (maxX - minX) * sc) / 2;
  const pz = v => pad + (v.z - minZ) * sc + (h - pad * 2 - (maxZ - minZ) * sc) / 2;

  // grid
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = dpr;
  for (let i = 1; i < 5; i++) {
    g.beginPath(); g.moveTo((w / 5) * i, 0); g.lineTo((w / 5) * i, h); g.stroke();
    g.beginPath(); g.moveTo(0, (h / 5) * i); g.lineTo(w, (h / 5) * i); g.stroke();
  }
  // planned path
  g.strokeStyle = 'rgba(255,216,61,0.55)';
  g.setLineDash([5 * dpr, 4 * dpr]);
  g.lineWidth = 1.4 * dpr;
  g.beginPath();
  path.forEach((p, i) => i === 0 ? g.moveTo(px(p), pz(p)) : g.lineTo(px(p), pz(p)));
  g.stroke();
  g.setLineDash([]);

  // A / B
  g.fillStyle = '#2fd873';
  g.beginPath(); g.arc(px(path[0]), pz(path[0]), 4.5 * dpr, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff9030';
  g.beginPath(); g.arc(px(path.at(-1)), pz(path.at(-1)), 4.5 * dpr, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9fe8bb'; g.font = `bold ${9 * dpr}px Consolas`;
  g.fillText('A', px(path[0]) - 3 * dpr, pz(path[0]) - 7 * dpr);
  g.fillStyle = '#ffc896';
  g.fillText('B', px(path.at(-1)) - 3 * dpr, pz(path.at(-1)) - 7 * dpr);

  // GNSS breadcrumb trail
  g.fillStyle = 'rgba(90,208,255,0.7)';
  for (const p of gps.track) g.fillRect(px(p) - dpr * 0.7, pz(p) - dpr * 0.7, 1.4 * dpr, 1.4 * dpr);

  // ego arrow
  const ex = px(truck.pos), ez = pz(truck.pos);
  g.save();
  g.translate(ex, ez);
  g.rotate(Math.PI - truck.yaw); // world yaw -> canvas (x=east, y=+z)
  g.fillStyle = '#5ad0ff';
  g.beginPath(); g.moveTo(0, -6 * dpr); g.lineTo(-4 * dpr, 5 * dpr); g.lineTo(4 * dpr, 5 * dpr); g.closePath(); g.fill();
  g.restore();
}

export function formatGPSReadout(gps, truck) {
  const f = gps.fix;
  const latH = f.lat >= 0 ? 'N' : 'S', lonH = f.lon >= 0 ? 'E' : 'W';
  return `<b>${f.mode}</b>  sats ${f.sats}
LAT  <b>${Math.abs(f.lat).toFixed(6)}° ${latH}</b>
LON  <b>${Math.abs(f.lon).toFixed(6)}° ${lonH}</b>
ALT  <b>${f.alt.toFixed(2)} m</b>
VEL  <b>${(f.speed * 3.6).toFixed(1)} km/h</b>
COG  <b>${f.course.toFixed(1)}°</b>
HDOP <b>${f.hdop.toFixed(2)}</b>
ENU  <b>${truck.pos.x.toFixed(1)}, ${(-truck.pos.z).toFixed(1)}</b>`;
}
