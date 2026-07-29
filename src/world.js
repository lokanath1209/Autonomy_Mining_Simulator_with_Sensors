// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
// World construction: Boddington-style mine terrain, haul road, A/B markers, mining machines.
import * as THREE from 'three';

export const LAYER_DEFAULT = 0;
export const LAYER_DEBUG = 1;
export const LAYER_COLLIDER = 2;

const MINE_YELLOW = 0xf2b307;
const DARK = 0x23262a;
const TIRE = 0x1a1c1e;

const matCache = new Map();
function mat(color, rough = 0.72, metal = 0.15) {
  const key = `${color}_${rough}_${metal}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function wheel(r, w, x, y, z) {
  const m = cyl(r, r, w, TIRE, x, y, z, 18);
  m.rotation.z = Math.PI / 2;
  const hub = cyl(r * 0.45, r * 0.45, w + 0.06, 0x8a8f96, 0, 0, 0, 12);
  m.add(hub);
  return m;
}

// ---------------------------------------------------------------- text label
export function makeLabel(text, color = '#ffd83d') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 112;
  const g = c.getContext('2d');
  g.font = 'bold 52px Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width + 46;
  g.fillStyle = 'rgba(10,12,16,0.72)';
  g.beginPath(); g.roundRect(256 - w / 2, 14, w, 84, 14); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.stroke();
  g.fillStyle = color;
  g.fillText(text, 256, 58);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  spr.scale.set(16, 3.5, 1);
  spr.layers.set(LAYER_DEBUG);
  return spr;
}

// ---------------------------------------------------------------- machines

export function makeHaulTruck(bodyColor = MINE_YELLOW) {
  const g = new THREE.Group();
  g.add(box(6.4, 1.6, 10.5, DARK, 0, 2.6, 0.4));
  g.add(box(7.4, 0.5, 4.4, bodyColor, 0, 3.9, 3.4));
  const bedPivot = new THREE.Group();
  bedPivot.position.set(0, 4.3, -6.1);
  g.add(bedPivot);
  const bed = new THREE.Group();
  const floor = box(7.6, 0.8, 9.6, bodyColor, 0, 0, 0);
  const wallL = box(0.6, 2.6, 9.6, bodyColor, -3.6, 1.4, 0);
  const wallR = box(0.6, 2.6, 9.6, bodyColor, 3.6, 1.4, 0);
  const wallF = box(7.6, 3.0, 0.7, bodyColor, 0, 1.6, 4.6);
  bed.add(floor, wallL, wallR, wallF);
  bed.position.set(0, 0.3, 4.7);
  bed.rotation.x = 0.1;
  bedPivot.add(bed);
  g.userData.bedPivot = bedPivot;
  const canopy = box(7.8, 0.55, 3.4, bodyColor, 0, 6.9, 4.6);
  canopy.rotation.x = 0.06;
  g.add(canopy);
  g.add(box(2.5, 2.1, 2.2, 0x2e3238, -2.1, 5.2, 4.3));
  g.add(box(2.5, 0.9, 0.2, 0x9fd8ff, -2.1, 5.5, 5.42));
  g.add(box(7.2, 2.6, 0.9, bodyColor, 0, 2.7, 5.6));
  g.add(box(6.6, 0.5, 0.5, 0xd8d8d8, 0, 4.35, 5.85));
  g.add(box(0.5, 3.4, 0.4, 0xb9bec5, -3.6, 2.2, 5.2));
  // Payload: a full, heaping load of broken rock/ore filling the bed edge-to-edge
  // and mounding above the side walls, like a fully-loaded haul truck.
  const payload = new THREE.Group();
  const heapGeo = new THREE.SphereGeometry(1, 18, 14);
  const hp = heapGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const j = 0.85 + Math.random() * 0.25;
    hp.setXYZ(i, hp.getX(i) * j, hp.getY(i) * j, hp.getZ(i) * j);
  }
  heapGeo.computeVertexNormals();
  const heap = new THREE.Mesh(heapGeo, mat(0x86888a, 1, 0));
  heap.scale.set(3.9, 2.6, 4.7);
  heap.position.y = 1.3;
  heap.castShadow = true;
  payload.add(heap);
  const rockColors = [0x9a9c9e, 0x707377, 0x86888a, 0x5f6266];
  const rockLump = (r, x, y, z) => {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0),
      mat(rockColors[(Math.random() * rockColors.length) | 0], 1, 0));
    lump.position.set(x, y, z);
    lump.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    lump.castShadow = true;
    payload.add(lump);
  };
  // Low base layer laid out on a grid spanning the full inner floor — guarantees
  // corner-to-corner, wall-to-wall coverage so no bare bed/floor ever peeks through,
  // regardless of how the tapered mound above happens to fall.
  for (const gx of [-2.7, -1.35, 0, 1.35, 2.7]) {
    for (const gz of [-4.1, -2.5, -0.9, 0.7, 2.3, 3.7]) {
      rockLump(0.6 + Math.random() * 0.35,
        gx + (Math.random() - 0.5) * 0.6, 0.55 + Math.random() * 0.35, gz + (Math.random() - 0.5) * 0.6);
    }
  }
  // Taller scattered rocks on top for the heaping, domed silhouette.
  for (let i = 0; i < 22; i++) {
    const r = 0.5 + Math.random() * 0.85;
    const a = Math.random() * Math.PI * 2, d = Math.random();
    rockLump(r, Math.cos(a) * d * 3.5, 2.1 + Math.random() * 1.7, Math.sin(a) * d * 4.4);
  }
  payload.position.set(0, 0.5, -0.4);
  bed.add(payload);
  g.userData.bed = bed;
  g.userData.payload = payload;
  g.add(wheel(1.9, 1.5, -3.1, 1.9, 3.9));
  g.add(wheel(1.9, 1.5, 3.1, 1.9, 3.9));
  g.add(wheel(1.9, 1.4, -3.5, 1.9, -2.6));
  g.add(wheel(1.9, 1.4, -2.0, 1.9, -2.6));
  g.add(wheel(1.9, 1.4, 3.5, 1.9, -2.6));
  g.add(wheel(1.9, 1.4, 2.0, 1.9, -2.6));
  g.userData.dims = { w: 9, h: 7.4, l: 13.5 };
  return g;
}

export function makeDozer() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(1.3, 1.9, 6.6, 0x2a2d31, s * 2.3, 1.0, -0.2));
    for (let i = -2; i <= 2; i++) {
      const roller = cyl(0.55, 0.55, 1.34, 0x51565c, s * 2.3, 0.6, -0.2 + i * 1.35, 10);
      roller.rotation.z = Math.PI / 2;
      g.add(roller);
    }
  }
  g.add(box(3.4, 2.2, 5.6, MINE_YELLOW, 0, 2.9, -0.4));
  g.add(box(2.4, 2.0, 2.2, 0x2e3238, 0, 5.0, -1.2));
  g.add(cyl(0.35, 0.35, 1.6, 0x3a3f45, 1.2, 4.6, 1.8, 8));
  const blade = box(6.4, 2.4, 0.55, MINE_YELLOW, 0, 1.7, 3.9);
  blade.rotation.x = -0.18;
  g.add(blade);
  g.add(box(0.5, 0.5, 3.0, 0x74797f, -2.2, 1.9, 2.2));
  g.add(box(0.5, 0.5, 3.0, 0x74797f, 2.2, 1.9, 2.2));
  const rip = box(0.6, 2.6, 0.5, 0x74797f, 0, 1.6, -3.9);
  rip.rotation.x = 0.5;
  g.add(rip);
  g.userData.dims = { w: 6.4, h: 6, l: 9 };
  return g;
}

export function makeExcavator() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(1.5, 1.7, 7.4, 0x2a2d31, s * 2.4, 0.9, 0));
  g.add(box(5.2, 0.7, 5.2, 0x3a3f45, 0, 2.0, 0));
  const house = new THREE.Group();
  house.add(box(4.8, 2.6, 6.6, MINE_YELLOW, 0, 1.4, -0.8));
  house.add(box(2.0, 2.2, 2.0, 0x2e3238, -1.4, 2.9, 1.6));
  house.add(box(4.6, 2.2, 1.4, 0x35383c, 0, 1.5, -3.9));
  const boomGroup = new THREE.Group();
  boomGroup.position.set(0.9, 2.0, 2.4);
  boomGroup.rotation.x = -0.72;
  boomGroup.add(box(1.1, 1.6, 7.0, MINE_YELLOW, 0, 0, 3.3));
  const boomCyl = cyl(0.17, 0.17, 4.4, 0x8f959c, 0, -1.0, 2.6, 8);
  boomCyl.rotation.x = Math.PI / 2 - 0.3;
  boomGroup.add(boomCyl);
  house.add(boomGroup);
  const stickGroup = new THREE.Group();
  stickGroup.position.set(0, 0, 6.7);
  stickGroup.rotation.x = 1.45;
  stickGroup.add(box(0.9, 1.2, 4.4, MINE_YELLOW, 0, 0, 2.0));
  const crowdCyl = cyl(0.14, 0.14, 3.0, 0x8f959c, 0, 0.9, 1.4, 8);
  crowdCyl.rotation.x = Math.PI / 2 - 0.4;
  stickGroup.add(crowdCyl);
  boomGroup.add(stickGroup);
  const bucketGroup = new THREE.Group();
  bucketGroup.position.set(0, 0, 4.3);
  bucketGroup.rotation.x = -0.95;
  const bm = 0x6e747b;
  const bW = 3.4, bH = 2.0, bD = 2.3;
  bucketGroup.add(box(bW, 0.3, bD, bm, 0, -bH / 2, 0));
  bucketGroup.add(box(0.26, bH, bD, bm, -bW / 2 + 0.13, 0, 0));
  bucketGroup.add(box(0.26, bH, bD, bm, bW / 2 - 0.13, 0, 0));
  bucketGroup.add(box(bW, bH, 0.28, bm, 0, 0, -bD / 2 + 0.14));
  bucketGroup.add(box(bW, 0.35, 0.5, 0x53585e, 0, bH / 2 - 0.15, bD / 2 - 0.2));
  for (let i = 0; i < 5; i++) {
    const tooth = box(0.24, 0.6, 0.2, 0x53585e, -bW / 2 + 0.55 + i * (bW - 1.1) / 4, -bH / 2 - 0.2, bD / 2 - 0.18);
    tooth.rotation.x = 0.55;
    bucketGroup.add(tooth);
  }
  stickGroup.add(bucketGroup);
  house.position.y = 2.35;
  g.add(house);
  g.userData.house = house;
  g.userData.boom = boomGroup;
  g.userData.stick = stickGroup;
  g.userData.bucket = bucketGroup;
  g.userData.dims = { w: 6.5, h: 8, l: 12 };
  return g;
}

export function makeMaterialPile(radius = 8, height = 4) {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 14, 3), mat(0x6b5a44, 1, 0));
  const pos = cone.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i)) < height / 2 - 0.01) {
      pos.setX(i, pos.getX(i) * (0.86 + Math.random() * 0.28));
      pos.setZ(i, pos.getZ(i) * (0.86 + Math.random() * 0.28));
    }
  }
  cone.geometry.computeVertexNormals();
  cone.position.y = height / 2;
  cone.castShadow = cone.receiveShadow = true;
  g.add(cone);
  for (let i = 0; i < 7; i++) {
    const r = 0.5 + Math.random() * 0.9;
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(0x7d6a50, 1, 0));
    const a = Math.random() * Math.PI * 2;
    const d = radius * (0.5 + Math.random() * 0.6);
    lump.position.set(Math.cos(a) * d, r * 0.5, Math.sin(a) * d);
    lump.castShadow = true;
    g.add(lump);
  }
  return g;
}

export function makeShovel(bodyColor = MINE_YELLOW) {
  const g = new THREE.Group();

  // === Undercarriage (crawlers + carbody) ===
  const trackW = 2.6, trackH = 1.8, trackL = 12.0;
  g.add(box(trackW, trackH, trackL, DARK, -3.6, trackH / 2, 0));
  g.add(box(trackW, trackH, trackL, DARK,  3.6, trackH / 2, 0));
  for (const sx of [-3.6, 3.6]) {
    const sp = cyl(0.95, 0.95, trackW, 0x2a2e33, sx, trackH / 2, -trackL / 2 + 0.9, 10);
    sp.rotation.z = Math.PI / 2; g.add(sp);
    const id = cyl(0.95, 0.95, trackW, 0x2a2e33, sx, trackH / 2,  trackL / 2 - 0.9, 10);
    id.rotation.z = Math.PI / 2; g.add(id);
  }
  for (let i = 0; i < 11; i++) {
    const z = -4.8 + i * 1.0;
    g.add(box(trackW + 0.18, 0.20, 0.82, 0x3a3e44, -3.6, trackH + 0.06, z));
    g.add(box(trackW + 0.18, 0.20, 0.82, 0x3a3e44,  3.6, trackH + 0.06, z));
  }
  g.add(box(7.6, 1.1, 5.0, 0x3a3e44, 0, 1.55, 0));          // carbody cross-frame
  g.add(cyl(3.2, 3.2, 0.35, 0x555a5f, 0, 2.25, 0, 16));     // slew ring

  // === Upper house (slews on Y axis) ===
  const house = new THREE.Group();
  house.position.set(0, 2.4, 0);
  g.add(house);
  g.userData.house = house;

  house.add(box(8.0, 3.6, 9.5, bodyColor, 0, 1.8, 0));            // engine deck
  house.add(box(8.4, 3.0, 2.5, 0x3a3e44, 0, 1.5, -5.5));         // counterweight
  house.add(box(8.2, 0.4, 2.4, 0x555a5f, 0, 3.1, -5.5));         // cw top plate
  house.add(box(3.0, 3.4, 3.2, bodyColor, -2.2, 3.7, 4.0));      // cab
  house.add(box(2.8, 2.6, 0.14, 0x9fd8ff, -2.2, 3.9, 5.58));    // cab front glass
  house.add(box(0.14, 2.6, 3.0, 0x9fd8ff, -3.64, 3.9, 4.0));    // cab left glass
  house.add(box(3.0, 0.32, 3.2, bodyColor, -2.2, 5.5, 4.0));     // cab roof
  house.add(box(4.2, 1.2, 2.8, bodyColor, 1.6, 4.4, 0.4));       // machinery cover
  house.add(box(3.6, 1.2, 2.4, bodyColor, 1.6, 4.4, -2.8));      // engine cover
  house.add(cyl(0.24, 0.18, 3.2, DARK, 2.8, 5.8, -0.6, 8));     // exhaust stack
  // A-frame gantry
  house.add(box(0.60, 5.5, 0.60, 0x7a8288, -1.6, 5.15, 3.5));
  house.add(box(0.60, 5.5, 0.60, 0x7a8288,  1.6, 5.15, 3.5));
  house.add(box(3.8, 0.44, 0.44, 0x7a8288, 0, 7.95, 3.5));      // gantry cross-bar
  house.add(box(0.44, 0.44, 4.5, 0x7a8288, -1.6, 7.95, 5.75)); // gantry stay L
  house.add(box(0.44, 0.44, 4.5, 0x7a8288,  1.6, 7.95, 5.75)); // gantry stay R

  // === Boom (rotation.x pivots to raise / lower) ===
  const boomPivot = new THREE.Group();
  boomPivot.position.set(0, 1.4, 4.5);
  house.add(boomPivot);
  g.userData.boom = boomPivot;

  const boomL = 10.5;
  boomPivot.add(box(1.0, 1.0, boomL, 0x5a6069, -1.1, 0, boomL / 2));
  boomPivot.add(box(1.0, 1.0, boomL, 0x5a6069,  1.1, 0, boomL / 2));
  boomPivot.add(box(2.6, 0.65, 0.65, 0x5a6069, 0, 0, 1.8));          // foot cross
  boomPivot.add(box(2.6, 0.65, 0.65, 0x5a6069, 0, 0, boomL - 0.6)); // tip cross
  const bCyl = cyl(0.32, 0.32, boomL * 0.68, 0x8a9099, 0, 0, boomL * 0.34, 8);
  bCyl.rotation.x = -0.15;
  boomPivot.add(bCyl);

  // === Stick / dipper arm ===
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 0, boomL);
  stickPivot.rotation.x = 0.5; // stick angles slightly downward from boom tip
  boomPivot.add(stickPivot);

  const stickL = 6.0;
  stickPivot.add(box(0.85, 0.85, stickL, 0x5a6069, 0, 0, stickL / 2));
  const sCyl = cyl(0.24, 0.24, stickL * 0.7, 0x8a9099, 0, 0.6, stickL * 0.35, 8);
  sCyl.rotation.x = 0.12;
  stickPivot.add(sCyl);

  // === Bucket (rotation.x curls / dumps) ===
  const bucketPivot = new THREE.Group();
  bucketPivot.position.set(0, 0, stickL);
  stickPivot.add(bucketPivot);
  g.userData.bucket = bucketPivot;

  const bW = 5.2, bH = 2.6, bD = 3.0, bm = 0x4a5260;
  bucketPivot.add(box(bW, 0.36, bD, bm, 0, -bH / 2, bD / 2));       // floor
  bucketPivot.add(box(bW, bH, 0.36, bm, 0, 0, 0));                    // back wall
  bucketPivot.add(box(0.36, bH + 0.36, bD, bm, -bW / 2 + 0.18, 0, bD / 2)); // left cheek
  bucketPivot.add(box(0.36, bH + 0.36, bD, bm,  bW / 2 - 0.18, 0, bD / 2)); // right cheek
  bucketPivot.add(box(bW, 0.42, 0.65, 0x3d4248, 0, -bH / 2, bD + 0.04));    // cutting edge
  for (let i = 0; i < 6; i++) {
    const t = box(0.38, 0.88, 0.32, 0x3d4248,
      -bW / 2 + 0.56 + i * (bW - 1.12) / 5, -bH / 2 - 0.78, bD + 0.2);
    t.rotation.x = -0.3;
    bucketPivot.add(t);
  }
  const bktCyl = cyl(0.24, 0.24, 2.4, 0x8a9099, 0, 0.5, 1.3, 8);
  bktCyl.rotation.x = 0.5;
  bucketPivot.add(bktCyl);

  // Bucket load heap (shown while carrying material)
  const bucketLoad = new THREE.Group();
  const hGeo = new THREE.SphereGeometry(1, 12, 9);
  const hPos = hGeo.attributes.position;
  for (let i = 0; i < hPos.count; i++) {
    const j = 0.88 + Math.random() * 0.22;
    hPos.setXYZ(i, hPos.getX(i) * j, hPos.getY(i) * j, hPos.getZ(i) * j);
  }
  hGeo.computeVertexNormals();
  const bHeap = new THREE.Mesh(hGeo,
    new THREE.MeshStandardMaterial({
      color: 0xa9885a, roughness: 0.95, metalness: 0,
      emissive: 0x5a4020, emissiveIntensity: 0.9,
    }));
  bHeap.scale.set(2.6, 1.7, 1.7);
  bHeap.position.set(0, 0.55, bD / 2);   // mounded well above the rim so it reads from any angle
  bHeap.castShadow = true;
  bucketLoad.add(bHeap);
  bucketLoad.visible = false;
  bucketPivot.add(bucketLoad);
  g.userData.bucketLoad = bucketLoad;

  g.userData.dims = { w: 9.2, h: 10.5, l: 12.0 };
  return g;
}

export function makeGrader() {
  const g = new THREE.Group();
  g.add(box(1.4, 1.1, 9.5, MINE_YELLOW, 0, 2.3, 1.5));
  g.add(box(3.2, 2.4, 4.4, MINE_YELLOW, 0, 2.2, -3.0));
  g.add(box(2.2, 2.0, 1.9, 0x2e3238, 0, 4.2, -1.2));
  const blade = box(5.6, 1.3, 0.4, 0x8f959c, 0, 1.0, 0.8);
  blade.rotation.y = 0.5; blade.rotation.x = -0.2;
  g.add(blade);
  g.add(wheel(1.05, 0.8, -1.6, 1.05, 5.6));
  g.add(wheel(1.05, 0.8, 1.6, 1.05, 5.6));
  for (const zz of [-2.2, -4.4]) for (const s of [-1, 1]) g.add(wheel(1.05, 0.8, s * 1.7, 1.05, zz));
  g.userData.dims = { w: 4, h: 5, l: 12 };
  return g;
}

export function makeWaterTruck() {
  const g = makeHaulTruck(0xdadfe4);
  const tank = cyl(2.6, 2.6, 8.6, 0xcfd6dc, 0, 5.4, -1.2, 20);
  tank.rotation.x = Math.PI / 2;
  g.add(tank);
  g.add(box(7.0, 0.4, 0.4, 0x35505c, 0, 1.4, -5.6));
  g.userData.dims = { w: 9, h: 8, l: 13.5 };
  return g;
}

export function makeSCOM() {
  const g = new THREE.Group();
  g.add(box(3.2, 2.8, 7.2, 0xe8ebee, 0, 2.4, 0));
  g.add(box(3.3, 0.3, 7.3, 0x8f959c, 0, 3.95, 0));
  g.add(box(3.0, 1.0, 0.2, 0x35d6e8, 0, 2.6, 3.61));
  for (const s of [-1, 1]) { g.add(wheel(0.75, 0.5, s * 1.75, 0.75, -2.2)); g.add(wheel(0.75, 0.5, s * 1.75, 0.75, 2.2)); }
  const mast = cyl(0.12, 0.16, 7.5, 0x9aa1a8, 1.0, 7.5, -2.4, 8);
  g.add(mast);
  g.add(box(1.6, 1.0, 0.1, 0xf2f4f6, 1.0, 10.6, -2.4));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf2f4f6));
  dish.position.set(-0.8, 4.4, 1.8); dish.rotation.x = -1.1; dish.castShadow = true;
  g.add(dish);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0xff6a00, emissiveIntensity: 2 }));
  beacon.position.set(1.0, 11.3, -2.4);
  g.add(beacon);
  g.userData.dims = { w: 3.4, h: 11, l: 7.4 };
  return g;
}

export function makeLightTower() {
  const g = new THREE.Group();
  g.add(box(2.4, 1.4, 3.6, MINE_YELLOW, 0, 1.0, 0));
  g.add(cyl(0.14, 0.2, 8.6, 0x9aa1a8, 0, 5.9, 0, 8));
  const head = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2b0, emissiveIntensity: 1.6 }));
    lamp.position.set((i - 1.5) * 0.95, 0, 0);
    head.add(lamp);
  }
  head.position.set(0, 10.1, 0); head.rotation.x = 0.35;
  g.add(head);
  g.userData.dims = { w: 2.6, h: 10.6, l: 3.8 };
  return g;
}

// ---------------------------------------------------------------- terrain
// Boddington-inspired open-pit mine height function — analytical, no allocations.
// Called every frame for terrain-following; keep it cheap.
export function getTerrainHeight(wx, wz) {
  // Gentle rolling Jarrah-country plateau (3 octaves of trig)
  let h = Math.sin(wx * 0.0092 + 0.5) * Math.cos(wz * 0.0078 - 0.3) * 5.5
         + Math.sin(wx * 0.021  + 1.8) * Math.cos(wz * 0.018  + 0.9) * 2.5
         + Math.sin(wx * 0.048  - 0.7) * Math.sin(wz * 0.052  + 1.4) * 1.0;
  // Slight net upslope toward B (waste dump sits on elevated ground, as in real mines)
  h += (wx + wz) * 0.007;

  // Open pit — elliptical, east of the haul road, clearly visible from cab
  // Centre (200, -180), semi-axes 160 × 130 m, depth 26 m, 4 terraced benches
  const pitDr = Math.hypot((wx - 200) / 160, (wz + 180) / 130);
  if (pitDr < 1.0) {
    const raw = 26 * Math.pow(1.0 - pitDr, 0.75);
    const bh = 6.5;  // bench height
    h -= Math.floor(raw / bh) * bh + (raw % bh) * 0.22;
  }

  // Waste-dump mound near B — typical mine site feature
  const dumpDr = Math.hypot(wx - 400, wz - 300);
  if (dumpDr < 90) h += 16 * Math.pow(1.0 - dumpDr / 90, 2);

  return h;
}

function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8d7355';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(60,45,28,0.16)' : 'rgba(178,152,112,0.14)';
    const r = 1 + Math.random() * 7;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- world
export function createWorld(scene) {
  scene.background = new THREE.Color(0xa8c4d8);
  scene.fog = new THREE.Fog(0xa8c4d8, 500, 1400);

  const hemi = new THREE.HemisphereLight(0xcfe4f2, 0x5c4a33, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(180, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 50; sc.far = 700;
  sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140;
  scene.add(sun);
  scene.add(sun.target);

  // ---- Terrain mesh (Boddington-style heightfield) ----
  // Visual mesh: 100×100 segments (10,000 quads) — good visual fidelity, cheap to render.
  // NOT on LAYER_COLLIDER — using a separate flat proxy instead (see below) to keep
  // LiDAR raycasting O(1) rather than O(10 k triangles per ray).
  const TSIZE = 2400, TSEGS = 100;
  const terrGeo = new THREE.PlaneGeometry(TSIZE, TSIZE, TSEGS, TSEGS);
  terrGeo.rotateX(-Math.PI / 2);
  const tp = terrGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    tp.setY(i, getTerrainHeight(tp.getX(i), tp.getZ(i)) + (Math.random() - 0.5) * 0.45);
  }
  terrGeo.computeVertexNormals();
  const ground = new THREE.Mesh(terrGeo,
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), color: 0xb5a184, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Flat ground collider for LiDAR — 2 triangles only, no terrain detail needed.
  const groundCollider = new THREE.Mesh(
    new THREE.PlaneGeometry(TSIZE, TSIZE),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  groundCollider.rotation.x = -Math.PI / 2;
  groundCollider.layers.set(LAYER_COLLIDER);
  groundCollider.userData.intensity = 0.25;
  groundCollider.userData.cls = 'ground';
  scene.add(groundCollider);

  // ---- Haul road path A → B (autopilot waypoints, Y=0 for 2-D path tracking) ----
  const path = [
    new THREE.Vector3(-330, 0, -240),
    new THREE.Vector3(-190, 0, -215),
    new THREE.Vector3(-60,  0, -110),
    new THREE.Vector3(30,   0,  30),
    new THREE.Vector3(170,  0,  130),
    new THREE.Vector3(300,  0,  195),
    new THREE.Vector3(345,  0,  245),
  ];

  // ---- Haul road ribbon (floated just above terrain surface) ----
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x6e5b43, roughness: 1 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x54452f, roughness: 1 });
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = a.distanceTo(b) + 6;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const gy = getTerrainHeight(mid.x, mid.z);
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(15, len), roadMat);
    seg.rotation.x = -Math.PI / 2; seg.rotation.z = -yaw;
    seg.position.set(mid.x, gy + 0.08, mid.z);
    seg.receiveShadow = true;
    scene.add(seg);
    for (const s of [-1, 1]) {
      const berm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), edgeMat);
      berm.rotation.x = -Math.PI / 2; berm.rotation.z = -yaw;
      const off = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(s * 8.6);
      berm.position.set(mid.x + off.x, gy + 0.09, mid.z + off.z);
      scene.add(berm);
    }
  }

  // ---- A / B markers ----
  function marker(pos, color, letter) {
    const grp = new THREE.Group();
    const gy = getTerrainHeight(pos.x, pos.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(9, 11, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = gy + 0.1;
    grp.add(ring);
    const post = cyl(0.35, 0.35, 12, color, 0, gy + 6, 0, 10);
    post.castShadow = false;
    grp.add(post);
    const lbl = makeLabel(`  ${letter}  `, letter === 'A' ? '#5aff9c' : '#ffb056');
    lbl.position.set(0, gy + 15, 0); lbl.scale.set(12, 4.4, 1);
    grp.add(lbl);
    grp.position.copy(pos);
    scene.add(grp);
    return grp;
  }
  marker(path[0], 0x2fd873, 'A · LOAD');
  marker(path[path.length - 1], 0xff9030, 'B · DUMP');

  // ---- Rocks (scattered off road, sitting on terrain) ----
  const colliders = [groundCollider];
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 90; i++) {
    const rock = new THREE.Mesh(rockGeo, mat(0x6f6257, 1, 0));
    const s = 0.5 + Math.random() * 2.6;
    rock.scale.set(s * (0.7 + Math.random() * 0.6), s * 0.7, s * (0.7 + Math.random() * 0.6));
    let x, z;
    do { x = (Math.random() - 0.5) * 900; z = (Math.random() - 0.5) * 900; }
    while (distToPath(x, z, path) < 14);
    rock.position.set(x, getTerrainHeight(x, z) + s * 0.35, z);
    rock.rotation.y = Math.random() * Math.PI;
    rock.castShadow = rock.receiveShadow = true;
    rock.layers.enable(LAYER_COLLIDER);
    rock.userData.intensity = 0.35;
    rock.userData.cls = 'rock';
    scene.add(rock);
    colliders.push(rock);
  }

  // ---- Load / dump infrastructure ----
  const machines = [];
  const placed = [];

  function addMachine(grp, cls, label, x, z, yaw) {
    const gy = getTerrainHeight(x, z);
    grp.position.set(x, gy, z);
    grp.rotation.y = yaw;
    scene.add(grp);
    const lbl = makeLabel(label);
    lbl.position.set(0, grp.userData.dims.h + 3.5, 0);
    grp.add(lbl);
    const d = grp.userData.dims;
    const col = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.l), new THREE.MeshBasicMaterial());
    col.position.set(x, gy + d.h / 2, z);
    col.rotation.y = yaw;
    col.layers.set(LAYER_COLLIDER);
    col.userData.intensity = 0.95;
    col.userData.cls = cls;
    scene.add(col);
    colliders.push(col);
    const m = { group: grp, cls, label, dims: d, collider: col };
    machines.push(m);
    placed.push({ x, z });
    return m;
  }

  // Wheel loader beside point A
  const A = path[0];
  const roadYawA = Math.atan2(path[1].x - A.x, path[1].z - A.z);
  const perpA = new THREE.Vector3(Math.cos(roadYawA), 0, -Math.sin(roadYawA));
  const loaderPos = A.clone().addScaledVector(perpA, 17);
  const loader = addMachine(makeShovel(), 'shovel', 'SH-01 · MHS-9020',
    loaderPos.x, loaderPos.z, Math.atan2(A.x - loaderPos.x, A.z - loaderPos.z));
  loader.isLoader = true;

  const loadPilePos = A.clone().addScaledVector(perpA, 33);
  const loadPile = makeMaterialPile(9, 4.5);
  loadPile.position.set(loadPilePos.x, getTerrainHeight(loadPilePos.x, loadPilePos.z), loadPilePos.z);
  scene.add(loadPile);
  const pileCol = new THREE.Mesh(new THREE.ConeGeometry(9, 4.5, 10), new THREE.MeshBasicMaterial());
  pileCol.position.set(loadPilePos.x, getTerrainHeight(loadPilePos.x, loadPilePos.z) + 2.25, loadPilePos.z);
  pileCol.layers.set(LAYER_COLLIDER);
  pileCol.userData.intensity = 0.45;
  pileCol.userData.cls = 'stockpile';
  scene.add(pileCol);
  colliders.push(pileCol);
  placed.push({ x: loadPilePos.x, z: loadPilePos.z });

  // Dump pile at B — grows as truck tips loads
  const B = path[path.length - 1];
  const roadYawB = Math.atan2(B.x - path[path.length - 2].x, B.z - path[path.length - 2].z);
  const fwdB = new THREE.Vector3(Math.sin(roadYawB), 0, Math.cos(roadYawB));
  const perpB = new THREE.Vector3(Math.cos(roadYawB), 0, -Math.sin(roadYawB));
  const dumpPilePos = B.clone().addScaledVector(fwdB, -14).addScaledVector(perpB, 5);
  const dumpPile = makeMaterialPile(8, 4);
  dumpPile.position.set(dumpPilePos.x, getTerrainHeight(dumpPilePos.x, dumpPilePos.z), dumpPilePos.z);
  dumpPile.scale.setScalar(0.01);
  dumpPile.visible = false;
  scene.add(dumpPile);

  // ---- Random machine placement ----
  const machineDefs = [
    { make: () => makeHaulTruck(), cls: 'haul_truck', label: 'MTTT-01 · AHT-797' },
    { make: () => makeHaulTruck(0xe0a400), cls: 'haul_truck', label: 'MTTT-02 · AHT-797' },
    { make: makeSCOM, cls: 'scom_unit', label: 'SCOM-1 · SITE CMD' },
    { make: makeDozer, cls: 'dozer', label: 'DZ-11 · HBD-11' },
    { make: makeDozer, cls: 'dozer', label: 'DZ-12 · HBD-11' },
    { make: makeGrader, cls: 'grader', label: 'GR-24 · MGR-24' },
    { make: makeWaterTruck, cls: 'water_truck', label: 'WT-77 · HWT-77' },
    { make: makeLightTower, cls: 'light_tower', label: 'LT-05' },
    { make: makeLightTower, cls: 'light_tower', label: 'LT-06' },
  ];
  for (const def of machineDefs) {
    let x, z, tries = 0;
    do {
      x = (Math.random() - 0.5) * 760;
      z = (Math.random() - 0.5) * 640;
      tries++;
    } while (tries < 200 && (
      distToPath(x, z, path) < 26 ||
      placed.some(p => Math.hypot(p.x - x, p.z - z) < 42) ||
      path[0].distanceTo(new THREE.Vector3(x, 0, z)) < 55 ||
      path[path.length - 1].distanceTo(new THREE.Vector3(x, 0, z)) < 55
    ));
    addMachine(def.make(), def.cls, def.label, x, z, Math.random() * Math.PI * 2);
  }

  return { path, machines, colliders, sun, ground, loader, loadPile, dumpPile };
}

export function distToPath(x, z, path) {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].x, az = path[i].z, bx = path[i + 1].x, bz = path[i + 1].z;
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    min = Math.min(min, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return min;
}
