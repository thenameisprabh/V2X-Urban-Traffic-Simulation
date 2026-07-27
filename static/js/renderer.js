/**
 * KESKUSTORI V2X - Three.js Rendering Pipeline
 * UPDATED: Proper coordinate system, road rendering, and vehicle scaling
 * Production-grade code with coordinate transforms
 */

class SimulationRenderer {
    constructor(canvasElement, roadNetworkData) {
        this.canvas = canvasElement;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.vehicleMeshes = new Map();
        this.trafficLightMeshes = new Map();
        this.roadNetworkData = roadNetworkData;
        
        // Stats
        this.frameCount = 0;
        this.lastTime = Date.now();
        this.fps = 0;
        
        // SCALE FACTOR: Map coordinates × SCALE = World coordinates
        // Map uses [-100, 800] × [-300, 800], we scale by 10
        this.SCALE = 10;
        
        // Map bounds derived from network data if available
        this.MAP_BOUNDS = this.computeMapBounds();
        
        console.log("🎬 SimulationRenderer constructor called with SCALE=" + this.SCALE);
        console.log('🎬 Map bounds:', this.MAP_BOUNDS);
        this.init();
    }

    computeMapBounds() {
        const defaultBounds = {
            minX: -100,
            maxX: 800,
            minZ: -300,
            maxZ: 800
        };

        if (!this.roadNetworkData || !Array.isArray(this.roadNetworkData.roads)) {
            return defaultBounds;
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;

        const normalizePoint = (point) => {
            if (!point) return null;
            if (Array.isArray(point) && point.length >= 2) {
                return { x: point[0], z: point[1] };
            }
            if (typeof point === 'object') {
                return { x: point.x ?? point[0], z: point.z ?? point[1] };
            }
            return null;
        };

        this.roadNetworkData.roads.forEach(road => {
            const geometry = Array.isArray(road.geometry) ? road.geometry : [];
            if (geometry.length > 0) {
                geometry.forEach(point => {
                    const p = normalizePoint(point);
                    if (!p) return;
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minZ = Math.min(minZ, p.z);
                    maxZ = Math.max(maxZ, p.z);
                });
            } else if (road.start && road.end) {
                const start = normalizePoint(road.start);
                const end = normalizePoint(road.end);
                [start, end].forEach(p => {
                    if (!p) return;
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minZ = Math.min(minZ, p.z);
                    maxZ = Math.max(maxZ, p.z);
                });
            }
        });

        if (minX === Number.POSITIVE_INFINITY || minZ === Number.POSITIVE_INFINITY) {
            return defaultBounds;
        }

        return {
            minX,
            maxX,
            minZ,
            maxZ
        };
    }

    init() {
        console.log('🎬 Initializing Three.js renderer...');

        try {
            // Scene setup
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x1a3a52);
            this.scene.fog = new THREE.Fog(0x1a3a52, 5000, 10000);

            // Calculate map center and dimensions
            const mapCenterX = (this.MAP_BOUNDS.minX + this.MAP_BOUNDS.maxX) / 2 * this.SCALE;
            const mapCenterZ = (this.MAP_BOUNDS.minZ + this.MAP_BOUNDS.maxZ) / 2 * this.SCALE;
        const mapWidth = Math.max((this.MAP_BOUNDS.maxX - this.MAP_BOUNDS.minX) * this.SCALE, 1);
        const mapHeight = Math.max((this.MAP_BOUNDS.maxZ - this.MAP_BOUNDS.minZ) * this.SCALE, 1);
            this.camera = new THREE.PerspectiveCamera(
                50,
                this.canvas.clientWidth / this.canvas.clientHeight,
                0.1,
                20000
            );

            // Position camera at distance to see entire map
            const distance = Math.max(mapWidth, mapHeight) * 0.7;
            this.camera.position.set(
                mapCenterX,
                distance * 0.6,
                mapCenterZ + distance * 0.5
            );
            this.camera.lookAt(mapCenterX, 0, mapCenterZ);

            console.log(`✅ Camera positioned at (${this.camera.position.x.toFixed(0)}, ${this.camera.position.y.toFixed(0)}, ${this.camera.position.z.toFixed(0)})`);
            console.log(`✅ Map center: (${mapCenterX.toFixed(0)}, ${mapCenterZ.toFixed(0)})`);
            console.log(`✅ Map dimensions: ${mapWidth.toFixed(0)} × ${mapHeight.toFixed(0)}`);

            // Renderer setup
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                alpha: true
            });
            this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFShadowShadowMap;

            console.log('✅ WebGL Renderer initialized');

            // Lighting
            this.setupLights();

            // Ground
            this.createGround();

            // Road network
            this.createRoadNetwork();

