/* ═══════════════════════════════════════════════════════════════════
   Pergolam 3D — Configuration contract
   -------------------------------------------------------------------
   This file is the single source of truth for WHAT the 3D model needs.
   Every key uses the exact attribute name from the Infor CPQ ruleset
   "Anchor.PERGOLAS_Pergolam" so the mapping CPQ → 3D is 1 : 1.

   Exposed as window.PergolaConfig:
     .SCHEMA          field definitions (type, options, ranges, CPQ page)
     .defaults()      a complete default configuration object
     .normalize(obj)  coerce/validate a partial object into a full config
     .derive(cfg)     values CPQ computes itself (bays, louver count, uprights…)
     .fromQueryString(search)   read config from ?Width_mm=4000&...
     .toQueryString(cfg)        build ?... from a config
     .fromMessage(data)         extract a config from a postMessage payload
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    // Values below come from the ruleset. Where the ruleset only references an
    // option list by ID (the option list itself is not in the XML export), the
    // value set is our best reading of the rules and is marked ASSUMED.
    var COLORS = [
        { value: 'WHITE', label: 'White', hex: '#F1F1EE' },
        { value: 'ANTHRACITE', label: 'Anthracite', hex: '#3B3F45' },
        { value: 'BLACK', label: 'Black', hex: '#161719' }
    ];
    var LIGHT_OPTIONS = [                       // PGL_GutterLight / PGL_LouverLight / PGL_UprightLight
        { value: 'None', label: 'None' },
        { value: 'White', label: 'White' },     // rule: IF(Light_Upright.Value="White", 73, 111)
        { value: 'RGB', label: 'RGB' }          // ASSUMED second paid option
    ];
    var OFFSET_AXES = [                         // PGL_OffsetAxis — rule only tests != "None"
        { value: 'None', label: 'None' },
        { value: 'Width', label: 'Width' },         // ASSUMED
        { value: 'Projection', label: 'Projection' } // ASSUMED
    ];
    var BASEPLATE_TYPES = [                     // PGL_Baseplate_Type — from CENTRAL/FLUSH/CORNER rules
        { value: 'Central', label: 'Central' },
        { value: 'Flush', label: 'Flush' },
        { value: 'Corner', label: 'Corner' }
    ];
    var DRAIN_DIRECTIONS = [                    // PGL_DrainDirection_U1..U4 — default "Out"
        { value: 'Out', label: 'Out' },
        { value: 'In', label: 'In' },           // ASSUMED
        { value: 'Left', label: 'Left' },       // ASSUMED
        { value: 'Right', label: 'Right' }      // ASSUMED
    ];

    var SCHEMA = [
        // ── Page 1: Project ──────────────────────────────────────────
        { key: 'PGL_ProjectName', page: 'Project', type: 'text', label: 'Project Name', default: 'Demo Pergola' },

        // ── Page 1: Pergolam Configuration ───────────────────────────
        { key: 'PGL_ConfigType', page: 'Configuration', type: 'radio', label: 'Pergolam Configuration', default: 'Gazebo',
          options: [
              { value: 'Between_Wall', label: 'Between Wall', hint: 'No uprights. Frame fixed to walls on both sides.' },
              { value: 'With_Post', label: 'With Post', hint: 'One side fixed to a wall, 2 uprights on the opposite corners.' },
              { value: 'Gazebo', label: 'Gazebo', hint: 'Free standing, 4 uprights.' }
          ] },
        { key: 'AttachSide', page: 'Configuration', type: 'radio', label: 'Attachment Side', default: 'C',
          visibleWhen: function (c) { return c.PGL_ConfigType === 'With_Post'; },
          options: [
              { value: 'A', label: 'A (front, width)' },
              { value: 'B', label: 'B (right, projection)' },
              { value: 'C', label: 'C (back, width)' },
              { value: 'D', label: 'D (left, projection)' }
          ] },

        // ── Page 2: Dimensions and Motor Location ────────────────────
        { key: 'Width_mm', page: 'Dimensions', type: 'number', label: 'Width in mm', default: 4000, min: 1829, max: 7000, step: 1, hint: '1829mm-7000mm' },
        { key: 'Projection_mm', page: 'Dimensions', type: 'number', label: 'Projection in mm', default: 3500, min: 2438, max: 7000, step: 1, hint: '2438mm-7000mm' },
        { key: 'FreeHeight_mm', page: 'Dimensions', type: 'number', label: 'Free Height in mm', default: 2600, min: 1000, max: 4267, step: 1, hint: '1000mm-4267mm',
          visibleWhen: function (c) { return c.PGL_ConfigType !== 'Between_Wall'; } },
        { key: 'MotorLocation', page: 'Dimensions', type: 'radio', label: 'Motor Location (Left or Right)', default: 'Left',
          visibleWhen: function (c) { return Number(c.Width_mm) <= 4500; },
          options: [{ value: 'Left', label: 'Left' }, { value: 'Right', label: 'Right' }] },

        // ── Page 3: Frame and Louver Colors ──────────────────────────
        { key: 'FrameColor', page: 'Colors', type: 'swatch', label: 'Frame Color', default: 'ANTHRACITE', options: COLORS },
        { key: 'LouverColor', page: 'Colors', type: 'swatch', label: 'Louver Color', default: 'ANTHRACITE', options: COLORS },

        // ── Page 4: Upright Options ──────────────────────────────────
        { key: 'Upright_Style', page: 'Uprights', type: 'radio', label: 'Upright Style (Standard or Offset)', default: 'ST',
          options: [{ value: 'ST', label: 'Standard' }, { value: 'OFF', label: 'Offset' }] },
        { key: 'U1_Offset_Axis', page: 'Uprights', type: 'select', label: 'Upright 1 Offset', default: 'None', options: OFFSET_AXES, upright: 1, group: 'offset' },
        { key: 'U1_Offset_mm', page: 'Uprights', type: 'number', label: 'Offset along axis in mm', default: 0, min: 0, max: 3000, step: 1, upright: 1, group: 'offset' },
        { key: 'U2_Offset_Axis', page: 'Uprights', type: 'select', label: 'Upright 2 Offset', default: 'None', options: OFFSET_AXES, upright: 2, group: 'offset' },
        { key: 'U2_Offset_mm', page: 'Uprights', type: 'number', label: 'Offset along axis in mm', default: 0, min: 0, max: 3000, step: 1, upright: 2, group: 'offset' },
        { key: 'U3_Offset_Axis', page: 'Uprights', type: 'select', label: 'Upright 3 Offset', default: 'None', options: OFFSET_AXES, upright: 3, group: 'offset' },
        { key: 'U3_Offset_mm', page: 'Uprights', type: 'number', label: 'Offset along axis in mm', default: 0, min: 0, max: 3000, step: 1, upright: 3, group: 'offset' },
        { key: 'U4_Offset_Axis', page: 'Uprights', type: 'select', label: 'Upright 4 Offset', default: 'None', options: OFFSET_AXES, upright: 4, group: 'offset' },
        { key: 'U4_Offset_mm', page: 'Uprights', type: 'number', label: 'Offset along axis in mm', default: 0, min: 0, max: 3000, step: 1, upright: 4, group: 'offset' },

        { key: 'BasePlate_Style', page: 'Uprights', type: 'radio', label: 'Base Plate Style', default: 'ST',
          options: [{ value: 'ST', label: 'Standard' }, { value: 'NS', label: 'Non-Standard' }] },
        { key: 'BasePlateType1', page: 'Uprights', type: 'select', label: 'Upright 1 Base Plate', default: 'Central', options: BASEPLATE_TYPES, upright: 1, group: 'baseplate' },
        { key: 'BasePlateType2', page: 'Uprights', type: 'select', label: 'Upright 2 Base Plate', default: 'Central', options: BASEPLATE_TYPES, upright: 2, group: 'baseplate' },
        { key: 'BasePlateType3', page: 'Uprights', type: 'select', label: 'Upright 3 Base Plate', default: 'Central', options: BASEPLATE_TYPES, upright: 3, group: 'baseplate' },
        { key: 'BasePlateType4', page: 'Uprights', type: 'select', label: 'Upright 4 Base Plate', default: 'Central', options: BASEPLATE_TYPES, upright: 4, group: 'baseplate' },

        { key: 'Drain_Style', page: 'Uprights', type: 'radio', label: 'Drain Style', default: 'ST',
          options: [{ value: 'ST', label: 'Standard' }, { value: 'NS', label: 'Non-Standard' }] },
        { key: 'DrainDirection1', page: 'Uprights', type: 'select', label: 'Upright 1 Drain Direction', default: 'Out', options: DRAIN_DIRECTIONS, upright: 1, group: 'drain' },
        { key: 'DrainDirection2', page: 'Uprights', type: 'select', label: 'Upright 2 Drain Direction', default: 'Out', options: DRAIN_DIRECTIONS, upright: 2, group: 'drain' },
        { key: 'DrainDirection3', page: 'Uprights', type: 'select', label: 'Upright 3 Drain Direction', default: 'Out', options: DRAIN_DIRECTIONS, upright: 3, group: 'drain' },
        { key: 'DrainDirection4', page: 'Uprights', type: 'select', label: 'Upright 4 Drain Direction', default: 'Out', options: DRAIN_DIRECTIONS, upright: 4, group: 'drain' },

        // ── Page 5: Lighting ─────────────────────────────────────────
        { key: 'Light_Gutter', page: 'Lights', type: 'radio', label: 'Gutter Lights', default: 'None', options: LIGHT_OPTIONS },
        { key: 'Light_Louver', page: 'Lights', type: 'radio', label: 'Louver Lights', default: 'None', options: LIGHT_OPTIONS },
        { key: 'Light_Upright', page: 'Lights', type: 'radio', label: 'Upright Lights', default: 'None', options: LIGHT_OPTIONS,
          visibleWhen: function (c) { return c.PGL_ConfigType !== 'Between_Wall'; } },

        // ── Page 6: Add Ons ──────────────────────────────────────────
        { key: 'FanBar', page: 'AddOns', type: 'bool', label: 'Fan Bar', default: false },
        { key: 'Sensor_Wind', page: 'AddOns', type: 'bool', label: 'Wind Sensor', default: false },
        { key: 'Sensor_Rain', page: 'AddOns', type: 'bool', label: 'Rain Sensor', default: false },
        { key: 'Sensor_Snow', page: 'AddOns', type: 'bool', label: 'Snow Sensor', default: false },
        { key: 'DaisyBox', page: 'AddOns', type: 'bool', label: 'Daisy Box', default: false },

        // ── Page 6: Notes ────────────────────────────────────────────
        { key: 'PGL_Notes', page: 'AddOns', type: 'textarea', label: 'Notes or Comments', default: '' }
    ];

    var BY_KEY = {};
    SCHEMA.forEach(function (f) { BY_KEY[f.key] = f; });

    function defaults() {
        var o = {};
        SCHEMA.forEach(function (f) { o[f.key] = f.default; });
        return o;
    }

    function toBool(v) {
        if (typeof v === 'boolean') return v;
        if (v == null) return false;
        var s = String(v).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'y';
    }

    function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

    // Coerce one raw value into the field's type. Unknown option values are
    // kept only if they match case-insensitively; otherwise fall back to default.
    function coerce(f, raw) {
        if (raw == null || raw === '') return f.default;
        switch (f.type) {
            case 'number': {
                var n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
                if (!isFinite(n)) return f.default;
                if (f.min != null && f.max != null) n = clamp(n, f.min, f.max);
                return Math.round(n);
            }
            case 'bool': return toBool(raw);
            case 'radio': case 'select': case 'swatch': {
                var s = String(raw).trim();
                var hit = null;
                f.options.forEach(function (o) {
                    if (!hit && (o.value.toLowerCase() === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase())) hit = o.value;
                });
                return hit || f.default;
            }
            default: return String(raw);
        }
    }

    // Build a full, valid configuration from any partial/dirty object.
    function normalize(src) {
        src = src || {};
        var cfg = defaults();
        // Accept keys case-insensitively (CPQ exports are case-sensitive, URLs are not).
        var lower = {};
        Object.keys(src).forEach(function (k) { lower[k.toLowerCase()] = src[k]; });
        SCHEMA.forEach(function (f) {
            var raw = src[f.key];
            if (raw === undefined) raw = lower[f.key.toLowerCase()];
            cfg[f.key] = coerce(f, raw);
        });
        return cfg;
    }

    // Upright numbering used by the ruleset (derived from the visibility rules):
    //   sides:   A = front (width),  B = right (projection),
    //            C = back  (width),  D = left  (projection)
    //   U1 = corner C·D (back-left)   U2 = corner B·C (back-right)
    //   U3 = corner A·B (front-right) U4 = corner D·A (front-left)
    // With_Post keeps the two uprights on the corners OPPOSITE the attached side.
    function uprightVisible(cfg, n) {
        var t = cfg.PGL_ConfigType, s = cfg.AttachSide;
        if (t === 'Gazebo') return true;
        if (t !== 'With_Post') return false;
        switch (n) {
            case 1: return s === 'A' || s === 'B';
            case 2: return s === 'A' || s === 'D';
            case 3: return s === 'C' || s === 'D';
            case 4: return s === 'B' || s === 'C';
        }
        return false;
    }

    // mm → feet/inches string the same way the ruleset does (1/16" precision).
    function mmToFtIn(mm) {
        var sixteenths = Math.round(mm / 25.4 * 16);
        var ft = Math.floor(sixteenths / 192);
        var rem = sixteenths % 192;
        var inch = Math.floor(rem / 16);
        var num = rem % 16, den = 16;
        while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
        var frac = num > 0 ? ' ' + num + '/' + den : '';
        return ft + "'-" + inch + frac + '"';
    }

    // Everything the CPQ rules compute from the inputs (kept identical on purpose).
    function derive(cfg) {
        var W = Number(cfg.Width_mm), P = Number(cfg.Projection_mm), H = Number(cfg.FreeHeight_mm);
        var numBay = W > 4500 ? 2 : 1;                                   // "Number of Bays"
        var bayWidth = W / numBay;                                        // BayWidth_mm
        var louverCount = Math.floor((P - 198 - 202) / 235) + 1;          // LouverCount
        var lightLouverCount = cfg.Light_Louver !== 'None' ? Math.floor((louverCount + 1) / 4) : 0;
        var numUprights = cfg.PGL_ConfigType === 'Gazebo' ? 4 : (cfg.PGL_ConfigType === 'With_Post' ? 2 : 0);
        var vis = [1, 2, 3, 4].map(function (n) { return uprightVisible(cfg, n); });
        var motor = numBay === 2 ? 'Central (Double Bay)' : cfg.MotorLocation;
        var engineeringReview = cfg.PGL_ConfigType === 'With_Post' && W > 4500;   // "Drain Options Review - WARNING"
        return {
            numBay: numBay,
            bays: numBay === 2 ? 'Double' : 'Single',
            BayWidth_mm: bayWidth,
            LouverCount: louverCount,
            LouverLength_mm: Math.round(bayWidth - 222),
            RegularLouverCount: louverCount - lightLouverCount,
            LightLouverCount: lightLouverCount,
            transBarLength_mm: 235 * (louverCount - 1) + 80,
            numUprights: numUprights,
            nUpright1Visible: vis[0], nUpright2Visible: vis[1], nUpright3Visible: vis[2], nUpright4Visible: vis[3],
            MotorLocationEffective: motor,
            engineeringReview: engineeringReview,
            widthFtIn: mmToFtIn(W), projectionFtIn: mmToFtIn(P), freeHeightFtIn: mmToFtIn(H)
        };
    }

    function fromQueryString(search) {
        var out = {}, q = (search || '').replace(/^\?/, '');
        if (!q) return null;
        q.split('&').forEach(function (pair) {
            if (!pair) return;
            var i = pair.indexOf('='), k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, ' ');
            var v = i < 0 ? 'true' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
            out[k] = v;
        });
        var known = Object.keys(out).some(function (k) { return !!BY_KEY[k] || !!BY_KEY[Object.keys(BY_KEY).filter(function (kk) { return kk.toLowerCase() === k.toLowerCase(); })[0]]; });
        return known ? out : null;
    }

    function toQueryString(cfg) {
        var d = defaults(), parts = [];
        SCHEMA.forEach(function (f) {
            var v = cfg[f.key];
            if (v === d[f.key] || v === '' || v == null) return;      // only non-default values
            parts.push(encodeURIComponent(f.key) + '=' + encodeURIComponent(String(v)));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    // Accepts the shapes we expect from an Infor CPQ external-application host:
    //   { command: 'InitializeCommand', options: { screenOptionId, orderNumber, ...config } }
    //   { command: 'SetConfiguration', config: { ...config } }
    //   { ...config }   (a flat object with known keys)
    // Search the message (up to 6 levels deep) for attribute values in any of the shapes the
    // Infor configurator host uses: an object keyed by attribute name, an array of
    // { name, value } pairs, or the UiData reply { command: 'UiData', data: { screenOptions: { id: { name, value, … } } } }.
    function fromMessage(data) {
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return null; } }
        if (!data || typeof data !== 'object') return null;
        var found = {};
        function keyOf(k) { if (BY_KEY[k]) return k; var lk = String(k).toLowerCase(); for (var i = 0; i < SCHEMA.length; i++) if (SCHEMA[i].key.toLowerCase() === lk) return SCHEMA[i].key; return null; }
        function visit(node, depth) {
            if (!node || typeof node !== 'object' || depth > 6) return;
            if (Array.isArray(node)) {
                node.forEach(function (item) {
                    if (item && typeof item === 'object') {
                        var n = item.name || item.Name || item.key || item.Key || item.id || item.Id;
                        var v = item.value !== undefined ? item.value : (item.Value !== undefined ? item.Value : item.val);
                        var k = n != null ? keyOf(n) : null;
                        if (k && v !== undefined) found[k] = v; else visit(item, depth + 1);
                    }
                });
                return;
            }
            // CPQ "UiData" screen options: { id, name: 'Width_mm', value: 4000, displayValue: '4000', ... }
            var nm = node.name || node.Name, nk = nm != null ? keyOf(nm) : null;
            if (nk && (node.value !== undefined || node.Value !== undefined)) {
                var nv = node.value !== undefined ? node.value : node.Value;
                if (nv !== null && typeof nv === 'object') nv = nv.value !== undefined ? nv.value : (nv.Value !== undefined ? nv.Value : nv.code);
                found[nk] = nv;
                return;
            }
            Object.keys(node).forEach(function (k) {
                var v = node[k], mk = keyOf(k);
                if (mk && (v === null || typeof v !== 'object')) found[mk] = v;
                else if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { visit(JSON.parse(v), depth + 1); } catch (e) { /* not JSON */ } }
                else if (v && typeof v === 'object') visit(v, depth + 1);
            });
        }
        visit(data, 0);
        return Object.keys(found).length ? found : null;
    }

    global.PergolaConfig = {
        SCHEMA: SCHEMA, BY_KEY: BY_KEY, COLORS: COLORS,
        defaults: defaults, normalize: normalize, derive: derive,
        uprightVisible: uprightVisible, mmToFtIn: mmToFtIn,
        fromQueryString: fromQueryString, toQueryString: toQueryString, fromMessage: fromMessage
    };
})(window);
