// main.js
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** ========= CONFIG ========= */
const WORLD_SIZE = 260;
const TERRAIN_RES = 256;
const TERRAIN_MAX_H = 2.6;
const TREE_COUNT = 520;
const PUMPKIN_COUNT = 56;
const GRAVE_COUNT = PUMPKIN_COUNT;
const PLAYER_RADIUS = 0.35;
const OBJ_TREE_R = 0.6;
const OBJ_PUMP_R = 0.45;
const OBJ_GRAVE_R = 0.5;
const FOG_DENSITY = 0.028;
const VR_WALK_SPEED = 5.5;
const VR_STRAFE_SPEED = 4.8;
const ARC_STEPS = 40;
const ARC_SPEED = 7.5;
const ARC_GRAVITY = 9.8;
const MAX_SLOPE_DEG = 45;
const WORLD_RADIUS = WORLD_SIZE * 0.5 - 1.0;
const PUMPKIN_AREA = 80;
const SPIRIT_COUNT = 40;
const GOAL_SCORE = 100;
const HDRI_LOCAL = 'assets/bosque.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr';

/** ========= DOM / UI ========= */
const hudTotal = document.getElementById('totalPumpkins');
const hudHit = document.getElementById('hitPumpkins');
const winMessage = document.getElementById('winMessage');

/** ========= GAME SCORE ========= */
let score = 0;
let gameWon = false;
let controlsEnabled = true;

/** ========= RENDERER / SCENES / CAMERA ========= */
const canvas = document.getElementById('scene');
const ambientEl = document.getElementById('ambient');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.autoClear = true;

// Escena principal
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101a);
scene.fog = new THREE.FogExp2(0x224466, FOG_DENSITY);

// Cámara del jugador
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
const player = new THREE.Group();
player.position.set(0, 1.6, 3);
player.add(camera);
scene.add(player);

/** ========= IBL / HDRI ========= */
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

async function setHDRI(url) {
    try {
        const hdr = await new Promise((res, rej) => new RGBELoader().load(url, (t) => res(t), undefined, rej));
        const env = pmremGen.fromEquirectangular(hdr).texture;
        scene.environment = env;
        scene.background = env;
        hdr.dispose();
    } catch (error) {
        console.warn('Error cargando HDRI local, usando fallback:', error);
        try {
            const hdr = await new Promise((res, rej) => new RGBELoader().load(HDRI_FALLBACK, (t) => res(t), undefined, rej));
            const env = pmremGen.fromEquirectangular(hdr).texture;
            scene.environment = env;
            scene.background = env;
            hdr.dispose();
        } catch (e) {
            console.warn('Sin HDRI:', e);
        }
    }
    pmremGen.dispose();
}

setHDRI(HDRI_LOCAL);

/** ========= LUCES ========= */
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x080820, 0.8);
scene.add(hemiLight);

// Luz de luna
const moonLight = new THREE.DirectionalLight(0xcfe2ff, 1.25);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.near = 0.5;
moonLight.shadow.camera.far = 220;
moonLight.position.set(30, 40, -30);
scene.add(moonLight);

/** ========= MURO (bajo) ========= */
const wallHeight = 6;
const wallGeo = new THREE.CylinderGeometry(WORLD_RADIUS + 0.5, WORLD_RADIUS + 0.5, wallHeight, 64, 1, true);
const wallMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const wallMesh = new THREE.Mesh(wallGeo, wallMat);
wallMesh.position.y = wallHeight / 2;
wallMesh.renderOrder = 5;
scene.add(wallMesh);

/** ========= PERLIN NOISE & TERRENO PBR ========= */
function makePerlin(seed = 1337) {
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    let n, q;
    for (let i = 255; i > 0; i--) {
        n = Math.floor((seed = (seed * 16807) % 2147483647) / 2147483647 * (i + 1));
        q = p[i];
        p[i] = p[n];
        p[n] = q;
    }
    for (let i = 0; i < 256; i++) p[256 + i] = p[i];
    const grad = (h, x, y) => {
        switch (h & 3) {
            case 0: return x + y;
            case 1: return -x + y;
            case 2: return x - y;
            default: return -x - y;
        }
    };
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
    return function noise(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = fade(x), v = fade(y), A = p[X] + Y, B = p[X + 1] + Y;
        return lerp(lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
            lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u), v);
    };
}
const noise2D = makePerlin(2025);

