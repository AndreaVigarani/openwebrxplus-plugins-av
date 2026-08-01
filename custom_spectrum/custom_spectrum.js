/**
 * OpenWebRX+ Plugin: Custom Spectrum (Gqrx & SpectraVue Ports)
 * Version: 1.4
 * License: MIT
 * Copyright (c) 2026 Andrea Vigarani
 * Code partially derived from Gqrx (Alexandru Csete), colorful_spectrum /spectravue (Konst Karapan) and my own tweaks
 * 
 */

 

Plugins.custom_spectrum = Plugins.custom_spectrum || {};
Plugins.custom_spectrum._version = 1.4;
Plugins.custom_spectrum.no_css = false;
// 1. Read the static height set from init.js, fallback to local storage or 150px
const configuredHeight = typeof Plugins.custom_spectrum_height === 'number' 
    ? Plugins.custom_spectrum_height 
    : 50;

// Persistent Settings
Plugins.custom_spectrum.settings = {
    spectrumHeight: configuredHeight,
    type: 'fsp',
    primaryColor: '#00e5ff',
    peakColor: '#ff2a6d',
    enablePeakHold: false,
    decayRate: 0.92,
    persistence: 0.15
};

Plugins.custom_spectrum.applyStaticHeightCss = function (heightPx) {
    const styleId = 'owrx-static-spectrum-height';
    let style = document.getElementById(styleId);
    
    if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
    }

    style.textContent = `
        /* Override base layout height before JS calculates pixel coordinates */
        .openwebrx-spectrum-container {
            max-height: ${heightPx}px !important;
        }
        .openwebrx-spectrum-container.expanded {
            height: ${heightPx}px !important;
            border-bottom: none;
        }
        #openwebrx-spectrum-canvas {
            height: ${heightPx}px !important;
        }
    `;
};
/// make receiver panel always overlap everything
Plugins.custom_spectrum.injectCss = function () {
    const styleId = 'owrx-custom-spectrum-css';
    if (document.getElementById(styleId)) return; // Prevent duplicate injection

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* ========================================================= */
        /* OpenWebRX Panel & Canvas Layout Overrides                 */
        /* ========================================================= */

        /* Re-anchor right side panels and prevent clipping */
        #openwebrx-panels-container-right {
            position: fixed !important;
            bottom: 0 !important;
            right: 10px !important;
            top: auto !important;
            left: auto !important;
            height: auto !important;
            max-height: calc(100vh - 60px) !important;
            display: flex !important;
            flex-direction: column-reverse !important;
            justify-content: flex-start !important;
            z-index: 99999 !important;
            overflow: visible !important;
        }

        #openwebrx-panels-container-right .openwebrx-panel {
            position: relative !important;
            z-index: 100000 !important;
            transform-origin: bottom center !important;
            background-color: rgba(30, 30, 30, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.6) !important;
            margin-top: 5px !important;
        }
      /* Enable Flexbox column layout for the parent container */
        #openwebrx-frequency-container {
            display: flex !important;
            flex-direction: column !important;
        }

        /* 1. Bandplan at the very top */
        .openwebrx-bandplan-container {
            order: 1 !important;
        }

        /* 2. Scale Canvas moved ABOVE the spectrum */
        #openwebrx-scale-container {
            order: 2 !important;
        }

        /* 3. Spectrum Canvas moved BELOW scale, directly touching the waterfall */
        .openwebrx-spectrum-container {
            order: 3 !important;
        }

        /* Ensure no weird bottom margin separates the spectrum from the waterfall */
        .openwebrx-spectrum-container {
            margin-bottom: 0 !important;
        }
            /* 1. Master Container: Define your custom unified gradient or theme background */
            #openwebrx-frequency-container {
            display: flex !important;
            flex-direction: column !important;

            /* OPTION A: Dark Modern Radio Slate (Fade down into waterfall) */
            background: linear-gradient(180deg, #3e3e3e 0%, #121215 70%, #0a0a0c 100%) !important;

            /* OPTION B: If you prefer keeping the theme PNG background, uncomment below: */
            /* background-image: url("static/gfx/openwebrx-scale-background.png") !important; */
            /* background-repeat: repeat-x !important; */
            /* background-size: cover !important; */

            z-index: 1001 !important;
        }

        /* 2. Flex Order Setup */
        .openwebrx-bandplan-container { order: 1 !important; }
        #openwebrx-scale-container    { order: 2 !important; }
        .openwebrx-spectrum-container { order: 3 !important; }

        /* 3. Strip Hardcoded Backgrounds from Scale Container & Canvas */
        #openwebrx-scale-container {
            height: 47px !important;
            overflow: hidden !important;
            z-index: 1000 !important;
            position: relative !important;
            background: transparent !important; /* Let parent background show through */
        }

        #openwebrx-scale-canvas {
            background: transparent !important;
        }

        /* 4. Strip Hardcoded Backgrounds from Spectrum Container & Canvas */
        .openwebrx-spectrum-container {
            background: transparent !important;
            margin-bottom: 0 !important;
        }

        #openwebrx-spectrum-canvas {
            background: transparent !important;
        }
    `;
    document.head.appendChild(style);
};

Plugins.custom_spectrum.STORAGE_KEY = 'owrx_custom_spectrum_cfg';
Plugins.custom_spectrum._peaksBuffer = null;

// Offscreen buffer canvas for persistence/3D trailing
Plugins.custom_spectrum._trailCanvas = document.createElement('canvas');
Plugins.custom_spectrum._trailCtx = Plugins.custom_spectrum._trailCanvas.getContext('2d');


Plugins.custom_spectrum.init = async function () {
    if (!Plugins.isLoaded('utils', 0.4)) {
        await Plugins.load('https://0xaf.github.io/openwebrxplus-plugins/receiver/utils/utils.js');
        if (!Plugins.isLoaded('utils', 0.4)) return false;
    }

    if (!Plugins.isLoaded('uikit', 0.6)) {
        await Plugins.load('https://0xaf.github.io/openwebrxplus-plugins/receiver/uikit/uikit.js');
        if (!Plugins.isLoaded('uikit', 0.6)) return false;
    }

    if (Plugins.uikit._initPromise instanceof Promise) {
        await Plugins.uikit._initPromise;
    }
    this.applyStaticHeightCss(this.settings.spectrumHeight);
    this.injectCss();
   
    this.loadSettings();
    
    Plugins.utils.on_ready(() => {
       this.hookSpectrumDraw();
       this.hookCustomScale(); // swaps scale logic 
       this.initOverlayCanvas();
    this.buildUi();

    // Trigger initial redraw so the new scale renders immediately
    if (typeof window.mkscale === 'function') {
        window.mkscale();
    }
        this.buildUi();
        console.log('✅ [custom_spectrum v1.4] Visualizer engine initialized.');
    });
    
    return true;
};
/**
 * Derives a readable color from OpenWebRX's current Waterfall LUT
 * @param {number} percentile Normalized dynamic range position (0.0 = min, 1.0 = max)
 * @param {number} maxLightness RGB saturation ceiling to prevent whiteouts (0-255)
 */
Plugins.custom_spectrum.getDerivedContourColor = function (percentile = 0.50, maxLightness = 210) {
    if (typeof Waterfall === 'undefined' || typeof Waterfall.makeColor !== 'function' || typeof spectrum === 'undefined') {
        return this.settings.primaryColor;
    }

    const min = spectrum.min || -120;
    const max = spectrum.max || -20;
    const targetSignal = min + ((max - min) * percentile);

    const rgb = Waterfall.makeColor(targetSignal);
    let [r, g, b] = [rgb[0], rgb[1], rgb[2]];

    // Clamp peak lightness to prevent thin lines from turning pure white/bleached
    const currentMax = Math.max(r, g, b);
    if (currentMax > maxLightness) {
        const scale = maxLightness / currentMax;
        r = Math.round(r * scale);
        g = Math.round(g * scale);
        b = Math.round(b * scale);
    }

    return `rgb(${r}, ${g}, ${b})`;
};
/**
 * Renders a glowing Peak Hold trace (Bloom + Core Line)
 */
Plugins.custom_spectrum.drawPeakHoldBloom = function (mainCtx, specObj, spec_width, spec_height, data_start, x_ratio, y_ratio, peakColor) {
    if (!this._peaksBuffer || this._peaksBuffer.length !== spec_width) {
        this._peaksBuffer = new Float32Array(spec_width);
    }

    const data_height = Math.abs(specObj.max - specObj.min) || 1;

    // Calculate peaks with decay rate
    mainCtx.beginPath();
    for (let x = 0; x < spec_width; x++) {
        const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
        const y = spec_height - (dataVal - specObj.min) * y_ratio;

        if (y < this._peaksBuffer[x] || !this._peaksBuffer[x]) {
            this._peaksBuffer[x] = y;
        } else {
            this._peaksBuffer[x] += (spec_height - this._peaksBuffer[x]) * (1 - this.settings.decayRate);
        }

        if (x === 0) mainCtx.moveTo(x, this._peaksBuffer[x]);
        else mainCtx.lineTo(x, this._peaksBuffer[x]);
    }

    mainCtx.save();

    // 1. Wide Bloom Halo (Background Glow)
    mainCtx.lineWidth = 1.3;
    mainCtx.strokeStyle = peakColor;
    mainCtx.globalAlpha = 0.55; // Soft glow
    mainCtx.stroke();
    mainCtx.restore();
};

Plugins.custom_spectrum.loadSettings = function () {
    try {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) this.settings = Object.assign({}, this.settings, JSON.parse(saved));
    } catch (e) {
        console.warn('[custom_spectrum] Failed to load settings:', e);
    }
};

Plugins.custom_spectrum.saveSettings = function () {
    try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
        console.warn('[custom_spectrum] Failed to save settings:', e);
    }
};

/**
 * Sync offscreen trail buffer dimensions safely
 */
Plugins.custom_spectrum._syncTrailCanvas = function (w, h) {
    if (this._trailCanvas.width !== w || this._trailCanvas.height !== h) {
        this._trailCanvas.width = w;
        this._trailCanvas.height = h;
        if (this._trailCtx) {
            this._trailCtx.clearRect(0, 0, w, h);
        }
    }
};

/**
 * Safely resolve 2D Context from spectrum instance
 */
Plugins.custom_spectrum.getValidContext = function (specObj) {
    if (!specObj) return null;
    if (specObj.ctx) return specObj.ctx;
    if (specObj.el && typeof specObj.el.getContext === 'function') {
        const ctx = specObj.el.getContext('2d');
        if (ctx) specObj.ctx = ctx; // Cache back to instance
        return ctx;
    }
    return null;
};

/**
 * Hook spectrum.draw with bulletproof guard clauses
 */
Plugins.custom_spectrum.hookSpectrumDraw = function () {
    const self = this;

    if (typeof spectrum === 'undefined') return;

    Plugins.utils.wrap_func(
        'draw',
        // Pre-Execution Guard
        function (orig, thisArg, args) {
            const ctx = self.getValidContext(thisArg);
            if (!ctx || !thisArg.el) return true;

            if (self.settings.type !== 'default') {
                const w = thisArg.el.offsetWidth || thisArg.el.width || 0;
                const h = thisArg.el.offsetHeight || thisArg.el.height || 0;
                if (w > 0 && h > 0) {
                    self._syncTrailCanvas(w, h);
                }
            }
            return true;
        },
        // Post-Execution
        function (res, thisArg, args) {
            if (self.settings.type === 'default') return;
            
            const ctx = self.getValidContext(thisArg);
            if (!ctx) return;

            self.drawCustomSpectrum(thisArg, ctx);
        },
        spectrum
    );
};

/**
 * Core Drawing Routine
 */
Plugins.custom_spectrum.drawCustomSpectrum = function (specObj, mainCtx) {
    if (!specObj || !specObj.data || !specObj.el || !mainCtx) return;

    const spec_width = specObj.el.offsetWidth || specObj.el.width || 0;
    const spec_height = specObj.el.offsetHeight || specObj.el.height || 0;
    if (spec_width <= 0 || spec_height <= 0) return;
 
    const vis_freq = get_visible_freq_range();
    const vis_start = 0.5 - (center_freq - vis_freq.start) / bandwidth;
    const vis_end = 0.5 - (center_freq - vis_freq.end) / bandwidth;

    const data_start = Math.round(fft_size * vis_start);
    const data_end = Math.round(fft_size * vis_end);
    const data_width = data_end - data_start;
    const data_height = Math.abs(specObj.max - specObj.min) || 1;

    const x_ratio = data_width / spec_width;
    const y_ratio = spec_height / data_height;

    const primaryColor = (this.settings.usePaletteColors !== false) 
        ? this.getDerivedContourColor(0.55, 180)   
        : this.settings.primaryColor;

    const peakColor = (this.settings.usePaletteColors !== false) 
        ? this.getDerivedContourColor(0.95, 220)   
        : this.settings.peakColor;

    const type = this.settings.type;
    const tCtx = this._trailCtx;

    // --- 1. OFFSCREEN TRAIL RENDERING (Phosphor & 3D) ---
    if (type === 'fsp' && tCtx) {
        tCtx.save();
        tCtx.globalCompositeOperation = 'destination-out';
        tCtx.fillStyle = `rgba(0, 0, 0, ${this.settings.persistence})`;
        tCtx.fillRect(0, 0, spec_width, spec_height);
        tCtx.restore();

        for (let x = 0; x < spec_width; x++) {
            const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
            const y = spec_height - (dataVal - specObj.min) * y_ratio;
            const normIntensity = Math.min(1.0, Math.max(0.0, (dataVal - specObj.min) / data_height));

            if (typeof Waterfall !== 'undefined' && typeof Waterfall.makeColor === 'function') {
                const c = Waterfall.makeColor(dataVal);
                tCtx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
            } else {
                tCtx.fillStyle = primaryColor;
            }

            const dotSize = normIntensity > 0.7 ? 2.5 : 1.5;
            tCtx.fillRect(x, y, 1.5, dotSize);
        }

    } else if (type === '3d' && tCtx) {
        const imgData = tCtx.getImageData(0, 0, spec_width, spec_height);
        tCtx.clearRect(0, 0, spec_width, spec_height);
        tCtx.putImageData(imgData, 1, -2);

        tCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        tCtx.fillRect(0, 0, spec_width, spec_height);

        for (let x = 0; x < spec_width; x++) {
            const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
            const y = spec_height - (dataVal - specObj.min) * y_ratio;

            if (typeof Waterfall !== 'undefined' && typeof Waterfall.makeColor === 'function') {
                const c = Waterfall.makeColor(dataVal);
                tCtx.strokeStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
            } else {
                tCtx.strokeStyle = primaryColor;
            }

            tCtx.beginPath();
            tCtx.moveTo(x, y + 6);
            tCtx.lineTo(x, y);
            tCtx.stroke();
        }
    }

    // --- 2. MAIN CANVAS DRAWING ---
    mainCtx.save();

    if (type === 'fsp' || type === '3d') {
        mainCtx.clearRect(0, 0, spec_width, spec_height);
        mainCtx.drawImage(this._trailCanvas, 0, 0);

    } else {
        mainCtx.clearRect(0, 0, spec_width, spec_height);

        
        // --- Option A: SpectraVue Full-Extent Palette ---
        if (type === 'spectravue') {
            const fillGradient = mainCtx.createLinearGradient(0, 0, 0, spec_height);
            const strokeGradient = mainCtx.createLinearGradient(0, 0, 0, spec_height);

            for (let i = 0; i <= 10; i++) {
                const step = i / 10;
                const signal = specObj.max - (step * (specObj.max - specObj.min));
                
                let c = [0, 229, 255];
                if (typeof Waterfall !== 'undefined' && typeof Waterfall.makeColor === 'function') {
                    const originalC = Waterfall.makeColor(signal);
                    c = [originalC[0], originalC[1], originalC[2]];
                }

                // Full palette stretch across 100% height
                const fillAlpha = 0.95 - (step * 0.35); 

                fillGradient.addColorStop(step, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${fillAlpha})`);
                strokeGradient.addColorStop(step, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 1.0)`);
            }

            mainCtx.beginPath();
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = spec_height - (dataVal - specObj.min) * y_ratio;
                if (x === 0) mainCtx.moveTo(x, y);
                else mainCtx.lineTo(x, y);
            }

            mainCtx.lineWidth = 1.5;
            mainCtx.strokeStyle = strokeGradient;
            mainCtx.stroke();

            mainCtx.lineTo(spec_width, spec_height);
            mainCtx.lineTo(0, spec_height);
            mainCtx.closePath();

            mainCtx.fillStyle = fillGradient;
            mainCtx.fill();

        } else if (type === 'mirror') {
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = (dataVal - specObj.min) * y_ratio;

                if (typeof Waterfall !== 'undefined' && typeof Waterfall.makeColor === 'function') {
                    const c = Waterfall.makeColor(dataVal);
                    mainCtx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
                } else {
                    mainCtx.fillStyle = primaryColor;
                }
                mainCtx.fillRect(x, spec_height, 1, -y);
            }

            mainCtx.beginPath();
            mainCtx.strokeStyle = primaryColor;
            mainCtx.lineWidth = 1;
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = spec_height - (dataVal - specObj.min) * y_ratio;
                if (x === 0) mainCtx.moveTo(x, y);
                else mainCtx.lineTo(x, y);
            }
            mainCtx.stroke();

        } else if (type === 'bin') {
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = (dataVal - specObj.min) * y_ratio;
                const alpha = Math.min(1.0, Math.max(0.1, y / spec_height));

                mainCtx.fillStyle = primaryColor;
                mainCtx.globalAlpha = alpha;
                mainCtx.fillRect(x, spec_height, 1, -y);
            }
            mainCtx.globalAlpha = 1.0;

        } else if (type === 'line') {
            mainCtx.beginPath();
            mainCtx.strokeStyle = primaryColor;
            mainCtx.lineWidth = 1.5;
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = spec_height - (dataVal - specObj.min) * y_ratio;
                if (x === 0) mainCtx.moveTo(x, y);
                else mainCtx.lineTo(x, y);
            }
            mainCtx.stroke();

        } else if (type === 'dots') {
            mainCtx.fillStyle = primaryColor;
            for (let x = 0; x < spec_width; x += 2) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = spec_height - (dataVal - specObj.min) * y_ratio;
                mainCtx.fillRect(x, y, 2, 2);
            }
        } else if (type === 'full') {
            const fillGradient = mainCtx.createLinearGradient(0, 0, 0, spec_height);
            const strokeGradient = mainCtx.createLinearGradient(0, 0, 0, spec_height);
            fillGradient.addColorStop(0, primaryColor);
            fillGradient.addColorStop(1, "rgba(8, 8, 8, 0.9)");
            strokeGradient.addColorStop(0,primaryColor);
            mainCtx.beginPath();
            for (let x = 0; x < spec_width; x++) {
                const dataVal = specObj.data[data_start + ((x * x_ratio) | 0)] || 0;
                const y = spec_height - (dataVal - specObj.min) * y_ratio;
                if (x === 0) mainCtx.moveTo(x, y);
                else mainCtx.lineTo(x, y);
            }
            mainCtx.lineWidth = 1.5;
            mainCtx.strokeStyle = strokeGradient;
            mainCtx.stroke();

            mainCtx.lineTo(spec_width, spec_height);
            mainCtx.lineTo(0, spec_height);
            mainCtx.closePath();

            mainCtx.fillStyle = fillGradient;
            mainCtx.fill();
        }
        // --- DRAW PEAK HOLD BLOOM BEHIND PRIMARY TRACE ---
        if (this.settings.enablePeakHold) {
            this.drawPeakHoldBloom(mainCtx, specObj, spec_width, spec_height, data_start, x_ratio, y_ratio, peakColor);
        }

    }
    var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
    for (var i=0; i<demods.length; i++) {
        var f = demods[i].get_offset_frequency() + center_freq;
        var x = scale_px_from_freq(f, range);
        mainCtx.beginPath();
        mainCtx.moveTo(x, 0);
        mainCtx.lineTo(x, spec_height);
        mainCtx.strokeStyle = "rgba(255,255,255,0.5)"
        mainCtx.lineWidth = 1;
        mainCtx.stroke();
    }

    mainCtx.restore();
};

/**
 * UIKit Interface
 */
Plugins.custom_spectrum.buildUi = function () {
    const self = this;

    const tabSlug = Plugins.uikit.addTab('Spectrum', { order: 910 });
    const tabEl = Plugins.uikit.getTabEl(tabSlug);

    if (!tabEl) return;

    const wrap = document.createElement('div');
    wrap.style.padding = '8px';

    const header = document.createElement('div');
    header.className = 'owrx-uikit__settings-section';
    header.innerHTML = `
        <div class="owrx-uikit__settings-title">Spectrum Visualizer</div>
    `;
    wrap.appendChild(header);

    // Mode Selector
    const modeGroup = document.createElement('div');
    modeGroup.style.margin = '10px 0';
    modeGroup.innerHTML = `<label style="display:block; font-weight:bold; margin-bottom:4px;">Display Mode</label>`;

    const select = document.createElement('select');
    select.style.cssText = 'width: 100%; padding: 6px; background: #2a2a2a; color: #fff; border: 1px solid #444; border-radius: 4px;';

    const modes = [
        { id: 'fsp', name: 'Digital Phosphor RTA' },
        { id: 'spectravue', name: 'SpectraVue Gradient Fill' },
        { id: '3d', name: 'Pseudo 3D Ribbon' },
        { id: 'mirror', name: 'Waterfall Palette Fill' },
        { id: 'bin', name: 'Vertical Bins' },
        { id: 'full', name:'Full gradient'},
        { id: 'line', name: 'Contour Line' },
        { id: 'dots', name: 'Discrete Dots' },
        { id: 'default', name: 'OpenWebRX Native' }
    ];

    modes.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = m.name;
        if (m.id === self.settings.type) opt.selected = true;
        select.appendChild(opt);
    });

    modeGroup.appendChild(select);
    wrap.appendChild(modeGroup);

    // Persistence Speed
    const fspControls = document.createElement('div');
    fspControls.style.display = (self.settings.type === 'fsp') ? 'block' : 'none';
    fspControls.style.margin = '10px 0';
    fspControls.innerHTML = `
        <label style="display:block; font-weight:bold; margin-bottom:4px;">Phosphor Decay Speed</label>
        <input type="range" id="spec-persistence" min="0.02" max="0.40" step="0.01" value="${self.settings.persistence}" style="width:100%;">
    `;
    fspControls.querySelector('#spec-persistence').addEventListener('input', function (e) {
        self.settings.persistence = parseFloat(e.target.value);
        self.saveSettings();
    });
      
    wrap.appendChild(fspControls);

    // Helper helper function (or inline it)
    const isTrailingMode = (type) => type === 'fsp' || type === '3d';

    // Peak Hold Group setup
    const peakGroup = document.createElement('div');
    // Initial check when UI opens/renders
    peakGroup.style.display = isTrailingMode(self.settings.type) ? 'none' : 'block';
    peakGroup.style.margin = '10px 0';
    peakGroup.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer;">
            <input type="checkbox" id="spec-enable-peak" ${self.settings.enablePeakHold ? 'checked' : ''}>
            Enable Hold
        </label>
        <div id="spec-peak-details" style="display:${self.settings.enablePeakHold ? 'block' : 'none'}; margin-top:8px;">
        </div>
    `;

    peakGroup.querySelector('#spec-enable-peak').addEventListener('change', function (e) {
        self.settings.enablePeakHold = e.target.checked;
        peakGroup.querySelector('#spec-peak-details').style.display = e.target.checked ? 'block' : 'none';
        self.saveSettings();
});

    // Mode Change Listener
    select.addEventListener('change', function (e) {
    self.settings.type = e.target.value;
    fspControls.style.display = (self.settings.type === 'fsp') ? 'block' : 'none';
    
    // Toggle Peak Hold UI visibility dynamically
    peakGroup.style.display = isTrailingMode(self.settings.type) ? 'none' : 'block';
    
    self.saveSettings();
    });
    // Update visibility when the user changes the spectrum type selector

    wrap.appendChild(peakGroup);

    tabEl.innerHTML = '';
    tabEl.appendChild(wrap);
};
/**
 * Overrides native OpenWebRX scale logic with refactored multi-tier ticks and edge bounds.
 */
