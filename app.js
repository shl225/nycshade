// NYC Shade Inequality - App Logic

let map;
let statsData = {};
let currentLayer = 'shade'; // 'shade' or 'bivariate'
let currentLoc = 'nyc';

// Colors for the bivariate map
const bivColors = {
    '1-1': '#e8e8e8', '2-1': '#ace4e4', '3-1': '#5ac8c8',
    '1-2': '#dfb0d6', '2-2': '#a5add3', '3-2': '#5698b9',
    '1-3': '#be64ac', '2-3': '#8c62aa', '3-3': '#3b4994'
};

async function init() {
    console.log("Initializing NYC Shade Inequality Map...");

    try {
        // Initialize MapLibre
        map = new maplibregl.Map({
            container: 'map',
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            center: [-74.006, 40.7128], // Initial NYC center
            zoom: 10,
            pitch: 0,
            bearing: 0,
            antialias: true
        });

        // Restore controls to bottom-right
        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

        // Setup Panel Toggle (Collapse/Expand)
        const statsPanel = document.getElementById('stats-panel');
        const closeBtn = statsPanel.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => {
            statsPanel.classList.toggle('collapsed');
        });

        map.on('error', (e) => console.error("MapLibre error:", e));

        map.on('load', async () => {
            console.log("Map style loaded successfully.");

            // Load data
            await loadData();

            // Setup Map Layers
            setupLayers();

            // Setup Event Listeners
            setupEventListeners();
        });
    } catch (err) {
        console.error("Map initialization failed:", err);
    }
}

async function loadData() {
    console.group("Loading Web Data");
    try {
        // Load Stats
        const statsRes = await fetch('data/stats.json');
        if (!statsRes.ok) throw new Error("Failed to load stats.json");
        statsData = await statsRes.json();
        updateStatsPanel('nyc');

        // Load SHAP data
        const shapRes = await fetch('data/shap_importance.json');
        if (!shapRes.ok) throw new Error("Failed to load shap_importance.json");
        const shapData = await shapRes.json();
        renderShapChart(shapData);

        // Load GeoJSON
        map.addSource('nyc-shade', {
            type: 'geojson',
            data: 'data/nyc_shade_web.geojson',
            promoteId: 'GEOID'
        });

        // Load Gowanus BID Boundary
        const bidRes = await fetch('data/gowanus_bid.geojson');
        if (bidRes.ok) {
            const bidData = await bidRes.json();
            map.addSource('gowanus-bid', {
                type: 'geojson',
                data: bidData
            });
        }
    } catch (err) {
        console.error("Data loading error:", err);
    }
    console.groupEnd();
}

function setupLayers() {
    console.log("Setting up map layers...");

    const source = map.getSource('nyc-shade');
    if (!source) {
        console.warn("Source 'nyc-shade' not found in map state. Retrying...");
        setTimeout(setupLayers, 1000);
        return;
    }
    console.log("Source 'nyc-shade' found, proceeding with layer setup.");

    // 1. Shade Layer (Standard) - Viridis Palette
    map.addLayer({
        id: 'shade-layer',
        type: 'fill',
        source: 'nyc-shade',
        paint: {
            'fill-color': [
                'interpolate',
                ['linear'],
                ['get', 'Cumulative shades'],
                0, '#440154',   // Dark Purple
                10, '#414487',  // Blue
                20, '#2a788e',  // Teal
                30, '#22a884',  // Green
                40, '#7ad151',  // Light Green
                50, '#fde725'   // Yellow
            ],
            'fill-opacity': 0.8,
            'fill-outline-color': 'rgba(255,255,255,0.1)'
        }
    });
    console.log("Layer 'shade-layer' added.");

    // 2. Bivariate Layer (Initially Hidden)
    map.addLayer({
        id: 'bivariate-layer',
        type: 'fill',
        source: 'nyc-shade',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': [
                'match',
                ['get', 'biv_cat'],
                '1-1', '#e8e8e8', '2-1', '#ace4e4', '3-1', '#5ac8c8',
                '1-2', '#dfb0d6', '2-2', '#a5add3', '3-2', '#5698b9',
                '1-3', '#be64ac', '2-3', '#8c62aa', '3-3', '#3b4994',
                'rgba(0,0,0,0)'
            ],
            'fill-opacity': 0.9,
            'fill-outline-color': 'rgba(255,255,255,0.15)'
        }
    });
    console.log("Layer 'bivariate-layer' added.");

    // 3. Highlight Layer
    map.addLayer({
        id: 'shade-highlight',
        type: 'line',
        source: 'nyc-shade',
        paint: {
            'line-color': '#fff',
            'line-width': 2,
            'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0]
        }
    });
    console.log("Layer 'shade-highlight' added.");

    // 4. Gowanus BID Layer (Initially Hidden)
    if (map.getSource('gowanus-bid')) {
        map.addLayer({
            id: 'bid-boundary',
            type: 'line',
            source: 'gowanus-bid',
            layout: { 'visibility': 'none' },
            paint: {
                'line-color': '#00ffff',
                'line-width': 3,
                'line-dasharray': [2, 1]
            }
        });
        console.log("Layer 'bid-boundary' added.");
    }

    console.log("Layers added to map.");
    setupInteractivity();
}

