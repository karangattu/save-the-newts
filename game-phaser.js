/* ===================================
   SAVE THE NEWTS - PHASER.JS GAME
   Arcade-Style Neon Graphics Edition
   =================================== */

// ===== GAME CONFIGURATION =====
// Note: Many of these are now base values that will be scaled or adjusted
const GAME_CONFIG = {
    // Base dimensions for reference
    BASE_WIDTH: 1000,
    BASE_HEIGHT: 700,

    // Road (Base values)
    BASE_ROAD_HEIGHT: 500,
    LANE_COUNT: 4,

    // Player
    PLAYER_SPEED: 300,
    PLAYER_SIZE: 40,
    MAX_CARRY: 2,
    PLAYER_LIVES: 3,
    PLAYER_INVINCIBLE_TIME: 2000,

    // Cars reference speeds (scaled by width)
    CAR_MIN_SPEED: 150,
    CAR_MAX_SPEED: 285,
    CAR_SPAWN_RATE: 1600, // Slightly faster spawn to account for shorter travel time on mobile
    CAR_WIDTH: 80,
    CAR_HEIGHT: 40,

    // Newts
    NEWT_SPEED: 38,
    NEWT_SPAWN_RATE: 2500,
    NEWT_SIZE: 25,

    // Scoring
    POINTS_PER_SAVE: 10,
    COMBO_MULTIPLIER: 1.5,

    // Difficulty
    DIFFICULTY_START_THRESHOLD: 5,
    DIFFICULTY_INCREMENT: 0.08,
    MAX_DIFFICULTY: 2.5,

    // Neon Arcade Colors
    COLORS: {
        // Neon palette
        neonPink: '#ff00ff',
        neonCyan: '#00ffff',
        neonPurple: '#bf00ff',
        neonBlue: '#0080ff',
        neonGreen: '#00ff80',
        neonYellow: '#ffff00',
        neonOrange: '#ff8000',

        // Environment
        forest: '#0a2a1a',
        lake: '#0a1a2a',
        road: '#0a0a0a',
        roadLine: '#ffaa00',
        roadEdge: '#333',
    },

    // Zone height min
    MIN_ZONE_HEIGHT: 60,
};

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SplashScene' });
    }

    preload() {
        this.load.image('poster', 'assets/poster.jpg');
        this.load.image('newt', 'assets/newt.png');
    }

    create() {
        const { width, height } = this.scale;

        // Add poster as full-screen background
        const poster = this.add.image(width / 2, height / 2, 'poster');
        // Cover aspect ratio
        const scaleX = width / poster.width;
        const scaleY = height / poster.height;
        const scale = Math.max(scaleX, scaleY);
        poster.setScale(scale).setScrollFactor(0);
        poster.setAlpha(0);

        // Fade in the poster
        this.tweens.add({
            targets: poster,
            alpha: 1,
            duration: 1500,
            ease: 'Power2'
        });

        // Handle resize
        this.scale.on('resize', (gameSize) => {
            const { width, height } = gameSize;
            this.cameras.main.setViewport(0, 0, width, height);
            poster.setPosition(width / 2, height / 2);
            const sX = width / poster.width;
            const sY = height / poster.height;
            poster.setScale(Math.max(sX, sY));
            if (this.scanlines) {
                this.scanlines.destroy();
                this.createScanlines();
            }
        });

        // Handle input to transition
        this.input.once('pointerdown', () => this.startTransition());
        this.input.keyboard.once('keydown', () => this.startTransition());
    }

    startTransition() {
        this.cameras.main.flash(200, 0, 255, 255);
        this.cameras.main.fadeOut(500, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene');
        });
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        // Game state
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.difficulty = 1;
        this.gameOver = false;
        this.paused = false;

        // Initialize layout variables
        this.calculateLayout();

        // Create game world
        this.backgroundGroup = this.add.group();
        this.roadGroup = this.add.group();
        this.createBackground();
        this.createRoad();

        // Dynamic labels
        this.createSafeZones();

        // Create game groups
        this.cars = this.add.group();
        this.newts = this.add.group();
        this.particles = this.add.group();

        // Create player
        this.createPlayer();

        // Create weather system
        this.createWeatherSystem();

        // Create HUD
        this.createHUD();

        // Handle resizing dynamically
        this.scale.on('resize', (gameSize) => {
            const { width, height } = gameSize;
            this.cameras.main.setViewport(0, 0, width, height);
            this.calculateLayout();
            this.resizeGame();
        });

        // Touch Anywhere Control
        this.createMobileControls();

        // Setup input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        this.pauseKey = this.input.keyboard.addKey('P');

        // Setup timers
        this.carSpawnTimer = this.time.addEvent({
            delay: GAME_CONFIG.CAR_SPAWN_RATE,
            callback: this.spawnCar,
            callbackScope: this,
            loop: true
        });

        this.newtSpawnTimer = this.time.addEvent({
            delay: GAME_CONFIG.NEWT_SPAWN_RATE,
            callback: this.spawnNewt,
            callbackScope: this,
            loop: true
        });

        // Initial spawns
        this.spawnNewt();

        // Camera fade in
        this.cameras.main.fadeIn(500, 0, 0, 0);

        // Pause handling
        this.pauseKey.on('down', () => this.togglePause());
    }

    calculateLayout() {
        const { width, height } = this.scale;

        // Speed scaling based on width (reference 1000px)
        // Clamp to avoid game becoming too slow on very narrow phones
        this.speedScale = Phaser.Math.Clamp(width / 1000, 0.6, 1.2);

        // Road Layout
        // Try to keep road height close to base, but fit within screen with padding
        const maxRoadHeight = height - (GAME_CONFIG.MIN_ZONE_HEIGHT * 2);
        this.roadHeight = Math.min(GAME_CONFIG.BASE_ROAD_HEIGHT, maxRoadHeight);

        // Center the road
        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / GAME_CONFIG.LANE_COUNT;

        // Safe Zones
        this.forestYLimit = this.roadY;
        this.lakeYStart = this.roadY + this.roadHeight;

        // Update existing elements if they exist
        if (this.scanlines) {
            this.scanlines.destroy();
            this.createScanlines();
        }
    }

    resizeGame() {
        // Re-draw background and road
        this.backgroundGroup.clear(true, true);
        this.roadGroup.clear(true, true);
        this.createBackground(); // Adds to display list, need to manage order or groups
        this.createRoad();

        // Re-position labels
        if (this.forestLabel) {
            this.forestLabel.setPosition(this.scale.width / 2, this.roadY - 20);
        }
        if (this.lakeLabel) {
            this.lakeLabel.setPosition(this.scale.width / 2, this.lakeYStart + 20);
        }

        // Layout UI
        this.layoutUI();

        // Keep player in bounds loosely
        this.player.x = Phaser.Math.Clamp(this.player.x, 0, this.scale.width);
        this.player.y = Phaser.Math.Clamp(this.player.y, 0, this.scale.height);
    }

    createBackground() {
        const { width, height } = this.scale;
        const bg = this.add.graphics();
        this.backgroundGroup.add(bg);

        // Forest zone (top)
        bg.fillGradientStyle(0x0a2a1a, 0x0a2a1a, 0x152a20, 0x152a20);
        bg.fillRect(0, 0, width, this.roadY);

        // Forest silhouette ridge (subtle depth)
        bg.fillStyle(0x06150f, 0.9);
        const ridgeY = this.roadY - 18;
        for (let x = 0; x < width + 60; x += 60) {
            const peak = Phaser.Math.Between(10, 28);
            bg.fillTriangle(x, ridgeY + 18, x + 30, ridgeY - peak, x + 60, ridgeY + 18);
        }

        // Lake zone (bottom)
        bg.fillGradientStyle(0x152535, 0x152535, 0x0a1a2a, 0x0a1a2a);
        bg.fillRect(0, this.lakeYStart, width, height - this.lakeYStart);

        // Lake ripples
        bg.lineStyle(1, 0x66ccff, 0.12);
        for (let y = this.lakeYStart + 16; y < height; y += 18) {
            const wobble = Phaser.Math.Between(-8, 8);
            bg.beginPath();
            bg.moveTo(0, y);
            bg.lineTo(width, y + wobble);
            bg.strokePath();
        }

        // Adjust depth to be behind everything
        bg.setDepth(-10);
    }

    createRoad() {
        const { width } = this.scale;
        const graphics = this.add.graphics();
        this.roadGroup.add(graphics);

        // Road base
        graphics.fillStyle(0x0a0a0a);
        graphics.fillRect(0, this.roadY, width, this.roadHeight);

        // Road edge glow
        graphics.lineStyle(3, 0xff00ff, 0.5);
        graphics.lineBetween(0, this.roadY, width, this.roadY);
        graphics.lineBetween(0, this.lakeYStart, width, this.lakeYStart);

        // Lane dividers
        for (let i = 1; i < GAME_CONFIG.LANE_COUNT; i++) {
            const y = this.roadY + (i * this.laneHeight);
            // Dashed line
            for (let x = 0; x < width; x += 60) {
                graphics.fillStyle(0xffaa00, 0.8);
                graphics.fillRect(x, y - 2, 30, 4);
            }
        }

        graphics.setDepth(-5);
    }

    createSafeZones() {
        const { width } = this.scale;

        // Forest Label
        this.forestLabel = this.add.text(width / 2, this.roadY - 20, 'FOREST (SAFE)', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#88ff88',
            shadow: { offsetX: 0, offsetY: 0, color: '#00ff00', blur: 10, fill: true }
        }).setOrigin(0.5).setDepth(-4);

        // Lake Label
        this.lakeLabel = this.add.text(width / 2, this.lakeYStart + 20, 'LAKE (SAFE)', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#88ccff',
            shadow: { offsetX: 0, offsetY: 0, color: '#0088ff', blur: 10, fill: true }
        }).setOrigin(0.5).setDepth(-4);
    }

    createPlayer() {
        const { width, height } = this.scale;
        this.player = this.add.container(width / 2, height - (GAME_CONFIG.MIN_ZONE_HEIGHT + 20));

        const body = this.add.graphics();

        // Simply reusing the drawing logic here
        body.fillStyle(0x000000, 0.4); body.fillEllipse(0, 25, 30, 10); // Shadow
        body.fillStyle(0x34495e); body.fillRect(-10, 10, 8, 20); body.fillRect(2, 10, 8, 20); // Legs
        body.fillStyle(0xf1c40f); body.fillRoundedRect(-15, -15, 30, 30, 5); // Vest
        body.fillStyle(0xffffff, 0.8); body.fillRect(-12, -5, 24, 3); body.fillRect(-12, 5, 24, 3); // Stripes
        body.fillStyle(0xfce4d6); body.fillCircle(0, -22, 10); // Head
        body.fillStyle(0xe74c3c); body.fillEllipse(0, -28, 14, 6); // Hard hat

        this.player.add(body);
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.size = GAME_CONFIG.PLAYER_SIZE;
        this.player.carrying = [];
        this.player.lives = GAME_CONFIG.PLAYER_LIVES;
        this.player.isInvincible = false;
        this.player.invincibleTimer = 0;
        this.player.direction = 1;

        // Add scanlines slightly above player but below UI
        this.createScanlines();
    }

    createScanlines() {
        if (this.scanlines) this.scanlines.destroy();
        this.scanlines = this.add.graphics();
        this.scanlines.setAlpha(0.03);
        this.scanlines.setDepth(100); // Overlay effect

        const { width, height } = this.scale;
        for (let y = 0; y < height; y += 3) {
            this.scanlines.lineStyle(1, 0x000000, 0.5);
            this.scanlines.lineBetween(0, y, width, y);
        }
    }

    createWeatherSystem() {
        // Rain particles
        this.weatherState = 'CLEAR';
        this.weatherTimer = 0;
        this.rainIntensity = 0;
        this.rainGraphics = this.add.graphics();
        this.rainGraphics.setDepth(50);
        this.rainDrops = [];
        for (let i = 0; i < 200; i++) {
            this.rainDrops.push({
                x: Phaser.Math.Between(0, 2000), // Larger range for resize
                y: Phaser.Math.Between(-50, 2000),
                len: Phaser.Math.Between(10, 20),
                speed: Phaser.Math.Between(8, 15),
                wind: Phaser.Math.FloatBetween(-1, 2)
            });
        }
    }

    createHUD() {
        const padding = 12;
        this.livesText = this.add.text(padding, padding, '', { fontFamily: 'Outfit, Arial', fontSize: '26px' });
        this.scoreText = this.add.text(this.scale.width - padding, padding, '', {
            fontFamily: 'Fredoka, Arial', fontSize: '22px', color: '#ffffff',
            stroke: GAME_CONFIG.COLORS.neonCyan, strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: GAME_CONFIG.COLORS.neonCyan, blur: 10, fill: true }
        }).setOrigin(1, 0);
        this.carryingText = this.add.text(this.scale.width / 2, padding, '', {
            fontFamily: 'Outfit, Arial', fontSize: '18px', color: '#ffffff',
            stroke: GAME_CONFIG.COLORS.neonPink, strokeThickness: 1
        }).setOrigin(0.5, 0);
        this.statsText = this.add.text(padding, this.scale.height - padding, '', {
            fontFamily: 'Outfit, Arial', fontSize: '16px', color: '#cccccc'
        });

        // Group them for depth
        this.livesText.setDepth(200);
        this.scoreText.setDepth(200);
        this.carryingText.setDepth(200);
        this.statsText.setDepth(200);

        this.layoutUI();
    }

    layoutUI() {
        const { width, height } = this.scale;
        const padding = 15;

        // Position HUD
        if (this.scoreText) this.scoreText.setPosition(width - padding, padding);
        if (this.carryingText) this.carryingText.setPosition(width / 2, padding + 30);
        if (this.statsText) this.statsText.setPosition(padding, height - padding - 20);
    }

    createMobileControls() {
        // "Touch Anywhere" Joystick
        // We do NOT draw a fixed base. Instead, we show one when the user touches.

        this.joystick = {
            active: false,
            pointerId: null,
            baseX: 0,
            baseY: 0,
            x: 0,
            y: 0
        };

        // Joystick Visuals (hidden by default)
        this.joyBase = this.add.circle(0, 0, 50, 0x000000, 0.4).setDepth(1000).setVisible(false);
        this.joyBase.setStrokeStyle(2, 0x00ffff, 0.8);
        this.joyThumb = this.add.circle(0, 0, 25, 0x00ffff, 0.6).setDepth(1001).setVisible(false);

        this.input.on('pointerdown', (pointer) => {
            // Ignore if clicking UI elements (simplified check)
            if (pointer.y < 80) return;

            this.joystick.active = true;
            this.joystick.pointerId = pointer.id;
            this.joystick.baseX = pointer.x;
            this.joystick.baseY = pointer.y;
            this.joystick.x = 0;
            this.joystick.y = 0;

            this.joyBase.setPosition(pointer.x, pointer.y).setVisible(true);
            this.joyThumb.setPosition(pointer.x, pointer.y).setVisible(true);
        });

        this.input.on('pointermove', (pointer) => {
            if (this.joystick.active && pointer.id === this.joystick.pointerId) {
                const dx = pointer.x - this.joystick.baseX;
                const dy = pointer.y - this.joystick.baseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = 40;

                // Clamp visual thumb
                const scale = dist > maxDist ? maxDist / dist : 1;
                const visualX = dx * scale;
                const visualY = dy * scale;

                this.joyThumb.setPosition(this.joystick.baseX + visualX, this.joystick.baseY + visualY);

                // Update vector
                this.joystick.x = visualX;
                this.joystick.y = visualY;
            }
        });

        this.input.on('pointerup', (pointer) => {
            if (pointer.id === this.joystick.pointerId) {
                this.joystick.active = false;
                this.joystick.x = 0;
                this.joystick.y = 0;
                this.joyBase.setVisible(false);
                this.joyThumb.setVisible(false);
            }
        });
    }

    update(time, delta) {
        if (this.gameOver || this.paused) return;

        this.updatePlayer(time, delta);
        this.updateCars(delta);
        this.updateNewts(delta);
        this.updateWeather(delta);
        this.checkCollisions();
        this.updateHUD();
    }

    updatePlayer(time, delta) {
        const player = this.player;
        let dx = 0, dy = 0;

        // Keyboard
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
        if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
        if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;

        // Joystick
        if (this.joystick.active) {
            dx = this.joystick.x / 40;
            dy = this.joystick.y / 40;
        }

        if (dx !== 0 || dy !== 0) {
            // Speed scaling here? Maybe not strictly necessary for player feel, 
            // but keeps it consistent if screen is huge/tiny. 
            // Let's keep player speed 'absolute' for better control feel, 
            // but the world is smaller on phone.

            const len = Math.sqrt(dx * dx + dy * dy);
            // Deadzone
            if (len > 0.1) {
                const moveX = (dx / len) * player.speed * (delta / 1000);
                const moveY = (dy / len) * player.speed * (delta / 1000);

                player.x += moveX;
                player.y += moveY;

                if (dx !== 0) player.direction = dx > 0 ? 1 : -1;
                player.scaleX = player.direction;
            }
        }

        // Clamp to screen
        player.x = Phaser.Math.Clamp(player.x, player.size, this.scale.width - player.size);
        player.y = Phaser.Math.Clamp(player.y, player.size, this.scale.height - player.size);

        // Update carried
        player.carrying.forEach((newt, i) => {
            newt.x = player.x + (i === 0 ? -15 : 15);
            newt.y = player.y - 5;
        });

        // Invincibility
        if (player.isInvincible) {
            player.invincibleTimer -= delta;
            player.alpha = Math.floor(time / 100) % 2 === 0 ? 0.4 : 1;
            if (player.invincibleTimer <= 0) {
                player.isInvincible = false;
                player.alpha = 1;
            }
        }
    }

    spawnCar() {
        const direction = Math.random() < 0.5 ? 1 : -1;
        const lane = Phaser.Math.Between(0, GAME_CONFIG.LANE_COUNT - 1);

        // Dynamic Y based on current road layout
        const y = this.roadY + (lane * this.laneHeight) + this.laneHeight / 2;

        const isMotorcycle = Math.random() < 0.3;
        const carWidth = isMotorcycle ? 40 : GAME_CONFIG.CAR_WIDTH;
        const carHeight = isMotorcycle ? 25 : GAME_CONFIG.CAR_HEIGHT;

        // Spawn nicely off-screen
        const x = direction === 1 ? -carWidth - 50 : this.scale.width + carWidth + 50;

        // Dynamic speed based on screen width
        const baseSpeed = Phaser.Math.Between(GAME_CONFIG.CAR_MIN_SPEED, GAME_CONFIG.CAR_MAX_SPEED);
        const speed = baseSpeed * this.difficulty * (isMotorcycle ? 1.3 : 1) * this.speedScale;

        const car = this.add.container(x, y);

        // ... (Graphics drawing logic remains similar, simplified for brevity but kept visually consistent)
        const graphics = this.add.graphics();
        const colors = [
            [0xe74c3c, 0xc0392b], [0x3498db, 0x2980b9], [0x2ecc71, 0x27ae60],
            [0x9b59b6, 0x8e44ad], [0xf39c12, 0xd68910], [0x1abc9c, 0x16a085]
        ];
        const colorPair = colors[Phaser.Math.Between(0, colors.length - 1)];

        if (isMotorcycle) {
            graphics.fillStyle(colorPair[0]); graphics.fillEllipse(0, 2, carWidth / 1.5, carHeight / 2);
            graphics.fillStyle(0x2d2d2d); graphics.fillCircle(-5, -8, 8); // Rider
            graphics.fillStyle(colorPair[1]); graphics.fillCircle(-5, -16, 6);
            graphics.fillStyle(0xffff99); graphics.fillCircle(carWidth / 2 - 3, 0, 3); // Light
        } else {
            graphics.fillStyle(colorPair[0]); graphics.fillRoundedRect(-carWidth / 2, -carHeight / 2 + 8, carWidth, carHeight - 8, 6);
            graphics.fillStyle(colorPair[1]); graphics.fillRoundedRect(-carWidth / 2 + 15, -carHeight / 2, carWidth - 35, carHeight - 10, 6);
            graphics.fillStyle(0x1a2530); graphics.fillRect(-carWidth / 2 + 20, -carHeight / 2 + 4, 18, 16); // Windows
            graphics.fillStyle(0xffff99); graphics.fillCircle(carWidth / 2 - 5, 0, 5); // Headlight
            graphics.fillStyle(0xff5252); graphics.fillCircle(-carWidth / 2 + 5, 0, 4); // Tail light
        }

        // Beam
        const beamCheck = isMotorcycle ? 80 : 150;
        const beam = this.add.graphics();
        beam.fillStyle(0xffff99, 0.1);
        beam.beginPath();
        beam.moveTo(carWidth / 2 - 3, -3);
        beam.lineTo(carWidth / 2 + beamCheck, -30);
        beam.lineTo(carWidth / 2 + beamCheck, 30);
        beam.lineTo(carWidth / 2 - 3, 3);
        beam.fillPath();

        car.add(beam);
        car.add(graphics);

        if (direction === -1) car.scaleX = -1;

        car.speed = speed;
        car.direction = direction;
        car.carWidth = carWidth;
        car.carHeight = carHeight;

        this.cars.add(car);
    }

    updateCars(delta) {
        this.cars.getChildren().forEach(car => {
            car.x += car.speed * car.direction * (delta / 1000);

            const buffer = 200;
            if ((car.direction === 1 && car.x > this.scale.width + buffer) ||
                (car.direction === -1 && car.x < -buffer)) {
                car.destroy();
            }
        });
    }

    spawnNewt() {
        const startSide = Math.random() < 0.5 ? 'forest' : 'lake';
        const moveDirection = startSide === 'forest' ? 1 : -1;

        const x = Phaser.Math.Between(50, this.scale.width - 50);

        // Dynamic Y spawn based on Safe Zones
        let y;
        if (startSide === 'forest') {
            y = Phaser.Math.Between(20, Math.max(20, this.forestYLimit - 20));
        } else {
            y = Phaser.Math.Between(this.lakeYStart + 20, this.scale.height - 20);
        }

        const newt = this.add.container(x, y);
        const sprite = this.add.image(0, 0, 'newt');

        // Scale newt slightly
        const targetH = GAME_CONFIG.NEWT_SIZE * 1.8;
        sprite.setDisplaySize(targetH, targetH); // Simplified aspect rough

        newt.add(sprite);
        newt.sprite = sprite; // Ref for anim
        newt.rotation = moveDirection === 1 ? Math.PI / 2 : -Math.PI / 2;

        newt.startSide = startSide;
        newt.destination = startSide === 'forest' ? 'lake' : 'forest';
        newt.moveDirection = moveDirection;
        newt.isCarried = false;
        newt.isSquished = false;
        newt.squishedTime = 0;

        this.newts.add(newt);
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (newt.isSquished) {
                newt.squishedTime += delta;
                newt.alpha = 1 - (newt.squishedTime / 2000);
                if (newt.squishedTime > 2000) newt.destroy();
                return;
            }

            if (!newt.isCarried) {
                newt.y += newt.moveDirection * GAME_CONFIG.NEWT_SPEED * (delta / 1000);

                // Wiggle anim
                const t = this.time.now;
                newt.sprite.y = Math.sin(t * 0.01) * 2;
                newt.sprite.rotation = (Math.sin(t * 0.008) * 0.1) + (newt.moveDirection === 1 ? Math.PI / 2 : -Math.PI / 2);

                // Destination check
                if ((newt.moveDirection === 1 && newt.y >= this.lakeYStart) ||
                    (newt.moveDirection === -1 && newt.y <= this.forestYLimit)) {
                    this.newtReachedDestination(newt, false);
                }
            }
        });
    }

    checkCollisions() {
        const player = this.player;
        // Simple circle/box bounds
        const pBounds = { x: player.x, y: player.y, r: player.size / 2 };

        // Cars
        this.cars.getChildren().forEach(car => {
            // Box collision approximation
            if (Math.abs(player.y - car.y) < 30 && Math.abs(player.x - car.x) < 50) {
                this.playerHit();
            }

            // Car vs Newt (Squish)
            this.newts.getChildren().forEach(newt => {
                if (!newt.isSquished && !newt.isCarried) {
                    if (Math.abs(newt.y - car.y) < 30 && Math.abs(newt.x - car.x) < 40) {
                        this.squishNewt(newt);
                    }
                }
            });
        });

        // Pickup Newt
        this.newts.getChildren().forEach(newt => {
            if (!newt.isSquished && !newt.isCarried && player.carrying.length < GAME_CONFIG.MAX_CARRY) {
                const dist = Phaser.Math.Distance.Between(player.x, player.y, newt.x, newt.y);
                if (dist < 40) this.pickupNewt(newt);
            }
        });

        // Dropoff Zones
        if (player.carrying.length > 0) {
            const inForest = player.y < this.forestYLimit;
            const inLake = player.y > this.lakeYStart;

            if (inForest || inLake) {
                const delivered = [...player.carrying];
                player.carrying = [];
                delivered.forEach(newt => {
                    const correct = (newt.destination === 'forest' && inForest) || (newt.destination === 'lake' && inLake);
                    this.newtReachedDestination(newt, true, correct);
                });
            }
        }
    }

    pickupNewt(newt) {
        newt.isCarried = true;
        this.player.carrying.push(newt);
        this.createParticles(newt.x, newt.y, 0x00ffff);
    }

    squishNewt(newt) {
        newt.isSquished = true;
        this.lost++;
        this.createParticles(newt.x, newt.y, 0xff6b35, 15);
    }

    newtReachedDestination(newt, byPlayer, correctZone = true) {
        if (byPlayer && correctZone) {
            this.saved++;
            this.score += GAME_CONFIG.POINTS_PER_SAVE * this.difficulty;
            this.createParticles(newt.x, newt.y, 0x00ff88);

            // Difficulty
            if (this.saved > GAME_CONFIG.DIFFICULTY_START_THRESHOLD) {
                this.difficulty = Math.min(2.5, 1 + (this.saved * 0.05));
                this.carSpawnTimer.delay = GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty;
            }
        }
        newt.destroy();
    }

    createParticles(x, y, color, count = 10) {
        for (let i = 0; i < count; i++) {
            const p = this.add.circle(x, y, 4, color);
            this.tweens.add({
                targets: p,
                x: x + Phaser.Math.Between(-30, 30),
                y: y + Phaser.Math.Between(-30, 30),
                alpha: 0,
                scale: 0,
                duration: 500,
                onComplete: () => p.destroy()
            });
        }
    }

    playerHit() {
        if (this.player.isInvincible) return;

        this.player.lives--;
        this.player.isInvincible = true;
        this.player.invincibleTimer = 2000;

        // Drop items
        this.player.carrying.forEach(n => n.destroy());
        this.player.carrying = [];

        this.cameras.main.shake(200, 0.01);
        if (navigator.vibrate) navigator.vibrate(200);

        if (this.player.lives <= 0) {
            this.scene.start('GameOverScene', { score: this.score, saved: this.saved, lost: this.lost });
        } else {
            // Reset pos
            this.player.x = this.scale.width / 2;
            this.player.y = this.scale.height - 50;
        }
    }

    updateWeather(delta) {
        // Simple rain effect reused
        if (this.weatherState === 'RAINING') {
            this.rainGraphics.clear();
            this.rainGraphics.lineStyle(1, 0xaec2e0, 0.5);
            this.rainDrops.forEach(d => {
                d.y += d.speed; d.x += d.wind;
                if (d.y > this.scale.height) { d.y = -10; d.x = Phaser.Math.Between(0, this.scale.width); }
                this.rainGraphics.beginPath(); this.rainGraphics.moveTo(d.x, d.y);
                this.rainGraphics.lineTo(d.x + d.wind, d.y + d.len);
                this.rainGraphics.strokePath();
            });
        }

        // Random weather change
        this.weatherTimer += delta;
        if (this.weatherTimer > 15000) {
            this.weatherTimer = 0;
            this.weatherState = Math.random() < 0.3 ? 'RAINING' : 'CLEAR';
            if (this.weatherState === 'CLEAR') this.rainGraphics.clear();
        }
    }

    togglePause() {
        this.paused = !this.paused;
        // Simple pause text overlay logic could go here
    }
}

// ===== GAME OVER SCENE =====
class GameOverScene extends Phaser.Scene {
    constructor() { super({ key: 'GameOverScene' }); }
    init(data) { this.score = data.score || 0; this.saved = data.saved || 0; this.lost = data.lost || 0; }

    create() {
        const { width, height } = this.scale;
        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        this.add.text(width / 2, height * 0.3, 'GAME OVER', {
            fontFamily: 'Fredoka, Arial', fontSize: '64px', color: '#ff0066', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.5, `Score: ${Math.floor(this.score)}`, { fontSize: '32px' }).setOrigin(0.5);

        const btn = this.add.text(width / 2, height * 0.7, 'PLAY AGAIN', {
            fontSize: '28px', color: '#00ffff', backgroundColor: '#333', padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        btn.on('pointerdown', () => this.scene.start('GameScene'));
    }
}

// ===== PHASER CONFIG =====
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.RESIZE, // Key change for mobile
        parent: 'game-container',
        width: '100%',
        height: '100%'
    },
    backgroundColor: '#000000',
    scene: [SplashScene, GameScene, GameOverScene],
    physics: { default: 'arcade', arcade: { debug: false } }
};

window.addEventListener('DOMContentLoaded', () => {
    new Phaser.Game(config);
});
