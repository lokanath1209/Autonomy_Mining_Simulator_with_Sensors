// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// Simulated sensor suite mounted on the truck.
// Camera: real render pass from a pinhole camera + projected 3D->2D detections (YOLO-style).
// LiDAR:  rotating multi-channel raycaster producing a live point cloud.
// Radar:  FMCW-style cone scan with range / bearing / radial-velocity tracks.
// IMU:    body-frame accel + gyro derived from vehicle kinematics, with bias + noise.
// GPS:    geodetic fix from local ENU with gaussian noise, 5 Hz.
import * as THREE from 'three';
import { LAYER_DEBUG, LAYER_COLLIDER } from './world.js';

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Default rig (truck frame: +Z forward, +Y up, meters / degrees)
export const DEFAULT_RIG = {
  camera: { x: 0, y: 7.6, z: 5.8, pitch: -6, yaw: 0, fov: 70 },
  lidar:  { x: 0, y: 8.4, z: 1.0, yaw: 0, range: 120 },
  radar:  { x: 0, y: 3.2, z: 6.4, pitch: 0, yaw: 0, range: 150, fov: 90 },
};

// ------------------------------------------------------------------ CAMERA
export class CameraSensor {
  constructor(truckGroup) {
    this.mount = new THREE.Object3D();
    truckGroup.add(this.mount);
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 900);
    this.camera.rotation.y = Math.PI; // truck forward is +Z; camera looks down -Z
    this.mount.add(this.camera);
    this.camera.layers.set(0);        // sensor camera must not see debug layer

    // frustum gizmo
    this.helper = new THREE.CameraHelper(this.camera);
    this.helper.layers.set(LAYER_DEBUG);
    this.helper.traverse(o => o.layers.set(LAYER_DEBUG));