function setupInteractivity() {
    let hoveredStateId = null;

    // Tooltips
    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'glass-popup',
        offset: 15
    });

    const onMove = (e) => {
        if (e.features.length > 0) {
            map.getCanvas().style.cursor = 'crosshair';

            const feature = e.features[0];
            const props = feature.properties;

            // Handle hover state for highlight
            if (hoveredStateId !== null) {
                map.setFeatureState({ source: 'nyc-shade', id: hoveredStateId }, { hover: false });
            }
            // Use GEOID as unique ID if available, otherwise index
            hoveredStateId = feature.id || props.GEOID;
            map.setFeatureState({ source: 'nyc-shade', id: hoveredStateId }, { hover: true });

            // Popup content
            const content = `
                <div class="popup-content">
                    <h4>Census Tract ${props.GEOID || ''}</h4>
                    <p><strong>Cumulative Shade:</strong> ${props['Cumulative shades'].toFixed(2)}%</p>
                    <p><strong>Building Shade:</strong> ${props['Building Coverage %']?.toFixed(1) || '0'}%</p>
                    <p><strong>Tree Shade:</strong> ${props['Tree Shade %']?.toFixed(1) || '0'}%</p>
                    <p><strong>Per Capita Income:</strong> $${props['Per Capita Income']?.toLocaleString() || 'N/A'}</p>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(content).addTo(map);
        }
    };

    const onLeave = () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
        if (hoveredStateId !== null) {
            map.setFeatureState({ source: 'nyc-shade', id: hoveredStateId }, { hover: false });
        }
        hoveredStateId = null;
    };

    map.on('mousemove', 'shade-layer', onMove);
    map.on('mouseleave', 'shade-layer', onLeave);
    map.on('mousemove', 'bivariate-layer', onMove);
    map.on('mouseleave', 'bivariate-layer', onLeave);
}

function setupEventListeners() {
    // Location Buttons
    document.getElementById('btn-nyc').addEventListener('click', (e) => switchLocation('nyc', e.target));
    document.getElementById('btn-brooklyn').addEventListener('click', (e) => switchLocation('brooklyn', e.target));
    document.getElementById('btn-gowanus').addEventListener('click', (e) => switchLocation('gowanus', e.target));

    // Layer Radios
    document.querySelectorAll('input[name="layer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentLayer = e.target.value;
            updateLayers();
        });
    });
}

function switchLocation(loc, btn) {
    currentLoc = loc;
    console.log(`Switching to location: ${loc}`);

    // Update active button
    document.querySelectorAll('.button-group button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Zoom to bounds
    const data = statsData[loc];
    if (data && data.bounds) {
        map.fitBounds(data.bounds, { padding: 50, duration: 1500 });
        updateStatsPanel(loc);
    }

    // Special: Gowanus BID Boundary visibility
    if (map.getLayer('bid-boundary')) {
        const visibility = (loc === 'gowanus') ? 'visible' : 'none';
        map.setLayoutProperty('bid-boundary', 'visibility', visibility);
    }
}

function updateLayers() {
    const isShade = currentLayer === 'shade';
    map.setLayoutProperty('shade-layer', 'visibility', isShade ? 'visible' : 'none');
    map.setLayoutProperty('bivariate-layer', 'visibility', isShade ? 'none' : 'visible');

    // Toggle Legends
    const shadeLegend = document.getElementById('shade-legend');
    const bivLegend = document.getElementById('biv-legend');

    if (isShade) {
        shadeLegend.classList.remove('hidden');
        bivLegend.classList.add('hidden');
    } else {
        shadeLegend.classList.add('hidden');
        bivLegend.classList.remove('hidden');
    }
}

function updateStatsPanel(loc) {
    const data = statsData[loc];
    if (!data) return;

    document.getElementById('location-title').innerText = data.name || loc.toUpperCase();
    document.getElementById('val-shade').innerText = `${data.avg_shade.toFixed(1)}%`;
    document.getElementById('val-income').innerText = `$${data.avg_income.toLocaleString()}`;
}

function renderShapChart(data) {
    const container = document.getElementById('shap-chart');
    container.innerHTML = '';

    const maxVal = Math.max(...Object.values(data));

    Object.entries(data).forEach(([key, val]) => {
        const percentage = (val / maxVal) * 100;
        const html = `
            <div class="bar-item">
                <span class="bar-label" title="${key}">${key}</span>
                <div class="bar-bg">
                    <div class="bar-fill" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
}

// Start app
init();

