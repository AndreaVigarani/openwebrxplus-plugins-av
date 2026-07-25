Plugins.filter_control = Plugins.filter_control || {};
Plugins.filter_control._version = 1.0;
Plugins.filter_control.no_css = true;
Plugins.filter_control._lastFft = null;
Plugins.filter_control.isDragging = false;

Plugins.filter_control.init = async function () {
    Plugins.filter_control.buildFloatingModal();
    Plugins.filter_control.injectReceiverPanelButton();
    Plugins.filter_control.hookFFTStream();

    // Redraw loop when visible
    setInterval(function () {
        var modal = document.getElementById('fc-floating-panel');
        if (modal && modal.style.display !== 'none' && !Plugins.filter_control.isDragging) {
            Plugins.filter_control.drawCanvas();
        }
    }, 100);

    return true;
};

// 1. Build Floating & Draggable Modal
Plugins.filter_control.buildFloatingModal = function () {
    if (document.getElementById('fc-floating-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'fc-floating-panel';
    panel.style.cssText = `
        position: fixed;
        top: 80px;
        left: 20px;
        width: 320px;
        background: rgba(24, 24, 24, 0.95);
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        z-index: 9999;
        display: none;
        backdrop-filter: blur(4px);
        user-select: none;
    `;

    // Header / Drag Handle
    var header = document.createElement('div');
    header.id = 'fc-panel-header';
    header.style.cssText = `
        padding: 8px 12px;
        background: #282828;
        border-bottom: 1px solid #333;
        border-top-left-radius: 5px;
        border-top-right-radius: 5px;
        cursor: move;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: bold;
        font-size: 13px;
        color: #eee;
    `;
    header.innerHTML = `
        <span>🎛️ Filter Control</span>
        <span id="fc-close-btn" style="cursor: pointer; padding: 0 4px; font-size: 16px; color: #888;">&times;</span>
    `;

    // Body Container
    var body = document.createElement('div');
    body.style.padding = '10px';

    // Status Readout
    var statusLabel = document.createElement('div');
    statusLabel.id = 'fc-status-display';
    statusLabel.style.cssText = 'font-weight: bold; margin-bottom: 8px; text-align: center; color: #ccc; font-size: 11px;';
    statusLabel.innerText = 'Mode: -- | Cutoffs: --';
    body.appendChild(statusLabel);

    // Interactive Canvas
    var canvas = document.createElement('canvas');
    canvas.id = 'fc-filter-canvas';
    canvas.width = 300;
    canvas.height = 135; // Increased from 110 to 135 to fit scale ticks
    canvas.style.cssText = 'width: 100%; height: 135px; background: #111; border: 1px solid #333; border-radius: 4px; touch-action: none; display: block;';
    body.appendChild(canvas);

    // Preset Buttons
    var presetsWrap = document.createElement('div');
    presetsWrap.style.cssText = 'margin-top: 8px; display: flex; gap: 6px; justify-content: center;';
    ['narrow', 'normal', 'wide'].forEach(function (tier) {
        var btn = document.createElement('button');
        btn.className = 'openwebrx-button';
        btn.innerText = tier.toUpperCase();
        btn.style.cssText = 'padding: 2px 10px; font-size: 11px; cursor: pointer;';
        btn.onclick = function () { Plugins.filter_control.applyPreset(tier); };
        presetsWrap.appendChild(btn);
    });
    body.appendChild(presetsWrap);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Close button event
    document.getElementById('fc-close-btn').onclick = function () {
        Plugins.filter_control.togglePanel(false);
    };

    // Attach dragging logic to panel header
    Plugins.filter_control.makeDraggable(panel, header);
    Plugins.filter_control.attachCanvasEvents(canvas);
};
/*
// 2. Inject Button into Top Header Bar ---- keep for future uses
Plugins.filter_control.injectHeaderButton = function () {
    var topBar = document.querySelector('#top-bar, .top-bar, header');
    if (!topBar || document.getElementById('fc-top-btn')) return;

    var btn = document.createElement('div');
    btn.id = 'fc-top-btn';
    btn.className = 'openwebrx-button';
    btn.innerText = 'FIL';
    btn.title = 'Toggle Filter Control Panel';
    btn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 2px 8px; cursor: pointer; font-weight: bold; font-size: 12px;';

    btn.onclick = function () {
        Plugins.filter_control.togglePanel();
    };

    topBar.appendChild(btn);
};
*/
// 3. Inject Button into Receiver Control Area
Plugins.filter_control.injectReceiverPanelButton = function () {
    var rxPanel = document.querySelector('#openwebrx-panel-receiver, .openwebrx-panel-receiver');
    if (!rxPanel || document.getElementById('fc-rx-btn')) return;

    var container = document.createElement('div');
    container.style.cssText = 'margin-top: 6px; text-align: center;';

    var btn = document.createElement('button');
    btn.id = 'fc-rx-btn';
    btn.className = 'openwebrx-button';
    btn.innerText = '🎛️ Filter Scope';
    btn.style.cssText = 'width: 90%; padding: 4px; font-size: 11px; cursor: pointer;';
    btn.onclick = function () {
        Plugins.filter_control.togglePanel();
    };

    container.appendChild(btn);
    rxPanel.appendChild(container);
};

// Toggle Modal Visibility
Plugins.filter_control.togglePanel = function (show) {
    var panel = document.getElementById('fc-floating-panel');
    if (!panel) return;

    if (show === undefined) {
        show = panel.style.display === 'none';
    }

    panel.style.display = show ? 'block' : 'none';
    if (show) {
        Plugins.filter_control.drawCanvas();
    }
};

// Make Element Draggable
Plugins.filter_control.makeDraggable = function (elm, handle) {
    var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        elm.style.top = (elm.offsetTop - pos2) + "px";
        elm.style.left = (elm.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
};

// --- (FFT Stream, Canvas Draw, and Touch Handlers remain unchanged) ---

Plugins.filter_control.hookFFTStream = function () {
    if (typeof waterfall_add !== 'function' || Plugins.filter_control._fftHooked) return;
    var origWaterfallAdd = waterfall_add;
    waterfall_add = function (data) {
        var res = origWaterfallAdd.apply(this, arguments);
        if (data && data.length) {
            Plugins.filter_control._lastFft = data;
        }
        return res;
    };
    Plugins.filter_control._fftHooked = true;
};

Plugins.filter_control.getLevelAtHz = function (relHz, maxHz) {
    var data = Plugins.filter_control._lastFft;
    if (!data || !data.length || typeof bandwidth === 'undefined') return null;

    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (!demods.length) return null;

    var dem = demods[0];
    var demOffset = (typeof UI !== 'undefined' && UI.getFrequency) ? (UI.getFrequency() - center_freq) : (dem.offset || 0);
    var targetHz = demOffset + relHz;

    var f0 = targetHz - (maxHz / 100);
    var f1 = targetHz + (maxHz / 100);

    var b0 = Math.floor((f0 / bandwidth + 0.5) * data.length);
    var b1 = Math.max(b0 + 1, Math.ceil((f1 / bandwidth + 0.5) * data.length));

    if (b1 <= 0 || b0 >= data.length) return null;

    var peak = -1000;
    for (var b = Math.max(0, b0); b < Math.min(data.length, b1); b++) {
        if (data[b] > peak) peak = data[b];
    }
    return peak === -1000 ? null : peak;
};

// 1. Draw Canvas with Frequency Axis & Hitzone Guidance
Plugins.filter_control.drawCanvas = function () {
    var canvas = document.getElementById('fc-filter-canvas');
    var statusLabel = document.getElementById('fc-status-display');
    if (!canvas) return;

    var isEditable = Plugins.filter_control.isFilterModifiable();
    canvas.style.cursor = isEditable ? 'pointer' : 'not-allowed';

    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (demods.length === 0) return;

    var dem = demods[0];
    var mode = (dem.modulation || '').toLowerCase();
    var low = dem.low_cut;
    var high = dem.high_cut;
    var bw = Math.abs(high - low);

    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;

    // Layout dimensions
    var topY = 15;
    var bottomY = h - 26; // Leave space for frequency scale
    var scaleY = h - 1;

    ctx.clearRect(0, 0, w, h);

    var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
    var centerX = w / 2;
    var hzToX = function (hz) { return centerX + (hz / maxHz) * (w / 2); };

    // --- 📐 FREQUENCY SCALE & TICKS ---
    ctx.strokeStyle = '#333';
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    // Center Reference Line
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(centerX, topY);
    ctx.lineTo(centerX, bottomY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scale Ticks
    var tickStep = maxHz >= 10000 ? 5000 : (maxHz >= 5000 ? 2000 : 500);
    for (var hz = -maxHz + tickStep; hz < maxHz; hz += tickStep) {
        if (hz === 0) continue;
        var tx = hzToX(hz);
        ctx.beginPath();
        ctx.moveTo(tx, bottomY);
        ctx.lineTo(tx, bottomY + 4);
        ctx.stroke();

        var label = (hz > 0 ? '+' : '') + (Math.abs(hz) >= 1000 ? (hz / 1000) + 'k' : hz);
        ctx.fillText(label, tx, bottomY + 14);
    }
    ctx.fillText('0', centerX, bottomY + 14);

    var x1 = hzToX(low);
    var x2 = hzToX(high);

    // --- 🌊 SMOOTHED FFT TRACE ---
    var fftData = Plugins.filter_control._lastFft;
    if (fftData && fftData.length) {
        var range = (typeof Waterfall !== 'undefined' && Waterfall.getRange) ? Waterfall.getRange() : { min: -100, max: 0 };
        var lo = range.min, hi = range.max;

        var points = [];
        var step = 4;

        for (var px = 0; px <= w; px += step) {
            var relHz = ((px - centerX) / (w / 2)) * maxHz;
            var val = Plugins.filter_control.getLevelAtHz(relHz, maxHz);
            if (val === null) val = lo;

            var t = Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
            var spectrumY = bottomY - Math.pow(t, 0.75) * (bottomY - topY);
            points.push({ x: px, y: spectrumY });
        }

        if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, bottomY);
            ctx.lineTo(points[0].x, points[0].y);

            for (var i = 0; i < points.length - 1; i++) {
                var xc = (points[i].x + points[i + 1].x) / 2;
                var yc = (points[i].y + points[i + 1].y) / 2;
                ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }

            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.lineTo(w, bottomY);
            ctx.closePath();

            var grad = ctx.createLinearGradient(0, topY, 0, bottomY);
            grad.addColorStop(0, 'rgba(63, 169, 245, 0.35)');
            grad.addColorStop(1, 'rgba(63, 169, 245, 0.05)');

            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = '#3fa9f5';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }
    }

    if (!isEditable) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff9900';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LOCKED (' + mode.toUpperCase() + ')', w / 2, h / 2);
        if (statusLabel) statusLabel.innerText = mode.toUpperCase() + ' | Fixed Bandwidth';
        return;
    }

    if (statusLabel) {
        statusLabel.innerText = mode.toUpperCase() + ' | Passband: [' + low + ', ' + high + '] Hz (' + bw + ' Hz)';
    }

    // --- 🎛️ PASSBAND & HITBOXES ---
    // Main Passband Fill
    ctx.fillStyle = 'rgba(255, 204, 0, 0.18)';
    ctx.fillRect(x1, topY, x2 - x1, bottomY - topY);

    // Passband Shift Zone Indicator (Bottom 40%)
    var shiftZoneY = topY + (bottomY - topY) * 0.6;
    ctx.fillStyle = 'rgba(255, 204, 0, 0.25)';
    ctx.fillRect(x1, shiftZoneY, x2 - x1, bottomY - shiftZoneY);

    // Passband Filter Envelope Outline
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    ctx.lineTo(Math.max(0, x1 - 8), bottomY);
    ctx.lineTo(x1, topY);
    ctx.lineTo(x2, topY);
    ctx.lineTo(Math.min(w, x2 + 8), bottomY);
    ctx.lineTo(w, bottomY);
    ctx.stroke();

    // Top Handle Nodes (Low / High Cut)
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(x1, topY, 4, 0, Math.PI * 2);
    ctx.arc(x2, topY, 4, 0, Math.PI * 2);
    ctx.fill();
};