const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, TERRAIN_RES, TERRAIN_RES);
terrainGeo.rotateX(-Math.PI / 2);
const tPos = terrainGeo.attributes.position;
for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i), z = tPos.getZ(i);
    const h = noise2D(x * 0.02, z * 0.02) * 0.6 + noise2D(x * 0.05, z * 0.05) * 0.25 + noise2D(x * 0.1, z * 0.1) * 0.1;
    tPos.setY(i, h * TERRAIN_MAX_H);
}
tPos.needsUpdate = true;
terrainGeo.computeVertexNormals();
terrainGeo.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.uv.array), 2));

const texLoader = new THREE.TextureLoader();
function loadTex(path) {
    const tex = texLoader.load(path);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
    return tex;
}

const groundColor = loadTex('assets/textures/ground/ground_color.jpg');
const groundNormal = loadTex('assets/textures/ground/ground_normal.jpg');
const groundRough = loadTex('assets/textures/ground/ground_roughness.jpg');
const groundAO = loadTex('assets/textures/ground/ground_ao.jpg');

const terrainMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x3a2a1c),
    map: groundColor,
    normalMap: groundNormal,
    roughnessMap: groundRough,
    aoMap: groundAO,
    roughness: 1.0,
    metalness: 0.0
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

/** ========= RAYCAST / UTIL ========= */
const raycaster = new THREE.Raycaster();

function getTerrainHeight(x, z) {
    raycaster.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 200;
    const hit = raycaster.intersectObject(terrain, false)[0];
    return hit ? hit.point.y : 0;
}

function clampToWorld(v) {
    const r = Math.hypot(v.x, v.z);
    if (r > WORLD_RADIUS - PLAYER_RADIUS) {
        const ang = Math.atan2(v.z, v.x);
        const rr = WORLD_RADIUS - PLAYER_RADIUS;
        v.x = Math.cos(ang) * rr;
        v.z = Math.sin(ang) * rr;
    }
    return v;
}

/** ========= ÁRBOLES (colliders) ========= */
const treeColliders = [];
function addTree(x, z, scale = 1) {
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, 2.6 * scale, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2b1a, roughness: 1 })    );
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    const crowns = new THREE.Group();
    const levels = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < levels; i++) {
        const crown = new THREE.Mesh(
            new THREE.ConeGeometry((1.6 - i * 0.25) * scale, (2.2 - i * 0.25) * scale, 10),
            new THREE.MeshStandardMaterial({ color: 0x0f2d1c, roughness: 0.9 })
        );
        crown.castShadow = true;
        crown.position.y = (2.0 + i * 0.7) * scale;
        crowns.add(crown);
    }

    const y = getTerrainHeight(x, z);
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.add(trunk, crowns);
    scene.add(tree);

    treeColliders.push({ x, z, r: OBJ_TREE_R * scale });
}

for (let i = 0; i < TREE_COUNT; i++) {
    let x = (Math.random() - 0.5) * WORLD_SIZE, z = (Math.random() - 0.5) * WORLD_SIZE;
    if (Math.hypot(x - player.position.x, z - player.position.z) < 6) {
        const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 20;
        x = player.position.x + Math.cos(a) * r;
        z = player.position.z + Math.sin(a) * r;
    }
    addTree(x, z, 0.8 + Math.random() * 1.8);
}

/** ========= AUDIO ========= */
const listener = new THREE.AudioListener();
camera.add(listener);
const audioLoader = new THREE.AudioLoader();

let chimeBuffer = null;
let windBuffer = null;
audioLoader.load('assets/audio/chime.mp3', (buf) => chimeBuffer = buf);
audioLoader.load('assets/audio/wind.mp3', (buf) => windBuffer = buf);

let windSfx = null;
function startAmbientAudio() {
    const ctx = listener.context;
    if (ambientEl) {
        try {
            const srcNode = ctx.createMediaElementSource(ambientEl);
            srcNode.connect(listener.getInput());
            ambientEl.loop = true;
            ambientEl.volume = 0.4;
            ambientEl.play().catch(() => { });
        } catch { }
    }
    if (windBuffer && !windSfx) {
        windSfx = new THREE.Audio(listener);
        windSfx.setBuffer(windBuffer);
        windSfx.setLoop(true);
        windSfx.setVolume(0.28);
        windSfx.play();
    }
}

