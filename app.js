    // Three.js setup
    const container = document.getElementById('canvas-container');
    // const overlay = document.getElementById('overlay'); // Removed
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // Black background
    scene.fog = new THREE.FogExp2(0x000000, 0.018); // Black fog
    
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 35);
    camera.lookAt(0, 0, 0);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true; // Enable WebXR
    container.appendChild(renderer.domElement);
    
    // Add VR Button
    if (typeof VRButton !== 'undefined') {
        const vrButton = VRButton.createButton(renderer);
        document.body.appendChild(vrButton);
        
        // Setup VR Camera Rig
        const vrCameraGroup = new THREE.Group();
        vrCameraGroup.position.set(0, 0, 35); // Start at same position as main camera
        scene.add(vrCameraGroup);
        vrCameraGroup.add(camera);
        
        renderer.xr.addEventListener('sessionstart', () => {
            // Adjust camera for VR scale
            vrCameraGroup.position.set(0, 2, 10); 
        });
        
    } else {
        console.warn('VRButton is not defined. Make sure the script is loaded correctly.');
    }
    
    // OrbitControls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false; // Disabled by default (View Mode)
    
    // Geometry
    const particleCount = 1500000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for(let i=0; i<particleCount; i++) positions[i*3 + 1] = -10000; // Hide unused particles
    const colors = new Float32Array(particleCount * 3);
    const types = new Float32Array(particleCount); // 0 = wood, 1 = leaf
    
    const woodColorBase = new THREE.Color(0x6b5b45); // Muted birch/pine bark
    const woodColorVar = new THREE.Color(0x4a4031);
    
    // Seasonal Palettes (Nordic/Scandi)
    const palettes = {
        autumn: [ // Tundra Autumn
            new THREE.Color(0x8b7355), new THREE.Color(0x6b5b45), new THREE.Color(0xa0855b),
            new THREE.Color(0x5c4d3c), new THREE.Color(0x8c3a3a), new THREE.Color(0x4a5e31),
            new THREE.Color(0x7a8b6c), new THREE.Color(0x9e907f)
        ],
        spring: [ // Taiga Spring
            new THREE.Color(0x6b8e23), new THREE.Color(0x556b2f), new THREE.Color(0x8fbc8f),
            new THREE.Color(0x4f6f52), new THREE.Color(0x78866b), new THREE.Color(0x9eab88),
            new THREE.Color(0xdbe5d0), new THREE.Color(0xe8ece1) // Birch/pale blossoms
        ],
        winter: [ // Fjord Winter
            new THREE.Color(0x2f4f4f), new THREE.Color(0x3a4f3d), new THREE.Color(0x4a5d5e),
            new THREE.Color(0x708090), new THREE.Color(0xb0c4de), new THREE.Color(0xe6e6fa),
            new THREE.Color(0xf0f8ff), new THREE.Color(0xffffff)
        ]
    };
    
    // Global Params & GUI
    const params = {
        mode: 'explore', // 'explore' or 'terraform'
        season: 'autumn',
        riverWidth: 4.0,
        terrainRoughness: 2.0,
        treeScale: 0.7,
        treeDensity: 35,
        plantType: 'Oak',
        interactionMode: 'Fluid Push/Pull',
        interactionContext: 'All', // New context control
        interactionRadius: 5.0,
        interactionForce: 1.0,
        windStrength: 1.0,
        windDirection: 0.0, // Angle in radians
        sunElevation: 0.3,
        sunAzimuth: 0.5,
        fogDensity: 0.018,
        clearAndRegenerate: () => generateEnvironment(true)
    };
    
    const gui = new lil.GUI({ title: 'Control Panel' });
    gui.hide(); // Hidden in explore mode
    
    const envFolder = gui.addFolder('Environment Design');
    envFolder.add(params, 'season', ['autumn', 'spring', 'winter']).onChange(() => generateEnvironment(true));
    envFolder.add(params, 'riverWidth', 1.0, 10.0).onChange(() => generateEnvironment(true));
    envFolder.add(params, 'terrainRoughness', 0.5, 5.0).onChange(() => generateEnvironment(true));
    envFolder.add(params, 'treeDensity', 0, 100, 1).onChange(() => generateEnvironment(true));
    envFolder.add(params, 'fogDensity', 0.005, 0.05).onChange(v => scene.fog.density = v);
    envFolder.add(params, 'clearAndRegenerate').name('Regenerate All');
    
    const atmosFolder = gui.addFolder('Atmosphere & Wind');
    atmosFolder.add(params, 'windStrength', 0.0, 5.0);
    atmosFolder.add(params, 'windDirection', 0.0, Math.PI * 2);
    atmosFolder.add(params, 'sunElevation', 0.0, Math.PI / 2);
    atmosFolder.add(params, 'sunAzimuth', 0.0, Math.PI * 2);
    
    const plantFolder = gui.addFolder('Planting (Click to Plant)');
    plantFolder.add(params, 'plantType', ['Oak', 'Pine', 'Bush']);
    plantFolder.add(params, 'treeScale', 0.3, 2.0);

    const intFolder = gui.addFolder('Interaction (Explore Mode)');
    intFolder.add(params, 'interactionMode', ['Wind Gust', 'Tornado', 'Parting', 'Fluid Push/Pull', 'Seismic Ripple', 'Aurora Field']);
    intFolder.add(params, 'interactionContext', ['All', 'Trees Only', 'Water Only', 'Ground Only']);
    intFolder.add(params, 'interactionRadius', 1.0, 15.0);
    intFolder.add(params, 'interactionForce', 0.1, 3.0);

    // Keyboard Controls State
    const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    let camTheta = Math.PI / 2;
    let camPhi = Math.PI / 3;
    let camRadius = 37;
    
    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (keys.hasOwnProperty(k)) keys[k] = true;
        
        // Toggle BLE Button visibility with 'b' key
        if (k === 'b') {
            document.getElementById('ble-btn').classList.toggle('visible');
        }
    });
    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (keys.hasOwnProperty(k)) keys[k] = false;
    });

    // UI Toggle - Removed for Museum Mode
    /*
    const modeToggle = document.getElementById('mode-toggle');
    modeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (params.mode === 'explore') {
            params.mode = 'terraform';
            modeToggle.innerText = 'Mode: Terraform (Click to Plant)';
            document.body.classList.add('design-active');
            gui.show();
            controls.enabled = true; // Enable OrbitControls
        } else {
            params.mode = 'explore';
            modeToggle.innerText = 'Mode: Explore';
            document.body.classList.remove('design-active');
            gui.hide();
            controls.enabled = false; // Disable OrbitControls
            
            // Sync custom camera controls with current camera position
            const spherical = new THREE.Spherical().setFromVector3(camera.position);
            camRadius = spherical.radius;
            camPhi = spherical.phi;
            camTheta = spherical.theta;
        }
    });
    */
    
    // Simple pseudo-noise for color clustering
    function simpleNoise(x, y, z) {
        const s = Math.sin(x * 0.5) * Math.cos(y * 0.3) * Math.sin(z * 0.5);
        return (s + 1.0) * 0.5; // 0 to 1
    }
    
    let pIndex = 0;
    
    function addParticle(x, y, z, color, type) {
      if (pIndex >= particleCount) return;
      positions[pIndex * 3] = x;
      positions[pIndex * 3 + 1] = y;
      positions[pIndex * 3 + 2] = z;
      
      colors[pIndex * 3] = color.r;
      colors[pIndex * 3 + 1] = color.g;
      colors[pIndex * 3 + 2] = color.b;
      
      types[pIndex] = type;
      
      pIndex++;
    }
    
    // Recursive tree generation
    function createBranch(start, dir, length, radius, depth, maxDepth) {
      // Wood particles for this segment
      const density = 500; 
      const segmentParticles = Math.max(20, Math.floor(length * radius * density)); 
      
      // Tangent vectors for cylinder volume
      const axis = dir.clone().normalize();
      const perp = new THREE.Vector3(1, 0, 0);
      if (Math.abs(axis.x) > 0.9) perp.set(0, 1, 0);
      perp.cross(axis).normalize();
      const perp2 = new THREE.Vector3().crossVectors(axis, perp).normalize();
      
      // Draw Wood
      for (let i = 0; i < segmentParticles; i++) {
        const h = Math.random() * length;
        // Taper radius
        const t = h / length;
        const r = radius * (1.0 - t * 0.2); // Taper
        const theta = Math.random() * Math.PI * 2;
        
        // Noise for bark texture
        const rNoise = (Math.random() - 0.5) * 0.15 * radius;
        
        // Ambient Occlusion: Darker towards the center
        const distanceToCenter = Math.random();
        const ao = 0.4 + 0.6 * distanceToCenter; // Brighter wood
        
        // Position
        const p = new THREE.Vector3().copy(start).add(axis.clone().multiplyScalar(h));
        p.add(perp.clone().multiplyScalar((r + rNoise) * distanceToCenter * Math.cos(theta)));
        p.add(perp2.clone().multiplyScalar((r + rNoise) * distanceToCenter * Math.sin(theta)));
        
        // Wood color variation
        const c = woodColorBase.clone().lerp(woodColorVar, Math.random() * 0.8).multiplyScalar(ao);
        addParticle(p.x, p.y, p.z, c, 0.0);
      }
      
      // Leaf Generation (Canopy)
      if (depth <= 3) { 
        const isTip = depth === 0;
        const leafDensity = isTip ? 180 : 50; 
        const leafSpread = isTip ? 1.8 : 0.9;
        
        // Distribute leaves along the branch
        for (let i = 0; i < leafDensity; i++) {
            const t = Math.pow(Math.random(), 0.6); // Bias towards end
            const center = new THREE.Vector3().copy(start).add(dir.clone().multiplyScalar(length * t));
            
            // Random offset for volume
            const offset = new THREE.Vector3(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).normalize().multiplyScalar(Math.random() * leafSpread);
            
            const pos = center.add(offset);
            
            // Ambient Occlusion for leaves
            const distFromCenter = offset.length() / leafSpread;
            const ao = 0.5 + 0.5 * distFromCenter;
            
            // Color Clustering Logic
            const noiseVal = simpleNoise(pos.x, pos.y, pos.z); // 0 to 1
            const currentPalette = palettes[params.season];
            const paletteIndexFloat = noiseVal * (currentPalette.length - 1) + (Math.random() - 0.5) * 2.0;
            const paletteIndex = Math.max(0, Math.min(currentPalette.length - 1, Math.floor(paletteIndexFloat)));
            
            const baseC = currentPalette[paletteIndex];
            const c = baseC.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.1).multiplyScalar(ao); 
            
            addParticle(pos.x, pos.y, pos.z, c, 1.0);
        }
      }
      
      if (depth <= 0) return;
      
      // Branching Logic
      const end = new THREE.Vector3().copy(start).add(dir.clone().multiplyScalar(length));
      
      // Number of branches splits
      let numBranches = 2;
      // Occasional triple split
      if (Math.random() < 0.25) numBranches = 3;
      // Main trunk splits less often at bottom
      if (depth > maxDepth - 2) numBranches = 2;
      
      for (let i = 0; i < numBranches; i++) {
         // Angle Variance
         const spreadBase = 0.8;
         const spread = spreadBase + (Math.random() - 0.4) * 0.4;
         
         const angleX = (Math.random() - 0.5) * spread;
         const angleZ = (Math.random() - 0.5) * spread;
         
         const newDir = dir.clone().applyEuler(new THREE.Euler(angleX, 0, angleZ)).normalize();
         
         // Gravity/Droop
         newDir.y -= 0.08 * (maxDepth - depth) * 0.15; 
         newDir.normalize();
         
         // Length decay
         const lenDecay = 0.75 + Math.random() * 0.15;
         // Radius decay
         const radDecay = 0.6;
         
         createBranch(
           end, 
           newDir, 
           length * lenDecay, 
           radius * radDecay, 
           depth - 1,
           maxDepth
         );
      }
    }
    
    function createPine(start, scale) {
        const height = 10.0 * scale;
        const trunkRadius = 1.0 * scale;
        const density = 600;
        
        // Trunk
        const trunkParticles = Math.floor(height * trunkRadius * density);
        for(let i=0; i<trunkParticles; i++) {
            const h = Math.random() * height;
            const r = trunkRadius * (1.0 - h/height);
            const theta = Math.random() * Math.PI * 2;
            const p = new THREE.Vector3(
                start.x + r * Math.cos(theta),
                start.y + h,
                start.z + r * Math.sin(theta)
            );
            const ao = 0.4 + 0.6 * Math.random();
            const c = woodColorBase.clone().lerp(woodColorVar, Math.random()).multiplyScalar(ao);
            addParticle(p.x, p.y, p.z, c, 0.0);
        }
        
        // Leaves (Cone)
        const leafDensity = 4000 * scale;
        for(let i=0; i<leafDensity; i++) {
            const h = Math.random() * height * 0.85 + height * 0.15; 
            const maxR = (height - h) * 0.5; 
            const r = Math.pow(Math.random(), 0.5) * maxR;
            const theta = Math.random() * Math.PI * 2;
            const p = new THREE.Vector3(
                start.x + r * Math.cos(theta),
                start.y + h,
                start.z + r * Math.sin(theta)
            );
            
            const distFromCenter = r / maxR;
            const ao = 0.3 + 0.7 * distFromCenter;
            
            const noiseVal = simpleNoise(p.x, p.y, p.z);
            const currentPalette = palettes[params.season];
            const paletteIndex = Math.floor(noiseVal * (currentPalette.length - 1));
            const c = currentPalette[paletteIndex].clone().multiplyScalar(ao);
            
            // Make pines slightly darker/greener
            c.lerp(new THREE.Color(0x166534), 0.3);
            
            addParticle(p.x, p.y, p.z, c, 1.0);
        }
    }

    function createBush(start, scale) {
        const radius = 2.5 * scale;
        const leafDensity = 3000 * scale;
        for(let i=0; i<leafDensity; i++) {
            const r = Math.pow(Math.random(), 0.4) * radius;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI; 
            
            const p = new THREE.Vector3(
                start.x + r * Math.sin(phi) * Math.cos(theta),
                start.y + r * Math.cos(phi) * 0.7, 
                start.z + r * Math.sin(phi) * Math.sin(theta)
            );
            if (p.y < start.y) p.y = start.y + Math.random()*0.5; 
            
            const distFromCenter = r / radius;
            const ao = 0.4 + 0.6 * distFromCenter;
            
            const noiseVal = simpleNoise(p.x, p.y, p.z);
            const currentPalette = palettes[params.season];
            const paletteIndex = Math.floor(noiseVal * (currentPalette.length - 1));
            const c = currentPalette[paletteIndex].clone().multiplyScalar(ao);
            
            addParticle(p.x, p.y, p.z, c, 1.0);
        }
    }
    
    // Terrain and River Generation
    function smoothstep(min, max, value) {
      const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
      return x * x * (3 - 2 * x);
    }

    function terrainHeight(x, z) {
        // Meandering river path
        const riverPathX = Math.sin(z * 0.1) * 8.0 + Math.cos(z * 0.05) * 5.0;
        const distToRiver = Math.abs(x - riverPathX);
        
        // Valley shape
        let h = (1.0 - Math.exp(-distToRiver * 0.15)) * 8.0; 
        
        // Add some noise for hills based on roughness param
        h += Math.sin(x * 0.2) * Math.cos(z * 0.2) * params.terrainRoughness; 
        h += Math.sin(x * 0.5 + z * 0.3) * (params.terrainRoughness * 0.25);
        
        return h - 4.0; // Lower overall
    }

    function generateEnvironment(clear = false) {
        if (clear) {
            pIndex = 0;
        }

        // 1. Generate Terrain (Random sampling for organic look)
        const terrainParticles = 350000;
        const terrainSize = 70;
        
        for (let i = 0; i < terrainParticles; i++) {
            const px = (Math.random() - 0.5) * terrainSize;
            const pz = (Math.random() - 0.5) * terrainSize;
            
            const riverPathX = Math.sin(pz * 0.1) * 8.0 + Math.cos(pz * 0.05) * 5.0;
            const distToRiver = Math.abs(px - riverPathX);
            const baseHeight = terrainHeight(px, pz);
            
            const riverWidth = params.riverWidth + Math.sin(pz * 0.3) * 1.5;
            
            // Add thickness to the ground
            const depth = Math.pow(Math.random(), 2.0) * 3.0; // Bias towards surface
            const py = baseHeight - depth;
            
            if (distToRiver < riverWidth && baseHeight < -1.0) {
                // Water
                const waterLevel = -2.0;
                if (py < waterLevel + 0.5) {
                    const c = new THREE.Color(0x1c3d4d).lerp(new THREE.Color(0x2a5a6b), Math.random());
                    // Flat surface with slight noise
                    const waterY = waterLevel + (Math.random()-0.5)*0.2;
                    addParticle(px, waterY, pz, c, 3.0);
                }
            } else {
                // Ground
                // Color based on height and distance to river
                const moisture = 1.0 - smoothstep(riverWidth, riverWidth + 10.0, distToRiver);
                
                // Adjust ground color slightly based on season
                let colorMoss = new THREE.Color(0x4a5d4e); // Muted nordic moss
                let colorDirt = new THREE.Color(0x3d3b38); // Dark slate dirt
                let colorHigh = new THREE.Color(0x5c6b6d); // Slate rock
                let colorRock = new THREE.Color(0x7a8789); // Lighter rock
                
                if (params.season === 'winter') {
                    colorMoss = new THREE.Color(0xdce2e6); // Snowy moss
                    colorHigh = new THREE.Color(0xeef2f5); // Snowy peaks
                } else if (params.season === 'spring') {
                    colorMoss = new THREE.Color(0x5c7a62); // Greener moss
                }
                
                let c = colorDirt.clone().lerp(colorMoss, moisture);
                c.lerp(colorHigh, smoothstep(-2.0, 2.0, baseHeight));
                c.lerp(colorRock, smoothstep(2.0, 6.0, baseHeight)); // Rocky peaks
                
                // Add noise to color
                c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
                
                // AO based on depth
                const ao = 0.2 + 0.8 * (1.0 - depth / 3.0);
                c.multiplyScalar(ao);
                
                addParticle(px, py, pz, c, 2.0);
            }
        }

        // 2. Forest Generation
        for (let i = 0; i < params.treeDensity; i++) {
            let tx, tz, py;
            let valid = false;
            let attempts = 0;
            while(!valid && attempts < 100) {
                tx = (Math.random() - 0.5) * (terrainSize - 10);
                tz = (Math.random() - 0.5) * (terrainSize - 10);
                const riverPathX = Math.sin(tz * 0.1) * 8.0 + Math.cos(tz * 0.05) * 5.0;
                const distToRiver = Math.abs(tx - riverPathX);
                const riverWidth = params.riverWidth + Math.sin(tz * 0.3) * 1.5;
                
                if (distToRiver > riverWidth + 2.0) { // Keep away from river
                    valid = true;
                }
                attempts++;
            }
            
            if (valid) {
                py = terrainHeight(tx, tz);
                const scale = params.treeScale + Math.random() * 0.8;
                const tiltX = (Math.random() - 0.5) * 0.2;
                const tiltZ = (Math.random() - 0.5) * 0.2;
                const dir = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
                
                if (params.plantType === 'Oak') {
                    createBranch(new THREE.Vector3(tx, py, tz), dir, 5.0 * scale, 1.6 * scale, 6, 6);
                } else if (params.plantType === 'Pine') {
                    createPine(new THREE.Vector3(tx, py, tz), scale);
                } else if (params.plantType === 'Bush') {
                    createBush(new THREE.Vector3(tx, py, tz), scale);
                }
            }
        }
        
        geometry.setDrawRange(0, pIndex);
        if (clear) {
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.color.needsUpdate = true;
            geometry.attributes.type.needsUpdate = true;
        }
    }

    // Initial Generation
    generateEnvironment(false);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('type', new THREE.BufferAttribute(types, 1));
    
    // Shaders
    const vertexShader = `
      attribute vec3 color;
      attribute float type; // 0 = wood, 1 = leaf
      
      uniform float uTime;
      uniform vec3 uMouse;
      uniform float uRadius;
      uniform float uForce;
      uniform float uInteractionType;
      uniform float uInteractionContext; // New uniform
      uniform vec3 uWindDir;
      uniform float uWindStrength;
      uniform vec3 uMouseVelocity; // Added
      
      varying float vDisplacement;
      varying vec3 vPosition;
      varying vec3 vColor;
      varying float vType;
      varying float vRustle; // New varying for SSS/Light interaction
      varying float vSwirl;
      varying float vAurora; // New varying for Aurora effect
      varying vec3 vWorldNormal; // For volumetric lighting
      varying vec3 vVelocity; // Added
      
      // Simplex 3D Noise 
      vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
      vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
      
      float snoise(vec3 v){ 
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
      
        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 = v - i + dot(i, C.xxx) ;
      
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
      
        vec3 x1 = x0 - i1 + 1.0 * C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
      
        i = mod(i, 289.0 ); 
        vec4 p = permute( permute( permute( 
                   i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
      
        float n_ = 1.0/7.0; // N=7
        vec3  ns = n_ * D.wyz - D.xzx;
      
        vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
      
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
      
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
      
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
      
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
      
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
      
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
      
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;
      
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                      dot(p2,x2), dot(p3,x3) ) );
      }
      
      mat2 rotate2d(float _angle){
          return mat2(cos(_angle),-sin(_angle),
                      sin(_angle),cos(_angle));
      }
      
      void main() {
        vPosition = position;
        vColor = color;
        vType = type;
        
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        
        // --- Sophisticated Wind Effect ---
        float windSpeed = uTime * 0.5;
        float windStrength = 0.0;
        float rustle = 0.0;
        
        // Complex wind field using 3D noise
        vec3 windPos = position * 0.05 + uWindDir * uTime * 1.5;
        float windNoise = snoise(windPos) * 0.5 + 0.5;
        float gust = snoise(windPos * 0.2 + vec3(100.0)) * 0.5 + 0.5;
        vec3 windForce = uWindDir * (windNoise + gust * 2.0) * uWindStrength;
        
        if (type == 1.0) { // Leaf
            rustle = snoise(vec3(position.x * 4.0, position.y * 4.0 + uTime * 3.0, position.z * 4.0));
            worldPosition.x += rustle * 0.08;
            worldPosition.y += rustle * 0.05;
            worldPosition.z += rustle * 0.08;
            windStrength = 0.8; 
        } else if (type == 0.0) { // Wood
            windStrength = 0.15; 
        } else if (type == 3.0) { // Water
            float ripple = snoise(vec3(position.x * 3.0, uTime * 1.5, position.z * 3.0));
            worldPosition.y += ripple * 0.1;
            worldPosition.x += snoise(vec3(position.x, position.y, uTime)) * 0.05;
            windStrength = 0.05;
        } else { // Ground
            windStrength = 0.0;
        }
        vRustle = rustle;
        
        if (type < 1.5) { // Only trees sway
            float heightFactor = smoothstep(-5.0, 15.0, position.y);
            // Apply sophisticated wind force
            worldPosition.xyz += windForce * heightFactor * windStrength * 2.0;
            
            // Add some sway perpendicular to wind
            vec3 perpWind = cross(uWindDir, vec3(0.0, 1.0, 0.0));
            if (length(perpWind) < 0.1) perpWind = vec3(1.0, 0.0, 0.0);
            float sway = snoise(vec3(0.0, position.y * 0.1, windSpeed)) * heightFactor * windStrength;
            worldPosition.xyz += normalize(perpWind) * sway;
        }
        
        // --- INTERACTION LOGIC ---
        
        bool canInteract = true;
        if (uInteractionContext == 1.0 && type > 1.5) canInteract = false; // Trees only (type 0 or 1)
        if (uInteractionContext == 2.0 && type != 3.0) canInteract = false; // Water only
        if (uInteractionContext == 3.0 && type != 2.0) canInteract = false; // Ground only
        
        float dist = distance(worldPosition.xyz, uMouse);
        float influence = 1.0 - smoothstep(0.0, uRadius, dist);
        if (!canInteract) influence = 0.0;
        
        vec3 noiseVec = vec3(
          snoise(position * 1.5 + uTime * 0.5),
          snoise(position * 1.5 + uTime * 0.5 + 100.0),
          snoise(position * 1.5 + uTime * 0.5 + 200.0)
        );
        
        vec3 dir = normalize(worldPosition.xyz - uMouse);
        dir += vec3(0.0, 0.2, 0.0); // Slight upward bias
        dir = normalize(dir);
        
        float scatterMult = 1.5;
        if (type == 1.0) scatterMult = 3.0; // Leaves move more
        if (type == 3.0) scatterMult = 2.0; // Water
        if (type == 2.0) scatterMult = 0.5; // Ground moves less
        if (type == 0.0) scatterMult = 0.2; // Wood moves very little
        
        float noiseAmp = (uForce > 0.0) ? 1.0 : 0.2; 
        
        vec3 displacement = vec3(0.0);
        float swirl = 0.0;
        
        vAurora = 0.0;
        
        if (uInteractionType == 1.0 && influence > 0.0) {
            // Tornado Mode
            swirl = influence;
            float spinSpeed = 15.0;
            float angle = influence * uTime * spinSpeed;
            
            vec3 toParticle = worldPosition.xyz - uMouse;
            vec2 rotatedXZ = rotate2d(angle) * toParticle.xz;
            
            worldPosition.x = uMouse.x + rotatedXZ.x;
            worldPosition.z = uMouse.z + rotatedXZ.y;
            
            vec3 newDir = normalize(worldPosition.xyz - uMouse);
            displacement = (newDir * uForce * 0.5 + noiseVec * noiseAmp + vec3(0.0, 2.0, 0.0)) * influence * scatterMult;
            worldPosition.xyz += displacement;
            
        } else if (uInteractionType == 2.0) {
            // Parting Mode
            displacement = vec3(dir.x, 0.0, dir.z) * abs(uForce) * 2.0 * influence * scatterMult + noiseVec * noiseAmp * influence;
            worldPosition.xyz += displacement;
        } else if (uInteractionType == 3.0) {
            // Fluid Push/Pull (PhD Level) with Velocity Field and Context
            float mouseSpeed = clamp(length(uMouseVelocity), 0.0, 20.0);
            vec3 mouseDir = mouseSpeed > 0.01 ? normalize(uMouseVelocity) : dir;
            
            // Advection along mouse path
            vec3 advection = mouseDir * mouseSpeed * influence * 0.3;
            
            // Curl noise based on cross product of mouse dir and vector to particle
            vec3 toParticle = normalize(worldPosition.xyz - uMouse);
            vec3 vortexAxis = cross(mouseDir, toParticle);
            if (length(vortexAxis) < 0.01) vortexAxis = vec3(0.0, 1.0, 0.0);
            vec3 curl = normalize(cross(vortexAxis, toParticle)) * snoise(position * 2.0 + uTime * 2.0) * abs(uForce);
            
            // Context-based modifications for Fluid Push/Pull
            if (type == 3.0) { // Water
                // Water gets more vertical displacement (waves) and less horizontal advection
                advection.y += mouseSpeed * influence * 0.5 * sign(uForce);
                curl *= 0.5;
            } else if (type == 1.0) { // Leaves
                // Leaves get more curl/vortex
                curl *= 2.0;
            } else if (type == 2.0) { // Ground
                // Ground mostly gets pushed down or pulled up
                advection = vec3(0.0, uForce * influence * 2.0, 0.0);
                curl = vec3(0.0);
            }
            
            displacement = (advection + curl * 2.0 + noiseVec * noiseAmp) * influence * scatterMult;
            worldPosition.xyz += displacement;
        } else if (uInteractionType == 4.0) {
            // Seismic Ripple (PhD Level)
            float wave = sin(dist * 3.0 - uTime * 15.0) * exp(-dist * 0.3);
            vec3 up = vec3(0.0, 1.0, 0.0);
            displacement = up * wave * abs(uForce) * 8.0 * scatterMult;
            displacement += dir * wave * uForce * 2.0 * scatterMult;
            worldPosition.xyz += displacement;
        } else if (uInteractionType == 5.0) {
            // Aurora Field (PhD Level)
            float lift = smoothstep(uRadius * 1.5, 0.0, dist) * abs(uForce) * 8.0;
            vec3 magneticUp = vec3(0.0, 1.0, 0.0) * lift;
            vec3 swirlDir = cross(dir, vec3(0.0, 1.0, 0.0));
            if (length(swirlDir) < 0.01) swirlDir = vec3(1.0, 0.0, 0.0);
            displacement = (magneticUp + normalize(swirlDir) * lift * 0.8 + noiseVec * lift * 0.3) * scatterMult;
            worldPosition.xyz += displacement;
            vAurora = influence * smoothstep(0.0, 15.0, displacement.y);
        } else if (uInteractionType == 0.0) {
            // Wind Gust Mode
            vec3 windDir = vec3(1.0, 0.2, 0.5); // Directional wind
            displacement = (windDir * uForce + noiseVec * noiseAmp) * influence * scatterMult;
            worldPosition.xyz += displacement;
        }
        
        vDisplacement = length(displacement);
        vSwirl = swirl;
        vVelocity = displacement; // Pass velocity to fragment shader
        
        // Calculate a fake normal for lighting based on position relative to center
        vWorldNormal = normalize(worldPosition.xyz - vec3(0.0, worldPosition.y, 0.0));
        if (type == 1.0) vWorldNormal = normalize(worldPosition.xyz + vec3(0.0, 5.0, 0.0)); // Leaves point somewhat up/out
        if (type == 2.0 || type == 3.0) vWorldNormal = vec3(0.0, 1.0, 0.0); // Ground/Water point up
        
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        
        // Size attenuation (smaller base size for point cloud look)
        float baseSize = 2.0; 
        if (type == 1.0) baseSize = 6.0 + rustle * 1.0; // Leaf
        if (type == 3.0) baseSize = 4.0; // Water
        if (type == 2.0) baseSize = 3.0; // Ground
        if (type == 0.0) baseSize = 4.0; // Wood
        
        gl_PointSize = (baseSize + influence * 2.0) * (20.0 / -mvPosition.z);
      }
    `;
    
    const fragmentShader = `
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uFogDensity;
      
      varying float vDisplacement;
      varying vec3 vPosition;
      varying vec3 vColor;
      varying float vType;
      varying float vRustle;
      varying float vSwirl;
      varying float vAurora;
      varying vec3 vWorldNormal;
      varying vec3 vVelocity;
      
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        float alphaMult = 1.0;
        vec3 finalBaseColor = vColor;
        
        // Volumetric Lighting / Mie Scattering Approximation
        vec3 viewDir = normalize(vPosition - cameraPosition);
        float VoL = max(0.0, dot(viewDir, uSunDirection));
        
        // Forward scattering (stronger towards the sun)
        float scattering = pow(VoL, 8.0) * 0.5 + pow(VoL, 32.0) * 1.5;
        vec3 scatterColor = uSunColor * scattering;
        
        if (vType == 1.0) { // Leaf
            dist = length(coord * vec2(1.0, 1.5));
            if (dist > 0.4) discard; 
            alphaMult = 0.9; 
            
            // SSS
            vec3 sssColor = vec3(0.8, 0.9, 0.3); 
            float sssIntensity = smoothstep(0.0, 1.0, vRustle) * 0.3; 
            float thinness = 1.0 - smoothstep(0.0, 0.4, dist);
            sssIntensity += thinness * 0.15;
            finalBaseColor = mix(vColor, sssColor, sssIntensity);
            
            // Fake lighting with sun
            float light = dot(vWorldNormal, uSunDirection);
            finalBaseColor *= 0.6 + 0.6 * max(0.0, light);
            
            // Add volumetric glow to leaves
            finalBaseColor += scatterColor * 0.3;
            
        } else if (vType == 3.0) { // Water
            if (dist > 0.5) discard;
            alphaMult = 0.85;
            
            // Sparkle
            float sparkle = smoothstep(0.8, 1.0, sin(vPosition.x * 20.0 + uTime * 2.0) * cos(vPosition.z * 20.0 + uTime * 1.5));
            finalBaseColor += vec3(sparkle * 0.6);
            
            // Fake water normal with sun
            float light = dot(vWorldNormal, uSunDirection);
            finalBaseColor *= 0.5 + 0.7 * max(0.0, light);
            
            // Specular highlight from sun
            vec3 halfVector = normalize(uSunDirection + viewDir);
            float specular = pow(max(0.0, dot(vWorldNormal, halfVector)), 32.0);
            finalBaseColor += uSunColor * specular * 0.5;
            
        } else { // Wood & Ground
            if (dist > 0.5) discard;
            // Fake lighting with sun
            float light = dot(vWorldNormal, uSunDirection);
            finalBaseColor *= 0.5 + 0.5 * max(0.0, light);
        }
        
        // Soft radial gradient for all particles
        float alpha = smoothstep(0.5, 0.1, dist) * alphaMult;
        
        float d = clamp(vDisplacement * 0.1, 0.0, 1.0);
        vec3 dustColor = vec3(0.6, 0.55, 0.45); // Dust
        if (vType == 1.0) dustColor = vec3(0.4, 0.5, 0.2); // Flying leaves
        if (vType == 3.0) dustColor = vec3(0.8, 0.9, 1.0); // Splash
        
        vec3 finalColor = mix(finalBaseColor, dustColor, d * 0.5);
        
        // Fog calculation with height mist
        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = exp2(-uFogDensity * uFogDensity * depth * depth * 1.442695);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        
        vec3 baseFogColor = vec3(0.0, 0.0, 0.0); // Black background
        
        // Ground mist
        float heightFog = 1.0 - smoothstep(-4.0, 8.0, vPosition.y);
        vec3 mistColor = vec3(0.1, 0.1, 0.15); // Dark mist
        vec3 finalFogColor = mix(baseFogColor, mistColor, heightFog * 0.6);
        
        // Add volumetric light to fog
        finalFogColor += scatterColor * 0.8;
        
        // Aurora coloring
        if (vAurora > 0.0) {
            vec3 auroraGreen = vec3(0.2, 1.0, 0.6);
            vec3 auroraPurple = vec3(0.7, 0.3, 1.0);
            vec3 aColor = mix(auroraGreen, auroraPurple, sin(vPosition.x * 0.2 + uTime * 0.5) * 0.5 + 0.5);
            finalColor = mix(finalColor, aColor, vAurora);
            alpha = min(1.0, alpha + vAurora * 0.6);
            finalColor += aColor * vAurora * 2.0; // Strong additive glow
        }
        
        // Velocity Field Color (VFC)
        float speed = length(vVelocity);
        if (speed > 0.05) {
            float speedNorm = clamp((speed - 0.05) * 0.2, 0.0, 1.0);
            
            // Cool cyan to hot magenta/orange gradient based on speed
            vec3 vfcSlow = vec3(0.0, 0.8, 1.0); // Cyan
            vec3 vfcFast = vec3(1.0, 0.2, 0.6); // Magenta
            vec3 vfcSuperFast = vec3(1.0, 0.6, 0.0); // Orange
            
            vec3 vfcColor = mix(vfcSlow, vfcFast, smoothstep(0.0, 0.5, speedNorm));
            vfcColor = mix(vfcColor, vfcSuperFast, smoothstep(0.5, 1.0, speedNorm));
            
            // Blend VFC into final color
            finalColor = mix(finalColor, vfcColor, speedNorm * 0.85);
            
            // Additive glow for fast particles
            finalColor += vfcColor * speedNorm * 1.5;
            alpha = min(1.0, alpha + speedNorm * 0.4);
        }
        
        // Final mix with volumetric scattering on particles
        gl_FragColor = vec4(mix(finalFogColor, finalColor + scatterColor * 0.3, fogFactor), alpha);
      }
    `;
    
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(999, 999, 999) },
        uRadius: { value: 5.0 },
        uForce: { value: 0.0 }, // Initialize force
        uInteractionType: { value: 0.0 },
        uInteractionContext: { value: 0.0 },
        uWindDir: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
        uWindStrength: { value: 1.0 },
        uSunDirection: { value: new THREE.Vector3(1.0, 0.5, -1.0).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.9, 0.8) },
        uFogDensity: { value: 0.018 },
        uMouseVelocity: { value: new THREE.Vector3(0, 0, 0) }
      },
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false
    });
    
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    
    // Post-Processing (Bloom)
    const renderScene = new THREE.RenderPass(scene, camera);
    const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.15;
    bloomPass.strength = 1.2; // Intense neon glow
    bloomPass.radius = 0.8;
    
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    
    // Interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(999, 999);
    const targetMouse3D = new THREE.Vector3(999, 999, 999);
    const currentMouse3D = new THREE.Vector3(999, 999, 999);
    const lastMouse3D = new THREE.Vector3(999, 999, 999); // Track previous position
    const planeView = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const planeDesign = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ground plane for planting
    
    window.addEventListener('mousemove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      
      if (params.mode === 'explore') {
          planeView.normal.copy(camera.position).normalize();
          raycaster.ray.intersectPlane(planeView, targetMouse3D);
      } else {
          // Design mode: raycast to ground plane, but don't apply physics
          targetMouse3D.set(999, 999, 999); // Disable physics interaction
      }
    });
    
    // Zoom Functionality
    window.addEventListener('wheel', (e) => {
      camera.position.z += e.deltaY * 0.01;
      camera.position.z = Math.max(5, Math.min(camera.position.z, 50)); // Clamp zoom
    });
    
    window.addEventListener('mouseleave', () => {
      targetMouse3D.set(999, 999, 999);
    });
    
    // Audio (Tone.js)
    let isAudioInitialized = false;
    let masterVol, windFilter, windNoise, auroraSynth, waterSynth;
    
    async function initAudio() {
        if (isAudioInitialized) return;
        await Tone.start();
        
        masterVol = new Tone.Volume(-10).toDestination();
        
        // Wind Noise
        windFilter = new Tone.Filter(400, "lowpass").connect(masterVol);
        windNoise = new Tone.Noise("pink").connect(windFilter).start();
        windNoise.volume.value = -15;
        
        // Aurora Synth Pad
        auroraSynth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "sine" },
            envelope: { attack: 2, decay: 1, sustain: 1, release: 4 }
        }).connect(masterVol);
        auroraSynth.volume.value = -30;
        
        // Water/Fluid Synth
        waterSynth = new Tone.FMSynth({
            harmonicity: 2,
            modulationIndex: 3,
            oscillator: { type: "sine" },
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.1, release: 1 }
        }).connect(masterVol);
        waterSynth.volume.value = -20;
        
        isAudioInitialized = true;
    }
    
    window.addEventListener('click', (e) => {
      // Ignore clicks on UI
      if (e.target.id === 'mode-toggle' || e.target.closest('.lil-gui') || e.target.closest('.chapter-btn') || e.target.id === 'record-btn' || e.target.id === 'ble-btn' || e.target.id === 'hand-track-btn') return;

      if (params.mode === 'explore') {
          initAudio();
      } else if (params.mode === 'terraform') {
          // Click to Plant Tree
          raycaster.setFromCamera(mouse, camera);
          const intersect = new THREE.Vector3();
          raycaster.ray.intersectPlane(planeDesign, intersect);
          
          if (intersect) {
              const py = terrainHeight(intersect.x, intersect.z);
              const scale = params.treeScale + (Math.random() - 0.5) * 0.2;
              const tiltX = (Math.random() - 0.5) * 0.2;
              const tiltZ = (Math.random() - 0.5) * 0.2;
              const dir = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
              
              // Plant a single tree at click location
              if (params.plantType === 'Oak') {
                  createBranch(new THREE.Vector3(intersect.x, py, intersect.z), dir, 5.0 * scale, 1.6 * scale, 6, 6);
              } else if (params.plantType === 'Pine') {
                  createPine(new THREE.Vector3(intersect.x, py, intersect.z), scale);
              } else if (params.plantType === 'Bush') {
                  createBush(new THREE.Vector3(intersect.x, py, intersect.z), scale);
              }
              
              // Update buffers
              geometry.setDrawRange(0, pIndex);
              geometry.attributes.position.needsUpdate = true;
              geometry.attributes.color.needsUpdate = true;
              geometry.attributes.type.needsUpdate = true;
          }
      }
    });
    
    // Resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    // Museum Mode Logic
    let currentChapter = 0;
    let attractMode = false;
    let lastInteractionTime = Date.now();
    const ATTRACT_TIMEOUT = 10000; // 10 seconds idle to start attract mode
    
    const chapters = [
        {
            title: "Chapter 1: The Living Forest",
            desc: "Experience the invisible forces of nature. Wind gusts move through the trees, creating organic motion patterns driven by complex noise algorithms.",
            setup: () => {
                params.interactionMode = 'Wind Gust';
                params.interactionContext = 'All';
                params.season = 'autumn';
                params.windStrength = 2.0;
                params.fogDensity = 0.018;
                params.sunElevation = 0.3;
                generateEnvironment(true);
            }
        },
        {
            title: "Chapter 2: The Invisible Flow",
            desc: "Interact with the environment as if it were a fluid. Your movement creates vortices and currents, visualizing the velocity field with dynamic color.",
            setup: () => {
                params.interactionMode = 'Fluid Push/Pull';
                params.interactionContext = 'All';
                params.season = 'spring';
                params.windStrength = 0.5;
                params.fogDensity = 0.012;
                params.sunElevation = 0.8; // Bright day
                generateEnvironment(true);
            }
        },
        {
            title: "Chapter 3: Magnetic Skies",
            desc: "A simulation of electromagnetic phenomena. High-altitude particles are manipulated by magnetic fields, creating an Aurora Borealis effect in a night setting.",
            setup: () => {
                params.interactionMode = 'Aurora Field';
                params.interactionContext = 'All';
                params.season = 'winter';
                params.windStrength = 0.2;
                params.fogDensity = 0.025;
                params.sunElevation = -0.2; // Night
                generateEnvironment(true);
            }
        },
        {
            title: "Chapter 4: Seismic Earth",
            desc: "Geological forces at play. Interact with the terrain directly to trigger seismic ripples that propagate through the ground plane.",
            setup: () => {
                params.interactionMode = 'Seismic Ripple';
                params.interactionContext = 'Ground Only';
                params.season = 'autumn';
                params.windStrength = 0.0;
                params.fogDensity = 0.015;
                params.sunElevation = 0.1; // Sunrise
                generateEnvironment(true);
            }
        }
    ];

    window.setChapter = (index) => {
        currentChapter = index;
        
        // Update UI
        document.querySelectorAll('.chapter-btn').forEach((btn, i) => {
            if (i === index) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        
        const infoPanel = document.getElementById('info-panel');
        infoPanel.classList.remove('visible');
        
        setTimeout(() => {
            document.getElementById('info-title').innerText = chapters[index].title;
            document.getElementById('info-desc').innerText = chapters[index].desc;
            infoPanel.classList.add('visible');
        }, 600);
        
        // Apply Settings
        chapters[index].setup();
        
        // Reset interaction timer
        lastInteractionTime = Date.now();
        attractMode = false;
        document.getElementById('attract-indicator').classList.remove('visible');
    };

    // Initial Setup
    // gui.hide(); // Ensure GUI is hidden for museum mode
    
    // Attract Mode Loop
    setInterval(() => {
        if (Date.now() - lastInteractionTime > ATTRACT_TIMEOUT && !attractMode) {
            attractMode = true;
            document.getElementById('attract-indicator').classList.add('visible');
        }
    }, 1000);

    window.addEventListener('mousemove', () => {
        lastInteractionTime = Date.now();
        if (attractMode) {
            attractMode = false;
            document.getElementById('attract-indicator').classList.remove('visible');
        }
    });

    // Animation Loop
    const clock = new THREE.Clock();
    
    // Screen Recording Logic
    const recordBtn = document.getElementById('record-btn');
    const recordText = document.getElementById('record-text');
    let mediaRecorder;
    let recordedChunks = [];
    let isRecording = false;

    // Web Bluetooth Logic (Scaffold)
    const bleBtn = document.getElementById('ble-btn');
    let bluetoothDevice;
    let bleCharacteristic;

    bleBtn.addEventListener('click', async () => {
        if (!navigator.bluetooth) {
            alert('Web Bluetooth is not supported in this browser. Try Chrome or Edge.');
            return;
        }

        try {
            console.log('Requesting Bluetooth Device...');
            // Request device with specific service UUID (Nordic UART Service is common for ESP32)
            // Replace '6e400001-b5a3-f393-e0a9-e50e24dcca9e' with your specific service UUID if different
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'ESP32' }, { namePrefix: 'Arduino' }], 
                optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] 
            });

            bluetoothDevice = device;
            device.addEventListener('gattserverdisconnected', onDisconnected);

            console.log('Connecting to GATT Server...');
            const server = await device.gatt.connect();

            console.log('Getting Service...');
            const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');

            console.log('Getting Characteristic...');
            // Nordic UART TX Characteristic (Notification)
            bleCharacteristic = await service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');

            await bleCharacteristic.startNotifications();
            bleCharacteristic.addEventListener('characteristicvaluechanged', handleBleData);
            
            bleBtn.classList.add('connected');
            bleBtn.innerHTML = '<span>📡 Connected</span>';
            console.log('BLE Connected!');

        } catch (error) {
            console.error('BLE Connection Failed:', error);
            alert('Connection failed: ' + error);
        }
    });

    function onDisconnected(event) {
        const device = event.target;
        console.log(`Device ${device.name} is disconnected.`);
        bleBtn.classList.remove('connected');
        bleBtn.innerHTML = '<span>📡 Connect Device</span>';
    }

    function handleBleData(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const str = decoder.decode(value).trim();
        
        // Expected format: "x,y,force" (e.g., "0.5,0.2,1.0")
        // Or specific commands: "WIND:2.5", "SEASON:winter"
        
        console.log('BLE Data:', str);

        // Example Parsing Logic
        if (str.startsWith('WIND:')) {
            const val = parseFloat(str.split(':')[1]);
            if (!isNaN(val)) params.windStrength = val;
        } else if (str.includes(',')) {
            const parts = str.split(',');
            if (parts.length >= 2) {
                // Map hardware input (0-1) to screen coordinates (-1 to 1)
                const x = parseFloat(parts[0]);
                const y = parseFloat(parts[1]);
                
                if (!isNaN(x) && !isNaN(y)) {
                    // Update mouse position for interaction
                    mouse.x = (x * 2) - 1;
                    mouse.y = (y * 2) - 1;
                    
                    // Trigger interaction raycast
                    raycaster.setFromCamera(mouse, camera);
                    if (params.mode === 'explore') {
                        planeView.normal.copy(camera.position).normalize();
                        raycaster.ray.intersectPlane(planeView, targetMouse3D);
                    }
                }
                
                // Optional 3rd parameter for force/strength
                if (parts.length >= 3) {
                    const force = parseFloat(parts[2]);
                    if (!isNaN(force)) params.interactionForce = force;
                }
            }
        }
    }

    recordBtn.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    function startRecording() {
        const stream = renderer.domElement.captureStream(60); // 60 FPS
        const options = { mimeType: 'video/webm; codecs=vp9' };
        
        try {
            mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            console.error('MediaRecorder error:', e);
            // Fallback for browsers that might not support vp9
            try {
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            } catch (e2) {
                alert('Screen recording is not supported in this browser.');
                return;
            }
        }

        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleStop;
        mediaRecorder.start();

        isRecording = true;
        recordBtn.classList.add('recording');
        recordText.innerText = 'STOP';
        console.log('Recording started');
    }

    function stopRecording() {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordText.innerText = 'REC';
        console.log('Recording stopped');
    }

    function handleDataAvailable(event) {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    }

    function handleStop() {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        recordedChunks = [];
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style.display = 'none';
        a.href = url;
        a.download = 'nordic-simulation-recording.webm';
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
    
    // MediaPipe Hand Tracking
    const videoElement = document.getElementById('input_video');
    const handTrackBtn = document.getElementById('hand-track-btn');
    let handsActive = false;
    let camera_mp;

    if (typeof Hands !== 'undefined') {
        const hands = new Hands({locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }});
        
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        hands.onResults((results) => {
            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const indexFinger = results.multiHandLandmarks[0][8]; // Index finger tip
                
                // Map to mouse coordinates (mirror X for natural feel)
                mouse.x = -(indexFinger.x * 2 - 1);
                mouse.y = -(indexFinger.y * 2 - 1);
                
                // Trigger interaction raycast
                raycaster.setFromCamera(mouse, camera);
                if (params.mode === 'explore') {
                    planeView.normal.copy(camera.position).normalize();
                    raycaster.ray.intersectPlane(planeView, targetMouse3D);
                }
            } else {
                // Move target away if no hand detected
                targetMouse3D.set(999, 999, 999);
            }
        });

        camera_mp = new Camera(videoElement, {
          onFrame: async () => {
            await hands.send({image: videoElement});
          },
          width: 640,
          height: 480
        });

        handTrackBtn.addEventListener('click', async () => {
            if (!handsActive) {
                try {
                    handTrackBtn.innerHTML = '<span>⏳ Starting...</span>';
                    await camera_mp.start();
                    handTrackBtn.classList.add('connected');
                    handTrackBtn.innerHTML = '<span>✋ Tracking Active</span>';
                    handsActive = true;
                    initAudio(); // Start audio on interaction
                } catch (err) {
                    console.error("Camera start failed:", err);
                    alert("Could not start camera. Please ensure you have granted camera permissions.");
                    handTrackBtn.innerHTML = '<span>✋ Enable Hand Tracking</span>';
                }
            } else {
                camera_mp.stop();
                handTrackBtn.classList.remove('connected');
                handTrackBtn.innerHTML = '<span>✋ Enable Hand Tracking</span>';
                handsActive = false;
                targetMouse3D.set(999, 999, 999);
            }
        });
    } else {
        console.warn("MediaPipe not loaded.");
        if(handTrackBtn) handTrackBtn.style.display = 'none';
    }

    renderer.setAnimationLoop(function () {
      const deltaTime = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();
      material.uniforms.uTime.value = elapsedTime;
      
      // Attract Mode Camera Rotation
      if (attractMode) {
          camTheta += 0.1 * deltaTime;
          // Slowly cycle colors or wind in attract mode?
          material.uniforms.uTime.value = elapsedTime * 1.5; // Speed up time slightly
      }
      
      // Update Atmosphere Uniforms
      const windX = Math.cos(params.windDirection);
      const windZ = Math.sin(params.windDirection);
      material.uniforms.uWindDir.value.set(windX, 0.0, windZ).normalize();
      material.uniforms.uWindStrength.value = params.windStrength;
      
      const sunY = Math.sin(params.sunElevation);
      const sunXZ = Math.cos(params.sunElevation);
      const sunX = Math.cos(params.sunAzimuth) * sunXZ;
      const sunZ = Math.sin(params.sunAzimuth) * sunXZ;
      material.uniforms.uSunDirection.value.set(sunX, sunY, sunZ).normalize();
      
      // Adjust sun color based on elevation (golden hour effect)
      const sunColor = new THREE.Color();
      if (params.sunElevation < 0.2) {
          sunColor.setHex(0xff7e40); // Sunset orange
      } else if (params.sunElevation < 0.5) {
          sunColor.setHex(0xffb370); // Golden hour
      } else {
          sunColor.setHex(0xfff5e6); // Midday
      }
      material.uniforms.uSunColor.value.copy(sunColor);
      material.uniforms.uFogDensity.value = params.fogDensity;
      
      // Update Controls
      if (controls.enabled) controls.update();
      
      // Mouse Movement Logic
      currentMouse3D.lerp(targetMouse3D, 0.1);
      material.uniforms.uMouse.value.copy(currentMouse3D);
      material.uniforms.uRadius.value = params.interactionRadius;
      
      if (params.interactionMode === 'Wind Gust') material.uniforms.uInteractionType.value = 0.0;
      else if (params.interactionMode === 'Tornado') material.uniforms.uInteractionType.value = 1.0;
      else if (params.interactionMode === 'Parting') material.uniforms.uInteractionType.value = 2.0;
      else if (params.interactionMode === 'Fluid Push/Pull') material.uniforms.uInteractionType.value = 3.0;
      else if (params.interactionMode === 'Seismic Ripple') material.uniforms.uInteractionType.value = 4.0;
      else if (params.interactionMode === 'Aurora Field') material.uniforms.uInteractionType.value = 5.0;
      
      if (params.interactionContext === 'All') material.uniforms.uInteractionContext.value = 0.0;
      else if (params.interactionContext === 'Trees Only') material.uniforms.uInteractionContext.value = 1.0;
      else if (params.interactionContext === 'Water Only') material.uniforms.uInteractionContext.value = 2.0;
      else if (params.interactionContext === 'Ground Only') material.uniforms.uInteractionContext.value = 3.0;
      
      // Calculate Mouse Speed and Velocity
      const dist = currentMouse3D.distanceTo(lastMouse3D);
      const safeDelta = Math.max(deltaTime, 0.001);
      const speed = dist / safeDelta;
      
      const mouseVelocity = new THREE.Vector3().subVectors(currentMouse3D, lastMouse3D).divideScalar(safeDelta);
      // Clamp velocity to prevent extreme explosions
      if (mouseVelocity.length() > 50.0) mouseVelocity.normalize().multiplyScalar(50.0);
      material.uniforms.uMouseVelocity.value.lerp(mouseVelocity, 0.1); // Smooth velocity
      
      lastMouse3D.copy(currentMouse3D);
      
      let targetForce = 0.0;
      
      // Check if mouse is effectively off-screen or not interacting
      if (targetMouse3D.x > 900) {
          targetForce = 0.0;
      } else {
          if (speed > 8.0) {
              targetForce = 4.0 * params.interactionForce; 
          } else if (speed < 2.0) {
              targetForce = -1.2 * params.interactionForce; 
          } else {
              targetForce = 0.5 * params.interactionForce; 
          }
      }
      
      // Smoothly interpolate force
      material.uniforms.uForce.value = THREE.MathUtils.lerp(material.uniforms.uForce.value, targetForce, 0.05);
      
      // Audio Modulation
      if (isAudioInitialized) {
          // Wind noise based on wind strength and mouse speed
          const targetFreq = 200 + (params.windStrength * 500) + (speed * 100);
          windFilter.frequency.rampTo(Math.min(targetFreq, 5000), 0.1);
          
          if (params.interactionMode === 'Aurora Field') {
              // Play ethereal chords based on mouse position
              if (speed > 2.0 && Math.random() > 0.95) {
                  const notes = ["C4", "E4", "G4", "B4", "D5"];
                  const note = notes[Math.floor(Math.random() * notes.length)];
                  auroraSynth.triggerAttackRelease(note, "2n");
              }
          } else if (params.interactionMode === 'Fluid Push/Pull' || params.interactionMode === 'Seismic Ripple') {
              if (speed > 5.0 && Math.random() > 0.9) {
                  waterSynth.triggerAttackRelease("C2", "8n");
              }
          }
      }
      
      // Camera Controls in Explore Mode
      if (params.mode === 'explore') {
          const camSpeed = 1.5 * deltaTime;
          const zoomSpeed = 20.0 * deltaTime;
          
          if (keys.w) camPhi -= camSpeed;
          if (keys.s) camPhi += camSpeed;
          if (keys.a) camTheta -= camSpeed;
          if (keys.d) camTheta += camSpeed;
          if (keys.q) camRadius += zoomSpeed;
          if (keys.e) camRadius -= zoomSpeed;
          
          // Auto-rotate slowly if no keys pressed
          if (!keys.a && !keys.d) {
              camTheta += 0.05 * deltaTime;
          }
          
          camPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, camPhi));
          camRadius = Math.max(5, Math.min(100, camRadius));
          
          camera.position.x = camRadius * Math.sin(camPhi) * Math.cos(camTheta);
          camera.position.y = camRadius * Math.cos(camPhi);
          camera.position.z = camRadius * Math.sin(camPhi) * Math.sin(camTheta);
          camera.lookAt(0, 0, 0);
      }
      
      composer.render();
    });