            // OrbitControls
            this.setupOrbitControls();

            // Start animation loop
            this.animate();

            console.log('✅ Three.js initialization complete');

        } catch (error) {
            console.error('❌ Initialization error:', error);
            throw error;
        }
    }

    setupLights() {
        try {
            // Ambient light
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
            this.scene.add(ambientLight);

            // Directional light (sun)
            const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
            sunLight.position.set(5000, 6000, 4000);
            sunLight.castShadow = true;
            sunLight.shadow.mapSize.width = 4096;
            sunLight.shadow.mapSize.height = 4096;
            sunLight.shadow.camera.left = -5000;
            sunLight.shadow.camera.right = 5000;
            sunLight.shadow.camera.top = 5000;
            sunLight.shadow.camera.bottom = -5000;
            sunLight.shadow.camera.far = 10000;
            sunLight.shadow.bias = -0.0005;
            this.scene.add(sunLight);

            console.log('✅ Lights created');
        } catch (error) {
            console.error('❌ Lighting error:', error);
        }
    }

    createGround() {
        try {
            const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
            const groundMaterial = new THREE.MeshLambertMaterial({ 
                color: 0x2a5a3a,
                flatShading: false
            });
            const ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            ground.position.y = -0.1;
            this.scene.add(ground);

            console.log('✅ Ground created');
        } catch (error) {
            console.error('❌ Ground error:', error);
        }
    }

    createRoadNetwork() {
        try {
            if (!this.roadNetworkData || !this.roadNetworkData.roads) {
                console.warn('⚠️ Road network data not available, creating placeholder grid');
                this.createPlaceholderRoads();
                return;
            }

            console.log(`🛣️  Creating ${this.roadNetworkData.roads.length} roads from network data...`);

            const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
            const roadWidth = 80; // 3.5m lane × 2 lanes × 10 scale ≈ 70-80

            // Draw each road
            this.roadNetworkData.roads.forEach((road, idx) => {
                try {
                    if (!road.geometry || road.geometry.length < 2) return;

                    const start = road.geometry[0];
                    const end = road.geometry[road.geometry.length - 1];

                    // Calculate road properties
                    const startX = start[0] * this.SCALE;
                    const startZ = start[1] * this.SCALE;
                    const endX = end[0] * this.SCALE;
                    const endZ = end[1] * this.SCALE;

                    const centerX = (startX + endX) / 2;
                    const centerZ = (startZ + endZ) / 2;
                    const length = Math.hypot(endX - startX, endZ - startZ);
                    const angle = Math.atan2(endZ - startZ, endX - startX);

                    // Create road mesh
                    const roadMesh = new THREE.Mesh(
                        new THREE.PlaneGeometry(roadWidth, length),
                        roadMaterial
                    );
                    roadMesh.rotation.x = -Math.PI / 2;
                    roadMesh.rotation.z = angle;
                    roadMesh.position.set(centerX, 0, centerZ);
                    roadMesh.receiveShadow = true;
                    this.scene.add(roadMesh);

                    // Add center line
                    const lineMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
                    const lineMesh = new THREE.Mesh(
                        new THREE.PlaneGeometry(3, length * 0.9),
                        lineMaterial
                    );
                    lineMesh.rotation.x = -Math.PI / 2;
                    lineMesh.rotation.z = angle;
                    lineMesh.position.set(centerX, 0.05, centerZ);
                    this.scene.add(lineMesh);

                    console.log(`  ✓ Road ${idx}: ${road.name} (${length.toFixed(0)}m)`);
                } catch (error) {
                    console.warn(`  ⚠️ Error rendering road ${idx}:`, error);
                }
            });

            console.log('✅ Road network created');
        } catch (error) {
            console.error('❌ Road network error:', error);
        }
    }

    createPlaceholderRoads() {
        console.log('🛣️  Creating placeholder road grid...');
        
        const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const roadWidth = 80;

        // Vertical roads
        for (let x = this.MAP_BOUNDS.minX; x <= this.MAP_BOUNDS.maxX; x += 400) {
            const road = new THREE.Mesh(
                new THREE.PlaneGeometry(roadWidth, (this.MAP_BOUNDS.maxZ - this.MAP_BOUNDS.minZ) * this.SCALE),
                roadMaterial
            );
            road.rotation.x = -Math.PI / 2;
            road.position.set(x * this.SCALE, 0, (this.MAP_BOUNDS.minZ + this.MAP_BOUNDS.maxZ) / 2 * this.SCALE);
            road.receiveShadow = true;
            this.scene.add(road);
        }

        // Horizontal roads
        for (let z = this.MAP_BOUNDS.minZ; z <= this.MAP_BOUNDS.maxZ; z += 400) {
            const road = new THREE.Mesh(
                new THREE.PlaneGeometry((this.MAP_BOUNDS.maxX - this.MAP_BOUNDS.minX) * this.SCALE, roadWidth),
                roadMaterial
            );
            road.rotation.x = -Math.PI / 2;
            road.position.set((this.MAP_BOUNDS.minX + this.MAP_BOUNDS.maxX) / 2 * this.SCALE, 0, z * this.SCALE);
            road.receiveShadow = true;
            this.scene.add(road);
        }

        console.log('✅ Placeholder road grid created');
    }

    setupOrbitControls() {
        try {
            if (typeof OrbitControls === 'undefined') {
                console.warn('⚠️ OrbitControls not available');
                return;
            }

            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.08;
            this.controls.enableZoom = true;
            this.controls.zoomSpeed = 1.5;
            this.controls.autoRotate = false;
            
            // Zoom limits
            this.controls.minDistance = 500;
            this.controls.maxDistance = 8000;
            
            // Set target to map center
            const mapCenterX = (this.MAP_BOUNDS.minX + this.MAP_BOUNDS.maxX) / 2 * this.SCALE;
            const mapCenterZ = (this.MAP_BOUNDS.minZ + this.MAP_BOUNDS.maxZ) / 2 * this.SCALE;
            this.controls.target.set(mapCenterX, 100, mapCenterZ);
            this.controls.update();

            console.log('✅ OrbitControls initialized');
        } catch (error) {
            console.error('❌ OrbitControls error:', error);
        }
    }

    /**
     * UPDATE VEHICLES
     */
    updateVehicles(vehicles) {
        if (!Array.isArray(vehicles) || vehicles.length === 0) {
            return;
        }

        const activeUIDs = new Set();

        vehicles.forEach(vehicle => {
            try {
                if (!vehicle || vehicle.uid === undefined) {
                    return;
                }

                activeUIDs.add(vehicle.uid);

                // Create or update mesh
                if (!this.vehicleMeshes.has(vehicle.uid)) {
                    const mesh = this.createVehicleMesh(vehicle);
                    if (mesh) {
                        this.vehicleMeshes.set(vehicle.uid, mesh);
                    }
                } else {
                    const mesh = this.vehicleMeshes.get(vehicle.uid);
                    this.updateVehicleMesh(mesh, vehicle);
                }
            } catch (error) {
                console.error('❌ Vehicle update error:', error);
            }
        });

        // Remove inactive vehicles
        for (const [uid, mesh] of this.vehicleMeshes.entries()) {
            if (!activeUIDs.has(uid)) {
                try {
                    this.scene.remove(mesh);
                    this.vehicleMeshes.delete(uid);
                } catch (error) {
                    console.error('❌ Vehicle removal error:', error);
                }
            }
        }
    }

    /**
     * CREATE VEHICLE MESH
     */
    createVehicleMesh(vehicle) {
        try {
            let geometry, color;
            const vehicleType = (vehicle.type || 'car').toLowerCase();

            // Vehicle geometries (scaled for visibility)
            switch (vehicleType) {
                case 'car':
                    geometry = new THREE.BoxGeometry(40, 25, 80);
                    color = 0xFF4444;
                    break;
                case 'bus':
                    geometry = new THREE.BoxGeometry(30, 35, 100);
                    color = 0xFFDD00;
                    break;
                case 'cyclist':
                    geometry = new THREE.BoxGeometry(20, 30, 50);
                    color = 0x44FF44;
                    break;
                case 'pedestrian':
                case 'people':
                    geometry = new THREE.BoxGeometry(15, 40, 15);
                    color = 0x4444FF;
                    break;
                case 'ambulance':
                    geometry = new THREE.BoxGeometry(35, 30, 90);
                    color = 0xFF00FF;
                    break;
                case 'police':
                    geometry = new THREE.BoxGeometry(35, 30, 90);
                    color = 0x0088FF;
                    break;
                case 'fire_truck':
                    geometry = new THREE.BoxGeometry(35, 35, 100);
                    color = 0xFF6600;
                    break;
                default:
                    geometry = new THREE.BoxGeometry(30, 20, 60);
                    color = 0xFFAA00;
            }

            const material = new THREE.MeshPhongMaterial({
                color,
                shininess: 100,
                flatShading: false,
                emissive: 0x000000
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { uid: vehicle.uid, type: vehicleType };

            // Position with coordinate transform: MAP → WORLD
            const posX = (vehicle.pos ? vehicle.pos[0] : 0) * this.SCALE;
            const posZ = (vehicle.pos ? vehicle.pos[1] : 0) * this.SCALE;
            mesh.position.set(posX, 15, posZ);
            mesh.rotation.y = vehicle.rotation || 0;

            this.scene.add(mesh);
            
            return mesh;

        } catch (error) {
            console.error('❌ Create vehicle mesh error:', error, vehicle);
            return null;
        }
    }

    /**
     * UPDATE VEHICLE MESH
     */
    updateVehicleMesh(mesh, vehicle) {
        try {
            if (!mesh || !vehicle) return;

            // Position with coordinate transform
            const posX = (vehicle.pos ? vehicle.pos[0] : 0) * this.SCALE;
            const posZ = (vehicle.pos ? vehicle.pos[1] : 0) * this.SCALE;

            mesh.position.set(posX, 15, posZ);
            mesh.rotation.y = vehicle.rotation || 0;

        } catch (error) {
            console.error('❌ Update vehicle mesh error:', error);
        }
    }

    /**
     * UPDATE TRAFFIC LIGHTS
     */
    updateTrafficLights(lights) {
        if (!Array.isArray(lights)) return;

        lights.forEach(light => {
            try {
                if (!this.trafficLightMeshes.has(light.id)) {
                    this.trafficLightMeshes.set(
                        light.id,
                        this.createTrafficLightMesh(light)
                    );
                } else {
                    this.updateTrafficLightState(
                        this.trafficLightMeshes.get(light.id),
                        light
                    );
                }
            } catch (error) {
                console.error('❌ Traffic light error:', error);
            }
        });
    }

    /**
     * CREATE TRAFFIC LIGHT MESH
     */
    createTrafficLightMesh(light) {
        try {
            const group = new THREE.Group();

            // Pole
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(5, 5, 80, 8),
                new THREE.MeshPhongMaterial({ 
                    color: 0x333333,
                    shininess: 30
                })
            );
            pole.position.y = 40;
            pole.castShadow = true;
            group.add(pole);

            // Traffic light heads
            const colors = [0xFF0000, 0xFFFF00, 0x00FF00];
            for (let i = 0; i < 3; i++) {
                const lightMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(8, 16, 16),
                    new THREE.MeshPhongMaterial({
                        color: colors[i],
                        emissive: 0x000000,
                        shininess: 100
                    })
                );
                lightMesh.position.y = 65 - i * 12;
                lightMesh.castShadow = true;
                lightMesh.userData = { lightIndex: i };
                group.add(lightMesh);
            }

            // Position with coordinate transform
            const posX = (light.pos ? light.pos[0] : 0) * this.SCALE;
            const posZ = (light.pos ? light.pos[1] : 0) * this.SCALE;
            group.position.set(posX, 0, posZ);
            group.userData = { id: light.id };
            this.scene.add(group);

            return group;

        } catch (error) {
            console.error('❌ Create traffic light error:', error);
            return null;
        }
    }

    /**
     * UPDATE TRAFFIC LIGHT STATE
     */
    updateTrafficLightState(group, light) {
        try {
            const stateStr = light.state.split('.')[1]?.toUpperCase() || 'RED';
            let emissiveColor = 0x330000;
            let emissiveIntensity = 0.3;

            if (stateStr === 'GREEN') {
                emissiveColor = 0x00FF00;
                emissiveIntensity = 0.8;
            } else if (stateStr === 'YELLOW') {
                emissiveColor = 0xFFFF00;
                emissiveIntensity = 0.6;
            } else if (stateStr === 'RED') {
                emissiveColor = 0xFF0000;
                emissiveIntensity = 0.8;
            }

            group.children.forEach(child => {
                if (child.userData && child.userData.lightIndex !== undefined) {
                    child.material.emissive.setHex(emissiveColor);
                    child.material.emissiveIntensity = emissiveIntensity;
                }
            });

        } catch (error) {
            console.error('❌ Update traffic light state error:', error);
        }
    }

    /**
     * ANIMATION LOOP
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        try {
            if (this.controls) {
                this.controls.update();
            }

            this.frameCount++;
            const now = Date.now();
            if (now - this.lastTime >= 1000) {
                this.fps = this.frameCount;
                this.frameCount = 0;
                this.lastTime = now;
            }

            this.renderer.render(this.scene, this.camera);

        } catch (error) {
            console.error('❌ Animation loop error:', error);
        }
    }

    resize() {
        try {
            const width = this.canvas.clientWidth;
            const height = this.canvas.clientHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);

        } catch (error) {
            console.error('❌ Resize error:', error);
        }
    }

    getFPS() {
        return this.fps;
    }

    getSceneInfo() {
        return {
            vehicles: this.vehicleMeshes.size,
            trafficLights: this.trafficLightMeshes.size,
            fps: this.fps
        };
    }
}

window.SimulationRenderer = SimulationRenderer;
console.log('✅ SimulationRenderer loaded');
