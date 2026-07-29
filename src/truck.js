// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// Vehicle: AHT-797 autonomous haul truck.
// Kinematic model + pure-pursuit path tracker + simple mission state machine.
import * as THREE from 'three';
import { makeHaulTruck, makeLabel } from './world.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Truck {
  constructor(scene, path, terrainH = () => 0) {
    this.terrainH = terrainH;

    this.group = makeHaulTruck();
    this.group.rotation.order = 'YXZ';  // yaw → pitch → roll for terrain following
    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const lbl = makeLabel('AHT-797 · TRUCK', '#5ad0ff');
    lbl.position.y = 11;
    this.group.add(lbl);
    scene.add(this.group);

    this.pathAB = path.map(p => p.clone());
    this.pathBA = [...this.pathAB].reverse();

    // driven path breadcrumbs (debug layer)
    this.trail = [];

    // params
    this.cruise = 18.0;        // m/s (~65 km/h)
    this.maxAccel = 1.1;
    this.maxDecel = 2.2;
    this.lookahead = 26;
    this.maxYawRate = 0.34;    // rad/s
    this.obstacleDist = Infinity; // fed by radar (AEB)
    this.loadTime = 9;         // s to fill payload at A
    this.dumpTime = 6;         // s for full dump sequence at B
    // The shovel's dig+swing takes up most of `load` 0..1; it only actually tips its
    // bucket into the truck bed across this narrow window (matches the shovel's own
    // dump-phase timing in main.js). The truck bed shouldn't visibly fill before then.
    this.scoopDumpStart = 0.72;
    this.scoopDumpEnd = 0.82;

    this.bed = this.group.userData.bed;
    this.bedPivot = this.group.userData.bedPivot;   // rear hinge — rotate negative to raise the front
    this.payload = this.group.userData.payload;
    this.payloadRestZ = this.payload.position.z;

    this.reset();
  }

  reset() {
    this.pos = this.pathAB[0].clone();
    this.yaw = Math.atan2(this.pathAB[1].x - this.pos.x, this.pathAB[1].z - this.pos.z);
    this.speed = 0;
    this.yawRate = 0;
    this.accelLong = 0;
    this.state = 'LOADING';    // mission starts at A being loaded
    this.path = this.pathAB;
    this.wpIndex = 1;
    this.simTime = 0;
    this.load = 0;             // payload fill 0..1
    this.dumpT = 0;
    this.totalDumped = 0;      // completed loads dumped at B
    this.dumpFlow = 0;         // instantaneous dump flow (for pile growth)
    this.trail.length = 0;
    if (this.bedPivot) this.bedPivot.rotation.x = 0;
    this.syncTransform();
    this.applyPayloadVisual();
  }

  // Fraction of the truck bed that should visibly show material right now.
  // While LOADING, this stays at 0 through the shovel's dig/lift/swing and only
  // ramps up once the bucket actually tips its scoop into the bed; elsewhere it
  // tracks the real payload fraction (e.g. draining while DUMPING at B).
  get displayLoad() {
    if (this.state !== 'LOADING') return this.load;
    return THREE.MathUtils.clamp(
      (this.load - this.scoopDumpStart) / (this.scoopDumpEnd - this.scoopDumpStart), 0, 1);
  }

  applyPayloadVisual() {
    if (!this.payload) return;
    const fill = this.displayLoad;
    this.payload.visible = fill > 0.03;
    this.payload.scale.y = Math.max(0.05, fill);
    // while tipping, the heap slides toward the open rear of the body
    const slide = this.state === 'DUMPING' ? (1 - this.load) * 3.4 : 0;
    this.payload.position.z = this.payloadRestZ - slide;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  get velocity() {
    return this.forward.multiplyScalar(this.speed);
  }

  syncTransform() {
    const px = this.pos.x, pz = this.pos.z;
    // Terrain height at truck centre
    const gY = this.terrainH(px, pz);
    // Central-difference terrain gradient for pitch / roll
    const e = 3.5;
    const dhdx = (this.terrainH(px + e, pz) - this.terrainH(px - e, pz)) / (2 * e);
    const dhdz = (this.terrainH(px, pz + e) - this.terrainH(px, pz - e)) / (2 * e);
    // Truck-forward and truck-right unit vectors in XZ plane
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // Pitch: terrain slope along forward (nose up when climbing = negative X rotation in YXZ)
    const pitch = -Math.atan(sy * dhdx + cy * dhdz);
    // Roll: terrain slope along right  (right-side high = positive Z rotation in YXZ)
    const roll  =  Math.atan(cy * dhdx - sy * dhdz);
    const MAX = 0.30;  // ~17° clamp
    this.group.position.set(px, gY, pz);
    this.group.rotation.set(
      THREE.MathUtils.clamp(pitch, -MAX, MAX),
      this.yaw,
      THREE.MathUtils.clamp(roll,  -MAX, MAX)
    );
    // Store computed angles so HUD / sensors can read them
    this.pitch = pitch;
    this.roll  = roll;
  }

  distToGoal() {
    return this.pos.distanceTo(this.path[this.path.length - 1]);
  }
  distToWp() {
    return this.pos.distanceTo(this.path[Math.min(this.wpIndex, this.path.length - 1)]);
  }

  update(dt) {
    this.simTime += dt;
    const prevSpeed = this.speed;
    this.dumpFlow = 0;

    if (this.state === 'LOADING') {
      // loader fills the payload in bucket passes
      this.speed = 0; this.accelLong = 0; this.yawRate = 0;
      this.load = Math.min(1, this.load + dt / this.loadTime);
      this.applyPayloadVisual();
      if (this.load >= 1) {
        this.path = this.pathAB;
        this.wpIndex = 1;
        this.state = 'HAUL → B';
      }
      return;
    }

    if (this.state === 'DUMPING') {
      // tip bed up, drain payload onto the dump pile, lower bed
      this.speed = 0; this.accelLong = 0; this.yawRate = 0;
      this.dumpT += dt;
      const t = this.dumpT;
      const tiltUp = 1.6, drainEnd = 4.2, downEnd = this.dumpTime;
      const maxTilt = 0.85;   // ~49° body angle, typical for a rear-dump hauler
      let tilt;
      if (t < tiltUp) tilt = maxTilt * (t / tiltUp);
      else if (t < drainEnd) tilt = maxTilt;
      else tilt = maxTilt * Math.max(0, 1 - (t - drainEnd) / (downEnd - drainEnd));
      // negative rotation about the rear hinge lifts the FRONT of the body;
      // material exits over the open tail behind the truck
      this.bedPivot.rotation.x = -tilt;
      if (t > tiltUp * 0.5 && t < drainEnd && this.load > 0) {
        const drain = Math.min(this.load, dt / (drainEnd - tiltUp * 0.5));
        this.load = Math.max(0, this.load - drain);
        this.dumpFlow = drain;      // world grows the dump pile from this
        this.applyPayloadVisual();
      }
      if (t >= downEnd) {
        this.bedPivot.rotation.x = 0;
        this.load = 0;
        this.totalDumped += 1;
        this.applyPayloadVisual();
        this.path = this.pathBA;
        this.wpIndex = 1;
        this.state = 'RETURN → A';
      }
      return;
    }

    // ---- pure pursuit: find lookahead target along remaining path
    const target = this.lookaheadPoint();
    const desiredYaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    const err = wrap(desiredYaw - this.yaw);
    const speedFactor = Math.min(1, Math.max(0.25, this.speed / 6));
    this.yawRate = THREE.MathUtils.clamp(err * 1.4, -this.maxYawRate, this.maxYawRate) * speedFactor;
    this.yaw = wrap(this.yaw + this.yawRate * dt);

    // ---- speed control: cruise, slow for curves, goal approach, obstacle AEB
    const dGoal = this.distToGoal();
    let vTarget = this.cruise;
    vTarget *= 1 - Math.min(0.55, Math.abs(err) * 1.3);                 // slow in turns
    vTarget = Math.min(vTarget, Math.sqrt(2 * this.maxDecel * Math.max(0, dGoal - 4))); // stop at goal
    if (this.obstacleDist < 45) {                                       // radar AEB corridor
      vTarget = Math.min(vTarget, THREE.MathUtils.mapLinear(this.obstacleDist, 12, 45, 0, this.cruise * 0.6));
    }
    vTarget = Math.max(0, vTarget);

    const dv = THREE.MathUtils.clamp(vTarget - this.speed, -this.maxDecel * dt, this.maxAccel * dt);
    this.speed = Math.max(0, this.speed + dv);

    // ---- integrate
    this.pos.addScaledVector(this.forward, this.speed * dt);
    this.syncTransform();
    this.accelLong = dt > 0 ? (this.speed - prevSpeed) / dt : 0;

    // waypoint advance
    if (this.distToWp() < 18 && this.wpIndex < this.path.length - 1) this.wpIndex++;

    // goal reached
    if (dGoal < 5 && this.speed < 0.3) {
      this.speed = 0;
      if (this.state === 'HAUL → B') {
        this.state = 'DUMPING';
        this.dumpT = 0;
      } else {
        this.state = 'LOADING';
        this.load = 0;
      }
    }

    // breadcrumbs
    if (!this._lastCrumb || this.pos.distanceTo(this._lastCrumb) > 4) {
      this._lastCrumb = this.pos.clone();
      this.trail.push(this._lastCrumb);
      if (this.trail.length > 400) this.trail.shift();
    }
  }

  lookaheadPoint() {
    // walk path from current wp; return point at lookahead distance
    let remaining = this.lookahead;
    let prev = this.pos;
    for (let i = this.wpIndex; i < this.path.length; i++) {
      const seg = this.path[i].clone().sub(prev);
      const len = seg.length();
      if (len >= remaining) return prev.clone().addScaledVector(seg.normalize(), remaining);
      remaining -= len;
      prev = this.path[i];
    }
    return this.path[this.path.length - 1];
  }
}
