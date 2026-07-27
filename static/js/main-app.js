/**
 * KESKUSTORI V2X - Main Application Controller
 * UPDATED: Better debugging and road network integration
 */

class KeskustoriApp {
    constructor() {
        console.log('🚀 KeskustoriApp constructor called');
        
        this.renderer = null;
        this.pollInterval = null;
        this.apiBaseURL = window.location.origin;
        this.roadNetworkData = null;
        
        this.state = {
            status: 'ok',
            tick: 0,
            vehicles: [],
            traffic_lights: [],
            intersections: [],
            weather: {},
            time_of_day: 12,
            is_night: false
        };

        this.init();
    }

    async init() {
        console.log('🔧 Initializing KESKUSTORI V2X...');

        try {
            // Load road network first
            await this.loadRoadNetwork();
            console.log('✅ Road network loaded');

            // Initialize renderer
            const canvas = document.getElementById('simulation-canvas');
            if (!canvas) {
                throw new Error('Canvas element not found');
            }

            this.renderer = new SimulationRenderer(canvas, this.roadNetworkData);
            console.log('✅ Renderer initialized');

            // Setup UI
            this.setupUI();
            console.log('✅ UI setup complete');

            // Start polling
            this.startPolling();
            console.log('✅ Polling started');

            // Handle resize
            window.addEventListener('resize', () => this.handleResize());

            this.updateStatus('✅ Connected to server');
            console.log('✅ Application ready!');

        } catch (error) {
            console.error('❌ Initialization error:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    async loadRoadNetwork() {
        try {
            const response = await fetch(`${this.apiBaseURL}/api/road-network`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.roadNetworkData = await response.json();
            console.log('✅ Road network data loaded:', this.roadNetworkData.roads?.length || 0, 'roads');
            return this.roadNetworkData;
        } catch (error) {
            console.warn('⚠️ Could not load road network:', error);
            return null;
        }
    }

    setupUI() {
        const spawnBtn = document.getElementById('spawn-btn');
        const clearBtn = document.getElementById('clear-btn');
        const spawnInput = document.getElementById('spawn-input');
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const resetBtn = document.getElementById('reset-btn');

        if (spawnBtn) {
            spawnBtn.addEventListener('click', () => this.handleSpawn());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.handleClear());
        }

        if (startBtn) {
            startBtn.addEventListener('click', () => this.handleStart());
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.handlePause());
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.handleReset());
        }

        if (spawnInput) {
            spawnInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleSpawn();
                }
            });
        }

        console.log('✅ UI listeners attached');
    }

    async handleSpawn() {
        const input = document.getElementById('spawn-input').value.trim();

        if (!input) {
            this.updateStatus('⚠️ Enter a spawn command');
            return;
        }

        try {
            this.updateStatus('🔄 Spawning agents...');
            console.log(`📤 Spawn request: "${input}"`);

            const response = await fetch(`${this.apiBaseURL}/api/spawn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: input })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📥 Spawn response:', data);

            if (data.status === 'ok') {
                const spawned = data.spawned || {};
                const total = spawned.total || 0;
                this.updateStatus(`✅ Spawned ${total} agents`);
                document.getElementById('spawn-input').value = '';
            } else {
                this.updateStatus(`❌ Spawn failed: ${data.message}`);
            }

        } catch (error) {
            console.error('❌ Spawn error:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    async handleClear() {
        try {
            this.updateStatus('🔄 Clearing simulation...');
            console.log('📤 Clear request');

            const response = await fetch(`${this.apiBaseURL}/api/clear`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('📥 Clear response:', data);
            this.updateStatus('✅ Simulation cleared');

        } catch (error) {
            console.error('❌ Clear error:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    async handleStart() {
        try {
            this.updateStatus('🔄 Starting simulation...');
            const startCount = Math.max(1, Number(document.getElementById('spawn-input')?.value?.trim() || 5));
            const startRes = await fetch(`${this.apiBaseURL}/api/simulation/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicle_count: startCount })
            });
            if (!startRes.ok) throw new Error(`HTTP ${startRes.status}`);
            const startData = await startRes.json();
            this.updateStatus(`▶️ Spawned ${startData.spawned?.total ?? startCount} agents`);
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }


    async handlePause() {
        try {
            this.updateStatus('🔄 Pausing simulation...');
            const response = await fetch(`${this.apiBaseURL}/api/simulation/pause`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.updateStatus('⏸️ Simulation paused');
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    async handleReset() {
        try {
            this.updateStatus('🔄 Resetting simulation...');
            const response = await fetch(`${this.apiBaseURL}/api/simulation/reset`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.updateStatus('🔄 Simulation reset');
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    startPolling() {
        console.log('🔄 Starting state polling (20Hz)');

        this.pollInterval = setInterval(() => {
            this.pollState();
        }, 50); // 20Hz
    }

    async pollState() {
        try {
            const response = await fetch(`${this.apiBaseURL}/api/state`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.status === 'ok') {
                this.state = data;
                this.updateUI();
                this.updateRenderer();
            }

        } catch (error) {
            // Silent - don't spam logs
        }
    }

    updateUI() {
        try {
            // Update tick
            const tickElement = document.getElementById('tick-count');
            if (tickElement) {
                tickElement.textContent = this.state.tick || 0;
            }

            // Update vehicle count
            const vehicleCountElement = document.getElementById('vehicle-count');
            if (vehicleCountElement) {
                const count = (this.state.vehicles || []).length;
                vehicleCountElement.textContent = count;
            }

            // Update FPS
            const fpsElement = document.getElementById('fps-count');
            if (fpsElement && this.renderer) {
                fpsElement.textContent = this.renderer.getFPS();
            }

            // Update weather
            if (this.state.weather) {
                const tempElement = document.getElementById('temp-display');
                if (tempElement) {
                    const temp = Math.round(this.state.weather.temperature || 20);
                    tempElement.textContent = `${temp}°C`;
                }

                const rainElement = document.getElementById('rain-display');
                if (rainElement) {
                    const rain = Math.round((this.state.weather.rain_intensity || 0) * 100);
                    rainElement.textContent = `${rain}%`;
                }

                const visElement = document.getElementById('visibility-display');
                if (visElement) {
                    const vis = Math.round((this.state.weather.visibility || 1) * 100);
                    visElement.textContent = `${vis}%`;
                }
            }

            // Update time
            if (this.state.time_of_day !== undefined) {
                const hours = Math.floor(this.state.time_of_day);
                const minutes = Math.round((this.state.time_of_day % 1) * 60);
                const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                
                const timeElement = document.getElementById('time-display');
                if (timeElement) {
                    timeElement.textContent = timeStr;
                }

                const dayIconElement = document.getElementById('day-icon');
                if (dayIconElement) {
                    const isDaytime = this.state.time_of_day >= 6 && this.state.time_of_day < 18;
                    dayIconElement.textContent = isDaytime ? '☀️' : '🌙';
                }
            }

            // Update vehicle list
            this.updateVehicleList(this.state.vehicles || []);

        } catch (error) {
            console.error('❌ UI update error:', error);
        }
    }

    updateVehicleList(vehicles) {
        try {
            const vehicleList = document.getElementById('vehicle-list');
            if (!vehicleList) return;

            if (vehicles.length === 0) {
                vehicleList.innerHTML = '<div style="color: #888; text-align: center; padding: 10px;">No vehicles</div>';
                return;
            }

            let html = '';
            vehicles.forEach(v => {
                const speed = (v.speed || 0).toFixed(1);
                const type = v.type || 'unknown';
                const pos = v.pos || [0, 0];
                html += `
                    <div class="vehicle-item">
                        <div class="vehicle-item-id">🚗 #${v.uid}</div>
                        <div class="vehicle-item-type">${type.toUpperCase()}</div>
                        <div class="vehicle-item-speed">Speed: ${speed} m/s</div>
                        <div class="vehicle-item-pos">Pos: (${pos[0].toFixed(0)}, ${pos[1].toFixed(0)})</div>
                    </div>
                `;
            });
            vehicleList.innerHTML = html;

        } catch (error) {
            console.error('❌ Vehicle list update error:', error);
        }
    }

    updateRenderer() {
        try {
            if (!this.renderer) return;

            // ✅ FIX: Ensure vehicles are an array
            const vehicles = Array.isArray(this.state.vehicles) ? this.state.vehicles : [];
            if (vehicles.length > 0) {
                this.renderer.updateVehicles(vehicles);
            }

            // ✅ FIX: Ensure traffic lights are an array
            const lights = Array.isArray(this.state.traffic_lights) ? this.state.traffic_lights : [];
            if (lights.length > 0) {
                this.renderer.updateTrafficLights(lights);
            }

        } catch (error) {
            console.error('❌ Renderer update error:', error);
        }
    }

    updateStatus(message) {
        const statusElement = document.getElementById('status-message');
        if (statusElement) {
            statusElement.textContent = message;
        }
        console.log(message);
    }

    handleResize() {
        if (this.renderer) {
            this.renderer.resize();
        }
    }
}

// Initialize on DOM ready
console.log('⏳ Waiting for DOM ready...');
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM ready - initializing app');
    window.app = new KeskustoriApp();
});