/** ========= ESPÍRITUS + PARTÍCULAS ========= */
const spirits = [];
const spiritColliders = [];
const particleSystems = [];

function spawnSpiritParticles(pos, type = 'yellow') {
    const COUNT = 180;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const baseColor = type === 'yellow' ? new THREE.Color(0xffdd44) : new THREE.Color(0x66bbff);

    for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3;
        positions[i3] = pos.x;
        positions[i3 + 1] = pos.y;
        positions[i3 + 2] = pos.z;

        const dir = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5)).normalize();
        const speed = 1.5 + Math.random() * 2.5;
        velocities[i3] = dir.x * speed;
        velocities[i3 + 1] = dir.y * speed;
        velocities[i3 + 2] = dir.z * speed;

        colors[i3] = baseColor.r;
        colors[i3 + 1] = baseColor.g;
        colors[i3 + 2] = baseColor.b;
        life[i] = 0.9 + Math.random() * 0.8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('life', new THREE.BufferAttribute(life, 1));

    const mat = new THREE.PointsMaterial({
        size: 0.09,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        fog: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points.userData = { age: 0, geo, mat };
    scene.add(points);
    particleSystems.push(points);
}

function updateParticles(dt) {
    for (let i = particleSystems.length - 1; i >= 0; i--) {
        const ps = particleSystems[i];
        ps.userData.age += dt;
        const geo = ps.userData.geo;
        const pos = geo.getAttribute('position');
        const vel = geo.getAttribute('velocity');
        const life = geo.getAttribute('life');
        const count = life.count;

        for (let j = 0; j < count; j++) {
            const idx = j * 3;
            vel.array[idx + 1] -= 7.5 * dt;
            pos.array[idx] += vel.array[idx] * dt;
            pos.array[idx + 1] += vel.array[idx + 1] * dt;
            pos.array[idx + 2] += vel.array[idx + 2] * dt;
        }
        pos.needsUpdate = true;

        const L = 2.2;
        const alpha = Math.max(0, 1.0 - (ps.userData.age / L));
        ps.userData.mat.opacity = alpha;

        if (ps.userData.age > L) {
            scene.remove(ps);
            ps.geometry.dispose();
            ps.material.dispose();
            particleSystems.splice(i, 1);
        }
    }
}

function addSpirit(x, z, type = 'yellow') {
    const y = getTerrainHeight(x, z) + 0.8 + Math.random() * 1.2;
    const color = type === 'yellow' ? 0xffdd44 : 0x66bbff;

    const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 1.0,
        roughness: 0.35,
        metalness: 0.0,
        transparent: true,
        opacity: 0.95
    });

    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), mat);
    orb.position.set(x, y, z);
    orb.castShadow = false;
    orb.receiveShadow = false;

    const glow = new THREE.PointLight(color, 0.9, 6, 2.0);
    glow.position.set(0, 0, 0);
    orb.add(glow);

    const floatPhase = Math.random() * Math.PI * 2;
    orb.userData = {
        type,
        collected: false,
        floatPhase,
        baseY: y,
        mat
    };

    scene.add(orb);
    spirits.push(orb);
    spiritColliders.push({ x, z, r: 0.45, idx: spirits.length - 1 });
}

// Inicializar espíritus
if (hudTotal) hudTotal.textContent = String(SPIRIT_COUNT);

for (let i = 0; i < SPIRIT_COUNT; i++) {
    const angle = (i / SPIRIT_COUNT) * Math.PI * 2 + Math.random() * 0.6;
    const radius = 6 + Math.random() * PUMPKIN_AREA;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const type = Math.random() < 0.72 ? 'yellow' : 'blue';
    addSpirit(x, z, type);
}

/** ========= VR: CONTROLADORES ========= */
const vrBtn = VRButton.createButton(renderer);
vrBtn.classList.add('vr-button');
document.body.appendChild(vrBtn);

const controllerLeft = renderer.xr.getController(0);
const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);

controllerLeft.visible = false;
controllerRight.visible = false;

const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0);
grip0.add(controllerModelFactory.createControllerModel(grip0));
scene.add(grip0);
const grip1 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
scene.add(grip1);

