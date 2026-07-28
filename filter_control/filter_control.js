/*
 * Plugin: add floating window to control filter bandwidth
 *
 * License: MIT
 * Copyright (c) 2026 Andrea Vigarani
 * Some code has been borrowed from https://aganet.github.io/openwebrxplus-rig-skin/receiver/rig_skin/rig_skin.js
 */
Plugins.filter_control = Plugins.filter_control || {};
Plugins.filter_control._version = 1.2;
Plugins.filter_control.no_css = true;
Plugins.filter_control._lastFft = null;
Plugins.filter_control.isDragging = false;
Plugins.filter_control._hoverX = null;
Plugins.filter_control._hoverY = null;

// =========================================================================
// INITIALIZATION
// =========================================================================
Plugins.filter_control.init = async function () {
    Plugins.filter_control.buildFloatingModal();
    Plugins.filter_control.injectReceiverPanelButton();
    Plugins.filter_control.hookFFTStream();

    setInterval(function () {
        var modal = document.getElementById('fc-floating-modal');
        if (modal && modal.style.display !== 'none' && !Plugins.filter_control.isDragging) {
            Plugins.filter_control.drawCanvas();
        }
    }, 100);
    
    return true;
};

Plugins.filter_control.isTouchDevice = function() {
    return window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
};

// Safe property getters for demodulator bandpass
Plugins.filter_control.getLowCut = function(dem) {
    if (!dem) return -1500;
    if (typeof dem.low_cut === 'number') return dem.low_cut;
    if (typeof dem.get_low_cut === 'function') return dem.get_low_cut();
    return -1500;
};

Plugins.filter_control.getHighCut = function(dem) {
    if (!dem) return 1500;
    if (typeof dem.high_cut === 'number') return dem.high_cut;
    if (typeof dem.get_high_cut === 'function') return dem.get_high_cut();
    return 1500;
};