Plugins.custom_spectrum.hookCustomScale = function () {


    var original_mkscale = window.mkscale;
     
    const scale_markers_levels = [
        { "large_marker_per_hz": 10000000, "mid_marker_per_hz": 2500000, "small_marker_per_hz": 1000000, "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 0 },
        { "large_marker_per_hz": 5000000,  "mid_marker_per_hz": 1000000, "small_marker_per_hz": 500000,  "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 0 },
        { "large_marker_per_hz": 1000000,  "mid_marker_per_hz": 250000,  "small_marker_per_hz": 100000,  "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 0 },
        { "large_marker_per_hz": 500000,   "mid_marker_per_hz": 100000,  "small_marker_per_hz": 50000,   "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 1 },
        { "large_marker_per_hz": 100000,   "mid_marker_per_hz": 25000,   "small_marker_per_hz": 10000,   "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 1 },
        { "large_marker_per_hz": 50000,    "mid_marker_per_hz": 10000,   "small_marker_per_hz": 5000,    "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 2 },
        { "large_marker_per_hz": 10000,    "mid_marker_per_hz": 2500,    "small_marker_per_hz": 1000,    "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 2 },
        { "large_marker_per_hz": 5000,     "mid_marker_per_hz": 1000,    "small_marker_per_hz": 500,     "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 3 },
        { "large_marker_per_hz": 1000,     "mid_marker_per_hz": 250,     "small_marker_per_hz": 100,     "estimated_text_width": 70, "format": "{x} MHz", "pre_divide": 1000000, "decimals": 1 }
    ];

    const scale_min_space_bw_texts = 50;

    function get_scale_mark_spacing(range) {
        var mp = scale_markers_levels[scale_markers_levels.length - 1];
        var large, numlarge;
        var fcalc = function (freq) {
            numlarge = (range.bw / freq);
            large = (typeof waterfallWidth === 'function' ? waterfallWidth() : scale_ctx.canvas.width) / numlarge;
            return true;
        };
        for (var i = scale_markers_levels.length - 1; i >= 0; i--) {
            var item = scale_markers_levels[i];
            if (!fcalc(item.large_marker_per_hz)) continue;
            if (large - item.estimated_text_width > scale_min_space_bw_texts) {
                mp = item;
                break;
            }
        }
        return { params: mp };
    }
if (typeof Envelope !== 'undefined') {
        // 1. Draw Override
        Envelope.prototype.draw = function (visible_range) {
            Plugins.custom_spectrum.drawCustomEnvelope(this, visible_range);
        };

        // 2. Drag Move Override (Triggers scale repaint dynamically)
        var original_drag_move = Envelope.prototype.drag_move;
        Envelope.prototype.drag_move = function (x) {
            var handled = original_drag_move ? original_drag_move.apply(this, arguments) : true;
            if (typeof window.mkscale === 'function') {
                window.mkscale();
            }
            return handled;
        };

        // 3. NEW: Mousedown Enforcer on Envelope Prototype
        if (Envelope.prototype.mousedown) {
            var original_env_mousedown = Envelope.prototype.mousedown;
            Envelope.prototype.mousedown = function (e) {
                var canvas = document.getElementById("openwebrx-scale-canvas");
                if (canvas && e) {
                    var rect = canvas.getBoundingClientRect();
                    var mouseY = e.clientY - rect.top;

                    // If user clicks in UPPER ZONE (Y <= 22):
                    // ONLY allow resizing passband edges/handles (beginning, ending).
                    // Disallow full-body envelope shifting/dragging in the upper zone if desired,
                    // or block offset tuning from starting here.
                    if (mouseY <= 22) {
                        // Check if mouse is directly on a resize handle
                        if (!window.hovered_handle || window.hovered_handle === "default") {
                            // Clicked blank passband space in upper area: abort envelope drag!
                            return false;
                        }
                    } 
                    // If user clicks in LOWER ZONE (Y > 22):
                    // Completely abort stock envelope drag operations!
                    else if (mouseY > 22) {
                        return false;
                    }
                }
                return original_env_mousedown.apply(this, arguments);
            };
        }
    }

    // B. Replace global mkenvelopes with our standalone function
    window.mkenvelopes = Plugins.custom_spectrum.customMkenvelopes;

    // --- 1. Catch ALL tuning changes from Demodulator (Clicking waterfall, bookmark, wheel, etc.) ---
if (typeof Demodulator !== 'undefined' && Demodulator.prototype.set_offset_frequency) {
    var original_set_offset = Demodulator.prototype.set_offset_frequency;

    Demodulator.prototype.set_offset_frequency = function () {
        // Execute original frequency assignment inside OpenWebRX
        var res = original_set_offset.apply(this, arguments);

        // Instantly force a scale repaint with the updated offset
        if (typeof window.mkscale === 'function') {
            window.mkscale();
        }

        return res;
    };
}

// --- 2. Catch center frequency shifts (Panning waterfall) ---
if (typeof window.set_center_freq === 'function') {
    var original_set_center = window.set_center_freq;

    window.set_center_freq = function () {
        var res = original_set_center.apply(this, arguments);
        if (typeof window.mkscale === 'function') {
            window.mkscale();
        }
        return res;
    };
}
    this.setupScaleController();
 
    window.mkscale = function () {
        // 1. Let native mkscale run first to trigger mkenvelopes() in [0, 22]
        var result;
        if (typeof original_mkscale === 'function') {
            result = original_mkscale.apply(this, arguments);
        }

        if (typeof scale_ctx === 'undefined' || !scale_ctx) return result;

        var range = get_visible_freq_range();
        if (!range || !range.bw || range.bw <= 0) return result;

        // 2. Clear ONLY native lower area (Y: 22 to canvas bottom)
        var sc_y = 23;
        var sc_h = 14;
        scale_ctx.clearRect(0, sc_y, scale_ctx.canvas.width, scale_ctx.canvas.height - sc_y);

        // Custom Scale Styling
        scale_ctx.strokeStyle = "#ffffff";
        scale_ctx.font = "12px monospace";
        scale_ctx.textBaseline = "top";
        scale_ctx.fillStyle = "#fffdfdaf";
        scale_ctx.lineWidth = 1;

        var spacing = get_scale_mark_spacing(range);
        if (!spacing || !spacing.params) return result;

        var smallbw = spacing.params.small_marker_per_hz;
        var largebw = spacing.params.large_marker_per_hz;
        var midbw = spacing.params.mid_marker_per_hz || (largebw / 2);

        if (!smallbw || smallbw <= 0) return result;

        var marker_hz = Math.ceil(range.start / smallbw) * smallbw;
        var text_h_pos = sc_y + 14; // Numbers rendered nicely below ticks
        var text_to_draw = '';

        var ftext = function (f) {
            var format, pre_divide, decimals;
            if (f < 1000000) {
                format = "{x} kHz";
                pre_divide = 1000;
                decimals = 0;
            } else {
                format = spacing.params.format;
                pre_divide = spacing.params.pre_divide;
                decimals = spacing.params.decimals;
            }
            if (typeof format_frequency === 'function') {
                text_to_draw = format_frequency(format, f, pre_divide, decimals);
            } else {
                text_to_draw = (f / pre_divide).toFixed(decimals) + (f < 1000000 ? " kHz" : " MHz");
            }
        };

        var x;
        var sp_ratio = 10;
        var viewWidth = window.innerWidth;
        var max_iterations = 500;
        var iterations = 0;

        while ((x = scale_px_from_freq(marker_hz, range)) <= viewWidth && iterations < max_iterations) {
            iterations++;
            
            if (x >= 0) {
                scale_ctx.beginPath();
                scale_ctx.moveTo(x, sc_y);

                if (marker_hz % largebw === 0) {
                    scale_ctx.lineTo(x, sc_y + sc_h);
                    ftext(marker_hz);
                    var text_measured = scale_ctx.measureText(text_to_draw);
                    scale_ctx.textAlign = "center";

                    if ((range.start + smallbw * sp_ratio > marker_hz) && (x < text_measured.width / 2)) {
                        if (scale_px_from_freq(marker_hz + smallbw * sp_ratio, range) - text_measured.width >= scale_min_space_bw_texts) {
                            scale_ctx.textAlign = "left";
                            scale_ctx.fillText(text_to_draw, 0, text_h_pos);
                        }
                    } else if ((range.end - smallbw * sp_ratio < marker_hz) && (x > viewWidth - text_measured.width / 2)) {
                        if (viewWidth - text_measured.width - scale_px_from_freq(marker_hz - smallbw * sp_ratio, range) >= scale_min_space_bw_texts) {
                            scale_ctx.textAlign = "right";
                            scale_ctx.fillText(text_to_draw, viewWidth, text_h_pos);
                        }
                    } else {
                        scale_ctx.fillText(text_to_draw, x, text_h_pos);
                    }
                } else if (midbw && marker_hz % midbw === 0) {
                    scale_ctx.lineTo(x, sc_y + sc_h - 7);
                } else {
                    scale_ctx.lineTo(x, sc_y + sc_h - 11);
                }
                scale_ctx.stroke();
            }

            marker_hz += smallbw;
        }

        // Base line separating envelope area and scale ticks
        scale_ctx.beginPath();
        scale_ctx.moveTo(0, sc_y);
        scale_ctx.lineTo(scale_ctx.canvas.width, sc_y);
        scale_ctx.stroke();
    var demodulators = typeof getDemodulators === 'function' ? getDemodulators() : [];
    if (demodulators.length) {
        var center_f = center_freq + demodulators[0].offset_frequency;
        var line_x = scale_px_from_freq(center_f, range);

        if (line_x >= 0 && line_x <= scale_ctx.canvas.width) {
            // Draw Tuning Pointer / Grab Handle on the Scale
            scale_ctx.fillStyle = "#ffffffc3"; 
            
            // Downward Triangle at the top edge of scale (Y = 22)
            scale_ctx.beginPath();
            scale_ctx.moveTo(line_x - 6, 25);
            scale_ctx.lineTo(line_x + 6, 25);
            scale_ctx.lineTo(line_x, scale_ctx.canvas.height-5);
            scale_ctx.closePath();
            scale_ctx.fill();

            // Subtle vertical indicator line extending down through the scale ticks
            scale_ctx.strokeStyle = "#ffffffb3";;
            scale_ctx.lineWidth = 1.0;
            scale_ctx.beginPath();
            scale_ctx.moveTo(line_x, 22);
            scale_ctx.lineTo(line_x, scale_ctx.canvas.height);
            scale_ctx.stroke();
        }
    }
        return result;
    };
};


Plugins.custom_spectrum.setupScaleController = function () {
    var canvas = document.getElementById("openwebrx-scale-canvas") || (typeof scale_ctx !== 'undefined' ? scale_ctx.canvas : null);
    if (!canvas || canvas.dataset.scaleControllerHooked) return;
    canvas.dataset.scaleControllerHooked = "true";

    // --- CONSTANTS ---
    var UPPER_ZONE_HEIGHT = 22; // Height of top passband envelope zone in px
    var DRAG_THRESHOLD = 3;     // Pixels required before treating movement as a drag

    // --- CENTRALIZED INPUT STATE ---
    var state = {
        active: false,
        type: null,        // 'vfo' | 'pbs'
        pointerId: null,
        startX: 0,
        startOffset: 0,
        startLowCut: 0,
        startHighCut: 0,
        moved: false
    };

    // --- HELPER 1: Get Active Demodulator ---
    function getPrimaryDemod() {
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        return demods.length ? demods[0] : null;
    }

    // --- HELPER 2: Single Source of Truth for Hit Zones ---
    function getHitZone(x, y) {
        var demod = getPrimaryDemod();
        if (!demod || !demod.envelope || !demod.envelope.drag_ranges) {
            return { zone: y <= UPPER_ZONE_HEIGHT ? "UPPER_EMPTY" : "LOWER_SCALE" };
        }

        var r = demod.envelope.drag_ranges;

        // Upper Zone Checks (Y <= 22)
        if (y <= UPPER_ZONE_HEIGHT) {
            if (r.beginning && x >= r.beginning.x1 && x <= r.beginning.x2) {
                return { zone: "UPPER_WING_LEFT", cursor: "w-resize", handle: "beginning" };
            }
            if (r.ending && x >= r.ending.x1 && x <= r.ending.x2) {
                return { zone: "UPPER_WING_RIGHT", cursor: "e-resize", handle: "ending" };
            }
            if (r.pbs && x >= r.pbs.x1 && x <= r.pbs.x2) {
                return { zone: "UPPER_PBS", cursor: "ew-resize", handle: "pbs" };
            }
            return { zone: "UPPER_EMPTY", cursor: "default", handle: null };
        }

        // Lower Zone Checks (Y > 22)
        return { zone: "LOWER_SCALE", cursor: "pointer", handle: null };
    }

    // --- HELPER 3: Force Clear Native Drag Envelopes ---
    function clearNativeEnvelopes() {
        var demods = typeof getDemodulators === 'function' ? getDemodulators() : [];
        for (var i = 0; i < demods.length; i++) {
            if (demods[i].envelope) {
                demods[i].envelope.drag = false;
                demods[i].envelope.active_handle = null;
            }
        }
        if (typeof scale_canvas_drag_params !== 'undefined') {
            scale_canvas_drag_params.drag = false;
            scale_canvas_drag_params.mouse_down = false;
        }
    }

    // =========================================================================
    // UNIFIED POINTER EVENT HANDLERS (MOUSE + TOUCH + STYLUS)
    // =========================================================================

    // --- 1. POINTER DOWN ---
    canvas.addEventListener("pointerdown", function (e) {
        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;

        var target = getHitZone(x, y);
        var demod = getPrimaryDemod();

        clearNativeEnvelopes();

        if (target.zone === "LOWER_SCALE") {
            // Initiate VFO Drag
            e.preventDefault();
            e.stopPropagation();
            
            state.active = true;
            state.type = "vfo";
            state.pointerId = e.pointerId;
            state.startX = x;
            state.startOffset = demod ? demod.offset_frequency : 0;
            state.moved = false;

            canvas.setPointerCapture(e.pointerId);

        } else if (target.zone === "UPPER_PBS" && demod) {
            // Initiate Passband Shift (PBS) Drag
            e.preventDefault();
            e.stopPropagation();

            state.active = true;
            state.type = "pbs";
            state.pointerId = e.pointerId;
            state.startX = x;
            state.startLowCut = demod.low_cut;
            state.startHighCut = demod.high_cut;
            state.moved = false;

            canvas.setPointerCapture(e.pointerId);

        } else if (target.zone === "UPPER_EMPTY") {
            // Block background scale retune when touching empty space in upper zone
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // --- 2. POINTER MOVE ---
    canvas.addEventListener("pointermove", function (e) {
        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;

        // A. ACTIVE DRAG IN PROGRESS (VFO OR PBS)
        if (state.active && state.pointerId === e.pointerId) {
            e.preventDefault();
            e.stopPropagation();
  
            var deltaX = x - state.startX;
            if (Math.abs(deltaX) > DRAG_THRESHOLD) state.moved = true;

            if (state.moved) {
                var range = typeof get_visible_freq_range === 'function' ? get_visible_freq_range() : null;
                var demod = getPrimaryDemod();

                if (range && demod) {
                    var hzPerPixel = range.bw / canvas.width;

                    if (state.type === "vfo") {
                     
                        var newOffset = state.startOffset + (deltaX * hzPerPixel);
                        if (demod.set_offset_frequency) demod.set_offset_frequency(newOffset);

                    } else if (state.type === "pbs") {
                        // PBS Shift Math
                        var shiftHz = Math.round(deltaX * hzPerPixel);
                        var newLow = state.startLowCut + shiftHz;
                        var newHigh = state.startHighCut + shiftHz;
 
                        if (typeof demod.setBandpass === 'function') {
                            demod.setBandpass({ low_cut: newLow, high_cut: newHigh });
                        } else if (typeof demod.set_filter === 'function') {
                            demod.set_filter(newLow, newHigh);
    }
                          
                        

                        // Force scale & shuttle envelope to repaint in real time!
                        if (typeof window.mkscale === 'function') {
                            window.mkscale();
    }
                        // Force instantaneous UI Repaint while dragging
                        if (typeof window.mkenvelopes === 'function') {
                            window.mkenvelopes();
                        }
                    }
                }
            }
            canvas.style.cursor = "ew-resize";
            return;
        }

        // B. HOVER / NON-DRAG POINTER POSITIONING
        var hit = getHitZone(x, y);
        canvas.style.cursor = hit.cursor;

        if (window.hovered_handle !== hit.handle) {
            window.hovered_handle = hit.handle;
            if (typeof mkenvelopes === 'function') mkenvelopes();
        }
    }, true);

    // --- 3. POINTER UP / CANCEL ---
    function handlePointerUp(e) {
        if (!state.active || state.pointerId !== e.pointerId) return;

        e.preventDefault();
        e.stopPropagation();

        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left;

        // Static Click in Lower Zone (Jump Tune)
        if (!state.moved && state.type === "vfo") {
            var range = typeof get_visible_freq_range === 'function' ? get_visible_freq_range() : null;
            var demod = getPrimaryDemod();

            if (range && demod && typeof center_freq !== 'undefined') {
                var target_freq = range.start + (x / canvas.width) * range.bw;
                if (demod.set_offset_frequency) {
                    demod.set_offset_frequency(target_freq - center_freq);
                }
            }
        }

        // Release Pointer Capture
        if (canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
        }
/*
        // Finalize filter settings to OpenWebRX websocket backend
        if (state.type === "pbs") {
            var demod = getPrimaryDemod();
            if (demod && typeof demod.set === 'function') {
                demod.set(); // Flushes low_cut / high_cut parameters over WebSocket to server
            }
        }
*/
        // Reset State
        state.active = false;
        state.type = null;
        state.pointerId = null;
        state.moved = false;

        clearNativeEnvelopes();
    }

    canvas.addEventListener("pointerup", handlePointerUp, true);
    canvas.addEventListener("pointercancel", handlePointerUp, true);

    // --- 4. POINTER LEAVE CLEANUP ---
    canvas.addEventListener("pointerleave", function (e) {
        if (!state.active) {
            canvas.style.cursor = "default";
            if (window.hovered_handle) {
                window.hovered_handle = null;
                if (typeof mkenvelopes === 'function') mkenvelopes();
            }
        }
    });
};

Plugins.custom_spectrum.drawCustomEnvelope = function (envelope_inst, visible_range) {
    if (typeof scale_ctx === 'undefined' || !scale_ctx) return;

    var current_range = visible_range || (typeof get_visible_freq_range === 'function' ? get_visible_freq_range() : null);
    if (!current_range) return;
    envelope_inst.visible_range = current_range;

    var demod = envelope_inst.demodulator;
    if (!demod) return;

    // Calculate passband frequencies & pixel targets
    var from = center_freq + demod.offset_frequency;
    var to = center_freq + demod.offset_frequency;
    var fake_indicator = demod.low_cut == null || demod.high_cut == null;

    if (fake_indicator) {
        var fixedBw = demod.ifRate ? demod.ifRate / 2 : 3000;
        from -= fixedBw;
        to += fixedBw;
    } else {
        from += demod.low_cut;
        to += demod.high_cut;
    }

    var from_px = scale_px_from_freq(from, current_range);
    var to_px = scale_px_from_freq(to, current_range);
    if (isNaN(from_px) || isNaN(to_px)) return;

    if (to_px < from_px) {
        var tmp = to_px; to_px = from_px; from_px = tmp;
    }

    // Initialize hitboxes & drag state
    var drag_ranges = { envelope_on_screen: false, line_on_screen: false };
    var env_bounding_line_w = 80;

    if (!(to_px + env_bounding_line_w < 0 || from_px - env_bounding_line_w > window.innerWidth)) {
        if (!fake_indicator) {
            // --- 1. HITBOX DEFINITIONS ---
            // Left Cut Handle (wing area covering low_cut text)
            drag_ranges.beginning = { 
                x1: from_px - 55, 
                x2: from_px 
            }; 

            // Right Cut Handle (wing area covering high_cut text)
            drag_ranges.ending = { 
                x1: to_px, 
                x2: to_px + 55 
            }; 
 // Entire passband body for shifting (everything between from_px and to_px)

            var pbsLeft = from_px + 5;
            var pbsRight = to_px - 5;
            if (pbsRight > pbsLeft) {
                drag_ranges.pbs = {
                    x1: pbsLeft,
                    x2: pbsRight
                };
            }
            drag_ranges.width = null; 
            drag_ranges.envelope_on_screen = true;
        }

        // Save canvas state before drawing custom graphics
        scale_ctx.save();

        // --- 2. INNER PASSBAND FILL (Active Filter Trap) ---
        scale_ctx.fillStyle = this.getDerivedContourColor(0.50,180);
        scale_ctx.beginPath();
        scale_ctx.moveTo(from_px - 4, 20);
        scale_ctx.lineTo(from_px, 6);
        scale_ctx.lineTo(to_px, 6);
        scale_ctx.lineTo(to_px + 4, 20);
        scale_ctx.closePath();
        scale_ctx.fill();

        // --- 3. SHUTTLE WINGS & OUTLINE ---
        scale_ctx.strokeStyle = 'rgba(250, 249, 246, 0.85)';
        scale_ctx.lineWidth = 1.1;
        scale_ctx.fillStyle = 'rgba(243, 243, 244, 0.29)'; // Soft shuttle housing fill

        scale_ctx.beginPath();
        scale_ctx.moveTo(from_px - 55, 13);
        scale_ctx.lineTo(from_px - 45, 20);
        scale_ctx.lineTo(from_px - 3, 20);
        scale_ctx.lineTo(from_px, 6);
        scale_ctx.lineTo(to_px, 6);
        scale_ctx.lineTo(to_px + 3, 20);
        scale_ctx.lineTo(to_px + 45, 20);
        scale_ctx.lineTo(to_px + 55, 13);
        scale_ctx.lineTo(to_px + 45, 6);
        scale_ctx.lineTo(from_px - 45, 6);
        scale_ctx.closePath();
        
        scale_ctx.fill();
        scale_ctx.stroke();

        // --- 4. PASSBAND FREQUENCY BADGE TEXT ---
        scale_ctx.font = '11px monospace';
        scale_ctx.fillStyle = 'rgba(243, 243, 244, 0.95)';
        scale_ctx.textBaseline = 'top';

        // Low Cut Frequency (Left Wing)
        var lowText = (demod.low_cut > 0 ? '+' : '') + demod.low_cut;
        scale_ctx.textAlign = 'right';
        scale_ctx.fillText(lowText, from_px - 6, 8);

        // High Cut Frequency (Right Wing)
        var highText = (demod.high_cut > 0 ? '+' : '') + demod.high_cut;
        scale_ctx.textAlign = 'left';
        scale_ctx.fillText(highText, to_px + 6, 8);

        scale_ctx.restore();
    }

    // --- 5. CENTER FREQUENCY / BFO INDICATOR LINE ---
    var line = center_freq + demod.offset_frequency;
    if (typeof line !== "undefined") {
        var line_px = scale_px_from_freq(line, current_range);
        if (!isNaN(line_px) && !(line_px < 0 || line_px > window.innerWidth)) {
            drag_ranges.line = { x1: line_px - 3, x2: line_px + 3 };
            drag_ranges.line_on_screen = true;
            
            scale_ctx.save();
            scale_ctx.beginPath();
            scale_ctx.moveTo(line_px, 0);
            scale_ctx.lineTo(line_px, 22);
            scale_ctx.strokeStyle = "#ffffff";
            scale_ctx.lineWidth = 1.2;
            scale_ctx.stroke();
            scale_ctx.restore();
        }
    }

    envelope_inst.drag_ranges = drag_ranges;
};
// -------------------------------------------------------------
// 2. Standalone Module: Custom mkenvelopes Loop
// -------------------------------------------------------------
Plugins.custom_spectrum.customMkenvelopes = function (visible_range) {
    if (typeof getDemodulators !== 'function' || typeof scale_ctx === 'undefined') return;

    var demodulators = getDemodulators();
    
    // Clear top envelope zone (Y: 0..22)
    scale_ctx.clearRect(0, 0, scale_ctx.canvas.width, 22);

    for (var i = 0; i < demodulators.length; i++) {
        if (demodulators[i].envelope) {
            // Call our standalone drawing method directly
            Plugins.custom_spectrum.drawCustomEnvelope(demodulators[i].envelope, visible_range);
        }
    }

    if (demodulators.length && typeof secondary_demod_waterfall_set_zoom === 'function') {
        var bandpass = demodulators[0].getBandpass();
        secondary_demod_waterfall_set_zoom(bandpass.low_cut, bandpass.high_cut);
    }
};

Plugins.custom_spectrum.initOverlayCanvas = function() {
    var mainCanvas = document.getElementById("openwebrx-scale-canvas");
    if (!mainCanvas || document.getElementById("openwebrx-hud-canvas")) return;

    var hudCanvas = document.createElement("canvas");
    hudCanvas.id = "openwebrx-hud-canvas";
    hudCanvas.style.position = "absolute";
    hudCanvas.style.top = mainCanvas.offsetTop + "px";
    hudCanvas.style.left = mainCanvas.offsetLeft + "px";
    hudCanvas.style.pointerEvents = "none"; // Clicks pass right through to main scale!
    hudCanvas.width = mainCanvas.width;
    hudCanvas.height = mainCanvas.height;

    mainCanvas.parentNode.insertBefore(hudCanvas, mainCanvas.nextSibling);
    window.hud_ctx = hudCanvas.getContext("2d");
};
