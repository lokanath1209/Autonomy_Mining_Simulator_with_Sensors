// AUSSIM (AUtonomy Site SIMulator) — entry point. © 2026 Lokanath.
import { initAuth } from './auth.js';
initAuth();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld, LAYER_DEBUG, getTerrainHeight } from './world.js';
import { Truck } from './truck.js';
import { CameraSensor, LidarSensor, RadarSensor, IMUSensor, GPSSensor } from './sensors.js';
import { drawDetections, drawLidarBEV, drawRadarPPI, drawIMU, drawGPS, formatGPSReadout } from './panels.js';
import { buildSensorConfigUI, buildSimSliders, freshRig } from './ui.js';

// ------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const DPR = Math.min(1.75, window.devicePixelRatio || 1);
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const world = createWorld(scene);
const truck = new Truck(scene, world.path, getTerrainHeight);

// main viewer camera (sees default + debug layers)
const viewCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 3000);
viewCam.layers.enable(LAYER_DEBUG);
viewCam.position.set(-380, 60, -320);
const controls = new OrbitControls(viewCam, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.maxDistance = 900;

// ------------------------------------------------------------- sensors
const rig = freshRig();
const camSensor = new CameraSensor(truck.group);
scene.add(camSensor.helper);
const lidar = new LidarSensor(truck.group, scene);
const radar = new RadarSensor(truck.group);
const imu = new IMUSensor();
const gps = new GPSSensor();

function applyRig() {
  camSensor.applyConfig(rig.camera);
  camSensor.helper.update();
  lidar.applyConfig(rig.lidar);
  radar.applyConfig(rig.radar);
}
applyRig();

// ------------------------------------------------------------- UI wiring
const $ = id => document.getElementById(id);
const sim = { running: false, started: false, simSpeed: 1, cruise: truck.cruise, camMode: 'follow' };

const rigUI = buildSensorConfigUI($('sensor-config'), rig, applyRig);
buildSimSliders($('sim-sliders'), sim, () => { truck.cruise = sim.cruise; });

$('btn-start').onclick = () => {
  $('landing').classList.add('hidden');
  $('app').classList.remove('hidden');
  sim.running = true;
  sim.started = true;
};
$('btn-run').onclick = () => {
  sim.running = !sim.running;
  $('btn-run').textContent = sim.running ? '❚❚ Pause' : '▶ Run';
};
$('btn-reset').onclick = () => {
  truck.reset();
  gps.track.length = 0;
  for (const k of ['ax', 'az', 'gy']) imu.history[k].length = 0;
};
$('btn-stop').onclick = () => {
  sim.running = false;
  sim.started = false;
  truck.reset();
  gps.track.length = 0;
  for (const k of ['ax', 'az', 'gy']) imu.history[k].length = 0;
  $('btn-run').textContent = '❚❚ Pause';
  $('app').classList.add('hidden');
  $('landing').classList.remove('hidden');
};
$('btn-sensors-reset').onclick = () => {
  Object.assign(rig, freshRig());
  applyRig();
  rigUI.refresh();
};
function wireMinimize(panelId, btnId) {
  $(btnId).onclick = () => {
    const collapsed = $(panelId).classList.toggle('collapsed');
    $(btnId).textContent = collapsed ? '+' : '−';
    $(btnId).title = collapsed ? 'Maximize' : 'Minimize';
  };
}
wireMinimize('left-panel', 'btn-min-left');
wireMinimize('right-panel', 'btn-min-right');
$('chk-lidar-pts').onchange = e => { lidar.points.visible = e.target.checked; };
$('chk-gizmos').onchange = e => {
  camSensor.helper.visible = e.target.checked;
  camSensor.mount.children.forEach(c => { if (c !== camSensor.camera) c.visible = e.target.checked; });
  radar.mount.children.forEach(c => c.visible = e.target.checked);
  lidar.mount.children.forEach(c => c.visible = e.target.checked);
};
document.querySelectorAll('#cam-modes .ctl-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#cam-modes .ctl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sim.camMode = btn.dataset.mode;
  };
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewCam.aspect = window.innerWidth / window.innerHeight;
  viewCam.updateProjectionMatrix();
});

// ------------------------------------------------------------- load / dump choreography
const shovelGrp       = world.loader.group;
const shovelHouse     = shovelGrp.userData.house;
const shovelBoom      = shovelGrp.userData.boom;
const shovelBucket    = shovelGrp.userData.bucket;
const shovelBucketLoad = shovelGrp.userData.bucketLoad;
const shovelRestYaw   = shovelGrp.rotation.y;

