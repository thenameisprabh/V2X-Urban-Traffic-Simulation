/**
 * Metrics Display - Dashboard for simulation statistics
 */

class MetricsDisplay {
    constructor() {
        this.metrics = {
            fps: 0,
            tick: 0,
            vehicle_count: 0,
            pedestrian_count: 0,
            avg_speed: 0,
            congestion_percent: 0
        };
        
        this.initializeDisplay();
        console.log('📊 MetricsDisplay initialized');
    }

    initializeDisplay() {
        const dashboard = document.getElementById('metrics-dashboard');
        if (!dashboard) return;
        
        dashboard.innerHTML = `
            <div class="metrics-row">
                <div class="metric-item">
                    <label>FPS</label>
                    <span id="metric-fps">0</span>
                </div>
                <div class="metric-item">
                    <label>Tick</label>
                    <span id="metric-tick">0</span>
                </div>
                <div class="metric-item">
                    <label>Vehicles</label>
                    <span id="metric-vehicles">0</span>
                </div>
            </div>
            <div class="metrics-row">
                <div class="metric-item">
                    <label>Avg Speed</label>
                    <span id="metric-speed">0 m/s</span>
                </div>
                <div class="metric-item">
                    <label>Congestion</label>
                    <span id="metric-congestion">0%</span>
                </div>
            </div>
        `;
    }

    update(metricsData) {
        if (!metricsData) return;
        
        this.metrics = metricsData;
        
        const updates = {
            'metric-fps': metricsData.fps?.toFixed(1) || '0',
            'metric-tick': metricsData.tick || '0',
            'metric-vehicles': metricsData.vehicle_count || '0',
            'metric-speed': (metricsData.avg_speed?.toFixed(1) || '0') + ' m/s',
            'metric-congestion': (metricsData.congestion_percent?.toFixed(1) || '0') + '%'
        };
        
        for (const [id, value] of Object.entries(updates)) {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        }
    }
}

window.MetricsDisplay = MetricsDisplay;
