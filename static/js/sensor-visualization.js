'use strict';

console.log('>>> sensor-visualization.js loading...');

var SENSOR_VISUALS = {};

function visualizeVehicleSensors(vehicle_uid, vehicle_pos, vehicle_heading) {
  /**
   * Show vehicle sensor coverage.
   * - Camera: 90° FOV cone (front)
   - Radar: 360° circle (all-around)
   */

  // Remove old visualizations
  if (SENSOR_VISUALS[vehicle_uid]) {
    window.SCN.remove(SENSOR_VISUALS[vehicle_uid]);
  }

  var group = new THREE.Group();

  // Camera FOV visualization
  var cameraGeom = new THREE.ConeGeometry(100, 100, 16, 1);
  var cameraMat = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.1,
    wireframe: true,
  });
  var cameraViz = new THREE.Mesh(cameraGeom, cameraMat);
  cameraViz.position.set(vehicle_pos[0], 2, vehicle_pos[1]);
  cameraViz.rotation.z = Math.PI / 2;
  cameraViz.rotation.y = vehicle_heading;
  group.add(cameraViz);

  // Radar visualization
  var radarGeom = new THREE.CircleGeometry(150, 32);
  var radarMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
  });
  var radarViz = new THREE.Mesh(radarGeom, radarMat);
  radarViz.position.set(vehicle_pos[0], 0.5, vehicle_pos[1]);
  radarViz.rotation.x = Math.PI / 2;
  group.add(radarViz);

  window.SCN.add(group);
  SENSOR_VISUALS[vehicle_uid] = group;
}

function toggleSensorVisualization(enabled) {
  Object.keys(SENSOR_VISUALS).forEach(function(uid) {
    SENSOR_VISUALS[uid].visible = enabled;
  });
}

window.visualizeVehicleSensors = visualizeVehicleSensors;
window.toggleSensorVisualization = toggleSensorVisualization;

console.log('✓ sensor-visualization.js loaded');
