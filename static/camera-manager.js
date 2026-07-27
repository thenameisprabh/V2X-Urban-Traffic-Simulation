/**
 * Camera Manager - Professional camera control
 */

class CameraManager {
    constructor(camera, renderer, orbitControls) {
        this.camera = camera;
        this.renderer = renderer;
        this.controls = orbitControls;
        
        this.mode = 'FREE';
        this.modes = {
            'FREE': 'Orbit around center',
            'TOP_DOWN': "Bird's eye view",
            'FOLLOW_VEHICLE': 'Third-person chase'
        };
        
        this.setupInputs();
        console.log('🎥 CameraManager initialized');
    }

    setupInputs() {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Numpad1') {
                this.setMode('TOP_DOWN');
            } else if (e.code === 'Numpad2') {
                this.setMode('FREE');
            } else if (e.code === 'Space') {
                this.reset();
            }
        });
    }

    setMode(mode) {
        if (mode in this.modes) {
            this.mode = mode;
            console.log(`📷 Camera mode: ${mode}`);
            
            if (mode === 'TOP_DOWN') {
                this.enableTopDown();
            } else if (mode === 'FREE') {
                this.enableFree();
            }
        }
    }

    enableFree() {
        if (this.controls) {
            this.controls.enabled = true;
            this.controls.autoRotate = false;
        }
    }

    enableTopDown() {
        const centerX = 350;
        const centerZ = 250;
        
        this.camera.position.set(centerX, 400, centerZ);
        this.camera.lookAt(centerX, 0, centerZ);
        this.camera.fov = 75;
        this.camera.updateProjectionMatrix();
        
        if (this.controls) {
            this.controls.enabled = false;
        }
    }

    reset() {
        this.setMode('FREE');
        if (this.controls) {
            this.controls.reset();
        }
    }

    getMode() {
        return this.mode;
    }
}

window.CameraManager = CameraManager;
