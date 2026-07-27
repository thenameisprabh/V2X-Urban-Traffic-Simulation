'use strict';

console.log('>>> ui-controller.js loading...');

class UIController {
  constructor() {
    this.prompt_input = document.getElementById('prompt-input');
    this.submit_btn = document.getElementById('spawn-btn');
    this.weather_display = document.getElementById('weather-display');
    this.time_display = document.getElementById('time-display');
    this.stats_display = document.getElementById('stats-display');
    this.sensors_toggle = document.getElementById('toggle-sensors');

    this._attachEventListeners();
  }

  _attachEventListeners() {
    this.submit_btn.addEventListener('click', () => this._handleSpawn());
    this.prompt_input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this._handleSpawn();
    });

    if (this.sensors_toggle) {
      this.sensors_toggle.addEventListener('change', (e) => {
        window.toggleSensorVisualization(e.target.checked);
      });
    }
  }

  async _handleSpawn() {
    var prompt = this.prompt_input.value.trim();
    if (!prompt) {
      alert('Please enter a prompt');
      return;
    }

    this.submit_btn.disabled = true;
    this.submit_btn.textContent = 'Spawning...';

    try {
      var response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt }),
      });

      var data = await response.json();
      console.log('✅ Agents spawned:', data);

      this.submit_btn.textContent = 'Spawn Agents';
      this.submit_btn.disabled = false;
    } catch (err) {
      console.error('❌ Spawn error:', err);
      alert('Failed to spawn agents: ' + err.message);
      this.submit_btn.textContent = 'Spawn Agents';
      this.submit_btn.disabled = false;
    }
  }

  updateWeatherDisplay(weather_state) {
    if (!this.weather_display) return;

    var html = `
      <div class="weather-item">
        <span class="weather-label">🌡️ Temp:</span>
        <span class="weather-value">${weather_state.temperature.toFixed(1)}°C</span>
      </div>
      <div class="weather-item">
        <span class="weather-label">👁️ Visibility:</span>
        <span class="weather-value">${(weather_state.visibility * 100).toFixed(0)}%</span>
      </div>
      <div class="weather-item">
        <span class="weather-label">💨 Wind:</span>
        <span class="weather-value">${weather_state.wind_speed.toFixed(1)} m/s</span>
      </div>
      <div class="weather-item">
        <span class="weather-label">⛅ Type:</span>
        <span class="weather-value">${weather_state.type}</span>
      </div>
    `;

    this.weather_display.innerHTML = html;
  }

  updateTimeDisplay(time_of_day, is_night) {
    if (!this.time_display) return;

    var hours = Math.floor(time_of_day);
    var minutes = Math.floor((time_of_day % 1) * 60);
    var timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    var dayNightStr = is_night ? '🌙 Night' : '☀️ Day';

    this.time_display.innerHTML = `<strong>${dayNightStr}</strong> — ${timeStr}`;
  }

  updateStatsDisplay(vehicles_count, fps, tick) {
    if (!this.stats_display) return;

    this.stats_display.innerHTML = `
      <span>🚗 Vehicles: ${vehicles_count}</span>
      <span>⚡ FPS: ${fps.toFixed(1)}</span>
      <span>📊 Tick: ${tick}</span>
    `;
  }
}

window.UIController = UIController;
console.log('✓ ui-controller.js loaded');