    // body gizmo
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x35d6e8 }));
    g.layers.set(LAYER_DEBUG);
    this.mount.add(g);
  }
  applyConfig(c) {
    this.mount.position.set(c.x, c.y, c.z);
    this.mount.rotation.set(THREE.MathUtils.degToRad(c.pitch), THREE.MathUtils.degToRad(c.yaw), 0);
    if (this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
  }
  // Project machine bounding boxes into the image -> detection list.
  detect(machines, truckPos) {
    this.camera.updateMatrixWorld();
    const dets = [];
    const v = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    for (const m of machines) {
      const dist = m.group.position.distanceTo(camPos);
      if (dist > 320) continue;
      const d = m.dims;
      // 8 corners of the machine's oriented box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, behind = 0;
      for (let i = 0; i < 8; i++) {
        v.set(((i & 1) ? 0.5 : -0.5) * d.w, ((i & 2) ? 1 : 0) * d.h, ((i & 4) ? 0.5 : -0.5) * d.l);
        v.applyAxisAngle(new THREE.Vector3(0, 1, 0), m.group.rotation.y).add(m.group.position);
        const pv = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
        if (pv.z > -0.5) { behind++; continue; }
        v.project(this.camera);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      if (behind > 4 || minX > 1 || maxX < -1 || minY > 1 || maxY < -1 || minX === Infinity) continue;
      const conf = Math.max(0.28, Math.min(0.99, 1.04 - dist / 340 + gauss() * 0.02));
      dets.push({
        cls: m.cls, conf, dist,
        // NDC -> [0..1] image coords (y flipped)
        x0: (Math.max(-1, minX) + 1) / 2, x1: (Math.min(1, maxX) + 1) / 2,
        y0: 1 - (Math.min(1, maxY) + 1) / 2, y1: 1 - (Math.max(-1, minY) + 1) / 2,
      });
    }
    dets.sort((a, b) => a.dist - b.dist);
    return dets;
  }
}

// ------------------------------------------------------------------ LIDAR
export class LidarSensor {
  constructor(truckGroup, scene) {
    this.mount = new THREE.Object3D();
    truckGroup.add(this.mount);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 16),
      new THREE.MeshBasicMaterial({ color: 0x38e07b }));
    g.layers.set(LAYER_DEBUG);
    this.mount.add(g);

    this.channels = 32;
    this.vFovLo = -22; this.vFovHi = 8;      // degrees
    this.azStep = 3;                          // degrees
    this.azPerFrame = 45;                     // degrees swept per frame
    this.azimuth = 0;
    this.range = 120;
    this.yawOffset = 0;

    // ring buffer of points (world coords + intensity)
    this.maxPoints = this.channels * Math.ceil(360 / this.azStep);
    this.positions = new Float32Array(this.maxPoints * 3);
    this.colors = new Float32Array(this.maxPoints * 3);
    this.meta = new Float32Array(this.maxPoints * 4);  // truck-relative x,z,y + intensity for BEV panel
    this.valid = new Uint8Array(this.maxPoints);
    this.writeIdx = 0;
    this.pointCount = 0;
    this.revHz = 0; this._revTimer = 0; this._revAz = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER_DEBUG);
    scene.add(this.points);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(LAYER_COLLIDER);
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._color = new THREE.Color();
  }

  applyConfig(c) {
    this.mount.position.set(c.x, c.y, c.z);
    this.yawOffset = THREE.MathUtils.degToRad(c.yaw);
    this.range = c.range;
  }

  update(dt, colliders, truck) {
    this.raycaster.far = this.range;
    this.mount.getWorldPosition(this._origin);
    const baseYaw = truck.yaw + this.yawOffset;

    const steps = Math.round(this.azPerFrame / this.azStep);
    for (let s = 0; s < steps; s++) {
      this.azimuth = (this.azimuth + this.azStep) % 360;
      const azRad = baseYaw + THREE.MathUtils.degToRad(this.azimuth);
      for (let ch = 0; ch < this.channels; ch++) {
        const el = THREE.MathUtils.degToRad(this.vFovLo + (ch / (this.channels - 1)) * (this.vFovHi - this.vFovLo));
        const ce = Math.cos(el);
        this._dir.set(Math.sin(azRad) * ce, Math.sin(el), Math.cos(azRad) * ce);
        this.raycaster.set(this._origin, this._dir);
        const hits = this.raycaster.intersectObjects(colliders, false);
        const idx = this.writeIdx;
        this.writeIdx = (this.writeIdx + 1) % this.maxPoints;
        if (hits.length) {
          const h = hits[0];
          const noise = 1 + gauss() * 0.004;
          const px = this._origin.x + this._dir.x * h.distance * noise;
          const py = this._origin.y + this._dir.y * h.distance * noise;
          const pz = this._origin.z + this._dir.z * h.distance * noise;
          this.positions[idx * 3] = px; this.positions[idx * 3 + 1] = py; this.positions[idx * 3 + 2] = pz;
          const intensity = h.object.userData.intensity ?? 0.4;
          // color by height (blue low -> yellow/red high), machines pop bright
          const t = Math.min(1, py / 9);
          this._color.setHSL(0.62 - t * 0.62, 1, 0.35 + intensity * 0.3);
          this.colors[idx * 3] = this._color.r; this.colors[idx * 3 + 1] = this._color.g; this.colors[idx * 3 + 2] = this._color.b;
          // truck frame (for BEV): rotate world delta by -truck.yaw
          const dx = px - truck.pos.x, dz = pz - truck.pos.z;
          const cy = Math.cos(-truck.yaw), sy = Math.sin(-truck.yaw);
          this.meta[idx * 4] = dx * cy + dz * sy;          // right(+)/left(-)... x in truck frame
          this.meta[idx * 4 + 1] = -dx * sy + dz * cy;     // forward
          this.meta[idx * 4 + 2] = py;
          this.meta[idx * 4 + 3] = intensity;
          this.valid[idx] = 1;
        } else {
          this.positions[idx * 3 + 1] = -1000; // park below ground
          this.valid[idx] = 0;
        }
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.pointCount = this.valid.reduce((a, b) => a + b, 0);

    // rev rate estimate
    this._revAz += this.azPerFrame;
    this._revTimer += dt;
    if (this._revTimer > 1) {
      this.revHz = (this._revAz / 360) / this._revTimer;
      this._revTimer = 0; this._revAz = 0;
    }
  }
}

// ------------------------------------------------------------------ RADAR
export class RadarSensor {
  constructor(truckGroup) {
    this.mount = new THREE.Object3D();
    truckGroup.add(this.mount);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xff5d5d }));
    g.layers.set(LAYER_DEBUG);
    this.mount.add(g);

    // FOV wedge gizmo
    this.fovMesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24, 0, 1),
      new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    this.fovMesh.rotation.x = -Math.PI / 2;
    this.fovMesh.layers.set(LAYER_DEBUG);
    this.mount.add(this.fovMesh);

    this.range = 150;
    this.fov = 90;            // degrees
    this.yawOffset = 0;
    this.tracks = [];
    this.sweep = 0;           // for PPI animation
    this._accum = 0;
    this.updateHz = 15;
  }

  applyConfig(c) {
    this.mount.position.set(c.x, c.y, c.z);
    this.mount.rotation.set(THREE.MathUtils.degToRad(c.pitch ?? 0), THREE.MathUtils.degToRad(c.yaw), 0);
    this.yawOffset = THREE.MathUtils.degToRad(c.yaw);
    this.range = c.range;
    this.fov = c.fov;
    const half = THREE.MathUtils.degToRad(c.fov / 2);
    this.fovMesh.geometry.dispose();
    this.fovMesh.geometry = new THREE.CircleGeometry(c.range * 0.35, 24, Math.PI / 2 - half, half * 2);
  }

  update(dt, machines, truck) {
    this.sweep = (this.sweep + dt * 2.4) % (Math.PI * 2);
    this._accum += dt;
    if (this._accum < 1 / this.updateHz) return;
    this._accum = 0;

    const radarPos = new THREE.Vector3();
    this.mount.getWorldPosition(radarPos);
    const boresight = truck.yaw + this.yawOffset;
    const truckVel = truck.velocity;
    const half = THREE.MathUtils.degToRad(this.fov / 2);

    this.tracks = [];
    let id = 1;
    for (const m of machines) {
      const dx = m.group.position.x - radarPos.x;
      const dz = m.group.position.z - radarPos.z;
      const range = Math.hypot(dx, dz);
      if (range > this.range || range < 2) continue;
      const bearing = wrap(Math.atan2(dx, dz) - boresight);
      if (Math.abs(bearing) > half) continue;
      // radial velocity: target static, so v_r = -projection of truck velocity on LOS
      const losX = dx / range, losZ = dz / range;
      const vr = -(truckVel.x * losX + truckVel.z * losZ);
      // RCS by machine size
      const rcs = 10 * Math.log10(m.dims.w * m.dims.h * m.dims.l) + gauss() * 1.5;
      this.tracks.push({
        id: id++, cls: m.cls,
        range: range + gauss() * 0.35,
        bearing: bearing + gauss() * 0.006,
        vr: vr + gauss() * 0.12,
        rcs,
      });
    }
    // occasional clutter/false alarm
    if (Math.random() < 0.06) {
      this.tracks.push({
        id: 99, cls: 'clutter',
        range: 8 + Math.random() * this.range * 0.9,
        bearing: (Math.random() - 0.5) * 2 * half,
        vr: gauss() * 0.4, rcs: -5 + gauss() * 3,
      });
    }
    this.tracks.sort((a, b) => a.range - b.range);
  }

  // closest in-corridor obstacle for AEB (±12° around boresight)
  nearestAhead() {
    let best = Infinity;
    for (const t of this.tracks) {
      if (Math.abs(t.bearing) < THREE.MathUtils.degToRad(12) && t.cls !== 'clutter') best = Math.min(best, t.range);
    }
    return best;
  }
}