// Direction vectors from shovel to pile and to truck stop
const _pileVec = new THREE.Vector3(
  world.loadPile.position.x - shovelGrp.position.x, 0,
  world.loadPile.position.z - shovelGrp.position.z).normalize();
const _truckVec = new THREE.Vector3(
  world.path[0].x - shovelGrp.position.x, 0,
  world.path[0].z - shovelGrp.position.z).normalize();

// House slew angles relative to the shovel group's own yaw
const _yawToPile  = Math.atan2(_pileVec.x,  _pileVec.z);
const _yawToTruck = Math.atan2(_truckVec.x, _truckVec.z);
const houseYawToPile  = _yawToPile  - shovelRestYaw;
const houseYawToTruck = _yawToTruck - shovelRestYaw;

// Boom rotation.x: negative lifts the boom up (right-hand rule around X)
const BOOM_REST  = -0.65;  // ready position — ~37° elevation
const BOOM_DIG   = -0.40;  // lowered toward face for digging
const BOOM_HIGH  = -1.00;  // raised for slewing with full bucket

// Bucket rotation.x: positive curls back (material retained), negative tips forward (dump)
const BUCK_REST  =  0.30;  // slight curl at idle
const BUCK_DIG   = -0.40;  // open for digging
const BUCK_CURL  =  1.10;  // curled, retaining material
const BUCK_DUMP  = -0.80;  // tipped forward to dump into truck

