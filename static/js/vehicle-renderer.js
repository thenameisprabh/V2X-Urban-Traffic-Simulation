'use strict';

console.log('>>> vehicle-renderer.js loading...');

// Vehicle mesh registry
var VEHICLE_MESHES = {};
var VEHICLE_LABELS = {};

// Geometry cache
var VEHICLE_GEOMETRY = {
  car: new THREE.BoxGeometry(2.0, 1.4, 4.5),
  cyclist: new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8),
  pedestrian: new THREE.CylinderGeometry(0.4, 0.4, 1.8, 8),
  parked: new THREE.BoxGeometry(2.0, 1.4, 4.5),
};

// Material cache
var VEHICLE_MATERIALS = {
  car: new THREE.MeshStandardMaterial({
    color: 0xff6600,
    metalness: 0.6,
    roughness: 0.4,
  }),
  cyclist: new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    metalness: 0.3,
    roughness: 0.5,
  }),
  pedestrian: new THREE.MeshStandardMaterial({
    color: 0x00ccff,
    metalness: 0.0,
    roughness: 0.8,
  }),
  parked: new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.5,
    roughness: 0.6,
  }),
};

function _createVehicleMesh(vehicle) {
  var type = vehicle.type || 'car';
  var geo = VEHICLE_GEOMETRY[type] || VEHICLE_GEOMETRY.car;
  var mat = VEHICLE_MATERIALS[type] || VEHICLE_MATERIALS.car;

  var mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'vehicle_' + vehicle.uid;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  var pos = vehicle.pos || [0, 0];
  mesh.position.set(pos[0], 0.9, pos[1]);
  mesh.rotation.y = vehicle.rotation || 0;

  window.SCN.add(mesh);
  VEHICLE_MESHES[vehicle.uid] = mesh;

  console.log('✓ Vehicle mesh created:', vehicle.uid, type);
  return mesh;
}

function _updateVehicleMesh(mesh, vehicle) {
  var pos = vehicle.pos || [0, 0];
  mesh.position.set(pos[0], 0.9, pos[1]);
  mesh.rotation.y = vehicle.rotation || 0;

  // Frustum culling: only update if visible
  var frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      window.CAM.projectionMatrix,
      window.CAM.matrixWorldInverse
    )
  );

  mesh.visible = frustum.containsPoint(mesh.position);
}

function updateVehicles(vehicles) {
  if (!window.SCN || !window.CAM) {
    console.warn('updateVehicles: SCN or CAM not ready');
    return;
  }

  if (!vehicles || !vehicles.length) {
    return;
  }

  var liveUids = [];

  vehicles.forEach(function(vehicle) {
    if (vehicle.uid === undefined || !vehicle.pos) return;

    liveUids.push(vehicle.uid);

    if (VEHICLE_MESHES[vehicle.uid]) {
      _updateVehicleMesh(VEHICLE_MESHES[vehicle.uid], vehicle);
    } else {
      _createVehicleMesh(vehicle);
    }
  });

  // Remove stale meshes
  Object.keys(VEHICLE_MESHES).forEach(function(uid) {
    if (!liveUids.includes(Number(uid))) {
      window.SCN.remove(VEHICLE_MESHES[uid]);
      delete VEHICLE_MESHES[uid];
    }
  });
}

window.updateVehicles = updateVehicles;
console.log('✓ vehicle-renderer.js loaded');