// ------------------------------------------------------------------ IMU
export class IMUSensor {
  constructor() {
    this.accel = { x: 0, y: 9.81, z: 0 };  // body frame: x lateral, y up, z longitudinal
    this.gyro = { x: 0, y: 0, z: 0 };      // rad/s
    this.rpy = { roll: 0, pitch: 0, yaw: 0 };
    this.bias = { ax: gauss() * 0.02, az: gauss() * 0.02, gy: gauss() * 0.001 };
    this.history = { ax: [], az: [], gy: [] };  // strip chart buffers
    this.histLen = 260;
  }
  update(dt, truck) {
    const vib = Math.min(1, truck.speed / 8) * 0.35;      // engine/road vibration grows with speed
    this.accel.z = truck.accelLong + this.bias.az + gauss() * 0.05 + gauss() * vib;
    this.accel.x = truck.speed * truck.yawRate + this.bias.ax + gauss() * 0.05 + gauss() * vib;
    this.accel.y = 9.81 + gauss() * 0.08 + gauss() * vib * 1.6;
    this.gyro.y = truck.yawRate + this.bias.gy + gauss() * 0.004;
    this.gyro.x = gauss() * 0.006 * (1 + vib);
    this.gyro.z = gauss() * 0.006 * (1 + vib);
    this.rpy.yaw = truck.yaw;
    this.rpy.roll = gauss() * 0.002;
    this.rpy.pitch = -truck.accelLong * 0.01 + gauss() * 0.002;

    const h = this.history;
    h.ax.push(this.accel.x); h.az.push(this.accel.z); h.gy.push(this.gyro.y);
    for (const k of ['ax', 'az', 'gy']) if (h[k].length > this.histLen) h[k].shift();
  }
}

// ------------------------------------------------------------------ GPS
export class GPSSensor {
  constructor(originLat = -23.3582, originLon = 119.7521) {
    this.lat0 = originLat; this.lon0 = originLon;
    this.fix = { lat: originLat, lon: originLon, alt: 512, speed: 0, course: 0, hdop: 0.6, sats: 14, mode: 'RTK-FIX' };
    this._accum = 0;
    this.rate = 5; // Hz
    this.track = [];
  }
  update(dt, truck) {
    this._accum += dt;
    if (this._accum < 1 / this.rate) return;
    this._accum = 0;
    const nE = gauss() * 0.03, nN = gauss() * 0.03;   // ~3 cm RTK noise
    const east = truck.pos.x + nE;
    const north = -truck.pos.z + nN;
    this.fix.lat = this.lat0 + north / 111320;
    this.fix.lon = this.lon0 + east / (111320 * Math.cos(this.lat0 * Math.PI / 180));
    this.fix.alt = 512.4 + gauss() * 0.05;
    this.fix.speed = truck.speed + gauss() * 0.05;
    // compass course over ground: 0° = north (-Z), clockwise
    this.fix.course = ((180 - THREE.MathUtils.radToDeg(truck.yaw)) % 360 + 360) % 360;
    this.fix.hdop = 0.5 + Math.abs(gauss()) * 0.15;
    this.fix.sats = 13 + Math.round(Math.random() * 3);
    this.track.push({ x: truck.pos.x, z: truck.pos.z });
    if (this.track.length > 1200) this.track.shift();
  }
}