// 2. Vertical-Split Mouse & Touch Events
Plugins.filter_control.attachCanvasEvents = function (canvas) {
    var activeHit = null;
    var startX = 0, origLow = 0, origHigh = 0;

    var getCanvasCoords = function (e) {
        var rect = canvas.getBoundingClientRect();
        var clientX = e.touches ? e.touches[0].clientX : e.clientX;
        var clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    var onStart = function (e) {
        if (!Plugins.filter_control.isFilterModifiable()) return;
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        if (!demods.length) return;

        var dem = demods[0];
        var mode = (dem.modulation || '').toLowerCase();
        var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
        var w = canvas.width;
        var h = canvas.height;
        var centerX = w / 2;

        var hzToX = function (hz) { return centerX + (hz / maxHz) * (w / 2); };
        var coords = getCanvasCoords(e);
        var x = coords.x;
        var y = coords.y;

        var x1 = hzToX(dem.low_cut);
        var x2 = hzToX(dem.high_cut);

        var topY = 15;
        var bottomY = h - 26;
        var splitY = topY + (bottomY - topY) * 0.6; // 60% top, 40% bottom split

        // 🎯 Region 1: Lower Area (Bottom 40%) -> Always Passband Shift
        if (y >= splitY) {
            if (x >= x1 - 10 && x <= x2 + 10) {
                activeHit = 'center';
            } else {
                return;
            }
        } 
        // 🎯 Region 2: Upper Area (Top 60%) -> Low / High Edge Cutoffs
        else {
            var distLow = Math.abs(x - x1);
            var distHigh = Math.abs(x - x2);

            // On extremely narrow passbands (< 15px width on screen), pick the nearest edge
            if (Math.abs(x2 - x1) < 15) {
                activeHit = (distLow <= distHigh) ? 'low' : 'high';
            } else {
                if (distLow < 15) activeHit = 'low';
                else if (distHigh < 15) activeHit = 'high';
                else if (x > x1 && x < x2) activeHit = 'center'; // Fallback inside body
                else return;
            }
        }

        Plugins.filter_control.isDragging = true;
        startX = x;
        origLow = dem.low_cut;
        origHigh = dem.high_cut;
        e.preventDefault();
    };

    var onMove = function (e) {
        if (!activeHit) return;
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        if (!demods.length) return;

        var dem = demods[0];
        var mode = (dem.modulation || '').toLowerCase();
        var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
        var w = canvas.width;

        var coords = getCanvasCoords(e);
        var deltaHz = Math.round(((coords.x - startX) / (w / 2)) * maxHz);

        var newLow = origLow;
        var newHigh = origHigh;

        if (activeHit === 'low') newLow = Math.min(origLow + deltaHz, origHigh - 50);
        else if (activeHit === 'high') newHigh = Math.max(origHigh + deltaHz, origLow + 50);
        else if (activeHit === 'center') {
            newLow = origLow + deltaHz;
            newHigh = origHigh + deltaHz;
        }

        dem.setBandpass({ low_cut: newLow, high_cut: newHigh });
        Plugins.filter_control.drawCanvas();
        e.preventDefault();
    };

    var onEnd = function () {
        if (!activeHit) return;
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        if (demods.length > 0) {
            var dem = demods[0];
            if (typeof UI !== 'undefined' && typeof UI.saveBandpass === 'function') {
                UI.saveBandpass((dem.modulation || '').toLowerCase(), dem.low_cut, dem.high_cut);
            }
        }
        activeHit = null;
        Plugins.filter_control.isDragging = false;
    };

    canvas.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
};

Plugins.filter_control.applyPreset = function (tier) {
    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (!demods.length) return;

    var dem = demods[0];
    var mode = (dem.modulation || '').toLowerCase();

    var presets = {
        lsb: { narrow: 1800, normal: 2400, wide: 3000 },
        usb: { narrow: 1800, normal: 2400, wide: 3000 },
        cw:  { narrow: 250,  normal: 500,  wide: 1000 },
        am:  { narrow: 4000, normal: 6000, wide: 9000 },
        sam: { narrow: 4000, normal: 6000, wide: 9000 },
        nfm: { narrow: 6000, normal: 10000, wide: 15000 }
    };

    var modePresets = presets[mode] || { narrow: 1000, normal: 2400, wide: 6000 };
    var bw = modePresets[tier] || 2400;

    var low, high;
    if (mode === 'lsb') { low = -bw; high = -100; }
    else if (mode === 'usb'||mode === 'cw') { low = 100; high = bw; }
    else { var half = Math.round(bw / 2); low = -half; high = half; }

    if (Plugins.filter_control.isFilterModifiable()) {
        dem.setBandpass({ low_cut: low, high_cut: high });
        if (typeof UI !== 'undefined' && typeof UI.saveBandpass === 'function') {
            UI.saveBandpass(mode, low, high);
        }
    }
    Plugins.filter_control.drawCanvas();
};

Plugins.filter_control.isFilterModifiable = function () {
    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (!demods.length) return false;

    var dem = demods[0];
    var baseMode = (dem.modulation || '').toLowerCase();
    if (['am', 'sam', 'nfm', 'lsb', 'usb', 'cw'].indexOf(baseMode) === -1) return false;

    var activeDigi = dem.digimode || dem.digital_mode || (dem.secondary ? dem.secondary.type : null);
    if (activeDigi && activeDigi !== 'none' && activeDigi !== false) return false;

    return true;
};
