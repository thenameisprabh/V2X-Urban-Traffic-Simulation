'use strict';

console.log('>>> map-generator.js loading...');

class CityMapGenerator {
  /**
   * Generate a realistic city map with:
   * - Road grid (major and minor streets)
   * - Buildings
   * - Parks
   * - Traffic lights at intersections
   */

  constructor(map_width = 2000, map_height = 2000) {
    this.width = map_width;
    this.height = map_height;
    this.block_size = 100; // meters per block
    this.roads = [];
    this.intersections = [];
  }

  generate() {
    console.log('🗺️  Generating city map...');
    
    this._generateRoads();
    this._generateBuildings();
    this._generatePyramid();
    this._generateLighting();
    
    console.log('✓ City map generated');
  }

  _generateRoads() {
    /**
     * Create a grid of roads.
     * - Major streets: every 200m (wider, more traffic)
     * - Minor streets: every 100m
     */
    
    var major_interval = 200;
    var minor_interval = 100;

    // Horizontal roads
    for (var z = 0; z <= this.height; z += minor_interval) {
      var is_major = (z % major_interval) === 0;
      var width = is_major ? 15 : 8;
      var color = is_major ? 0x444444 : 0x666666;

      var roadGeom = new THREE.PlaneGeometry(this.width, width);
      var roadMat = new THREE.MeshLambertMaterial({ color: color });
      var road = new THREE.Mesh(roadGeom, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.z = z - this.height / 2;
      road.receiveShadow = true;

      window.SCN.add(road);
      this.roads.push(road);

      // Add road markings (dashed lines)
      if (is_major) {
        this._addRoadMarkings(z - this.height / 2, 'horizontal');
      }
    }

    // Vertical roads
    for (var x = 0; x <= this.width; x += minor_interval) {
      var is_major = (x % major_interval) === 0;
      var width = is_major ? 15 : 8;
      var color = is_major ? 0x444444 : 0x666666;

      var roadGeom = new THREE.PlaneGeometry(width, this.height);
      var roadMat = new THREE.MeshLambertMaterial({ color: color });
      var road = new THREE.Mesh(roadGeom, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.x = x - this.width / 2;
      road.receiveShadow = true;

      window.SCN.add(road);
      this.roads.push(road);

      if (is_major) {
        this._addRoadMarkings(x - this.width / 2, 'vertical');
      }
    }

    console.log(`✓ Generated ${this.roads.length} road segments`);
  }

  _addRoadMarkings(position, direction) {
    /**
     * Add dashed yellow line markings to major roads.
     */
    var dash_length = 3;
    var gap = 5;
    var total_length = direction === 'horizontal' ? this.width : this.height;

    for (var i = 0; i < total_length; i += (dash_length + gap)) {
      var markGeom = new THREE.PlaneGeometry(
        direction === 'horizontal' ? dash_length : 0.5,
        direction === 'horizontal' ? 0.5 : dash_length
      );
      var markMat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
      var mark = new THREE.Mesh(markGeom, markMat);

      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.01;

      if (direction === 'horizontal') {
        mark.position.z = position;
        mark.position.x = i - this.width / 2;
      } else {
        mark.position.x = position;
        mark.position.z = i - this.height / 2;
      }

      window.SCN.add(mark);
    }
  }

  _generateBuildings() {
    /**
     * Create buildings at random locations on the map.
     */
    var building_colors = [0xcc8844, 0xbb7744, 0xdd9955];

    for (var i = 0; i < 30; i++) {
      var x = (Math.random() - 0.5) * this.width;
      var z = (Math.random() - 0.5) * this.height;

      // Skip if on a road
      if (Math.abs(x % 200) < 20 || Math.abs(z % 200) < 20) continue;

      var width = 50 + Math.random() * 40;
      var depth = 40 + Math.random() * 40;
      var height = 20 + Math.random() * 40;

      var buildingGeom = new THREE.BoxGeometry(width, height, depth);
      var color = building_colors[Math.floor(Math.random() * building_colors.length)];
      var buildingMat = new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.1,
        roughness: 0.8,
      });

      var building = new THREE.Mesh(buildingGeom, buildingMat);
      building.position.set(x, height / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;

      window.SCN.add(building);

      // Add windows
      this._addWindowsToBuilding(building, width, depth, height);
    }

    console.log('✓ Generated 30 buildings');
  }

  _addWindowsToBuilding(building, width, depth, height) {
    /**
     * Add simple window geometry to buildings.
     */
    var window_size = 2;
    var window_spacing = 5;

    for (var row = 0; row < height; row += window_spacing) {
      for (var col = 0; col < width; col += window_spacing) {
        var windowGeom = new THREE.PlaneGeometry(window_size, window_size);
        var windowMat = new THREE.MeshBasicMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0.7,
        });
        var window_mesh = new THREE.Mesh(windowGeom, windowMat);

        window_mesh.position.set(
          col - width / 2 + window_size / 2,
          row + window_size / 2,
          width / 2 + window_size / 2
        );

        building.add(window_mesh);
      }
    }
  }

  _generatePyramid() {
    /**
     * Add a pyramid landmark in center of map.
     */
    var pyramidGeom = new THREE.ConeGeometry(60, 80, 4);
    var pyramidMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.7,
      roughness: 0.3,
    });
    var pyramid = new THREE.Mesh(pyramidGeom, pyramidMat);
    pyramid.position.set(0, 0, 0);
    pyramid.castShadow = true;
    pyramid.receiveShadow = true;

    window.SCN.add(pyramid);
    console.log('✓ Added pyramid landmark');
  }

  _generateLighting() {
    /**
     * Add street lamps at intersections.
     */
    for (var x = -this.width / 2; x < this.width / 2; x += 200) {
      for (var z = -this.height / 2; z < this.height / 2; z += 200) {
        this._addStreetLamp(x, z);
      }
    }
  }

  _addStreetLamp(x, z) {
    /**
     * Add a street lamp at position.
     */
    var post_geom = new THREE.CylinderGeometry(0.5, 0.5, 10, 8);
    var post_mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    var post = new THREE.Mesh(post_geom, post_mat);
    post.position.set(x, 5, z);
    post.castShadow = true;

    var light_geom = new THREE.SphereGeometry(1, 8, 8);
    var light_mat = new THREE.MeshBasicMaterial({ color: 0xffff99 });
    var light_mesh = new THREE.Mesh(light_geom, light_mat);
    light_mesh.position.y = 9;
    post.add(light_mesh);

    window.SCN.add(post);

    // Add point light for illumination
    var light = new THREE.PointLight(0xffff99, 0.5, 100);
    light.position.set(x, 10, z);
    window.SCN.add(light);
  }
}

window.CityMapGenerator = CityMapGenerator;
console.log('✓ map-generator.js loaded');
