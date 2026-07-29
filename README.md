# AUSSIM — AUtonomy Site SIMulator

**AUSSIM** is a browser-based **perception + autonomy simulator** for an autonomous **CAT 797F haul truck**
operating on a **Boddington-style open-pit mine** — uneven terrain with a benched open pit, waste-dump
mound and rolling Jarrah-country hills. The truck runs a continuous production cycle —
**load at Point A → haul → dump at Point B → return** — while a full simulated sensor suite
(camera, LiDAR, radar, IMU, GNSS) streams live outputs to instrument panels, and other
Caterpillar machines (MTTT haul trucks, SCOM site-command unit, D11 dozers, 24M grader,
777 water truck, light towers) are randomly placed around the site.

> 📖 Deep-dive sensor documentation (implementation, design considerations, per-sensor
> architecture and flow diagrams): **[docs/sensor-documentation.html](docs/sensor-documentation.html)**

---

## Table of contents

1. [Quick start](#quick-start)
2. [Feature overview](#feature-overview)
3. [System architecture](#system-architecture)
4. [Runtime data flow](#runtime-data-flow)
5. [Mission state machine](#mission-state-machine)
6. [Sensor suite summary](#sensor-suite-summary)
7. [How the sensors actually work](#how-the-sensors-actually-work)
8. [Controls & configuration](#controls--configuration)
9. [Module reference](#module-reference)
10. [Rendering design](#rendering-design)
11. [Headless verification hooks](#headless-verification-hooks)
12. [Mapping to a real autonomy stack](#mapping-to-a-real-autonomy-stack)

---

## Running locally (without Claude)

No cloud dependency — AUSSIM is a pure Node + browser app.

```bash
# 1. Install Node.js ≥ 18  (https://nodejs.org)
# 2. Clone / download the project, then inside the project directory:
npm install          # installs three + vite from package.json
npm run dev          # starts Vite dev server
# 3. Open your browser at:
#    http://localhost:5173
```

To stop the dev server press `Ctrl+C` in the terminal.
For a production build (static files you can serve anywhere):

```bash
npm run build        # outputs to dist/
npm run preview      # serves dist/ locally for a quick check
```

Prerequisites: **Node.js ≥ 18**, **npm ≥ 9**. No GPU, no Python, no backend required — everything runs in the browser via Three.js / WebGL.

## Quick start

```bash
npm install
npm run dev          # -> http://localhost:5173
```

Press **▶ START** on the landing page. Use **■ Stop** to end a run and return to the landing page, **❚❚ Pause / ▶ Run** to freeze/resume, **↺ Reset** to restart the mission without leaving the app.

Prerequisites are documented in [requirements.txt](requirements.txt)
(Node ≥ 18; packages: `three`, `vite`).

## Feature overview

| Area | What is simulated |
|---|---|
| **World** | Boddington-style uneven terrain (rolling hills, open pit with 4 terraced benches, waste-dump mound), S-curved haul road with berms, rocks, A/B markers, 10+ procedural CAT machines with floating ID labels |
| **Truck** | CAT 797F kinematics (accel/decel limits, yaw-rate limits), pure-pursuit path tracking, terrain-following pitch/roll/height, curve slow-down, goal braking, radar AEB |
| **Material cycle** | 6060 FS loader + stockpile at A fills the truck (visible payload heap, PAYLOAD % HUD); dump body tips at B and a pile grows one truck-load per trip |
| **Camera** | Real second render pass from a truck-mounted pinhole camera + projected 3D→2D detections (class, confidence, range) |
| **LiDAR** | 32-channel rotating raycaster; 3D point cloud in the world view + height-colored bird's-eye-view panel |
| **Radar** | FMCW-style cone scan; PPI scope with range / bearing / radial velocity tracks, RCS model, clutter false alarms |
| **IMU** | 6-DOF body-frame accelerations + gyro rates from vehicle kinematics with bias, noise, speed-dependent vibration |
| **GNSS** | RTK-grade geodetic fix (lat/lon/alt/COG/HDOP/sats) + mini-map with planned path and breadcrumb trail |
| **Sensor rig** | Live sliders to translate (lateral/height/forward) and rotate (pitch/yaw) every sensor, plus FOV/range; 3D gizmos show mounts and fields of view |

## System architecture

```mermaid
flowchart TB
    subgraph UI["UI layer (DOM)"]
        LAND["Landing page<br/>START button"]
        LEFT["Left panel<br/>mission controls + sensor rig sliders"]
        HUD["HUD<br/>state · speed · payload · heading · dist · detections"]
        RIGHT["Right panel<br/>camera / LiDAR / radar / IMU / GNSS instruments"]
    end

    subgraph CORE["Simulation core (src/main.js loop)"]
        LOOP["requestAnimationFrame loop<br/>dt = clock Δ × sim speed"]
        TRUCK["Truck (src/truck.js)<br/>kinematics + pure pursuit + mission FSM"]
        ANIM["World choreography<br/>loader swing · pile growth · payload fill"]
    end

    subgraph SENSORS["Sensor models (src/sensors.js)"]
        CAM["CameraSensor<br/>pinhole render + detector"]
        LID["LidarSensor<br/>raycast scanner"]
        RAD["RadarSensor<br/>cone scan tracks"]
        IMU2["IMUSensor<br/>accel + gyro"]
        GPS2["GPSSensor<br/>ENU → geodetic"]
    end

    subgraph WORLD["World model (src/world.js)"]
        SCENE["THREE.Scene<br/>terrain · road · machines · piles"]
        COLL["Collider layer (raycast-only proxies)"]
    end

    subgraph OUT["Instrument rendering (src/panels.js)"]
        P1["Detection overlay (2D canvas)"]
        P2["LiDAR BEV (2D canvas)"]
        P3["Radar PPI (2D canvas)"]
        P4["IMU strip charts (2D canvas)"]
        P5["GNSS map + readout"]
    end

    LAND -->|start/stop| LOOP
    LEFT -->|rig config| SENSORS
    LEFT -->|pause · reset · speed| LOOP
    LOOP --> TRUCK --> ANIM --> SCENE
    TRUCK -->|pose · velocity| SENSORS
    SCENE --> CAM
    COLL --> LID
    SCENE -->|machine positions| RAD
    RAD -->|nearest obstacle| TRUCK
    CAM --> P1
    LID --> P2
    RAD --> P3
    IMU2 --> P4
    GPS2 --> P5
    TRUCK --> HUD
    P1 & P2 & P3 & P4 & P5 --> RIGHT
```

## Runtime data flow

One animation frame executes this pipeline (≈60 Hz, sensor-internal rates differ):

```mermaid
sequenceDiagram
    participant L as Loop (main.js)
    participant T as Truck
    participant S as Sensors
    participant W as World/Scene
    participant P as Panels (2D)
    participant R as WebGL Renderer

    L->>T: update(dt) — FSM + pure pursuit + integrate pose
    L->>T: obstacleDist = radar.nearestAhead()  (AEB feedback)
    L->>W: updateWorldAnims(dt) — loader swing, pile scale, payload
    L->>S: lidar.update — sweep 45°/frame, 32ch raycasts vs collider layer
    L->>S: radar.update (15 Hz) — range/bearing/vr per machine + clutter
    L->>S: imu.update — accel/gyro from kinematics + noise
    L->>S: gps.update (5 Hz) — ENU + noise → lat/lon fix
    L->>S: camera.detect (15 Hz) — project machine boxes → 2D detections
    L->>P: draw BEV, PPI, strip charts, map, detection boxes
    L->>R: render(scene, viewCam) — full canvas
    L->>R: render(scene, sensorCam) — scissored into camera panel
    L->>P: update HUD text (~7 Hz)
```

## Mission state machine

```mermaid
stateDiagram-v2
    [*] --> LOADING : START (truck empty at A)
    LOADING --> HAUL_TO_B : payload = 100%\n(~9 s, loader swings pile→truck)
    HAUL_TO_B --> DUMPING : reached B & stopped
    DUMPING --> RETURN_TO_A : bed tipped, payload drained\n(dump pile grows +1 load)
    RETURN_TO_A --> LOADING : reached A & stopped
    note right of HAUL_TO_B
        pure pursuit (26 m lookahead)
        curve slow-down · goal braking
        radar AEB (< 45 m in ±12° corridor)
    end note
```

## Sensor suite summary

| Sensor | Rate | Model | Output surface |
|---|---|---|---|
| Camera | render every frame; detector 15 Hz | Pinhole `THREE.PerspectiveCamera` second render pass; oriented-bbox projection detector | Camera panel (live feed + boxes w/ class·conf·range), HUD detection count |
| LiDAR | ~7.5 Hz full revolution (45°/frame, 3° az, 32 ch) | `THREE.Raycaster` against invisible collider layer; range noise; height/intensity coloring | 3D point cloud in world view + BEV panel with range rings |
| Radar | 15 Hz | Analytic cone scan: range, bearing, radial velocity vs ego motion, log-RCS, 6% clutter | PPI wedge scope with sweep, blips, per-track range/vr labels |
| IMU | every physics step (nominal 200 Hz label) | ax = v·ω (centripetal), az = dv/dt, g + vibration ∝ speed, constant biases | 3 strip charts (lat accel, long accel, yaw rate) + |a| meta |
| GNSS | 5 Hz | Local ENU → WGS-84 around −23.3582°, 119.7521° (Pilbara); σ ≈ 3 cm (RTK) | Lat/Lon/Alt/VEL/COG/HDOP/sats readout + mini-map (path, A/B, trail) |

Full detail per sensor — inputs, equations, pipelines, pitfalls — in
**[docs/sensor-documentation.html](docs/sensor-documentation.html)**.

## How the sensors actually work

The truck "sees" the world through three very different senses — LiDAR, radar and camera —
the same trio a real autonomous haul truck (e.g. Cat MineStar Command) carries. Each one is
good at something the others are bad at, which is why they're used together. In everyday
terms:

- **LiDAR** is like throwing thousands of tiny laser tape-measures every fraction of a
  second and building a 3-D shape of everything around the truck from where they bounce back.
- **Radar** is like shouting a radio "ping" and listening for the echo — it's not very
  detailed, but it tells you exactly how fast something is moving, even through dust or rain.
- **Camera** is the only sensor that sees like a human eye — color, texture, and shape — so
  it's what actually reads "that's a dozer" vs "that's a rock."

None of them alone is enough (LiDAR doesn't know colors, radar doesn't know shapes, cameras
struggle in dust/fog/darkness), so the truck fuses all three, the same way a human driver
uses their eyes plus a general sense of "how fast is that thing closing in on me."

### LiDAR section

**What it is, in plain terms:** LiDAR = *Light Detection And Ranging*. Picture a lighthouse
beam that spins around the truck, except instead of one beam it's 32 laser beams stacked at
slightly different angles (like 32 flashlights fanned out vertically), and instead of light
you see, it's an invisible laser pulse. Each beam fires outward, hits something solid — the
ground, a rock, another truck — and bounces back. The sensor measures **how long the round
trip took**. Since light travels at a known, constant speed, `distance = (time × speed of
light) / 2` tells you exactly how far away that point is. Do this thousands of times a
second across a full rotation and you get a **3-D "point cloud"** — a dot-by-dot X-ray sketch
of everything solid around the truck, with no color, just precise shape and distance.

In AUSSIM, this is simulated with `THREE.Raycaster` (see [src/sensors.js](src/sensors.js))
firing invisible rays against a simplified "collider" copy of the world (so it's fast) instead
of real lasers — but the geometry is the same as a physical LiDAR: 32 vertical channels ×
sweeping azimuth, with small realistic range noise added to each hit.

```mermaid
flowchart TD
    START(["Frame tick\n(~60 Hz sim loop)"]) --> POSE["Read truck pose\n(position + heading + rig offsets)"]
    POSE --> MOUNT["Compute LiDAR mount transform\n(lateral/height/forward, yaw)"]
    MOUNT --> AZSTEP["Advance sweep azimuth\nby 45° this frame (3° sub-steps)"]

    AZSTEP --> CH0["Channel loop: 32 vertical channels\n(fixed elevation angles, top to bottom)"]
    CH0 --> CH1["Channel 1 (top)"]
    CH0 --> CH2["Channel 2"]
    CH0 --> CHDOT["... channels 3-31 ..."]
    CH0 --> CH32["Channel 32 (bottom)"]

    CH1 --> FIRE["Fire ray:\norigin = mount pos\ndirection = azimuth x elevation"]
    CH2 --> FIRE
    CHDOT --> FIRE
    CH32 --> FIRE

    FIRE --> CAST["THREE.Raycaster intersects\nagainst collider layer\n(terrain, machines, rocks, berms)"]
    CAST --> HIT{"Ray hits\nwithin max range?"}
    HIT -- "no" --> DROP["No return — discard\n(open sky / out of range)"]
    HIT -- "yes" --> TOF["Time-of-flight distance\n= time x speed_of_light / 2"]
    TOF --> JITTER["Add small range noise\n(sensor realism model)"]
    JITTER --> POINT["Compute 3D point (x, y, z)\n+ height value + intensity"]
    POINT --> PUSH["Push into point ring buffer\n(oldest points evicted)"]

    PUSH --> MORE{"More channels\nor azimuth steps\nleft this sweep?"}
    MORE -- "yes" --> AZSTEP
    MORE -- "no, full 360°\ncovered" --> CLOUD["Full point cloud ready"]

    CLOUD --> COLOR["Color-code points\nby height (BEV) / intensity"]
    COLOR --> V1["3D world view:\nfloating colored dot cloud\nover real terrain"]
    COLOR --> V2["Bird's-eye-view panel:\ntop-down projection\n+ concentric range rings"]
    V1 --> DONE(["Rendered @ ~7.5 Hz\nfull-revolution rate"])
    V2 --> DONE
```

**Architecture — how it's wired into AUSSIM:**

```mermaid
flowchart TB
    subgraph World
        COL["Collider layer\n(invisible box/cone proxies\nfor terrain, machines, rocks)"]
    end
    subgraph LidarSensor["LidarSensor (src/sensors.js)"]
        SWEEP["Sweep controller\n45°/frame, 3° azimuth step"]
        RAY["THREE.Raycaster\n(32 channels x current azimuth)"]
        NOISE["Range noise model"]
        BUF["Point ring buffer\n(pos + height/intensity)"]
    end
    subgraph Panels["src/panels.js"]
        P3D["3D world view\n(point cloud overlay)"]
        BEV["LiDAR BEV canvas\n(top-down, range rings)"]
    end

    COL --> RAY
    SWEEP --> RAY
    RAY --> NOISE --> BUF
    BUF --> P3D
    BUF --> BEV
```

**Why it matters for autonomy:** LiDAR gives the truck precise, lighting-independent 3-D
shape — it works identically in bright sun or pitch dark, because it makes its own light. This
is what tells the truck exactly *where* an obstacle's edges are, which is critical for path
planning around berms, rock piles, or a parked dozer.

### Radar section

**What it is, in plain terms:** Radar = *RAdio Detection And Ranging*. Instead of light,
it sends out a radio wave (like a mini invisible radio broadcast) in a cone shape ahead of the
truck, and listens for the echo bouncing off objects. Two things make radar special:

1. **Range** — same time-of-flight trick as LiDAR, but with radio waves, which travel
   straight through dust, rain and fog largely unaffected (this is why radar is the
   go-to sensor for foul-weather collision avoidance).
2. **Speed, for free** — because it's a wave, if the target is moving toward or away from
   the truck, the reflected wave's frequency shifts slightly (the **Doppler effect** — the
   same reason a siren sounds higher-pitched approaching you and lower-pitched leaving). By
   measuring that pitch shift, radar reads a target's closing speed directly, without needing
   to compare two separate snapshots in time.

Every object also reflects a different *amount* of radio energy depending on its size and
material — a big steel dump truck reflects a lot (**high RCS**, Radar Cross-Section), a person
or a rock reflects much less. AUSSIM models this with a simple log-RCS value per machine type,
plus a small amount of "clutter" (random false blips), which is realistic — real automotive/
mining radar occasionally flags noise as a target too.

```mermaid
flowchart TD
    START(["Radar tick\n@ 15 Hz"]) --> MOUNT["Compute radar mount transform\n(lateral/height/forward, pitch/yaw)"]
    MOUNT --> CONE["Define scan cone\n(range 40-250 m, FOV 20-160°,\ncentered on heading)"]

    CONE --> SCAN["Scan every machine\nin the world"]
    SCAN --> M1["Machine 1"]
    SCAN --> M2["Machine 2"]
    SCAN --> MDOT["... other machines ..."]
    SCAN --> MN["Machine N"]

    M1 --> INCONE{"Inside cone's\nrange + FOV?"}
    M2 --> INCONE
    MDOT --> INCONE
    MN --> INCONE

    INCONE -- "no" --> SKIP["Ignore — outside\nradar's field of view"]
    INCONE -- "yes" --> RB["Compute range + bearing\n(polar coords vs truck)"]
    RB --> REL["Compute relative velocity vector\n(machine motion - ego motion)"]
    REL --> DOP["Project onto line-of-sight\n= Doppler radial velocity v_r\n(closing speed, + / away, - / approach)"]
    RB --> RCS["Look up RCS by machine class\n(steel truck = high,\nsmall object = low) + log scale"]

    DOP --> TRACK["Build track:\n{range, bearing, v_r, RCS}"]
    RCS --> TRACK
    TRACK --> LIST["Append to this-frame track list"]

    LIST --> MORE{"More machines\nto check?"}
    MORE -- "yes" --> SCAN
    MORE -- "no" --> CLUTTER["Inject clutter:\n~6% chance of random\nfalse-alarm blips"]

    CLUTTER --> FINAL["Final track list\n(real tracks + clutter)"]
    FINAL --> PPI["Draw PPI scope:\nrotating sweep line,\nblips, range/bearing/v_r labels"]

    FINAL --> NEAREST["Find nearest real track\nahead of truck"]
    NEAREST --> GATE{"Range < 45 m\nAND bearing within\n±12° heading corridor?"}
    GATE -- "yes" --> BRAKE["AEB fires:\nbrake command -> Truck"]
    GATE -- "no" --> CLEAR["No intervention\n(normal driving continues)"]
```

**Architecture — how it's wired into AUSSIM:**

```mermaid
flowchart TB
    subgraph World
        MACH["Machine positions\n+ velocities (src/world.js)"]
    end
    subgraph RadarSensor["RadarSensor (src/sensors.js), 15 Hz"]
        SCAN["Cone scan\n(range 40-250 m, FOV 20-160°)"]
        DOP["Doppler model\nv_r = closing speed vs ego"]
        RCS["Log-RCS model per machine type"]
        CLUT["Clutter generator (6%)"]
        TRK["Track list builder"]
    end
    subgraph Truck["Truck (src/truck.js)"]
        AEB["AEB logic\nbrake if obstacle < 45m\nwithin ±12° heading"]
    end
    subgraph Panels["src/panels.js"]
        PPI["Radar PPI scope\n(sweep + range/bearing/vr labels)"]
    end

    MACH --> SCAN --> DOP --> TRK
    SCAN --> RCS --> TRK
    CLUT --> TRK
    TRK --> PPI
    TRK -->|nearest ahead| AEB
```

**Why it matters for autonomy:** Radar is the "gut reflex" sensor — coarser than LiDAR or
camera, but it directly measures closing speed and keeps working in weather/dust that would
blind a camera or scatter a laser. That's why AUSSIM wires radar (not LiDAR or camera)
straight into the truck's **automatic emergency braking (AEB)** — it's the fastest, most
robust "something is closing in on me" signal.

### Camera section

**What it is, in plain terms:** The camera is the only sensor that "sees" the way a person
does — a 2-D image built from light reflecting off surfaces, with color and texture. AUSSIM
mounts a virtual pinhole camera on the truck (a `THREE.PerspectiveCamera`, the standard
computer-graphics model of how a real lens focuses light onto a sensor/film) and renders the
same 3-D scene a second time from the truck's point of view. That gives a live video feed —
exactly what a driver, or an onboard vision system, would see.

On top of the raw image, a **detector** figures out *what* is in view: every machine in the
world already has a known 3-D bounding box (its physical outline). The detector projects each
box's eight corners from 3-D world space onto the 2-D camera image using the camera's
lens/perspective math, draws a rectangle around the visible ones, and labels it with a class
(e.g. "dozer", "haul truck"), a confidence score, and the real-world range to that object. This
mirrors how a real system like YOLO or Detectron2 works, except a real detector *learns* to
recognize shapes from pixels, whereas AUSSIM already knows the ground-truth boxes and just
projects them — a stand-in for "detection" that keeps the sim fast and deterministic.

```mermaid
flowchart TD
    START(["Render tick\nevery frame (image),\ndetector @ 15 Hz"]) --> MOUNT["Compute camera mount transform\n(lateral/height/forward, pitch/yaw, FOV)"]
    MOUNT --> PASS2["Second WebGL render pass:\nsame 3D scene, from truck's\npinhole camera viewpoint"]
    PASS2 --> SCISSOR["Scissor/viewport into\ncamera panel rect"]
    SCISSOR --> FEED["Live RGB image feed\n(camera panel)"]

    MOUNT --> DETLOOP{"Detector tick?\n(every ~4th frame, 15 Hz)"}
    DETLOOP -- "no" --> WAITFEED["Skip detection this frame\n(feed still updates)"]
    DETLOOP -- "yes" --> OBJLOOP["For each machine\nin the world"]

    OBJLOOP --> O1["Machine 1: known 3D\nbounding box (8 corners)"]
    OBJLOOP --> O2["Machine 2: known 3D\nbounding box"]
    OBJLOOP --> ODOT["... other machines ..."]

    O1 --> PROJ["Project each corner:\nworld space -> camera space\n-> 2D image space (perspective divide)"]
    O2 --> PROJ
    ODOT --> PROJ

    PROJ --> FRUSTUM{"Any corners inside\ncamera frustum\n(FOV + near/far)?"}
    FRUSTUM -- "no" --> OFFSCREEN["Discard — object\noutside field of view"]
    FRUSTUM -- "yes" --> OCCL{"Occluded by\nterrain/another object?"}
    OCCL -- "fully hidden" --> HIDDEN["Discard — not visible\nfrom this viewpoint"]
    OCCL -- "visible" --> BOX2D["Compute enclosing 2D box\nfrom projected corners"]

    BOX2D --> RANGE["Compute real-world range\n(distance truck -> object)"]
    RANGE --> CLASSIFY["Attach class label\n(e.g. dozer, haul truck)\n+ confidence score"]
    CLASSIFY --> DET["Detection record:\n{box, class, confidence, range}"]

    DET --> MOREOBJ{"More machines\nto check?"}
    MOREOBJ -- "yes" --> OBJLOOP
    MOREOBJ -- "no" --> OVERLAY["Draw all boxes + labels\non detection overlay canvas"]

    FEED --> COMPOSITE["Composite: live feed\n+ overlay"]
    OVERLAY --> COMPOSITE
    COMPOSITE --> COUNT["Update HUD detection count"]
```

**Architecture — how it's wired into AUSSIM:**

```mermaid
flowchart TB
    subgraph Scene["THREE.Scene (src/world.js)"]
        GEO["Visible geometry\n(terrain, road, machines, piles)"]
        BOXES["Known 3D bounding boxes\nper machine"]
    end
    subgraph CameraSensor["CameraSensor (src/sensors.js)"]
        PIN["Pinhole THREE.PerspectiveCamera\n(mounted: lateral/height/forward, pitch/yaw, FOV)"]
        PROJ["Bbox-to-2D projector\n(15 Hz detector)"]
    end
    subgraph Renderer["WebGL renderer (src/main.js)"]
        R1["Full-canvas pass\n(main viewer camera)"]
        R2["Scissored pass\n(camera sensor -> camera panel)"]
    end
    subgraph Panels["src/panels.js"]
        FEED["Camera panel: live feed"]
        OVER["Detection overlay canvas\n(boxes + class/conf/range)"]
    end

    GEO --> PIN --> R2 --> FEED
    BOXES --> PROJ --> OVER
    PROJ -->|count| HUD["HUD detection count"]
```

**Why it matters for autonomy:** Camera is the only sensor that can tell *what kind* of
object something is (a rock vs. a person vs. a dozer) rather than just *that* something is
there. It's essential for classification and for reading signage/markers, but — unlike
LiDAR/radar — its usefulness drops in darkness, glare, dust or fog, which is exactly why real
autonomy stacks (and this simulator) never rely on camera alone.

### Why fuse all three

```mermaid
flowchart LR
    LID["LiDAR\nprecise 3D shape\nworks day/night"] --> FUSE["Sensor fusion\n(perception layer)"]
    RAD["Radar\nrobust range + speed\nworks in dust/rain"] --> FUSE
    CAM["Camera\nclassifies objects\nneeds light/clear air"] --> FUSE
    FUSE --> OUT["Unified world model:\nwhat is it, where is it,\nhow fast, how far"]
    OUT --> PLAN["Path planning + AEB\n(Truck FSM)"]
```

Each sensor covers the others' blind spot: LiDAR gives exact shape but no color or velocity,
radar gives velocity and weather-proof range but coarse shape, and camera gives identity but
depends on visibility conditions. A real autonomous haul truck — and this simulator — combines
all three so a single point of failure (dust cloud, darkness, an unusual object shape) doesn't
blind the whole system.

## Controls & configuration

**Mission control (left panel)**

- **❚❚ Pause / ▶ Run** — freeze/resume simulation (rendering continues)
- **■ Stop** — end the run, reset the mission, return to the landing page
- **↺ Reset** — restart the mission in place
- **Follow / Orbit / Top / Cab** — viewer camera modes (Orbit = mouse drag/zoom)
- **Sim speed** 0.25–3× · **Cruise speed** 4–25 m/s
- Toggles: LiDAR cloud in 3D · sensor gizmos/FOV

**Sensor rig config (left panel accordions)** — applied live every frame:

| Sensor | Position | Rotation | Other |
|---|---|---|---|
| Camera | lateral / height / forward (m) | pitch −45…30°, yaw ±180° | FOV 30–120° |
| LiDAR | lateral / height / forward (m) | yaw ±180° | range 40–200 m |
| Radar | lateral / height / forward (m) | pitch ±30°, yaw ±180° | range 40–250 m, FOV 20–160° |

**Reset sensor rig** restores factory mounts (`DEFAULT_RIG` in [src/sensors.js](src/sensors.js)).

## Module reference

```
index.html            landing page, HUD, panel layout
src/style.css         dark UI theme
src/main.js           renderer, loop, scissor multi-view, UI wiring, choreography, debug hooks
src/world.js          terrain, road, A/B markers, procedural CAT machines, piles, colliders, labels
src/truck.js          Truck: kinematic model, pure-pursuit tracker, mission FSM, payload/dump
src/sensors.js        CameraSensor, LidarSensor, RadarSensor, IMUSensor, GPSSensor, DEFAULT_RIG
src/panels.js         2D canvas instruments: detections, LiDAR BEV, radar PPI, IMU charts, GPS map
src/ui.js             schema-driven slider/accordion construction
vite.config.js        dev server + snapshot-save middleware (verification helper)
docs/                 sensor documentation (HTML)
snapshots/            JPEGs written by the /__snap_save dev endpoint
```

## Rendering design

- **Single WebGL context, two render passes.** The main view renders full-canvas; the camera
  sensor renders the *same scene* into the camera panel using `setViewport`/`setScissor`
  aligned to the panel's DOM rect (three.js multiplies by pixel ratio internally).
- **Layer masks** separate concerns:
  - `0` — real geometry, visible to every camera
  - `1` — debug overlays (labels, LiDAR cloud, gizmos, frustum helper) — visible to the
    viewer camera only, so the sensor camera feed stays "physically clean"
  - `2` — invisible box/cone collider proxies used **only** by the LiDAR raycaster
    (~100 simple colliders instead of thousands of visual triangles)
- **Shadow camera follows the truck** (140 m box) so a 2 km world keeps crisp shadows.
- 2D instruments are plain `<canvas>` elements redrawn at 15 Hz, DPR-aware.

## Headless verification hooks

Debug-only globals (see end of [src/main.js](src/main.js)) let the sim be exercised without
a visible tab (rAF paused):

- `window.__advance(seconds)` — steps physics + sensors at fixed 60 Hz substeps, returns
  `{state, load, dumped, speed, pos, distToGoal, lidarPts, radarTrk}`
- `window.__snap(scale, quality)` — renders one frame synchronously and returns a JPEG dataURL
  composited from every canvas
- `POST /__snap_save?name=x` (dev server only) — writes that dataURL to `snapshots/x.jpg`

## Mapping to a real autonomy stack

This simulator is intentionally shaped like a robotics stack so components map 1:1 onto
production tooling:

| AUSSIM piece | Real-world equivalent |
|---|---|
| LiDAR point buffer (pos + intensity ring buffer) | `sensor_msgs/PointCloud2`, PCL / Open3D pipelines |
| Camera detector (projected boxes + confidence) | YOLO / Detectron2 inference on the RGB stream |
| BEV LiDAR panel | BEVFusion-style bird's-eye-view representation |
| Radar tracks (range, bearing, vr, RCS) | Automotive FMCW radar object lists (e.g. ARS548) |
| IMU + GNSS models | `sensor_msgs/Imu`, `sensor_msgs/NavSatFix`; EKF fusion (robot_localization) |
| Pure-pursuit tracker + FSM | ROS 2 Nav2 controller server + behavior tree |
| World + machine placement | CARLA / Gazebo / Isaac Sim scenario (OpenSCENARIO) |
| `__advance()` fixed-step hook | Sim-time stepping (`/clock`, `use_sim_time`) |

---

**AUSSIM (AUtonomy Site SIMulator)** © 2026 Lokanath. All rights reserved.
