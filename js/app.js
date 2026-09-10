/* ═══════════════════════════════════════════════════════════════════
   Pergolam 3D — UI wiring
   Builds the configurator panel from PergolaConfig.SCHEMA, keeps the 3D
   model in sync, and shows the exact parameter object the model receives.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var C = window.PergolaConfig, V = window.PergolaViewer, M = window.Messenger;

    // CPQ page captions, in the order the configurator shows them
    var PAGES = [
        { id: 'Project', title: 'Project Name', icon: 'fa-folder-open' },
        { id: 'Configuration', title: 'Pergolam Configuration', icon: 'fa-shapes' },
        { id: 'Dimensions', title: 'Dimensions and Motor Location', icon: 'fa-ruler-combined' },
        { id: 'Colors', title: 'Frame and Louver Colors', icon: 'fa-palette' },
        { id: 'Uprights', title: 'Upright Options', icon: 'fa-grip-lines-vertical', visibleWhen: function (c) { return c.PGL_ConfigType !== 'Between_Wall'; } },
        { id: 'Lights', title: 'Lighting Options', icon: 'fa-lightbulb' },
        { id: 'AddOns', title: 'Add Ons', icon: 'fa-puzzle-piece' }
    ];

    // Which 3D part lights up when a field changes
    var FIELD_PART = {
        PGL_ConfigType: 'uprights', AttachSide: 'walls', Width_mm: 'frame', Projection_mm: 'frame', FreeHeight_mm: 'uprights',
        MotorLocation: 'motor', FrameColor: 'frame', LouverColor: 'louvers', Upright_Style: 'uprights',
        BasePlate_Style: 'baseplates', Drain_Style: 'drains', Light_Gutter: 'lights', Light_Louver: 'lights', Light_Upright: 'lights',
        FanBar: 'addons', Sensor_Wind: 'addons', Sensor_Rain: 'addons', Sensor_Snow: 'addons', DaisyBox: 'addons'
    };
    // Which panel page a 3D part belongs to (for click-to-locate)
    var PART_PAGE = { frame: 'Dimensions', louvers: 'Colors', uprights: 'Uprights', baseplates: 'Uprights', drains: 'Uprights', motor: 'Dimensions', walls: 'Configuration', lights: 'Lights', addons: 'AddOns' };

    var cfg, derived, viewer, source = 'Demo panel';
    var $ = function (id) { return document.getElementById(id); };

    // Session persistence. CPQ drives the page by reloading it with a new query string on every
    // change, so we keep the camera, the louver angle and the previous config across reloads.
    var STORE_CFG = 'pergola3d.cfg', STORE_CAM = 'pergola3d.camera';
    function loadJSON(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function saveJSON(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

    // ── Toast ───────────────────────────────────────────────────────
    var toastTimer;
    function toast(msg, kind) {
        var t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
        clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
    }

    // ── Panel rendering ─────────────────────────────────────────────
    function renderPanel() {
        var host = $('panel'); host.innerHTML = '';
        PAGES.forEach(function (p, idx) {
            var sec = document.createElement('section'); sec.className = 'page'; sec.id = 'page-' + p.id;
            sec.innerHTML = '<header class="page-head"><span class="page-num">' + (idx + 1) + '</span><i class="fa-solid ' + p.icon + '"></i><h3>' + p.title + '</h3><i class="fa-solid fa-chevron-down chev"></i></header><div class="page-body"></div>';
            sec.querySelector('.page-head').addEventListener('click', function () { sec.classList.toggle('collapsed'); });
            var body = sec.querySelector('.page-body');
            C.SCHEMA.filter(function (f) { return f.page === p.id; }).forEach(function (f) { body.appendChild(renderField(f)); });
            if (p.id === 'Dimensions') {
                var note = document.createElement('div'); note.className = 'field note-field'; note.id = 'motor-double-note';
                note.innerHTML = '<label>Motor Location</label><div class="static-value"><i class="fa-solid fa-circle-info"></i> Central (Double Bay) — automatic when Width &gt; 4500 mm</div>';
                body.appendChild(note);
                var warn = document.createElement('div'); warn.className = 'banner warn'; warn.id = 'eng-review';
                warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><div><strong>ENGINEERING REVIEW REQUIRED</strong><br>With Post Double Bay configuration. Drain options require Engineering review before this quote is submitted.</div>';
                body.appendChild(warn);
            }
            host.appendChild(sec);
        });
    }

    function renderField(f) {
        var wrap = document.createElement('div'); wrap.className = 'field'; wrap.dataset.key = f.key;
        if (f.group) wrap.classList.add('sub');
        var lbl = document.createElement('label'); lbl.textContent = f.label; lbl.htmlFor = 'f-' + f.key; wrap.appendChild(lbl);
        var ctl;
        switch (f.type) {
            case 'text': case 'number':
                ctl = document.createElement('input'); ctl.type = f.type; ctl.id = 'f-' + f.key;
                if (f.type === 'number') { ctl.min = f.min; ctl.max = f.max; ctl.step = f.step || 1; }
                ctl.addEventListener('change', function () { setValue(f.key, ctl.value); });
                ctl.addEventListener('keydown', function (e) { if (e.key === 'Enter') ctl.blur(); });
                wrap.appendChild(ctl);
                if (f.hint) { var h = document.createElement('div'); h.className = 'hint'; h.textContent = f.hint; wrap.appendChild(h); }
                break;
            case 'textarea':
                ctl = document.createElement('textarea'); ctl.id = 'f-' + f.key; ctl.rows = 2;
                ctl.addEventListener('change', function () { setValue(f.key, ctl.value); });
                wrap.appendChild(ctl); break;
            case 'radio':
                ctl = document.createElement('div'); ctl.className = 'seg'; ctl.id = 'f-' + f.key;
                f.options.forEach(function (o) {
                    var b = document.createElement('button'); b.type = 'button'; b.className = 'seg-btn'; b.dataset.value = o.value; b.textContent = o.label;
                    if (o.hint) b.title = o.hint;
                    b.addEventListener('click', function () { setValue(f.key, o.value); });
                    ctl.appendChild(b);
                });
                wrap.appendChild(ctl); break;
            case 'swatch':
                ctl = document.createElement('div'); ctl.className = 'swatches'; ctl.id = 'f-' + f.key;
                f.options.forEach(function (o) {
                    var b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.value = o.value; b.title = o.label;
                    b.innerHTML = '<span class="dot" style="background:' + o.hex + '"></span><span>' + o.label + '</span>';
                    b.addEventListener('click', function () { setValue(f.key, o.value); });
                    ctl.appendChild(b);
                });
                wrap.appendChild(ctl); break;
            case 'select':
                ctl = document.createElement('select'); ctl.id = 'f-' + f.key;
                f.options.forEach(function (o) { var op = document.createElement('option'); op.value = o.value; op.textContent = o.label; ctl.appendChild(op); });
                ctl.addEventListener('change', function () { setValue(f.key, ctl.value); });
                wrap.appendChild(ctl); break;
            case 'bool':
                wrap.classList.add('field-switch');
                ctl = document.createElement('label'); ctl.className = 'switch';
                var inp = document.createElement('input'); inp.type = 'checkbox'; inp.id = 'f-' + f.key;
                inp.addEventListener('change', function () { setValue(f.key, inp.checked); });
                ctl.appendChild(inp); var sl = document.createElement('span'); sl.className = 'slider'; ctl.appendChild(sl);
                wrap.appendChild(ctl); break;
        }
        return wrap;
    }

    // Push cfg values into the controls and apply CPQ visibility rules
    function syncPanel() {
        C.SCHEMA.forEach(function (f) {
            var wrap = document.querySelector('.field[data-key="' + f.key + '"]'); if (!wrap) return;
            var v = cfg[f.key];
            switch (f.type) {
                case 'text': case 'number': case 'textarea': case 'select': $('f-' + f.key).value = v; break;
                case 'bool': $('f-' + f.key).checked = !!v; break;
                case 'radio': case 'swatch':
                    wrap.querySelectorAll('[data-value]').forEach(function (b) { b.classList.toggle('active', b.dataset.value === v); }); break;
            }
            var vis = f.visibleWhen ? f.visibleWhen(cfg) : true;
            if (f.upright) {
                vis = vis && derived['nUpright' + f.upright + 'Visible'];
                if (f.group === 'offset') vis = vis && cfg.Upright_Style === 'OFF';
                if (f.group === 'baseplate') vis = vis && cfg.BasePlate_Style === 'NS';
                if (f.group === 'drain') vis = vis && cfg.Drain_Style === 'NS';
                if (f.key.indexOf('_Offset_mm') > 0) vis = vis && cfg[f.key.replace('_mm', '_Axis')] !== 'None';
            }
            wrap.hidden = !vis;
        });
        PAGES.forEach(function (p) { var sec = $('page-' + p.id); if (sec) sec.hidden = p.visibleWhen ? !p.visibleWhen(cfg) : false; });
        $('motor-double-note').hidden = derived.numBay !== 2;
        $('eng-review').hidden = !derived.engineeringReview;
        // offset mm label mirrors CPQ: CONCAT("Offset along ", axis, " in mm")
        [1, 2, 3, 4].forEach(function (n) {
            var w = document.querySelector('.field[data-key="U' + n + '_Offset_mm"] label');
            if (w) w.textContent = 'Offset along ' + cfg['U' + n + '_Offset_Axis'] + ' in mm';
        });
    }

    // ── State changes ───────────────────────────────────────────────
    function setValue(key, value, opts) {
        opts = opts || {};
        var next = Object.assign({}, cfg); next[key] = value;
        applyConfig(next, opts.source || 'Demo panel', key);
    }

    function partForKey(key) {
        if (FIELD_PART[key]) return FIELD_PART[key];
        if (/^U\d_|^BasePlateType|^DrainDirection/.test(key)) return /BasePlate/.test(key) ? 'baseplates' : /Drain/.test(key) ? 'drains' : 'uprights';
        return null;
    }

    function applyConfig(raw, src, changedKey, opts) {
        cfg = C.normalize(raw); derived = C.derive(cfg); source = src || source;
        viewer.update(cfg, derived, opts);
        syncPanel(); renderParams();
        saveJSON(STORE_CFG, cfg);
        var part = changedKey && partForKey(changedKey);
        if (part) viewer.flashPart(part);
        try { history.replaceState(null, '', location.pathname + C.toQueryString(cfg)); } catch (e) { /* file:// */ }
    }

    // Highlight what changed between the previous session config and the one that just arrived
    function flashDiff(prev, next) {
        if (!prev) return [];
        var changed = C.SCHEMA.filter(function (f) { return String(prev[f.key]) !== String(next[f.key]); });
        var parts = {};
        changed.forEach(function (f) { var p = partForKey(f.key); if (p) parts[p] = true; });
        Object.keys(parts).forEach(function (p) { viewer.flashPart(p); });
        return changed;
    }

    // ── Parameters drawer ───────────────────────────────────────────
    function renderParams() {
        $('source-pill').textContent = 'Source: ' + source;
        $('json-config').textContent = JSON.stringify(cfg, null, 2);
        var d = {};
        Object.keys(derived).forEach(function (k) { if (!/FtIn$/.test(k)) d[k] = derived[k]; });
        $('json-derived').textContent = JSON.stringify(d, null, 2);
        var s = $('summary');
        s.innerHTML = '';
        [
            ['Configuration', C.BY_KEY.PGL_ConfigType.options.filter(function (o) { return o.value === cfg.PGL_ConfigType; })[0].label + (cfg.PGL_ConfigType === 'With_Post' ? ' · side ' + cfg.AttachSide : '')],
            ['Bays', derived.bays + (derived.numBay === 2 ? ' (2 × ' + Math.round(derived.BayWidth_mm) + ' mm)' : '')],
            ['Size', cfg.Width_mm + ' × ' + cfg.Projection_mm + ' mm'],
            ['Free height', cfg.PGL_ConfigType === 'Between_Wall' ? 'n/a' : cfg.FreeHeight_mm + ' mm (' + derived.freeHeightFtIn + ')'],
            ['Louvers', derived.LouverCount + ' per bay · ' + derived.LouverLength_mm + ' mm' + (derived.LightLouverCount ? ' · ' + derived.LightLouverCount + ' lighted' : '')],
            ['Motor', derived.MotorLocationEffective],
            ['Colors', 'Frame ' + cfg.FrameColor + ' · Louver ' + cfg.LouverColor],
            ['Uprights', derived.numUprights ? derived.numUprights + ' · ' + (cfg.Upright_Style === 'OFF' ? 'Offset' : 'Standard') + ' · plates ' + (cfg.BasePlate_Style === 'NS' ? 'Non-Std' : 'Std') + ' · drains ' + (cfg.Drain_Style === 'NS' ? 'Non-Std' : 'Std') : 'none'],
            ['Lights', 'Gutter ' + cfg.Light_Gutter + ' · Louver ' + cfg.Light_Louver + ' · Upright ' + cfg.Light_Upright],
            ['Add-ons', ['FanBar', 'Sensor_Wind', 'Sensor_Rain', 'Sensor_Snow', 'DaisyBox'].filter(function (k) { return cfg[k]; }).map(function (k) { return C.BY_KEY[k].label; }).join(', ') || 'none']
        ].forEach(function (row) {
            var li = document.createElement('li'); li.innerHTML = '<span>' + row[0] + '</span><strong>' + row[1] + '</strong>'; s.appendChild(li);
        });
    }

    function copy(text, label) {
        var done = function () { toast(label + ' copied to clipboard', 'ok'); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
        else fallback();
        function fallback() {
            var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'err'); }
            document.body.removeChild(ta);
        }
    }

    // ── Boot ────────────────────────────────────────────────────────
    function boot() {
        renderPanel();
        viewer = V.create($('viewport'));
        viewer.on('pick', function (e) {
            var page = PART_PAGE[e.part];
            toast(e.label + (page ? '  →  ' + PAGES.filter(function (p) { return p.id === page; })[0].title : ''));
            if (page) {
                var sec = $('page-' + page); if (!sec || sec.hidden) return;
                sec.classList.remove('collapsed');
                sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                sec.classList.add('pulse'); setTimeout(function () { sec.classList.remove('pulse'); }, 1200);
            }
        });

        // ?debug=1 opens the Parameters drawer; remembered for the session because CPQ reloads without it
        var debug = /[?&#]debug=1/.test(location.href) || loadJSON('pergola3d.debug') === true;
        if (/[?&#]debug=0/.test(location.href)) debug = false;
        saveJSON('pergola3d.debug', debug);
        var prevCfg = loadJSON(STORE_CFG), savedCam = loadJSON(STORE_CAM);
        // CPQ "Set External Application" appends its UrlParameters to the URL; accept them in the
        // query string and also after a '#' (some hosts use a trailing # in the base URL).
        var fromUrl = C.fromQueryString(location.search);
        var fromHash = C.fromQueryString(location.hash.replace(/^#\/?\??/, '?'));
        if (fromHash) fromUrl = Object.assign({}, fromUrl || {}, fromHash);
        applyConfig(fromUrl || {}, fromUrl ? 'URL parameters' : 'Demo panel', null, { keepCamera: !!savedCam });

        // Viewer toolbar
        document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { viewer.setView(b.dataset.view); }); });
        $('btn-fit').addEventListener('click', function () { viewer.fit(); });
        var slider = $('louver-angle'), angleLbl = $('louver-angle-val');
        function setAngle(v) { slider.value = v; angleLbl.textContent = v + '°'; viewer.setLouverAngle(v); saveCamera(); }
        slider.addEventListener('input', function () { setAngle(Number(slider.value)); });
        $('btn-louver-close').addEventListener('click', function () { setAngle(0); });
        $('btn-louver-open').addEventListener('click', function () { setAngle(90); });

        // Restore point of view from the previous load (CPQ reloads the page on every change)
        var camTimer;
        function saveCamera() { clearTimeout(camTimer); camTimer = setTimeout(function () { saveJSON(STORE_CAM, viewer.getCameraState()); }, 250); }
        if (savedCam && viewer.setCameraState(savedCam)) {
            slider.value = viewer.getLouverAngle(); angleLbl.textContent = Math.round(viewer.getLouverAngle()) + '°';
        } else {
            setAngle(30);
        }
        viewer.onCameraChange(saveCamera);
        window.addEventListener('pagehide', function () { saveJSON(STORE_CAM, viewer.getCameraState()); });

        if (fromUrl) {
            var changed = flashDiff(prevCfg, cfg);
            if (changed.length) toast('Updated from URL: ' + changed.slice(0, 3).map(function (f) { return f.label; }).join(', ') + (changed.length > 3 ? ' +' + (changed.length - 3) : ''), 'ok');
        }
        $('chk-dims').addEventListener('change', function (e) { viewer.showDimensions(e.target.checked); });
        $('chk-labels').addEventListener('change', function (e) { viewer.showLabels(e.target.checked); });
        $('btn-shot').addEventListener('click', function () {
            var a = document.createElement('a'); a.href = viewer.screenshot(); a.download = (cfg.PGL_ProjectName || 'pergolam').replace(/[^\w\-]+/g, '_') + '.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        });
        $('btn-reset').addEventListener('click', function () { applyConfig({}, 'Demo panel'); toast('Defaults restored'); });

        // Drawer
        $('btn-params').addEventListener('click', function () { document.body.classList.toggle('drawer-open'); });
        $('btn-drawer-close').addEventListener('click', function () { document.body.classList.remove('drawer-open'); });
        $('btn-sidebar').addEventListener('click', function () { document.body.classList.toggle('sidebar-hidden'); });
        $('btn-copy-json').addEventListener('click', function () { copy(JSON.stringify(cfg, null, 2), 'JSON'); });
        $('btn-copy-url').addEventListener('click', function () { copy(location.origin + location.pathname + C.toQueryString(cfg), 'URL'); });
        $('btn-simulate').addEventListener('click', function () {
            // Feed a CPQ-style message into this page so the channel can be demoed without CPQ
            var sample = { command: 'SetConfiguration', config: { PGL_ConfigType: 'With_Post', AttachSide: 'C', Width_mm: 5200, Projection_mm: 4000, FreeHeight_mm: 2700, FrameColor: 'WHITE', LouverColor: 'ANTHRACITE', Light_Louver: 'RGB', Light_Gutter: 'White', FanBar: true, Sensor_Wind: true, PGL_ProjectName: 'CPQ message demo' } };
            M.simulateIncoming(sample);
        });
        $('btn-send-cpq').addEventListener('click', function () {
            M.updateScreenOption(M.state.screenOptionId, JSON.stringify(cfg));
            toast(M.state.embedded ? 'Configuration sent to CPQ (setScreenOption)' : 'Not embedded in CPQ — message posted to parent anyway', M.state.embedded ? 'ok' : '');
        });

        // CPQ bridge
        M.on('config', function (partial, raw) {
            var next = C.normalize(Object.assign({}, cfg, partial));
            var changedKeys = C.SCHEMA.filter(function (f) { return String(next[f.key]) !== String(cfg[f.key]); });
            var src = raw && raw.command === 'InitializeCommand' ? 'CPQ InitializeCommand' : 'CPQ message';
            if (!changedKeys.length) { source = src; renderParams(); return; }     // same values: nothing to rebuild
            var before = cfg;
            applyConfig(next, src);
            flashDiff(before, cfg);
            toast('Updated from CPQ: ' + changedKeys.slice(0, 3).map(function (f) { return f.label; }).join(', ') + (changedKeys.length > 3 ? ' +' + (changedKeys.length - 3) : ''), 'ok');
        });
        function renderCpqInfo(o) {
            var s = M.state;
            $('cpq-info').textContent = 'screenOptionId: ' + (s.screenOptionId || '—') + ' · order: ' + (s.orderNumber || '—') +
                (s.polling ? ' · polls: ' + s.polls + ' · replies: ' + s.replies + ' (+' + s.duplicates + ' identical) · last: ' + (s.lastReplyAt || '—') : '');
        }
        M.on('init', renderCpqInfo);

        // Diagnostics log (messages in/out, survives CPQ-driven reloads)
        var inCount = 0;
        function renderLog() {
            var ul = $('msglog'), entries = M.log(); ul.innerHTML = '';
            if (!entries.length) { ul.innerHTML = '<li class="empty">No messages yet.</li>'; return; }
            entries.slice(-40).forEach(function (e) {
                var li = document.createElement('li');
                var body = e.data == null ? '' : (typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
                if (body.length > 600) body = body.slice(0, 600) + ' …';
                li.innerHTML = '<span class="t">' + e.t + '</span><span class="dir dir-' + e.dir + '">' + e.dir.toUpperCase() + '</span>' + (e.note ? '<strong>' + e.note.replace(/</g, '&lt;') + '</strong> ' : '') + body.replace(/</g, '&lt;');
                ul.appendChild(li);
            });
            ul.scrollTop = ul.scrollHeight;
        }
        M.on('log', function (entry) {
            renderCpqInfo();
            if (!entry) return;                       // duplicate reply: counters only
            renderLog();
            if (entry.dir === 'in') {
                inCount++;
                var b = $('btn-params').querySelector('.badge');
                if (!b) { b = document.createElement('span'); b.className = 'badge'; $('btn-params').appendChild(b); }
                b.textContent = inCount;
            }
            if (entry.dir === 'info' && M.state.embedded) toast('Message received from host, but it carries no configurator attributes', '');
        });
        renderLog();
        $('btn-copy-log').addEventListener('click', function () { copy(JSON.stringify({ href: location.href, referrer: document.referrer, embedded: M.state.embedded, log: M.log() }, null, 2), 'Diagnostics log'); });
        $('btn-clear-log').addEventListener('click', function () { M.clearLog(); renderLog(); });
        if (debug) document.body.classList.add('drawer-open');
        $('embed-pill').textContent = M.state.embedded ? 'Embedded (iframe)' : 'Standalone';
        M.initializeApplication();
        if (M.state.embedded) {
            M.displayExternalAppPane();   // same as ABPointsUI: ask CPQ to show this pane
            // Inside CPQ the values come from the host: hide the demo panel unless ?panel=1 (☰ shows it again)
            if (!/[?&#]panel=1/.test(location.href)) document.body.classList.add('sidebar-hidden');
            // Poll the host for current values every N ms (?poll=0 disables, ?poll=5000 changes the interval)
            var pm = /[?&#]poll=(\d+)/.exec(location.href), pollMs = pm ? Number(pm[1]) : (loadJSON('pergola3d.poll') != null ? loadJSON('pergola3d.poll') : 4000);
            saveJSON('pergola3d.poll', pollMs);
            if (pollMs > 0) M.startPolling(Math.max(1000, pollMs));
        }
        renderCpqInfo();

        // Console / integration access:  PergolaApp.set({ Width_mm: 5000 })  ·  PergolaApp.get()
        window.PergolaApp = {
            viewer: viewer,
            get: function () { return Object.assign({}, cfg); },
            derived: function () { return Object.assign({}, derived); },
            set: function (partial, src) { applyConfig(Object.assign({}, cfg, partial || {}), src || 'API'); return window.PergolaApp.get(); }
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
