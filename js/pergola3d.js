/* ═══════════════════════════════════════════════════════════════════
   Pergolam 3D — parametric viewer (Three.js r128, non-module build)
   -------------------------------------------------------------------
   window.PergolaViewer.create(containerEl) → viewer
     viewer.update(cfg)            rebuild the model from a configuration
     viewer.setLouverAngle(deg)    0 = closed … 110 = fully open (animated)
     viewer.setView('iso'|'front'|'side'|'top')
     viewer.fit()                  frame the whole model
     viewer.showDimensions(bool)   dimension lines + labels
     viewer.showLabels(bool)       part labels (add-ons, uprights, sides)
     viewer.flashPart(name)        pulse-highlight a part group
     viewer.on('pick', fn)         fn({ part, label }) when the user clicks a part

   World units are METERS (config values are millimeters).
   Frozen plan (Top of screen = A) — built so a *normal* Three.js camera
   matches it (no mirrored projection). Looking from C toward A, and
   looking down with up=+Z, screen-right is world −X, so:
        U4 ---- A ---- U3          +Z = A (far / top of plan)
        D              B           −Z = C (near / bottom of plan)
        U1 ---- C ---- U2          +X = D (plan-left)
                                   −X = B (plan-right)
                                   +Y = up
   Front = stand outside C (U1 left, U2 right). Side = stand outside B.
   Iso = from U1 (C∩D): U1 near-left, U2 near-right, A far.
   Motor Left = on D toward A (screen-left). Motor Right = on B toward A.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    var MM = 0.001;
    var GUT_H = 0.200;          // gutter (frame beam) height
    var GUT_W = 0.150;          // gutter width
    var POST = 0.150;           // upright section
    var LOUVER_PITCH = 0.235;   // from the ruleset: 235 mm
    var LOUVER_BLADE = 0.230;   // blade width
    var LOUVER_THICK = 0.032;
    var LOUVER_END_GAP = 0.222; // louver length = BayWidth - 222 mm
    var BW_DISPLAY_HEIGHT = 2600; // Between_Wall has no FreeHeight input; display height
    var ACCENT = 0x2563eb;

    var COLOR_HEX = { WHITE: '#F1F1EE', ANTHRACITE: '#3B3F45', BLACK: '#161719' };
    var LED_COLORS = { White: '#FFE9B8', RGB: '#7C3AED' };

    var PART_LABELS = {
        frame: 'Gutter frame', louvers: 'Louvers', uprights: 'Uprights', baseplates: 'Base plates',
        drains: 'Drains', motor: 'Motor & transmission bar', walls: 'Wall', lights: 'LED lights',
        addons: 'Add-ons', dims: 'Dimensions', ground: 'Ground'
    };

    function srgb(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

    function makeMat(hex, opts) {
        opts = opts || {};
        return new THREE.MeshStandardMaterial({
            color: srgb(hex),
            metalness: opts.metalness != null ? opts.metalness : 0.3,
            roughness: opts.roughness != null ? opts.roughness : 0.5,
            emissive: opts.emissive ? srgb(opts.emissive) : new THREE.Color(0x000000),
            emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 1,
            transparent: !!opts.transparent, opacity: opts.opacity != null ? opts.opacity : 1,
            side: opts.side || THREE.FrontSide
        });
    }

    // ── Text label sprites (canvas backed) ─────────────────────────
    function makeLabel(text, o) {
        o = o || {};
        var fontPx = o.fontPx || 30, pad = 18;
        var c = document.createElement('canvas'), ctx = c.getContext('2d');
        ctx.font = '600 ' + fontPx + 'px "DM Sans", "Segoe UI", Arial, sans-serif';
        var w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = fontPx + pad * 1.2;
        c.width = w; c.height = h;
        ctx.font = '600 ' + fontPx + 'px "DM Sans", "Segoe UI", Arial, sans-serif';
        ctx.textBaseline = 'middle';
        var r = h / 2;
        ctx.fillStyle = o.bg || 'rgba(37,99,235,0.95)';
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = o.color || '#fff';
        ctx.fillText(text, pad, h / 2 + 1);
        var tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter; tex.encoding = THREE.sRGBEncoding;
        var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
        var s = new THREE.Sprite(mat);
        var height = o.height || 0.26;
        s.scale.set(height * w / h, height, 1);
        s.renderOrder = 999;
        s.userData.isLabel = true;
        return s;
    }

    function create(container) {
        // ── Renderer / scene / camera ──────────────────────────────
        var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        container.appendChild(renderer.domElement);

        var scene = new THREE.Scene();
        var bg = srgb('#E8ECF2');
        scene.background = bg;
        scene.fog = new THREE.Fog(bg, 28, 70);

        // Orthographic (drawing-style). Zoom changes camera.zoom, not distance.
        var frustumSize = 10; // world-meters visible vertically at zoom = 1
        var camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
        camera.position.set(12, 8, 14);
        camera.zoom = 1;

        var controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI / 2;          // horizon = true front/side elevation
        controls.minPolarAngle = 0;                     // allow true top
        controls.minZoom = 0.15; controls.maxZoom = 12;
        controls.minDistance = 4; controls.maxDistance = 80;
        controls.target.set(0, 1.4, 0);

        // ── Lights ──────────────────────────────────────────────────
        scene.add(new THREE.HemisphereLight(srgb('#FFFFFF'), srgb('#B8C0CC'), 0.75));
        var key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(-6, 11, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 1; key.shadow.camera.far = 40;
        key.shadow.camera.left = -10; key.shadow.camera.right = 10;
        key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
        key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(7, 5, -7);
        scene.add(fill);

        // ── Ground ──────────────────────────────────────────────────
        var ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), makeMat('#D6DBE3', { metalness: 0, roughness: 1 }));
        ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.part = 'ground';
        scene.add(ground);
        var grid = new THREE.GridHelper(60, 60, srgb('#B9C1CC'), srgb('#CBD2DB'));
        grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.55;
        scene.add(grid);

        // ── State ───────────────────────────────────────────────────
        var root = null, dimsGroup = null, labelsGroup = null;
        var louverPivots = [], fans = [], anemometers = [], rgbMats = [];
        var partMats = {};                   // part name → [materials]
        var flashes = {};                    // part name → start time
        var louverTarget = 30, louverCurrent = 30;
        var showDims = true, showLabels = true;
        var listeners = { pick: [] };
        var lastCfg = null, lastDerived = null;

        function reg(part, mat) { (partMats[part] = partMats[part] || []).push(mat); }

        function box(w, h, d, mat, x, y, z, part) {
            var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            m.castShadow = true; m.receiveShadow = true;
            m.userData.part = part;
            return m;
        }
        function cyl(rTop, rBot, h, mat, x, y, z, part, seg) {
            var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 20), mat);
            m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; m.userData.part = part;
            return m;
        }
        // Ground-plane flow arrow (sales: which way water leaves the upright).
        function drainArrow(px, pz, vx, vz, mat) {
            var g = new THREE.Group();
            var y = 0.035, gap = POST / 2 + 0.03, shaftL = 0.20, headL = 0.11;
            var dir = new THREE.Vector3(vx, 0, vz).normalize();
            var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            var shaft = box(0.038, shaftL, 0.038, mat, 0, 0, 0, 'drains');
            shaft.position.set(px + dir.x * (gap + shaftL / 2), y, pz + dir.z * (gap + shaftL / 2));
            shaft.quaternion.copy(q);
            g.add(shaft);
            var head = new THREE.Mesh(new THREE.ConeGeometry(0.07, headL, 8), mat);
            head.position.set(px + dir.x * (gap + shaftL + headL / 2 - 0.01), y, pz + dir.z * (gap + shaftL + headL / 2 - 0.01));
            head.quaternion.copy(q);
            head.castShadow = true; head.receiveShadow = true; head.userData.part = 'drains';
            g.add(head);
            return g;
        }

        function disposeGroup(g) {
            if (!g) return;
            g.traverse(function (o) {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map) o.material.map.dispose();
                    o.material.dispose();
                }
            });
            scene.remove(g);
        }

        // ── Build ───────────────────────────────────────────────────
        function build(cfg, d) {
            disposeGroup(root); disposeGroup(dimsGroup); disposeGroup(labelsGroup);
            louverPivots = []; fans = []; anemometers = []; rgbMats = []; partMats = {};
            root = new THREE.Group(); dimsGroup = new THREE.Group(); labelsGroup = new THREE.Group();
            scene.add(root); scene.add(dimsGroup); scene.add(labelsGroup);

            var type = cfg.PGL_ConfigType;
            var W = cfg.Width_mm * MM, P = cfg.Projection_mm * MM;
            var H = (type === 'Between_Wall' ? BW_DISPLAY_HEIGHT : cfg.FreeHeight_mm) * MM;
            var frameY = H + GUT_H / 2, topY = H + GUT_H;
            var numBay = d.numBay, bayW = d.BayWidth_mm * MM;

            var frameMat = makeMat(COLOR_HEX[cfg.FrameColor] || COLOR_HEX.ANTHRACITE, { metalness: 0.35, roughness: 0.45 });
            var louverMat = makeMat(COLOR_HEX[cfg.LouverColor] || COLOR_HEX.ANTHRACITE, { metalness: 0.35, roughness: 0.42 });
            var plateMat = makeMat('#2A2D33', { metalness: 0.5, roughness: 0.5 });
            var darkMat = makeMat('#26282C', { metalness: 0.4, roughness: 0.6 });
            var wallMat = makeMat('#E3DED2', { metalness: 0, roughness: 0.95 });
            reg('frame', frameMat); reg('louvers', louverMat); reg('baseplates', plateMat); reg('walls', wallMat);

            // Plan-right B is world −X, plan-left D is world +X (normal camera).
            var xB = -W / 2, xD = W / 2;

            // ── Gutter frame: A (+Z), C (−Z), B (−X), D (+X)
            var frame = new THREE.Group(); frame.name = 'frame';
            frame.add(box(W, GUT_H, GUT_W, frameMat, 0, frameY, P / 2 - GUT_W / 2, 'frame'));           // A
            frame.add(box(W, GUT_H, GUT_W, frameMat, 0, frameY, -P / 2 + GUT_W / 2, 'frame'));          // C
            frame.add(box(GUT_W, GUT_H, P - 2 * GUT_W, frameMat, xB + GUT_W / 2, frameY, 0, 'frame')); // B
            frame.add(box(GUT_W, GUT_H, P - 2 * GUT_W, frameMat, xD - GUT_W / 2, frameY, 0, 'frame')); // D
            if (numBay === 2) frame.add(box(GUT_W, GUT_H, P - 2 * GUT_W, frameMat, 0, frameY, 0, 'frame')); // E/F central gutter
            // thin louver-support ledges along the inner faces so the frame reads as a channel
            var lipMat = makeMat('#1F2226', { metalness: 0.4, roughness: 0.6 }); reg('frame', lipMat);
            var ledgeY = topY - 0.09;
            frame.add(box(W - 2 * GUT_W, 0.02, 0.04, lipMat, 0, ledgeY, P / 2 - GUT_W - 0.02, 'frame'));
            frame.add(box(W - 2 * GUT_W, 0.02, 0.04, lipMat, 0, ledgeY, -P / 2 + GUT_W + 0.02, 'frame'));
            frame.add(box(0.04, 0.02, P - 2 * GUT_W, lipMat, xB + GUT_W + 0.02, ledgeY, 0, 'frame'));
            frame.add(box(0.04, 0.02, P - 2 * GUT_W, lipMat, xD - GUT_W - 0.02, ledgeY, 0, 'frame'));
            if (numBay === 2) { frame.add(box(0.04, 0.02, P - 2 * GUT_W, lipMat, GUT_W / 2 + 0.02, ledgeY, 0, 'frame')); frame.add(box(0.04, 0.02, P - 2 * GUT_W, lipMat, -GUT_W / 2 - 0.02, ledgeY, 0, 'frame')); }
            root.add(frame);

            // ── Uprights (plan): U1 = C·D, U2 = B·C, U3 = A·B, U4 = D·A
            var corners = {
                1: { x: xD - POST / 2, z: -P / 2 + POST / 2 },
                2: { x: xB + POST / 2, z: -P / 2 + POST / 2 },
                3: { x: xB + POST / 2, z: P / 2 - POST / 2 },
                4: { x: xD - POST / 2, z: P / 2 - POST / 2 }
            };
            var uprights = new THREE.Group(); uprights.name = 'uprights';
            var uprightPos = {};
            [1, 2, 3, 4].forEach(function (n) {
                if (!d['nUpright' + n + 'Visible']) return;
                var c = corners[n], px = c.x, pz = c.z;
                var axis = cfg['U' + n + '_Offset_Axis'], off = (cfg['U' + n + '_Offset_mm'] || 0) * MM;
                var offset = cfg.Upright_Style === 'OFF' && axis !== 'None' && off > 0;
                if (offset) {
                    if (axis === 'Width') px -= Math.sign(px) * off;
                    else pz -= Math.sign(pz) * off;
                }
                uprightPos[n] = { x: px, z: pz };
                uprights.add(box(POST, H, POST, frameMat, px, H / 2, pz, 'uprights'));
                if (offset) {   // offset weldment: arm from post top back to the frame corner, under the gutter
                    var armMat = frameMat;
                    if (axis === 'Width') {
                        var len = Math.abs(c.x - px) + POST;
                        uprights.add(box(len, 0.14, POST, armMat, (c.x + px) / 2 + Math.sign(c.x) * POST / 2, H - 0.07, pz, 'uprights'));
                    } else {
                        var lenZ = Math.abs(c.z - pz) + POST;
                        uprights.add(box(POST, 0.14, lenZ, armMat, px, H - 0.07, (c.z + pz) / 2 + Math.sign(c.z) * POST / 2, 'uprights'));
                    }
                }
                // base plate
                var bpType = cfg.BasePlate_Style === 'NS' ? cfg['BasePlateType' + n] : 'Central';
                var plates = new THREE.Group();
                if (bpType === 'Flush') {
                    plates.add(box(POST + 0.01, 0.006, POST + 0.01, plateMat, px, 0.003, pz, 'baseplates'));
                } else {
                    var sx = bpType === 'Corner' ? Math.sign(px) * 0.075 : 0;
                    var sz = bpType === 'Corner' ? Math.sign(pz) * 0.075 : 0;
                    plates.add(box(0.30, 0.012, 0.30, plateMat, px + sx, 0.006, pz + sz, 'baseplates'));
                    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
                        plates.add(cyl(0.012, 0.012, 0.022, darkMat, px + sx + s[0] * 0.115, 0.022, pz + sz + s[1] * 0.115, 'baseplates', 10));
                    });
                }
                uprights.add(plates);
                // Drain direction is from the person facing that end of the pergola:
                //   C-end (U1, U2): stand outside C looking toward A
                //   A-end (U3, U4): stand outside A looking toward C
                // Out / In = away from / into the structure along projection.
                // Left / Right = that observer's left / right (so they swap on the A end).
                var dir = cfg.Drain_Style === 'NS' ? cfg['DrainDirection' + n] : 'Out';
                var end = Math.sign(pz) || 1; // −1 = C end, +1 = A end
                var v = dir === 'In' ? [0, -end]
                    : dir === 'Left' ? [-end, 0]
                    : dir === 'Right' ? [end, 0]
                    : [0, end]; // Out
                var drainMat = makeMat('#2563EB', { metalness: 0.15, roughness: 0.45 }); reg('drains', drainMat);
                uprights.add(drainArrow(px, pz, v[0], v[1], drainMat));
                // upright LED strip on the inward face
                if (cfg.Light_Upright !== 'None' && type !== 'Between_Wall') {
                    var lm = ledMat(cfg.Light_Upright); reg('lights', lm);
                    uprights.add(box(0.02, H * 0.86, 0.035, lm, px - Math.sign(px) * (POST / 2 + 0.008), H * 0.5, pz, 'lights'));
                }
                if (showLabels) { var lb = makeLabel('U' + n, { height: 0.22, bg: 'rgba(31,41,55,0.9)' }); lb.position.set(px, -0.12, pz); labelsGroup.add(lb); }
            });
            root.add(uprights);

            // ── Walls (With_Post: attached side; Between_Wall: sides B and D)
            var walls = new THREE.Group(); walls.name = 'walls';
            var wallH = topY + 0.55, wallT = 0.18;
            function wall(side) {
                if (side === 'A') walls.add(box(W + 1.4, wallH, wallT, wallMat, 0, wallH / 2, P / 2 + wallT / 2, 'walls'));
                if (side === 'C') walls.add(box(W + 1.4, wallH, wallT, wallMat, 0, wallH / 2, -P / 2 - wallT / 2, 'walls'));
                if (side === 'B') walls.add(box(wallT, wallH, P + 1.4, wallMat, xB - wallT / 2, wallH / 2, 0, 'walls'));
                if (side === 'D') walls.add(box(wallT, wallH, P + 1.4, wallMat, xD + wallT / 2, wallH / 2, 0, 'walls'));
            }
            if (type === 'With_Post') wall(cfg.AttachSide);
            if (type === 'Between_Wall') { wall('B'); wall('D'); }
            root.add(walls);

            // ── Louvers (axis along X, arrayed along Z, pitch 235 mm)
            var louvers = new THREE.Group(); louvers.name = 'louvers';
            var n = d.LouverCount, pivotY = topY - 0.075;
            var span = LOUVER_PITCH * (n - 1);
            var z0 = -span / 2;
            var lightIdx = {};
            if (d.LightLouverCount > 0) {
                for (var k = 0; k < d.LightLouverCount; k++) lightIdx[Math.round((k + 0.5) * n / d.LightLouverCount - 0.5)] = true;
            }
            var louverLedMat = cfg.Light_Louver !== 'None' ? ledMat(cfg.Light_Louver) : null;
            if (louverLedMat) reg('lights', louverLedMat);
            for (var b = 0; b < numBay; b++) {
                var bayCx = numBay === 1 ? 0 : (b === 0 ? bayW / 2 : -bayW / 2);
                var len = bayW - LOUVER_END_GAP;
                for (var i = 0; i < n; i++) {
                    var pivot = new THREE.Group();
                    pivot.position.set(bayCx, pivotY, z0 + i * LOUVER_PITCH);
                    var blade = box(len, LOUVER_THICK, LOUVER_BLADE, louverMat, 0, 0, 0, 'louvers');
                    pivot.add(blade);
                    if (louverLedMat && lightIdx[i]) {
                        pivot.add(box(len * 0.96, 0.012, 0.05, louverLedMat, 0, -LOUVER_THICK / 2 - 0.006, 0, 'lights'));
                    }
                    louvers.add(pivot);
                    louverPivots.push(pivot);
                }
                // louver support rails along the bay edges (top of gutter B/D or central)
            }
            root.add(louvers);

            // ── Motor + transmission bar
            var motor = new THREE.Group(); motor.name = 'motor';
            var motorMat = makeMat('#1C1E22', { metalness: 0.5, roughness: 0.5 }); reg('motor', motorMat);
            var barMat = makeMat('#4A4E55', { metalness: 0.6, roughness: 0.4 }); reg('motor', barMat);
            var barLen = d.transBarLength_mm * MM;
            // Single bay: Left = gutter D (+X), Right = gutter B (−X). Housing sits
            // toward side A (+Z) so it reads at the top of the plan. Bar runs along Z.
            var motorZ = P / 2 - GUT_W - 0.22;
            if (numBay === 1) {
                var side = cfg.MotorLocation === 'Right' ? -1 : 1;
                var mx = side * (W / 2 - GUT_W / 2);
                motor.add(box(0.13, 0.13, 0.28, motorMat, mx, topY - 0.09, motorZ, 'motor'));
                motor.add(box(0.035, 0.03, barLen, barMat, mx - side * 0.04, pivotY - 0.07, 0, 'motor'));
            } else {
                motor.add(box(0.13, 0.13, 0.28, motorMat, 0, topY - 0.09, motorZ, 'motor'));
                motor.add(box(0.035, 0.03, barLen, barMat, GUT_W / 2 + 0.05, pivotY - 0.07, 0, 'motor'));
                motor.add(box(0.035, 0.03, barLen, barMat, -GUT_W / 2 - 0.05, pivotY - 0.07, 0, 'motor'));
            }
            root.add(motor);
            if (showLabels) { var ml = makeLabel('Motor: ' + d.MotorLocationEffective, { height: 0.22, bg: 'rgba(31,41,55,0.9)' }); ml.position.copy(motor.children[0].position).y += 0.35; labelsGroup.add(ml); }

            // ── Gutter LED strips (inner perimeter)
            if (cfg.Light_Gutter !== 'None') {
                var gl = ledMat(cfg.Light_Gutter); reg('lights', gl);
                var lg = new THREE.Group();
                var innerW = W - 2 * GUT_W, innerP = P - 2 * GUT_W, ly = H + 0.03;
                lg.add(box(innerW, 0.012, 0.03, gl, 0, ly, -P / 2 + GUT_W + 0.015, 'lights'));
                lg.add(box(innerW, 0.012, 0.03, gl, 0, ly, P / 2 - GUT_W - 0.015, 'lights'));
                lg.add(box(0.03, 0.012, innerP, gl, xB + GUT_W + 0.015, ly, 0, 'lights'));
                lg.add(box(0.03, 0.012, innerP, gl, xD - GUT_W - 0.015, ly, 0, 'lights'));
                if (numBay === 2) { lg.add(box(0.03, 0.012, innerP, gl, GUT_W / 2 + 0.015, ly, 0, 'lights')); lg.add(box(0.03, 0.012, innerP, gl, -GUT_W / 2 - 0.015, ly, 0, 'lights')); }
                root.add(lg);
            }

            // ── Add-ons
            var addons = new THREE.Group(); addons.name = 'addons';
            var addonMat = makeMat('#2B2E34', { metalness: 0.4, roughness: 0.55 }); reg('addons', addonMat);
            var accentMat = makeMat('#2563EB', { metalness: 0.2, roughness: 0.5 }); reg('addons', accentMat);
            function addLabel(text, x, y, z) { if (!showLabels) return; var l = makeLabel(text, { height: 0.22 }); l.position.set(x, y, z); labelsGroup.add(l); }
            if (cfg.FanBar) {
                for (var fb = 0; fb < numBay; fb++) {
                    var cx = numBay === 1 ? 0 : (fb === 0 ? bayW / 2 : -bayW / 2);
                    var by = topY - 0.36;
                    addons.add(box(bayW - 2 * GUT_W + 0.02, 0.05, 0.08, addonMat, cx, by, 0, 'addons'));
                    var fan = new THREE.Group(); fan.position.set(cx, by - 0.30, 0);
                    addons.add(cyl(0.014, 0.014, 0.26, addonMat, cx, by - 0.15, 0, 'addons', 10));
                    fan.add(cyl(0.085, 0.085, 0.07, addonMat, 0, 0, 0, 'addons'));
                    for (var bl = 0; bl < 3; bl++) {
                        var blade = box(0.52, 0.008, 0.11, addonMat, 0.30, -0.02, 0, 'addons');
                        var holder = new THREE.Group(); holder.rotation.y = bl * Math.PI * 2 / 3; holder.add(blade); fan.add(holder);
                    }
                    addons.add(fan); fans.push(fan);
                    addLabel('Fan Bar', cx, by - 0.62, 0);
                }
            }
            if (cfg.Sensor_Wind) {
                var wx = xB + GUT_W / 2, wz = -P / 2 + GUT_W / 2;   // corner U2 (B·C)
                addons.add(cyl(0.01, 0.012, 0.32, addonMat, wx, topY + 0.16, wz, 'addons', 10));
                var an = new THREE.Group(); an.position.set(wx, topY + 0.33, wz);
                for (var a = 0; a < 3; a++) {
                    var arm = new THREE.Group(); arm.rotation.y = a * Math.PI * 2 / 3;
                    arm.add(box(0.13, 0.006, 0.006, addonMat, 0.065, 0, 0, 'addons'));
                    var cup = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), accentMat); cup.position.set(0.13, 0, 0); cup.castShadow = true; cup.userData.part = 'addons'; arm.add(cup);
                    an.add(arm);
                }
                addons.add(an); anemometers.push(an);
                addLabel('Wind Sensor', wx, topY + 0.6, wz);
            }
            var gcZ = -P / 2 + GUT_W / 2;   // on top of gutter C
            if (cfg.Sensor_Rain) {
                addons.add(box(0.09, 0.05, 0.09, addonMat, -0.5, topY + 0.025, gcZ, 'addons'));
                addons.add(cyl(0.03, 0.03, 0.01, accentMat, -0.5, topY + 0.055, gcZ, 'addons', 14));
                addLabel('Rain Sensor', -0.5, topY + 0.32, gcZ);
            }
            if (cfg.Sensor_Snow) {
                addons.add(box(0.09, 0.05, 0.09, addonMat, 0.5, topY + 0.025, gcZ, 'addons'));
                addons.add(cyl(0.03, 0.03, 0.01, accentMat, 0.5, topY + 0.055, gcZ, 'addons', 14));
                addLabel('Snow Sensor', 0.5, topY + 0.32, gcZ);
            }
            if (cfg.DaisyBox) {
                var host = uprightPos[3] || uprightPos[2] || uprightPos[1] || uprightPos[4];
                if (host) {
                    addons.add(box(0.07, 0.20, 0.14, addonMat, host.x + Math.sign(host.x) * (POST / 2 + 0.035), 1.25, host.z, 'addons'));
                    addLabel('Daisy Box', host.x + Math.sign(host.x) * 0.3, 1.55, host.z);
                } else {   // Between_Wall: mount on wall D
                    addons.add(box(0.07, 0.20, 0.14, addonMat, xD - 0.035, 1.25, P / 2 - 0.4, 'addons'));
                    addLabel('Daisy Box', xD - 0.3, 1.55, P / 2 - 0.4);
                }
            }
            root.add(addons);

            // ── Side letters (A B C D) so the CPQ layout guide matches the model
            if (showLabels) {
                var sideBg = 'rgba(107,114,128,0.9)';
                var la = makeLabel('A', { height: 0.24, bg: sideBg }); la.position.set(0, topY + 0.12, P / 2 + 0.05); labelsGroup.add(la);
                var lc = makeLabel('C', { height: 0.24, bg: sideBg }); lc.position.set(0, topY + 0.12, -P / 2 - 0.05); labelsGroup.add(lc);
                var lbb = makeLabel('B', { height: 0.24, bg: sideBg }); lbb.position.set(xB - 0.05, topY + 0.12, 0); labelsGroup.add(lbb);
                var ld = makeLabel('D', { height: 0.24, bg: sideBg }); ld.position.set(xD + 0.05, topY + 0.12, 0); labelsGroup.add(ld);
            }

            // ── Dimension lines
            buildDims(cfg, d, W, P, H, type);
            dimsGroup.visible = showDims;
            labelsGroup.visible = showLabels;

            setLouverAngle(louverTarget, true);
        }

        function ledMat(kind) {
            var hex = LED_COLORS[kind] || LED_COLORS.White;
            var m = new THREE.MeshStandardMaterial({ color: srgb('#FFFFFF'), emissive: srgb(hex), emissiveIntensity: 1.6, metalness: 0, roughness: 0.4 });
            if (kind === 'RGB') rgbMats.push(m);
            return m;
        }

        function dimLine(a, b, offsetDir, text) {
            var mat = new THREE.LineBasicMaterial({ color: srgb('#2563EB'), depthTest: false, transparent: true, opacity: 0.95 });
            var pts = [a, b];
            var tick = offsetDir.clone().multiplyScalar(0.12);
            var g = new THREE.Group();
            g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
            g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a.clone().sub(tick), a.clone().add(tick)]), mat));
            g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([b.clone().sub(tick), b.clone().add(tick)]), mat));
            g.children.forEach(function (l) { l.renderOrder = 998; });
            var lbl = makeLabel(text, { height: 0.24 });
            lbl.position.copy(a).add(b).multiplyScalar(0.5).add(offsetDir.clone().multiplyScalar(0.22));
            g.add(lbl);
            return g;
        }

        function buildDims(cfg, d, W, P, H, type) {
            var y = 0.02, m = 0.55;
            var V = THREE.Vector3;
            dimsGroup.add(dimLine(new V(-W / 2, y, P / 2 + m), new V(W / 2, y, P / 2 + m), new V(0, 1, 0),
                'Width ' + cfg.Width_mm + ' mm  (' + d.widthFtIn + ')'));
            dimsGroup.add(dimLine(new V(W / 2 + m, y, -P / 2), new V(W / 2 + m, y, P / 2), new V(0, 1, 0),
                'Projection ' + cfg.Projection_mm + ' mm  (' + d.projectionFtIn + ')'));
            if (type !== 'Between_Wall') {
                dimsGroup.add(dimLine(new V(-W / 2 - m, 0, P / 2 + m), new V(-W / 2 - m, H, P / 2 + m), new V(-1, 0, 0),
                    'Free Height ' + cfg.FreeHeight_mm + ' mm  (' + d.freeHeightFtIn + ')'));
            }
            if (d.numBay === 2) {
                var lb = makeLabel('Double bay · 2 × ' + Math.round(d.BayWidth_mm) + ' mm', { height: 0.22, bg: 'rgba(217,119,6,0.95)' });
                lb.position.set(0, H + GUT_H + 0.45, 0); dimsGroup.add(lb);
            }
        }

        // ── Louvers ─────────────────────────────────────────────────
        function applyLouverAngle(deg) {
            var r = THREE.MathUtils.degToRad(deg);
            for (var i = 0; i < louverPivots.length; i++) louverPivots[i].rotation.x = -r;
        }
        function setLouverAngle(deg, immediate) {
            louverTarget = Math.max(0, Math.min(110, Number(deg) || 0));
            if (immediate) { louverCurrent = louverTarget; applyLouverAngle(louverCurrent); }
        }

        // ── Camera helpers ──────────────────────────────────────────
        // Bounds of the pergola itself (walls and labels excluded so the camera frames the product)
        function bounds() {
            var b = new THREE.Box3();
            if (root) root.children.forEach(function (g) { if (g.name !== 'walls') b.expandByObject(g); });
            if (b.isEmpty()) b.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 3, 2));
            return b;
        }
        // True elevations for Front/Side/Top (0° tilt). Iso stays a 3/4 view.
        // Front looks at C (−Z). Iso is from U1 (+X, −Z). Side looks at B (−X).
        var viewAngles = { iso: [145, 30], front: [180, 0], side: [270, 0], top: [0, 90] };
        function applyOrthoFrustum() {
            var w = container.clientWidth || 1, h = container.clientHeight || 1;
            var aspect = w / h;
            var halfW = frustumSize * aspect / 2;
            camera.left = -halfW;
            camera.right = halfW;
            camera.top = frustumSize / 2;
            camera.bottom = -frustumSize / 2;
            camera.updateProjectionMatrix();
        }
        function zoomToFit(sphere) {
            var w = container.clientWidth || 1, h = container.clientHeight || 1;
            var aspect = w / h;
            var pad = 1.18;
            var need = Math.max(0.5, sphere.radius * 2 * pad);
            camera.zoom = Math.min((frustumSize * aspect) / need, frustumSize / need);
            camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom));
        }
        function setView(name, keepDistance) {
            var ang = viewAngles[name] || viewAngles.iso;
            var b = bounds(), c = b.getCenter(new THREE.Vector3()), sph = b.getBoundingSphere(new THREE.Sphere());
            var dist = keepDistance ? camera.position.distanceTo(controls.target) : Math.max(12, sph.radius * 3.2);
            var az = THREE.MathUtils.degToRad(ang[0]), el = THREE.MathUtils.degToRad(ang[1]);
            controls.target.copy(c);
            // Plan: +Z (side A) is screen-up → A at top, clockwise A-B-C-D.
            // U1 is world C·D (lower-left). Motor sits on D or B, toward A (top).
            if (name === 'top') {
                camera.up.set(0, 0, 1);
                camera.position.set(c.x, c.y + dist, c.z);
            } else {
                camera.up.set(0, 1, 0);
                camera.position.set(c.x + dist * Math.sin(az) * Math.cos(el), c.y + dist * Math.sin(el), c.z + dist * Math.cos(az) * Math.cos(el));
            }
            camera.near = 0.1; camera.far = dist * 20 + 100;
            if (!keepDistance) zoomToFit(sph);
            applyOrthoFrustum();
            controls.update();
        }
        function fit() {
            var b = bounds(), c = b.getCenter(new THREE.Vector3()), sph = b.getBoundingSphere(new THREE.Sphere());
            var dir = camera.position.clone().sub(controls.target).normalize();
            if (dir.lengthSq() < 0.5) dir.set(0.6, 0.4, -0.7).normalize();
            var dist = Math.max(12, sph.radius * 3.2);
            controls.target.copy(c);
            camera.position.copy(c).add(dir.multiplyScalar(dist));
            zoomToFit(sph);
            applyOrthoFrustum();
            controls.update();
        }

        // ── Flash highlight ─────────────────────────────────────────
        function flashPart(name) {
            if (!partMats[name]) return;
            flashes[name] = performance.now();
        }
        var flashColor = srgb('#2563EB');
        function updateFlashes(now) {
            Object.keys(flashes).forEach(function (name) {
                var t = (now - flashes[name]) / 900;
                var mats = partMats[name] || [];
                if (t >= 1) {
                    mats.forEach(function (m) { if (m.userData._baseEm) { m.emissive.copy(m.userData._baseEm); m.emissiveIntensity = m.userData._baseEmI; delete m.userData._baseEm; } });
                    delete flashes[name]; return;
                }
                var k = (1 - t) * (0.5 + 0.5 * Math.sin(t * Math.PI * 4));
                mats.forEach(function (m) {
                    if (!m.userData._baseEm) { m.userData._baseEm = m.emissive.clone(); m.userData._baseEmI = m.emissiveIntensity; }
                    m.emissive.copy(m.userData._baseEm).lerp(flashColor, k);
                    m.emissiveIntensity = Math.max(m.userData._baseEmI, 0.9);
                });
            });
        }

        // ── Picking ─────────────────────────────────────────────────
        var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), downAt = null;
        renderer.domElement.addEventListener('pointerdown', function (e) { downAt = [e.clientX, e.clientY]; });
        renderer.domElement.addEventListener('pointerup', function (e) {
            if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !root) { downAt = null; return; }
            downAt = null;
            var r = renderer.domElement.getBoundingClientRect();
            ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(ndc, camera);
            var hits = ray.intersectObject(root, true).filter(function (h) { return !h.object.userData.isLabel; });
            if (!hits.length) return;
            var part = hits[0].object.userData.part || 'frame';
            flashPart(part);
            listeners.pick.forEach(function (fn) { fn({ part: part, label: PART_LABELS[part] || part, point: hits[0].point }); });
        });

        // ── Resize / loop ───────────────────────────────────────────
        function resize() {
            var w = container.clientWidth || 1, h = container.clientHeight || 1;
            renderer.setSize(w, h, false);
            applyOrthoFrustum();
        }
        if (window.ResizeObserver) new ResizeObserver(resize).observe(container); else window.addEventListener('resize', resize);
        resize();

        var clock = new THREE.Clock();
        function loop() {
            requestAnimationFrame(loop);
            var dt = Math.min(clock.getDelta(), 0.1), now = performance.now();
            if (Math.abs(louverCurrent - louverTarget) > 0.05) {
                louverCurrent += (louverTarget - louverCurrent) * Math.min(1, dt * 6);
                applyLouverAngle(louverCurrent);
            }
            fans.forEach(function (f) { f.rotation.y += dt * 4; });
            anemometers.forEach(function (a) { a.rotation.y += dt * 3; });
            if (rgbMats.length) {
                var hue = (now / 6000) % 1, c = new THREE.Color().setHSL(hue, 0.85, 0.55).convertSRGBToLinear();
                rgbMats.forEach(function (m) { m.emissive.copy(c); });
            }
            updateFlashes(now);
            controls.update();
            renderer.render(scene, camera);
        }
        loop();

        // ── Public API ──────────────────────────────────────────────
        var api = {
            update: function (cfg, derived, opts) {
                var first = !lastCfg;
                lastCfg = cfg; lastDerived = derived;
                build(cfg, derived);
                if (first && !(opts && opts.keepCamera)) setView('iso');
                return api;
            },
            setLouverAngle: function (deg) { setLouverAngle(deg, false); return api; },
            getLouverAngle: function () { return louverTarget; },
            setView: function (name) { setView(name, false); return api; },
            fit: fit,
            showDimensions: function (b) { showDims = !!b; if (dimsGroup) dimsGroup.visible = showDims; return api; },
            showLabels: function (b) { showLabels = !!b; if (labelsGroup) labelsGroup.visible = showLabels; if (lastCfg) build(lastCfg, lastDerived); return api; },
            flashPart: flashPart,
            on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return api; },
            screenshot: function () { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
            // Camera persistence (so a page reload driven by CPQ keeps the user's point of view)
            getCameraState: function () { return { p: camera.position.toArray(), t: controls.target.toArray(), z: camera.zoom, louver: louverTarget }; },
            setCameraState: function (s) {
                if (!s || !s.p || !s.t) return false;
                camera.position.fromArray(s.p); controls.target.fromArray(s.t);
                if (s.z) camera.zoom = s.z;
                applyOrthoFrustum();
                controls.update();
                if (s.louver != null) setLouverAngle(s.louver, true);
                return true;
            },
            onCameraChange: function (fn) { controls.addEventListener('change', fn); return api; },
            PART_LABELS: PART_LABELS,
            _three: { scene: scene, camera: camera, renderer: renderer, controls: controls }
        };
        return api;
    }

    global.PergolaViewer = { create: create };
})(window);