function lerpYaw(cur, tgt, f) {
  const d = ((tgt - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return cur + d * f;
}

function updateWorldAnims(dt) {
  if (truck.state === 'LOADING') {
    const p = truck.load;
    let tHouseYaw, tBoom, tBuck, showLoad = false;

    if (p < 0.18) {
      // Phase 1 — slew house toward pile, lower boom, open bucket for dig
      const t = THREE.MathUtils.smoothstep(p / 0.18, 0, 1);
      tHouseYaw = houseYawToPile;
      tBoom = THREE.MathUtils.lerp(BOOM_REST, BOOM_DIG, t);
      tBuck = THREE.MathUtils.lerp(BUCK_REST, BUCK_DIG, t);

    } else if (p < 0.40) {
      // Phase 2 — crowd into face, curl bucket to capture material
      const t = THREE.MathUtils.smoothstep((p - 0.18) / 0.22, 0, 1);
      tHouseYaw = houseYawToPile;
      tBoom = THREE.MathUtils.lerp(BOOM_DIG, BOOM_DIG - 0.15, t);
      tBuck = THREE.MathUtils.lerp(BUCK_DIG, BUCK_CURL, t);
      showLoad = p > 0.32;

    } else if (p < 0.58) {
      // Phase 3 — raise boom with full bucket
      const t = THREE.MathUtils.smoothstep((p - 0.40) / 0.18, 0, 1);
      tHouseYaw = houseYawToPile;
      tBoom = THREE.MathUtils.lerp(BOOM_DIG - 0.15, BOOM_HIGH, t);
      tBuck = BUCK_CURL;
      showLoad = true;

    } else if (p < 0.72) {
      // Phase 4 — slew house toward truck with raised boom
      const t = THREE.MathUtils.smoothstep((p - 0.58) / 0.14, 0, 1);
      tHouseYaw = THREE.MathUtils.lerp(houseYawToPile, houseYawToTruck, t);
      tBoom = BOOM_HIGH;
      tBuck = BUCK_CURL;
      showLoad = true;

    } else if (p < 0.88) {
      // Phase 5 — position over truck, tip bucket to dump
      const t = THREE.MathUtils.smoothstep((p - 0.72) / 0.16, 0, 1);
      tHouseYaw = houseYawToTruck;
      tBoom = BOOM_HIGH;
      tBuck = THREE.MathUtils.lerp(BUCK_CURL, BUCK_DUMP, t);
      showLoad = p < 0.82;

    } else {
      // Phase 6 — slew back toward pile, reset to ready
      const t = THREE.MathUtils.smoothstep((p - 0.88) / 0.12, 0, 1);
      tHouseYaw = THREE.MathUtils.lerp(houseYawToTruck, houseYawToPile, t);
      tBoom = THREE.MathUtils.lerp(BOOM_HIGH, BOOM_REST, t);
      tBuck = THREE.MathUtils.lerp(BUCK_DUMP, BUCK_REST, t);
    }

    shovelHouse.rotation.y  = lerpYaw(shovelHouse.rotation.y, tHouseYaw, Math.min(1, dt * 4));
    shovelBoom.rotation.x   += (tBoom - shovelBoom.rotation.x)   * Math.min(1, dt * 5);
    shovelBucket.rotation.x += (tBuck - shovelBucket.rotation.x) * Math.min(1, dt * 5);
    shovelBucketLoad.visible = showLoad;

  } else {
    // Idle: house slews back to pile-facing, boom and bucket reset to ready
    shovelHouse.rotation.y  = lerpYaw(shovelHouse.rotation.y, houseYawToPile, Math.min(1, dt * 1.8));
    shovelBoom.rotation.x   += (BOOM_REST - shovelBoom.rotation.x)   * Math.min(1, dt * 1.8);
    shovelBucket.rotation.x += (BUCK_REST - shovelBucket.rotation.x) * Math.min(1, dt * 1.8);
    shovelBucketLoad.visible = false;
  }

  // Dump pile grows as truck unloads at B
  const dumped = truck.totalDumped + (truck.state === 'DUMPING' ? 1 - truck.load : 0);
  if (dumped > 0.02) {
    world.dumpPile.visible = true;
    world.dumpPile.scale.setScalar(Math.cbrt(Math.min(dumped, 14) * 0.4));
  } else {
    world.dumpPile.visible = false;
  }
  const taken = truck.totalDumped +
    (truck.state === 'LOADING' ? truck.load : truck.state === 'DUMPING' ? 1 : (truck.load > 0 ? 1 : 0));
  world.loadPile.scale.setScalar(Math.max(0.55, 1 - taken * 0.045));
}

// ------------------------------------------------------------- view camera
const camTmp = new THREE.Vector3();
function updateViewCamera(dt) {
  const p = truck.pos;
  if (sim.camMode === 'follow') {
    controls.enabled = false;
    const back = truck.forward.multiplyScalar(-34);
    camTmp.set(p.x + back.x - 14, 20, p.z + back.z + 6);
    viewCam.position.lerp(camTmp, Math.min(1, dt * 2.2));
    viewCam.lookAt(p.x, 5, p.z);
  } else if (sim.camMode === 'top') {
    controls.enabled = false;
    camTmp.set(p.x, 330, p.z + 0.1);
    viewCam.position.lerp(camTmp, Math.min(1, dt * 3));
    viewCam.lookAt(p.x, 0, p.z);
  } else if (sim.camMode === 'onboard') {
    controls.enabled = false;
    const fwd = truck.forward;
    viewCam.position.set(p.x - fwd.x * 2, 8.6, p.z - fwd.z * 2);
    viewCam.lookAt(p.x + fwd.x * 40, 4, p.z + fwd.z * 40);
  } else {
    controls.enabled = true;
    controls.target.lerp(new THREE.Vector3(p.x, 4, p.z), Math.min(1, dt * 1.5));
    controls.update();
  }
}

// ------------------------------------------------------------- scissor render of sensor camera
function renderCameraPanel() {
  const el = $('camera-view');
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return;
  const x = r.left, y = window.innerHeight - r.bottom;
  const w = r.width, h = r.height;
  if (Math.abs(camSensor.camera.aspect - w / h) > 1e-3) {
    camSensor.camera.aspect = w / h;
    camSensor.camera.updateProjectionMatrix();
    camSensor.helper.update();
  }
  const helperWasVisible = camSensor.helper.visible;
  camSensor.helper.visible = false;
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(scene, camSensor.camera);
  renderer.setScissorTest(false);
  camSensor.helper.visible = helperWasVisible;
}

// ------------------------------------------------------------- HUD
let hudAccum = 0;
function updateHUD(dt, dets) {
  hudAccum += dt;
  if (hudAccum < 0.15) return;
  hudAccum = 0;
  $('hud-state').textContent = truck.state;
  $('hud-speed').textContent = `${(truck.speed * 3.6).toFixed(1)} km/h`;
  $('hud-payload').textContent = `${Math.round(truck.displayLoad * 100)}%`;
  const compass = ((180 - THREE.MathUtils.radToDeg(truck.yaw)) % 360 + 360) % 360;
  $('hud-heading').textContent = `${compass.toFixed(0).padStart(3, '0')}°`;
  $('hud-pitch').textContent = `${THREE.MathUtils.radToDeg(truck.pitch || 0).toFixed(1)}°`;
  $('hud-roll').textContent  = `${THREE.MathUtils.radToDeg(truck.roll  || 0).toFixed(1)}°`;
  $('hud-dist').textContent = `${truck.distToGoal().toFixed(0)} m`;
  $('hud-det').textContent = `${dets.length}`;
  const t = Math.floor(truck.simTime);
  $('hud-time').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  $('meta-lidar').textContent = `${lidar.pointCount} pts · ${lidar.revHz.toFixed(1)} Hz`;
  $('meta-radar').textContent = `${radar.tracks.filter(t => t.cls !== 'clutter').length} trk · ${radar.range} m`;
  $('meta-camera').textContent = `FOV ${rig.camera.fov}° · ${dets.length} det`;
  $('meta-imu').textContent = `|a| ${Math.hypot(imu.accel.x, imu.accel.z).toFixed(2)} m/s²`;
  $('meta-gps').textContent = `${gps.fix.mode} · ${gps.fix.sats} SV`;
  $('gps-readout').innerHTML = formatGPSReadout(gps, truck);
}

// ------------------------------------------------------------- animation loop
const clock = new THREE.Clock();
let panelTick = 0;

function animate() {
  requestAnimationFrame(animate);
  window.__frames = (window.__frames || 0) + 1;
  const rawDt = Math.min(0.05, clock.getDelta());
  const dt = rawDt * sim.simSpeed;

  if (sim.running) {
    truck.update(dt);
    truck.obstacleDist = radar.nearestAhead();
    updateWorldAnims(dt);
    lidar.update(dt, world.colliders, truck);
    radar.update(dt, world.machines, truck);
    imu.update(dt, truck);
    gps.update(dt, truck);
  }

  world.sun.target.position.copy(truck.pos);
  world.sun.position.set(truck.pos.x + 180, 260, truck.pos.z + 120);

  updateViewCamera(rawDt);

  panelTick += rawDt;
  let dets = lastDets;
  if (panelTick > 1 / 15) {
    panelTick = 0;
    dets = lastDets = camSensor.detect(world.machines, truck.pos);
    if (sim.started) {
      drawDetections($('camera-overlay'), dets);
      drawLidarBEV($('lidar-canvas'), lidar);
      drawRadarPPI($('radar-canvas'), radar);
      drawIMU($('imu-canvas'), imu);
      drawGPS($('gps-canvas'), gps, truck, world.path);
    }
  }

  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, viewCam);
  if (sim.started) renderCameraPanel();

  updateHUD(rawDt, dets);
}
let lastDets = [];
animate();

// ---------------- headless debug hooks ----------------
window.__sim = sim;
window.__truck = truck;
window.__advance = (seconds = 1) => {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    truck.update(dt);
    truck.obstacleDist = radar.nearestAhead();
    updateWorldAnims(dt);
    lidar.update(dt, world.colliders, truck);
    radar.update(dt, world.machines, truck);
    imu.update(dt, truck);
    gps.update(dt, truck);
  }
  return { state: truck.state, load: truck.load, dumped: truck.totalDumped, speed: truck.speed, pos: { x: truck.pos.x, z: truck.pos.z }, distToGoal: truck.distToGoal(), lidarPts: lidar.pointCount, radarTrk: radar.tracks.length };
};
window.__snap = (scale = 0.5, quality = 0.6) => {
  updateViewCamera(1);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, viewCam);
  if (sim.started) {
    lastDets = camSensor.detect(world.machines, truck.pos);
    drawDetections($('camera-overlay'), lastDets);
    drawLidarBEV($('lidar-canvas'), lidar);
    drawRadarPPI($('radar-canvas'), radar);
    drawIMU($('imu-canvas'), imu);
    drawGPS($('gps-canvas'), gps, truck, world.path);
    renderCameraPanel();
    updateHUD(1, lastDets);
  }
  const out = document.createElement('canvas');
  out.width = Math.round(window.innerWidth * scale);
  out.height = Math.round(window.innerHeight * scale);
  const g = out.getContext('2d');
  g.fillStyle = '#0c0f13';
  g.fillRect(0, 0, out.width, out.height);
  for (const c of document.querySelectorAll('canvas')) {
    if (c === out || c.width < 2) continue;
    const r = c.getBoundingClientRect();
    if (r.width < 2) continue;
    try { g.drawImage(c, r.left * scale, r.top * scale, r.width * scale, r.height * scale); } catch (e) { /* ignore */ }
  }
  return out.toDataURL('image/jpeg', quality);
};