// Build Floating & Draggable Modal
Plugins.filter_control.buildFloatingModal = function () {
    if (document.getElementById('fc-floating-modal')) return;

    var modal = document.createElement('div');
    modal.id = 'fc-floating-modal';
    modal.style.cssText = `
        position: fixed;
        top: 80px;
        left: 20px;
        width: 380px;
        background: rgba(24, 24, 24, 0.95);
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        z-index: 9999;
        display: none;
        backdrop-filter: blur(4px);
        user-select: none;
    `;

    var header = document.createElement('div');
    header.id = 'fc-modal-header';
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
        font-size: 12px;
        color: #eee;
        font-variant-numeric: tabular-nums;
    `;

    header.innerHTML = `
        <span id="fc-modal-title">🎛️ Filter Scope</span>
        <span id="fc-close-btn" style="cursor: pointer; padding: 0 4px; font-size: 16px; color: #888;">&times;</span>
    `;

    var body = document.createElement('div');
    body.style.padding = '10px';

    var canvas = document.createElement('canvas');
    canvas.id = 'fc-filter-canvas';
    canvas.width = 360;
    canvas.height = 160;
    canvas.style.cssText = 'width: 100%; height: 160px; background: #111; border: 1px solid #333; border-radius: 4px; touch-action: none; display: block;';
    body.appendChild(canvas);

    var presetsWrap = document.createElement('div');
    presetsWrap.style.cssText = 'margin-top: 8px; display: flex; gap: 6px; justify-content: center;';
    ['narrow', 'normal', 'wide'].forEach(function (tier) {
        var btn = document.createElement('button');
        btn.className = 'openwebrx-button';
        btn.innerText = tier.toUpperCase();
        btn.style.cssText = 'padding: 2px 12px; font-size: 11px; cursor: pointer;';
        btn.onclick = function () { Plugins.filter_control.applyPreset(tier); };
        presetsWrap.appendChild(btn);
    });
     
    var btnReset = document.createElement('button');
    btnReset.className = 'openwebrx-button';
    btnReset.innerText = 'R';
    btnReset.title = 'Reset Passband';
    btnReset.style.cssText = 'padding: 2px 10px; font-size: 11px; cursor: pointer;';
    btnReset.onclick = function () { Plugins.filter_control.resetPreset(); };
    presetsWrap.appendChild(btnReset);
   
    body.appendChild(presetsWrap);

    modal.appendChild(header);
    modal.appendChild(body);
    document.body.appendChild(modal);

    document.getElementById('fc-close-btn').onclick = function () {
        Plugins.filter_control.togglePanel(false);
    };

    Plugins.filter_control.makeModalDraggable(header, modal);
    Plugins.filter_control.attachCanvasEvents(canvas);
};

Plugins.filter_control.getDerivedContourColor = function (percentile = 0.50, maxLightness = 210) {
    if (typeof Waterfall === 'undefined' || typeof Waterfall.makeColor !== 'function' || typeof spectrum === 'undefined') {
        return 'rgb(255, 204, 0)';
    }

    const min = spectrum.min || -120;
    const max = spectrum.max || -20;
    const targetSignal = min + ((max - min) * percentile);

    const rgb = Waterfall.makeColor(targetSignal);
    let [r, g, b] = [rgb[0], rgb[1], rgb[2]];

    const currentMax = Math.max(r, g, b);
    if (currentMax > maxLightness) {
        const scale = maxLightness / currentMax;
        r = Math.round(r * scale);
        g = Math.round(g * scale);
        b = Math.round(b * scale);
    }

    return `rgb(${r}, ${g}, ${b})`;
};

Plugins.filter_control.makeModalDraggable = function (headerEl, modalEl) {
    var isDragging = false;
    var startX = 0, startY = 0;
    var initialLeft = 0, initialTop = 0;

    headerEl.style.touchAction = 'none';

    var getCoords = function (e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };

    var onStart = function (e) {
        if (e.target.id === 'fc-close-btn' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        isDragging = true;
        var coords = getCoords(e);
        startX = coords.x;
        startY = coords.y;

        var rect = modalEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        modalEl.style.left = initialLeft + 'px';
        modalEl.style.top = initialTop + 'px';
        modalEl.style.right = 'auto';
        modalEl.style.bottom = 'auto';

        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
    };

    var onMove = function (e) {
        if (!isDragging) return;

        var coords = getCoords(e);
        var deltaX = coords.x - startX;
        var deltaY = coords.y - startY;

        var newLeft = initialLeft + deltaX;
        var newTop = initialTop + deltaY;

        var maxLeft = window.innerWidth - modalEl.offsetWidth;
        var maxTop = window.innerHeight - modalEl.offsetHeight;

        newLeft = Math.max(0, Math.min(maxLeft, newLeft));
        newTop = Math.max(0, Math.min(maxTop, newTop));

        modalEl.style.left = newLeft + 'px';
        modalEl.style.top = newTop + 'px';

        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
    };

    var onEnd = function () {
        isDragging = false;
    };

    headerEl.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    headerEl.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
};

Plugins.filter_control.injectReceiverPanelButton = function () {
    var rxPanel = document.querySelector('#openwebrx-panel-receiver, .openwebrx-panel-receiver');
    if (!rxPanel || document.getElementById('fc-rx-btn')) return;

    var container = document.createElement('div');
    container.style.cssText = 'margin-top: 6px; text-align: center;';

    var btn = document.createElement('button');
    btn.id = 'fc-rx-btn';
    btn.className = 'openwebrx-button';
    btn.innerText = 'Filter Scope';
    btn.style.cssText = 'width: 90%; padding: 4px; font-size: 11px; cursor: pointer;';
    btn.onclick = function () {
        Plugins.filter_control.togglePanel();
    };

    container.appendChild(btn);
    rxPanel.appendChild(container);
};

Plugins.filter_control.togglePanel = function (show) {
    var panel = document.getElementById('fc-floating-modal');
    if (!panel) return;

    if (show === undefined) {
        show = panel.style.display === 'none';
    }

    panel.style.display = show ? 'block' : 'none';
    if (show) {
        Plugins.filter_control.drawCanvas();
    }
};

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

// =========================================================================
// 🎨 CANVAS RENDERING LOGIC
// =========================================================================
Plugins.filter_control.drawCanvas = function () {
    var canvas = document.getElementById('fc-filter-canvas');
    var titleSpan = document.getElementById('fc-modal-title');

    if (!canvas) return;

    var isEditable = this.isFilterModifiable();
    canvas.style.cursor = isEditable ? 'pointer' : 'not-allowed';

    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (demods.length === 0) return;

    var dem = demods[0];
    var mode = (dem.modulation || '').toLowerCase();
    
    var low = this.getLowCut(dem);
    var high = this.getHighCut(dem);
    var bw = Math.abs(high - low);

    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;

    var topY = 22;
    var bottomY = h - 28;

    ctx.clearRect(0, 0, w, h);

    var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
    
    // 🎯 0 Hz Audio is strictly at the horizontal center of the scope
    var centerX = w / 2;
    var hzToX = function (hz) { return centerX + (hz / maxHz) * (w / 2); };

    // --- FREQUENCY SCALE & TICKS ---
    ctx.strokeStyle = '#9a9999';
    ctx.fillStyle = '#cbc4c4';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(centerX, topY);
    ctx.lineTo(centerX, bottomY);
    ctx.stroke();
    ctx.setLineDash([]);

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

    // --- FFT TRACE ---
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
            grad.addColorStop(0, Plugins.filter_control.getDerivedContourColor(0.50, 210));
            grad.addColorStop(1, Plugins.filter_control.getDerivedContourColor(0.10, 180));

            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = Plugins.filter_control.getDerivedContourColor(0.70, 250);
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
        if (titleSpan) titleSpan.innerText = 'Filter - (' + mode.toUpperCase() + ' - Locked)';
        return;
    }

    if (titleSpan) {
        if (mode === 'cw' && typeof UI !== 'undefined' && typeof UI.getCwOffset === 'function') {
            titleSpan.innerText = 'Filter - ' + mode.toUpperCase() + '   ' + bw + ' Hz | tone ' + UI.getCwOffset() + ' Hz';
        } else {
            titleSpan.innerText = 'Filter - ' + mode.toUpperCase() + '   ' + bw + ' Hz';
        }
    }

    // --- PASSBAND SHAPE & ENVELOPE ---
    ctx.fillStyle = 'rgba(255, 204, 0, 0.18)';
    ctx.fillRect(x1, topY, x2 - x1, bottomY - topY);

    var shiftZoneY = topY + (bottomY - topY) * 0.6;
    ctx.fillStyle = 'rgba(255, 204, 0, 0.25)';
    ctx.fillRect(x1, shiftZoneY, x2 - x1, bottomY - shiftZoneY);

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

    // Labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffcc00';

    var lowText = (low > 0 ? '+' : '') + low;
    var highText = (high > 0 ? '+' : '') + high;
    var dist = Math.abs(x2 - x1);

    if (x1 >= 0 && x1 <= w) {
        ctx.beginPath();
        ctx.arc(x1, topY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = (dist < 45) ? 'right' : (x1 < 30 ? 'left' : 'center');
        var lx = (dist < 45) ? Math.max(25, x1 - 6) : Math.max(25, Math.min(w - 25, x1));
        ctx.fillText(lowText, lx, topY - 6);
    }

    if (x2 >= 0 && x2 <= w) {
        ctx.beginPath();
        ctx.arc(x2, topY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = (dist < 45) ? 'left' : (x2 > w - 30 ? 'right' : 'center');
        var hx = (dist < 45) ? Math.min(w - 25, x2 + 6) : Math.max(25, Math.min(w - 25, x2));
        ctx.fillText(highText, hx, topY - 6);
    }

    // Side Chevron Buttons (Left/Right Stepping Areas)
    var arrowW = 30;
    var midY = h / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, 0, arrowW, h);
    ctx.fillRect(w - arrowW, 0, arrowW, h);

    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀', arrowW / 2, midY);
    ctx.fillText('▶', w - (arrowW / 2), midY);
    ctx.restore();

    // Reticle / Cursor Hz
    var hxPos = Plugins.filter_control._hoverX;
    if (hxPos !== null && hxPos >= arrowW && hxPos <= (w - arrowW) && !Plugins.filter_control.isDragging) {
        var isQsyZone = (hxPos < (x1 - 10) || hxPos > (x2 + 10));
        var isScaleBar = (Plugins.filter_control._hoverY >= bottomY);

        if (isQsyZone || isScaleBar) {
            var hoverHz = Math.round(((hxPos - centerX) / (w / 2)) * maxHz);
            var label = (hoverHz > 0 ? '+' : '') + hoverHz + ' Hz';

            ctx.save();
            ctx.strokeStyle = 'rgba(0, 230, 255, 0.7)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(hxPos, topY);
            ctx.lineTo(hxPos, bottomY);
            ctx.stroke();

            ctx.fillStyle = '#00e6ff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            var clampedTx = Math.max(arrowW + 20, Math.min(w - arrowW - 20, hxPos));
            ctx.fillText(label, clampedTx, bottomY - 6);
            ctx.restore();
        }
    }
};

// =========================================================================
// 🖱️ MOUSE & TOUCH EVENT LISTENERS
// =========================================================================
Plugins.filter_control.attachCanvasEvents = function (canvas) {
    var activeHit = null;
    var startX = 0, origLow = 0, origHigh = 0, origOffset = 0;

    // Prevent context menu on canvas so right-clicks can trigger fine steps
    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    var getCanvasCoords = function (e) {
        var rect = canvas.getBoundingClientRect();
        var touch = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null);
        var clientX = touch ? touch.clientX : e.clientX;
        var clientY = touch ? touch.clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    var getCenterFreq = function () {
        if (typeof UI !== 'undefined') {
            if (typeof UI.getCenterFrequency === 'function') return UI.getCenterFrequency();
            if (typeof UI.center_freq === 'number') return UI.center_freq;
            if (typeof UI.centerFreq === 'number') return UI.centerFreq;
        }
        if (typeof center_freq !== 'undefined' && typeof center_freq === 'number') {
            return center_freq;
        }
        return 0;
    };

    var getDemodOffset = function (demodulator) {
        if (!demodulator) return 0;
        if (typeof demodulator.get_offset_frequency === 'function') {
            return demodulator.get_offset_frequency();
        }
        if (typeof demodulator.offset === 'number') {
            return demodulator.offset;
        }
        return 0;
    };

    var setDemodOffset = function (demodulator, newOffset) {
        if (!demodulator) return;
        if (typeof demodulator.set_offset_frequency === 'function') {
            demodulator.set_offset_frequency(newOffset);
        } else if (typeof demodulator.set_offset === 'function') {
            demodulator.set_offset(newOffset);
        } else {
            demodulator.offset = newOffset;
        }
        
        Plugins.filter_control.drawCanvas();
    };

    // Fine/Coarse Step execution logic
    var stepDemodOffset = function (demod, direction, isFine) {
        if (!demod) return;
        var mode = (demod.modulation || '').toLowerCase();
        
        // Define fine & coarse step magnitudes per modulation type
        var stepSizes = {
            cw:  { fine: 10, coarse: 100 },
            lsb: { fine: 20, coarse: 100 },
            usb: { fine: 20, coarse: 100 },
            am:  { fine: 50, coarse: 500 },
            sam: { fine: 50, coarse: 500 },
            nfm: { fine: 50, coarse: 500 }
        };
        var config = stepSizes[mode] || { fine: 20, coarse: 100 };
        var stepHz = isFine ? config.fine : config.coarse;

        var centerFreq = getCenterFreq();
        var currentOffset = getDemodOffset(demod);
        var currentAbs = centerFreq + currentOffset;

        var targetAbs = currentAbs + (direction * stepHz);
        var freqNew = Math.round(targetAbs / stepHz) * stepHz;

        setDemodOffset(demod, freqNew - centerFreq);
    };

    var qsyDemodOffset = function (demod, x, w, maxHz, isTouch, mode) {
        var centerX = w / 2;
        var currentOffset = getDemodOffset(demod);
        
        var rawDeltaHz = Math.round(((x - centerX) / centerX) * maxHz);
        
        // Passband Midpoint Offset
        var passbandMidpointHz = 0;
        if (demod) {
            var low = Plugins.filter_control.getLowCut(demod);
            var high = Plugins.filter_control.getHighCut(demod);
            var baseMode = (demod.modulation || '').toLowerCase();
            if (baseMode === 'usb') {
                passbandMidpointHz = low;
            } else if (baseMode === 'lsb') {
                passbandMidpointHz = high;
            } else {
                passbandMidpointHz = Math.round((low + high) / 2);
            }
        }

        var targetOffsetHz = currentOffset + rawDeltaHz - passbandMidpointHz;

        if (isTouch) {
            var snapGrid = (mode === 'cw') ? 100 : 500;
            var centerFreq = getCenterFreq();
            var targetAbsFreq = centerFreq + targetOffsetHz;
            targetAbsFreq = Math.round(targetAbsFreq / snapGrid) * snapGrid;
            targetOffsetHz = targetAbsFreq - centerFreq;
        }

        setDemodOffset(demod, targetOffsetHz);
    };

    var onStart = function (e) {
        var coords = getCanvasCoords(e);
        var x = coords.x;
        var y = coords.y;
        var w = canvas.width;
        var h = canvas.height;

        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        var dem = demods.length ? demods[0] : null;

        var arrowWidth = 30;

        // Determine if action is a Fine Step (Right Click or Shift + Left Click)
        var isFine = (e.button === 2) || e.shiftKey;

        if (x <= arrowWidth) {
            stepDemodOffset(dem, -1, isFine);
            e.preventDefault();
            return;
        }
        if (x >= w - arrowWidth) {
            stepDemodOffset(dem, 1, isFine);
            e.preventDefault();
            return;
        }

        // Ignore right clicks on the rest of the canvas
        if (e.button === 2) return;

        if (!Plugins.filter_control.isFilterModifiable() || !dem) return;

        var mode = (dem.modulation || '').toLowerCase();
        var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
        
        var centerX = w / 2;
        var hzToX = function (hz) { return centerX + (hz / maxHz) * (w / 2); };

        var low = Plugins.filter_control.getLowCut(dem);
        var high = Plugins.filter_control.getHighCut(dem);

        var x1 = hzToX(low);
        var x2 = hzToX(high);

        var topY = 22;
        var bottomY = h - 28;
        var splitY = topY + (bottomY - topY) * 0.6;

        var isTouch = Plugins.filter_control.isTouchDevice();
        var isScaleBar = (y >= bottomY);
        var isOutsidePassband = (x < (x1 - 10) || x > (x2 + 10));

        if (isScaleBar || (isOutsidePassband && (!isTouch || y >= splitY))) {
            qsyDemodOffset(dem, x, w, maxHz, isTouch, mode);
            e.preventDefault();
            return;
        }

        if (y >= splitY) {
            if (x >= x1 - 10 && x <= x2 + 10) activeHit = 'center';
            else return;
        } else {
            var distLow = Math.abs(x - x1);
            var distHigh = Math.abs(x - x2);

            if (Math.abs(x2 - x1) < 15) {
                activeHit = (distLow <= distHigh) ? 'low' : 'high';
            } else {
                if (distLow < 15) activeHit = 'low';
                else if (distHigh < 15) activeHit = 'high';
                else if (x > x1 && x < x2) activeHit = 'center';
                else return;
            }
        }

        Plugins.filter_control.isDragging = true;
        Plugins.filter_control._hoverX = null;
        Plugins.filter_control._hoverY = null;
        startX = x;
        origLow = low;
        origHigh = high;
        origOffset = (typeof dem.get_offset_frequency === 'function') 
            ? dem.get_offset_frequency() 
            : (dem.offset || 0);
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
        var clampedX = Math.max(0, Math.min(w, coords.x));
        var deltaHz = Math.round(((clampedX - startX) / (w / 2)) * maxHz);

        var newLow = origLow;
        var newHigh = origHigh;
        var isSymmetric = (mode === 'am' || mode === 'sam' || mode === 'nfm');
        var minBw = (mode === 'cw') ? 100 : 50;

        if (isSymmetric) {
            if (activeHit === 'low' || activeHit === 'high') {
                var cursorHz = Math.round(((clampedX - (w / 2)) / (w / 2)) * maxHz);
                var centerPitch = (origLow + origHigh) / 2;
                var halfBw = Math.max(100, Math.abs(cursorHz - centerPitch));

                if (centerPitch - halfBw < -maxHz) halfBw = maxHz + centerPitch;
                if (centerPitch + halfBw > maxHz)  halfBw = maxHz - centerPitch;

                newLow = Math.round(centerPitch - halfBw);
                newHigh = Math.round(centerPitch + halfBw);
            } 
            else if (activeHit === 'center') {
                var bw = origHigh - origLow;
                newLow = origLow + deltaHz;
                newHigh = origHigh + deltaHz;

                if (newLow < -maxHz) {
                    newLow = -maxHz;
                    newHigh = newLow + bw;
                }
                if (newHigh > maxHz) {
                    newHigh = maxHz;
                    newLow = newHigh - bw;
                }
            }
        }
        else {
            if (activeHit === 'low') {
                newLow = Math.min(origLow + deltaHz, origHigh - minBw);
                newLow = Math.max(-maxHz, newLow);
                newHigh = origHigh;
            } 
            else if (activeHit === 'high') {
                newHigh = Math.max(origHigh + deltaHz, origLow + minBw);
                newHigh = Math.min(maxHz, newHigh);
                newLow = origLow;
            } 
            else if (activeHit === 'center') {
                var bw = origHigh - origLow;
                newLow = origLow + deltaHz;
                newHigh = origHigh + deltaHz;

                if (newLow < -maxHz) {
                    newLow = -maxHz;
                    newHigh = newLow + bw;
                }
                if (newHigh > maxHz) {
                    newHigh = maxHz;
                    newLow = newHigh - bw;
                }
            }
        }
        dem.setBandpass({ low_cut: newLow, high_cut: newHigh });

        // CW NCO Tracking
        if (mode === 'cw') {
            var origMidpoint = Math.round((origLow + origHigh) / 2);
            var newMidpoint = Math.round((newLow + newHigh) / 2);
            var midpointShift = newMidpoint - origMidpoint;

            var targetOffset = origOffset - midpointShift;

            if (typeof dem.set_offset_frequency === 'function') {
                dem.set_offset_frequency(targetOffset);
            } else if (typeof dem.set_offset === 'function') {
                dem.set_offset(targetOffset);
            } else {
                dem.offset = targetOffset;
            }

            if (typeof UI !== 'undefined') {
                UI.cwOffset = newMidpoint;
            }
        }
                
        Plugins.filter_control.drawCanvas();
        e.preventDefault();
    };

    var onEnd = function () {
        if (!activeHit) return;
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        if (demods.length > 0) {
            var dem = demods[0];
            var mode = (dem.modulation || '').toLowerCase();
            
            var low = Plugins.filter_control.getLowCut(dem);
            var high = Plugins.filter_control.getHighCut(dem);

            if (mode === 'cw' && typeof UI !== 'undefined') {
                UI.cwOffset = Math.round((low + high) / 2);
            }

            if (typeof UI !== 'undefined' && typeof UI.saveBandpass === 'function') {
                UI.saveBandpass(mode, low, high);
            }
        }
        activeHit = null;
        Plugins.filter_control.isDragging = false;
        Plugins.filter_control.drawCanvas();
    };

    var onHover = function (e) {
        if (Plugins.filter_control.isDragging) {
            Plugins.filter_control._hoverX = null;
            Plugins.filter_control._hoverY = null;
            return;
        }

        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        if (!demods.length) return;

        var coords = getCanvasCoords(e);
        var x = coords.x;
        var y = coords.y;
        var w = canvas.width;
        var h = canvas.height;
        var bottomY = h - 28;

        var isTouch = Plugins.filter_control.isTouchDevice();

        if (!isTouch) {
            Plugins.filter_control._hoverX = x;
            Plugins.filter_control._hoverY = y;
        } else {
            Plugins.filter_control._hoverX = null;
            Plugins.filter_control._hoverY = null;
        }

        if (!Plugins.filter_control.isFilterModifiable()) {
            canvas.style.cursor = 'not-allowed';
        } else {
            var dem = demods[0];
            var mode = (dem.modulation || '').toLowerCase();
            var maxHz = (mode === 'am' || mode === 'sam' || mode === 'nfm') ? 12000 : (mode === 'cw' ? 2000 : 5000);
            
            var centerX = w / 2;
            var hzToX = function (hz) { return centerX + (hz / maxHz) * (w / 2); };

            var low = Plugins.filter_control.getLowCut(dem);
            var high = Plugins.filter_control.getHighCut(dem);

            var x1 = hzToX(low);
            var x2 = hzToX(high);

            var isScaleBar = (y >= bottomY);
            var isOutsidePassband = (x < (x1 - 10) || x > (x2 + 10));

            if (x <= 30 || x >= w - 30) {
                canvas.style.cursor = 'pointer';
            } else if (isScaleBar || isOutsidePassband) {
                canvas.style.cursor = 'crosshair';
            } else {
                var topY = 22;
                var splitY = topY + (bottomY - topY) * 0.6;
                var distLow = Math.abs(x - x1);
                var distHigh = Math.abs(x - x2);

                if (y < splitY && (distLow < 15 || distHigh < 15)) {
                    canvas.style.cursor = 'ew-resize';
                } else {
                    canvas.style.cursor = 'grab';
                }
            }
        }

        Plugins.filter_control.drawCanvas();
    };

    canvas.addEventListener('mousemove', onHover);
    canvas.addEventListener('mouseleave', function () {
        Plugins.filter_control._hoverX = null;
        Plugins.filter_control._hoverY = null;
        Plugins.filter_control.drawCanvas();
    });

    canvas.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    
    window.addEventListener('blur', onEnd);
    document.addEventListener('mouseleave', onEnd);

    canvas.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
};

// =========================================================================
// 🎛️ PRESETS
// =========================================================================
Plugins.filter_control.applyPreset = function (tier) {
    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (!demods.length) return;
    var dem = demods[0];
    var mode = (dem.modulation || '').toLowerCase();
    
    var oldHi = this.getHighCut(dem);
    var oldLo = this.getLowCut(dem); 
    var oldCwOffset = (typeof UI !== 'undefined' && typeof UI.getCwOffset === 'function') ? UI.getCwOffset() : 600;

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
    if (mode === 'lsb') { 
        low = -bw + oldHi; 
        high = oldHi; 
    }
    else if (mode === 'usb') { 
        low = oldLo; 
        high = bw + oldLo; 
    }
    else if (mode === 'cw') {
        var half = Math.round(bw / 2); 
        low = oldCwOffset - half;
        high = oldCwOffset + half;
    }
    else { 
        var half = Math.round(bw / 2); 
        var center = Math.round((oldHi + oldLo) / 2);
        low = center - half; 
        high = center + half; 
    }

    if (Plugins.filter_control.isFilterModifiable()) {
        dem.setBandpass({ low_cut: low, high_cut: high });
        
        if (mode === 'cw' && typeof UI !== 'undefined') {
            UI.cwOffset = Math.round((low + high) / 2);
        } 
 
        if (typeof UI !== 'undefined' && typeof UI.saveBandpass === 'function') {
            UI.saveBandpass(mode, low, high);
        }
    }
    Plugins.filter_control.drawCanvas();
};

Plugins.filter_control.resetPreset = function () {
    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (!demods.length) return;
    var dem = demods[0];
    var mode = (dem.modulation || '').toLowerCase();

    var low, high;
    if (mode === 'lsb') { 
        low = -2400; 
        high = -100; 
    }
    else if (mode === 'usb') { 
        low = 100; 
        high = 2400; 
    }
    else if (mode === 'cw') {
        low = 100;
        high = 600;
    }
    else if (mode === 'am' || mode === 'sam') {
        low = -3000; 
        high = 3000; 
    }
    else {
        low = -5000; 
        high = 5000; 
    }

    if (Plugins.filter_control.isFilterModifiable()) {
        dem.setBandpass({ low_cut: low, high_cut: high });
        
        if (mode === 'cw' && typeof UI !== 'undefined') {
            UI.cwOffset = Math.round((low + high) / 2);
        } 

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