// Audio ambiente al entrar a VR
renderer.xr.addEventListener('sessionstart', async () => {
    try {
        if (ambientEl) {
            ambientEl.volume = 0.4;
            await ambientEl.play();
        }
    } catch (e) {
        console.warn('Audio bosque bloqueado:', e);
    }
    startAmbientAudio();
});

/** ========= LOCOMOCIÓN (stick) ========= */
function vrGamepadMove(dt) {
    if (!controlsEnabled) return;
    
    const session = renderer.xr.getSession();
    if (!session) return;
    
    for (const src of session.inputSources) {
        if (!src.gamepad) continue;
        let [x, y] = [src.gamepad.axes[2], src.gamepad.axes[3]];
        if (x === undefined || y === undefined) {
            x = src.gamepad.axes[0] ?? 0;
            y = src.gamepad.axes[1] ?? 0;
        }
        const dead = 0.12;
        if (Math.abs(x) < dead) x = 0;
        if (Math.abs(y) < dead) y = 0;
        if (x === 0 && y === 0) continue;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        let next = player.position.clone();
        next.addScaledVector(forward, -y * VR_WALK_SPEED * dt);
        next.addScaledVector(right, x * VR_STRAFE_SPEED * dt);

        next = clampToWorld(next);
        next.y = getTerrainHeight(next.x, next.z) + 1.6;
        next = resolveCollisions(player.position, next);
        player.position.copy(next);
    }
}

/** ========= COLISIONES ========= */
let hitCount = 0;

function resolveCollisions(curr, next) {
    // Árboles
    for (const t of treeColliders) {
        const dx = next.x - t.x, dz = next.z - t.z;
        const dist = Math.hypot(dx, dz);
        const minD = PLAYER_RADIUS + t.r;
        if (dist < minD) {
            const push = (minD - dist) + 1e-3;
            const nx = dx / (dist || 1), nz = dz / (dist || 1);
            next.x += nx * push;
            next.z += nz * push;
        }
    }

    // Espíritus
    for (const s of spiritColliders) {
        const dx = next.x - s.x, dz = next.z - s.z;
        const dist = Math.hypot(dx, dz);
        const minD = PLAYER_RADIUS + s.r;
        if (dist < minD) {
            const push = (minD - dist) + 1e-3;
            const nx = dx / (dist || 1), nz = dz / (dist || 1);
            next.x += nx * push;
            next.z += nz * push;

            const spirit = spirits[s.idx];
            if (spirit && !spirit.userData.collected) {
                spirit.userData.collected = true;

                // puntuación
                if (spirit.userData.type === 'yellow') {
                    hitCount += 5;
                } else {
                    hitCount -= 5;
                }
                
                if (hitCount < 0) hitCount = 0;
                score = hitCount;
                
                if (hudHit) hudHit.textContent = String(score);
                checkWin();

                // efecto visual y partículas
                spawnSpiritParticles(spirit.position.clone(), spirit.userData.type);

                // sonido
                if (chimeBuffer) {
                    const sfx = new THREE.Audio(listener);
                    sfx.setBuffer(chimeBuffer);
                    sfx.setLoop(false);
                    sfx.setVolume(0.85);
                    sfx.play();
                }

                // eliminar espíritu
                scene.remove(spirit);
            }
        }
    }
    return clampToWorld(next);
}

/** ========= CHECK WIN ========= */
function checkWin() {
    if (gameWon) return;

    if (score >= GOAL_SCORE) {
        gameWon = true;
        console.log("MISIÓN LOGRADA");
        
        if (winMessage) {
            winMessage.style.display = "grid";
        }
        
        controlsEnabled = false;
    }
}

/** ========= LOOP ========= */
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);

    if (renderer.xr.isPresenting && controlsEnabled) {
        vrGamepadMove(dt);
    }

    // Actualizar animación de espíritus (flotación)
    const t = performance.now() * 0.001;
    for (const spirit of spirits) {
        if (!spirit.userData.collected) {
            const floatY = Math.sin(t * 2 + spirit.userData.floatPhase) * 0.2;
            spirit.position.y = spirit.userData.baseY + floatY;
        }
    }

    updateParticles(dt);

    // Renderizar
    renderer.clear();
    renderer.render(scene, camera);
});

/** ========= RESIZE ========= */
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// Iniciar audio ambiente
startAmbientAudio();