/* ═══════════════════════════════════════════════════════════════════
   Pergolam 3D — CPQ bridge (same protocol as ABPointsUI/Messenger.js)
   -------------------------------------------------------------------
   Outgoing (page → Infor CPQ host, via window.parent.postMessage):
     { action: 'externalApplicationInitialized' }
     { action: 'setScreenOption', screenOptionId, value }
     { action: 'displayInformationPane', pane: 'externalapplication' | 'summary' }
     { action: 'configure' }

   Incoming (CPQ host → page, via window 'message' event):
     { command: 'InitializeCommand', options: { screenOptionId, orderNumber, ...attributes } }
     { command: 'SetConfiguration',  config: { ...attributes } }
     { ...attributes }   (flat object whose keys are ruleset attribute names)

   Every message in or out is written to a diagnostics log (Messenger.log)
   that survives page reloads (sessionStorage), so the CPQ handshake can be
   inspected from the "Parameters" drawer without DevTools.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    // Actions the Infor configurator host accepts from an external application (from its UI bundle):
    // configure, displayInformationPane, externalApplicationInitialized, finishConfiguration,
    // focusScreenOption, processing, saveOutputFile, setScreenOption, requestUiData.
    // The host answers requestUiData with { command: 'UiData', data: { screenOptions, pages, screens, … }, id: 'UiData' }.
    var outgoingActions = {
        displayInformationPane: 'displayInformationPane',
        setScreenOption: 'setScreenOption',
        initializeApplication: 'externalApplicationInitialized',
        requestUiData: 'requestUiData',
        configure: 'configure'
    };

    var LOG_KEY = 'pergola3d.msglog', LOG_MAX = 60;
    var state = {
        screenOptionId: '', orderNumber: '', embedded: window.parent && window.parent !== window,
        polls: 0, replies: 0, duplicates: 0, lastReplyAt: '', polling: false,
        handlers: { config: [], init: [], raw: [], log: [] }
    };
    var lastIncomingJson = '';

    function loadLog() { try { return JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
    var log = loadLog();
    function addLog(dir, data, note) {
        var entry = { t: new Date().toISOString().substr(11, 12), dir: dir, note: note || '', data: data };
        log.push(entry); if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
        try { sessionStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* storage blocked */ }
        state.handlers.log.forEach(function (fn) { fn(entry, log); });
        try { console.log('[Pergola3D] ' + dir + ' ' + (note || ''), data); } catch (e) { /* noop */ }
        // Mirror the entry to the host window so it can be inspected from the parent page's console
        // (the host ignores actions it does not know). Skipped for 'out' entries: they are already messages.
        if (state.embedded && dir !== 'out') { try { window.parent.postMessage({ action: 'pergola3dLog', entry: entry }, '*'); } catch (e) { /* noop */ } }
    }
    addLog('load', { href: location.href, referrer: document.referrer || '', embedded: state.embedded, ua: navigator.userAgent.slice(0, 80) }, 'page loaded');

    function send(message, quiet) {
        if (!quiet) addLog('out', message, message.action);
        try { window.parent.postMessage(message, '*'); } catch (e) { addLog('err', String(e), 'postMessage failed'); }
    }

    function processData(data, origin) {
        if (!data || typeof data !== 'object') { addLog('in', data, 'ignored (not an object) from ' + origin); return; }
        // Polling makes the host repeat the same reply; log it once and count the repeats.
        var json = ''; try { json = JSON.stringify(data); } catch (e) { json = String(Math.random()); }
        state.lastReplyAt = new Date().toISOString().substr(11, 8);
        if (json === lastIncomingJson) { state.duplicates++; state.handlers.log.forEach(function (fn) { fn(null, log); }); return; }
        lastIncomingJson = json; state.replies++;
        addLog('in', data, (data.command || data.action || 'message') + ' from ' + origin);
        state.handlers.raw.forEach(function (fn) { fn(data); });
        if (data.command === 'InitializeCommand' && data.options) {
            if (data.options.screenOptionId) state.screenOptionId = data.options.screenOptionId;
            if (data.options.orderNumber) state.orderNumber = data.options.orderNumber;
            state.handlers.init.forEach(function (fn) { fn(data.options); });
        }
        var cfg = global.PergolaConfig ? global.PergolaConfig.fromMessage(data) : null;
        if (cfg) state.handlers.config.forEach(function (fn) { fn(cfg, data); });
        else addLog('info', null, 'no known attribute keys in this message');
    }

    var Messenger = {
        state: state,
        log: function () { return log.slice(); },
        clearLog: function () { log = []; try { sessionStorage.removeItem(LOG_KEY); } catch (e) { /* noop */ } },
        startReceiver: function () {
            window.addEventListener('message', function (event) {
                var data = event.data;
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { addLog('in', data.slice(0, 200), 'string message (not JSON) from ' + event.origin); return; } }
                // Standalone: our own outgoing messages echo back (parent === window). Ignore them, but keep simulated ones.
                if (event.source === window && !(data && data.__simulated)) return;
                if (data && data.__simulated) { data = Object.assign({}, data); delete data.__simulated; }
                processData(data, event.origin);
            }, false);
        },
        on: function (ev, fn) { (state.handlers[ev] = state.handlers[ev] || []).push(fn); return Messenger; },
        initializeApplication: function () { send({ action: outgoingActions.initializeApplication }); },
        requestUiData: function (quiet) { send({ action: outgoingActions.requestUiData }, quiet); },
        // Ask the host for its current UI data on an interval; identical replies are dropped, so
        // the page only rebuilds when a screen option value actually changed.
        startPolling: function (intervalMs) {
            if (state.polling) return;
            state.polling = true;
            addLog('info', { intervalMs: intervalMs }, 'polling started: sending requestUiData');
            send({ action: outgoingActions.requestUiData });
            setInterval(function () { state.polls++; send({ action: outgoingActions.requestUiData }, true); }, intervalMs);
        },
        updateScreenOption: function (screenOptionId, value) {
            send({ action: outgoingActions.setScreenOption, screenOptionId: screenOptionId || state.screenOptionId, value: value });
        },
        displayExternalAppPane: function () { send({ action: outgoingActions.displayInformationPane, pane: 'externalapplication' }); },
        displaySummaryPane: function () { send({ action: outgoingActions.displayInformationPane, pane: 'summary' }); },
        configure: function () { send({ action: outgoingActions.configure }); },
        // Local simulation: feed a message into this page as if CPQ had sent it.
        simulateIncoming: function (data) { window.postMessage(Object.assign({}, data, { __simulated: true }), '*'); }
    };

    Messenger.startReceiver();
    global.Messenger = Messenger;
})(window);
