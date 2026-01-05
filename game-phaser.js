/* ===================================
   SAVE THE NEWTS - PHASER.JS GAME
   Arcade-Style Neon Graphics Edition
   =================================== */

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    // Canvas dimensions
    CANVAS_WIDTH: 1000,
    CANVAS_HEIGHT: 700,

    // Road
    ROAD_Y: 150,
    ROAD_HEIGHT: 500,
    LANE_COUNT: 4,

    // Player
    PLAYER_SPEED: 300,
    PLAYER_SIZE: 40,
    MAX_CARRY: 2,
    PLAYER_LIVES: 3,
    PLAYER_INVINCIBLE_TIME: 2000,

    // Cars
    CAR_MIN_SPEED: 120,
    CAR_MAX_SPEED: 240,
    CAR_SPAWN_RATE: 1800,
    CAR_WIDTH: 80,
    CAR_HEIGHT: 40,

    // Newts
    NEWT_SPEED: 48,
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

        // UI
        textGlow: '#00ffff',
        buttonGlow: '#ff00ff',
    },

    // Zone height
    ZONE_HEIGHT: 60,
};

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SplashScene' });
    }

    preload() {
        // Load the poster image
        this.load.image('poster', 'assets/poster.jpg');
        this.load.image('newt', 'assets/newt.png');
    }

    create() {
        const { width, height } = this.scale;

        // Add poster as full-screen background
        const poster = this.add.image(width / 2, height / 2, 'poster');
        poster.setDisplaySize(width, height);
        poster.setAlpha(0);

        // Fade in the poster
        this.tweens.add({
            targets: poster,
            alpha: 1,
            duration: 1500,
            ease: 'Power2'
        });

        // Poster-only splash: tap/click/press any key to start

        // Handle input to transition
        this.input.once('pointerdown', () => {
            this.startTransition();
        });

        this.input.keyboard.once('keydown', () => {
            this.startTransition();
        });
    }

    createScanlines() {
        const { width, height } = this.scale;
        const graphics = this.add.graphics();
        graphics.setAlpha(0.1);

        for (let y = 0; y < height; y += 4) {
            graphics.lineStyle(1, 0x000000, 0.3);
            graphics.lineBetween(0, y, width, y);
        }
    }

    startTransition() {
        // Flash effect
        this.cameras.main.flash(200, 0, 255, 255);

        // Fade out and transition to game
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
        const { width, height } = this.scale;

        // Game state
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.difficulty = 1;
        this.gameOver = false;
        this.paused = false;

        // Create game world
        this.createBackground();
        this.createRoad();
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

        // Layout on resize (mobile/desktop readability)
        this.scale.on('resize', () => {
            this.layoutUI();
        });

        // Create mobile controls
        if (this.isMobile()) {
            this.createMobileControls();
        }

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

        // Add scanlines overlay
        this.createScanlines();

        // Camera fade in
        this.cameras.main.fadeIn(500, 0, 0, 0);

        // Pause handling
        this.pauseKey.on('down', () => {
            this.togglePause();
        });
    }

    createBackground() {
        const { width, height } = this.scale;

        // Dark gradient background
        const bgGraphics = this.add.graphics();

        // Forest zone (top)
        bgGraphics.fillGradientStyle(0x0a2a1a, 0x0a2a1a, 0x152a20, 0x152a20);
        bgGraphics.fillRect(0, 0, width, GAME_CONFIG.ROAD_Y);

        // Forest silhouette ridge (subtle depth)
        bgGraphics.fillStyle(0x06150f, 0.9);
        const ridgeY = GAME_CONFIG.ROAD_Y - 18;
        for (let x = 0; x < width + 60; x += 60) {
            const peak = Phaser.Math.Between(10, 28);
            bgGraphics.fillTriangle(x, ridgeY + 18, x + 30, ridgeY - peak, x + 60, ridgeY + 18);
        }

        // Soft mist line near road edge
        bgGraphics.fillStyle(0x88ffdd, 0.05);
        bgGraphics.fillRect(0, GAME_CONFIG.ROAD_Y - 10, width, 10);

        // Lake zone (bottom)
        const lakeY = GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT;
        bgGraphics.fillGradientStyle(0x152535, 0x152535, 0x0a1a2a, 0x0a1a2a);
        bgGraphics.fillRect(0, lakeY, width, height - lakeY);

        // Lake surface ripples (simple, readable)
        bgGraphics.lineStyle(1, 0x66ccff, 0.12);
        for (let y = lakeY + 16; y < height; y += 18) {
            const wobble = Phaser.Math.Between(-8, 8);
            bgGraphics.beginPath();
            bgGraphics.moveTo(0, y);
            bgGraphics.lineTo(width, y + wobble);
            bgGraphics.strokePath();
        }

        // Add some ambient particles for atmosphere
        this.createAmbientParticles();
    }

    createAmbientParticles() {
        // Fireflies in forest zone
        for (let i = 0; i < 20; i++) {
            const x = Phaser.Math.Between(50, this.scale.width - 50);
            const y = Phaser.Math.Between(20, GAME_CONFIG.ROAD_Y - 20);

            const firefly = this.add.circle(x, y, 2, 0x88ff88);
            firefly.setAlpha(0.5);

            this.tweens.add({
                targets: firefly,
                alpha: { from: 0.2, to: 0.8 },
                x: x + Phaser.Math.Between(-30, 30),
                y: y + Phaser.Math.Between(-20, 20),
                duration: Phaser.Math.Between(2000, 4000),
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }
    }

    createRoad() {
        const { width } = this.scale;
        const graphics = this.add.graphics();

        // Road base with neon edge glow
        graphics.fillStyle(0x0a0a0a);
        graphics.fillRect(0, GAME_CONFIG.ROAD_Y, width, GAME_CONFIG.ROAD_HEIGHT);

        // Road edge glow (neon effect)
        graphics.lineStyle(3, 0xff00ff, 0.5);
        graphics.lineBetween(0, GAME_CONFIG.ROAD_Y, width, GAME_CONFIG.ROAD_Y);
        graphics.lineBetween(0, GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT,
            width, GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT);

        // Lane dividers
        const laneHeight = GAME_CONFIG.ROAD_HEIGHT / GAME_CONFIG.LANE_COUNT;
        for (let i = 1; i < GAME_CONFIG.LANE_COUNT; i++) {
            const y = GAME_CONFIG.ROAD_Y + (i * laneHeight);

            // Dashed line
            for (let x = 0; x < width; x += 60) {
                graphics.fillStyle(0xffaa00, 0.8);
                graphics.fillRect(x, y - 2, 30, 4);
            }
        }

        // Center line glow
        const centerY = GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT / 2;
        graphics.lineStyle(2, 0x00ffff, 0.3);
        graphics.lineBetween(0, centerY, width, centerY);
    }

    createSafeZones() {
        const { width, height } = this.scale;

        const lakeY = GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT;

        // Forest zone label
        this.forestLabel = this.add.text(width / 2, GAME_CONFIG.ROAD_Y - 28, 'FOREST (SAFE)', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#88ff88',
            shadow: { offsetX: 0, offsetY: 0, color: '#00ff00', blur: 10, fill: true }
        });
        this.forestLabel.setOrigin(0.5);

        // Lake zone label
        this.lakeLabel = this.add.text(width / 2, lakeY + 20, 'LAKE (SAFE)', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#88ccff',
            shadow: { offsetX: 0, offsetY: 0, color: '#0088ff', blur: 10, fill: true }
        });
        this.lakeLabel.setOrigin(0.5);
    }

    createPlayer() {
        const { width, height } = this.scale;

        // Create player as a container for complex sprite
        this.player = this.add.container(width / 2, height - 100);

        // Player body (volunteer in high-vis vest)
        const body = this.add.graphics();

        // Shadow
        body.fillStyle(0x000000, 0.4);
        body.fillEllipse(0, 25, 30, 10);

        // Legs
        body.fillStyle(0x34495e);
        body.fillRect(-10, 10, 8, 20);
        body.fillRect(2, 10, 8, 20);

        // Body (high-vis vest)
        body.fillStyle(0xf1c40f);
        body.fillRoundedRect(-15, -15, 30, 30, 5);

        // Reflective stripes
        body.fillStyle(0xffffff, 0.8);
        body.fillRect(-12, -5, 24, 3);
        body.fillRect(-12, 5, 24, 3);

        // Head
        body.fillStyle(0xfce4d6);
        body.fillCircle(0, -22, 10);

        // Hard hat
        body.fillStyle(0xe74c3c);
        body.fillEllipse(0, -28, 14, 6);

        this.player.add(body);

        // Player physics properties
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.size = GAME_CONFIG.PLAYER_SIZE;
        this.player.carrying = [];
        this.player.lives = GAME_CONFIG.PLAYER_LIVES;
        this.player.isInvincible = false;
        this.player.invincibleTimer = 0;
        this.player.direction = 1;

        // Movement velocity
        this.player.vx = 0;
        this.player.vy = 0;

        // Neon glow removed as per user request
        this.player.glow = null;
    }

    createWeatherSystem() {
        // Rain particle emitter
        this.rainEmitter = this.add.particles(0, 0, null, {
            x: { min: 0, max: this.scale.width },
            y: -20,
            lifespan: 1500,
            speedY: { min: 300, max: 500 },
            speedX: { min: -50, max: 50 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.5, end: 0 },
            quantity: 0,
            emitCallback: (particle) => {
                // Custom particle rendering (rain drops)
                particle.setTint(0xaec2e0);
            }
        });

        this.weatherState = 'CLEAR';
        this.weatherTimer = 0;
        this.rainIntensity = 0;

        // Create rain graphics
        this.rainGraphics = this.add.graphics();
        this.rainDrops = [];
        for (let i = 0; i < 200; i++) {
            this.rainDrops.push({
                x: Phaser.Math.Between(0, this.scale.width),
                y: Phaser.Math.Between(-50, this.scale.height),
                len: Phaser.Math.Between(10, 20),
                speed: Phaser.Math.Between(8, 15),
                wind: Phaser.Math.FloatBetween(-1, 2)
            });
        }
    }

    createHUD() {
        const padding = 12;

        this.uiPadding = padding;

        // Lives display
        this.livesText = this.add.text(padding, padding, '❤️❤️❤️', {
            fontFamily: 'Outfit, Arial',
            fontSize: '26px'
        });

        // Score display with neon effect
        this.scoreText = this.add.text(this.scale.width - padding, padding, 'SCORE: 0', {
            fontFamily: 'Fredoka, Arial',
            fontSize: '22px',
            color: '#ffffff',
            stroke: GAME_CONFIG.COLORS.neonCyan,
            strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: GAME_CONFIG.COLORS.neonCyan, blur: 10, fill: true }
        });
        this.scoreText.setOrigin(1, 0);

        // Carrying slots
        this.carryingText = this.add.text(this.scale.width / 2, padding, 'CARRYING: [ ]', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#ffffff',
            stroke: GAME_CONFIG.COLORS.neonPink,
            strokeThickness: 1
        });
        this.carryingText.setOrigin(0.5, 0);

        // Stats
        this.statsText = this.add.text(padding, this.scale.height - padding - 20,
            '💚 Saved: 0  💀 Lost: 0', {
            fontFamily: 'Outfit, Arial',
            fontSize: '16px',
            color: '#cccccc'
        });

        this.layoutUI();
    }

    layoutUI() {
        const w = this.scale.width;
        const h = this.scale.height;
        const uiScale = Phaser.Math.Clamp(w / GAME_CONFIG.CANVAS_WIDTH, 0.72, 1.05);

        const padding = Math.round((this.uiPadding ?? 12) * uiScale);
        const topRowY = padding;
        const secondRowY = topRowY + Math.round(30 * uiScale);

        if (this.livesText) {
            this.livesText.setPosition(padding, topRowY);
            this.livesText.setFontSize(Math.round(26 * uiScale));
        }

        if (this.scoreText) {
            this.scoreText.setPosition(w - padding, topRowY);
            this.scoreText.setFontSize(Math.round(22 * uiScale));
        }

        if (this.carryingText) {
            this.carryingText.setPosition(w / 2, secondRowY);
            this.carryingText.setFontSize(Math.round(18 * uiScale));
        }

        if (this.statsText) {
            this.statsText.setPosition(padding, h - padding - Math.round(46 * uiScale));
            this.statsText.setFontSize(Math.round(16 * uiScale));
        }

        const lakeY = GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT;
        if (this.forestLabel) {
            this.forestLabel.setPosition(w / 2, GAME_CONFIG.ROAD_Y - Math.round(28 * uiScale));
            this.forestLabel.setFontSize(Math.round(16 * uiScale));
        }

        if (this.lakeLabel) {
            // Keep lake label above bottom UI and readable
            const lakeLabelY = Math.min(h - padding - Math.round(12 * uiScale), lakeY + Math.round(20 * uiScale));
            this.lakeLabel.setPosition(w / 2, lakeLabelY);
            this.lakeLabel.setFontSize(Math.round(16 * uiScale));
        }
    }

    setGameplayPaused(paused) {
        this.paused = paused;
        if (this.carSpawnTimer) this.carSpawnTimer.paused = paused;
        if (this.newtSpawnTimer) this.newtSpawnTimer.paused = paused;
    }

    resetPlayerPosition() {
        this.player.x = this.scale.width / 2;
        this.player.y = this.scale.height - 100;
        this.player.vx = 0;
        this.player.vy = 0;
    }

    createMobileControls() {
        // Virtual joystick
        const joystickBase = this.add.circle(100, this.scale.height - 120, 60, 0x000000, 0.5);
        joystickBase.setStrokeStyle(3, 0x00ffff, 0.8);

        const joystickThumb = this.add.circle(100, this.scale.height - 120, 30, 0x00ffff, 0.6);

        this.joystick = {
            base: joystickBase,
            thumb: joystickThumb,
            x: 0,
            y: 0,
            active: false,
            pointerId: null
        };

        // Touch handling
        this.input.on('pointerdown', (pointer) => {
            const dist = Phaser.Math.Distance.Between(
                pointer.x, pointer.y,
                joystickBase.x, joystickBase.y
            );

            if (dist < 80) {
                this.joystick.active = true;
                this.joystick.pointerId = pointer.id;
            }
        });

        this.input.on('pointermove', (pointer) => {
            if (this.joystick.active && pointer.id === this.joystick.pointerId) {
                const dx = pointer.x - joystickBase.x;
                const dy = pointer.y - joystickBase.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = 40;

                if (dist > maxDist) {
                    this.joystick.x = (dx / dist) * maxDist;
                    this.joystick.y = (dy / dist) * maxDist;
                } else {
                    this.joystick.x = dx;
                    this.joystick.y = dy;
                }

                joystickThumb.x = joystickBase.x + this.joystick.x;
                joystickThumb.y = joystickBase.y + this.joystick.y;
            }
        });

        this.input.on('pointerup', (pointer) => {
            if (pointer.id === this.joystick.pointerId) {
                this.joystick.active = false;
                this.joystick.x = 0;
                this.joystick.y = 0;
                joystickThumb.x = joystickBase.x;
                joystickThumb.y = joystickBase.y;
            }
        });
    }

    createScanlines() {
        const graphics = this.add.graphics();
        graphics.setAlpha(0.03);
        graphics.setDepth(1000);

        for (let y = 0; y < this.scale.height; y += 3) {
            graphics.lineStyle(1, 0x000000, 0.5);
            graphics.lineBetween(0, y, this.scale.width, y);
        }
    }

    isMobile() {
        return this.sys.game.device.os.android ||
            this.sys.game.device.os.iOS ||
            this.sys.game.device.input.touch;
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

        // Keyboard input
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
        if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
        if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;

        // Mobile joystick
        if (this.joystick && this.joystick.active) {
            dx = this.joystick.x / 40;
            dy = this.joystick.y / 40;
        }

        // Normalize diagonal
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;

            player.x += dx * player.speed * (delta / 1000);
            player.y += dy * player.speed * (delta / 1000);

            if (dx !== 0) player.direction = dx > 0 ? 1 : -1;
            player.scaleX = player.direction;
        }

        // Bounds
        player.x = Phaser.Math.Clamp(player.x, player.size, this.scale.width - player.size);
        player.y = Phaser.Math.Clamp(player.y, player.size, this.scale.height - player.size);

        // Update carried newts
        player.carrying.forEach((newt, i) => {
            newt.x = player.x + (i === 0 ? -15 : 15);
            newt.y = player.y - 5;
        });

        // Invincibility timer
        if (player.isInvincible) {
            player.invincibleTimer -= delta;
            player.alpha = Math.floor(time / 100) % 2 === 0 ? 0.4 : 1;

            if (player.invincibleTimer <= 0) {
                player.isInvincible = false;
                player.alpha = 1;
            }
        }
    }

    updateCars(delta) {
        this.cars.getChildren().forEach(car => {
            car.x += car.speed * car.direction * (delta / 1000);

            // Remove if off screen
            if ((car.direction === 1 && car.x > this.scale.width + 100) ||
                (car.direction === -1 && car.x < -100)) {
                car.destroy();
            }
        });
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (newt.isSquished) {
                newt.squishedTime += delta;
                newt.alpha = 1 - (newt.squishedTime / 2000);
                if (newt.squishedTime > 2000) {
                    newt.destroy();
                }
                return;
            }

            if (!newt.isCarried) {
                newt.y += newt.moveDirection * GAME_CONFIG.NEWT_SPEED * (delta / 1000);

                // Animate legs while moving
                if (newt.legGraphics) {
                    newt.legAnimTime = (newt.legAnimTime || 0) + delta * 0.01;
                    const legOffset = Math.sin(newt.legAnimTime * 3) * 4;

                    newt.legGraphics.clear();
                    newt.legGraphics.lineStyle(2, 0xff6d00);

                    // Front legs (animated)
                    newt.legGraphics.lineBetween(5, -5, 10 + legOffset, -10);
                    newt.legGraphics.lineBetween(5, 5, 10 - legOffset, 10);

                    // Back legs (animated opposite)
                    newt.legGraphics.lineBetween(-5, -5, -10 - legOffset, -10);
                    newt.legGraphics.lineBetween(-5, 5, -10 + legOffset, 10);
                }

                // Check if reached destination
                if ((newt.moveDirection === 1 && newt.y >= this.scale.height - 80) ||
                    (newt.moveDirection === -1 && newt.y <= 80)) {
                    // Newt made it on its own!
                    this.newtReachedDestination(newt, false);
                }
            }
        });
    }

    updateWeather(delta) {
        this.weatherTimer += delta;

        // Change weather periodically
        if (this.weatherTimer > 20000) {
            this.weatherTimer = 0;

            if (this.weatherState === 'CLEAR') {
                if (Math.random() < 0.6) {
                    this.weatherState = 'RAINING';
                    this.rainIntensity = 0.5;
                }
            } else {
                this.weatherState = 'CLEAR';
                this.rainIntensity = 0;
            }
        }

        // Draw rain
        this.rainGraphics.clear();
        if (this.rainIntensity > 0) {
            this.rainGraphics.lineStyle(1.5, 0xaec2e0, 0.5);

            const activeDrops = Math.floor(this.rainDrops.length * this.rainIntensity);
            for (let i = 0; i < activeDrops; i++) {
                const drop = this.rainDrops[i];
                drop.y += drop.speed;
                drop.x += drop.wind;

                if (drop.y > this.scale.height) {
                    drop.y = -20;
                    drop.x = Phaser.Math.Between(0, this.scale.width);
                }

                this.rainGraphics.beginPath();
                this.rainGraphics.moveTo(drop.x, drop.y);
                this.rainGraphics.lineTo(drop.x + drop.wind, drop.y + drop.len);
                this.rainGraphics.strokePath();
            }
        }
    }

    checkCollisions() {
        const player = this.player;
        const playerBounds = {
            x: player.x - player.size / 2,
            y: player.y - player.size / 2,
            width: player.size,
            height: player.size
        };

        // Player vs Cars
        this.cars.getChildren().forEach(car => {
            const carBounds = {
                x: car.x - car.carWidth / 2,
                y: car.y - car.carHeight / 2,
                width: car.carWidth,
                height: car.carHeight
            };

            if (this.rectIntersects(playerBounds, carBounds)) {
                this.playerHit();
            }
        });

        // Player vs Newts (pickup)
        this.newts.getChildren().forEach(newt => {
            if (newt.isSquished || newt.isCarried) return;

            const newtBounds = {
                x: newt.x - GAME_CONFIG.NEWT_SIZE / 2,
                y: newt.y - GAME_CONFIG.NEWT_SIZE / 2,
                width: GAME_CONFIG.NEWT_SIZE,
                height: GAME_CONFIG.NEWT_SIZE
            };

            if (this.rectIntersects(playerBounds, newtBounds)) {
                if (player.carrying.length < GAME_CONFIG.MAX_CARRY) {
                    this.pickupNewt(newt);
                }
            }
        });

        // Cars vs Newts (squish)
        this.cars.getChildren().forEach(car => {
            const carBounds = {
                x: car.x - car.carWidth / 2,
                y: car.y - car.carHeight / 2,
                width: car.carWidth,
                height: car.carHeight
            };

            this.newts.getChildren().forEach(newt => {
                if (newt.isSquished || newt.isCarried) return;

                const newtBounds = {
                    x: newt.x - GAME_CONFIG.NEWT_SIZE / 2,
                    y: newt.y - GAME_CONFIG.NEWT_SIZE / 2,
                    width: GAME_CONFIG.NEWT_SIZE,
                    height: GAME_CONFIG.NEWT_SIZE
                };

                if (this.rectIntersects(carBounds, newtBounds)) {
                    this.squishNewt(newt);
                }
            });
        });

        // Check for delivery in safe zones
        if (player.carrying.length > 0) {
            const inForest = player.y < GAME_CONFIG.ZONE_HEIGHT + 30;
            const inLake = player.y > this.scale.height - GAME_CONFIG.ZONE_HEIGHT - 30;

            if (inForest || inLake) {
                const delivered = [...player.carrying];
                player.carrying = [];

                delivered.forEach(newt => {
                    const correctZone =
                        (newt.destination === 'forest' && inForest) ||
                        (newt.destination === 'lake' && inLake);

                    this.newtReachedDestination(newt, true, correctZone);
                });
            }
        }
    }

    rectIntersects(r1, r2) {
        return r1.x < r2.x + r2.width &&
            r1.x + r1.width > r2.x &&
            r1.y < r2.y + r2.height &&
            r1.y + r1.height > r2.y;
    }

    pickupNewt(newt) {
        newt.isCarried = true;
        this.player.carrying.push(newt);

        // Visual feedback
        this.cameras.main.flash(100, 0, 255, 255, false);

        // Particle effect
        this.createPickupParticles(newt.x, newt.y);
    }

    squishNewt(newt) {
        newt.isSquished = true;
        newt.squishedTime = 0;
        this.lost++;

        // Splatter effect
        this.createSplatterParticles(newt.x, newt.y);
    }

    newtReachedDestination(newt, byPlayer, correctZone = true) {
        if (byPlayer && correctZone) {
            this.saved++;
            this.score += GAME_CONFIG.POINTS_PER_SAVE * this.difficulty;

            // Success particles
            this.createSuccessParticles(newt.x, newt.y);

            // Increase difficulty after threshold
            if (this.saved > GAME_CONFIG.DIFFICULTY_START_THRESHOLD) {
                this.difficulty = Math.min(
                    GAME_CONFIG.MAX_DIFFICULTY,
                    1 + (this.saved - GAME_CONFIG.DIFFICULTY_START_THRESHOLD) * GAME_CONFIG.DIFFICULTY_INCREMENT
                );

                // Update spawn rate
                this.carSpawnTimer.delay = GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty;
            }
        }

        newt.destroy();
    }

    createPickupParticles(x, y) {
        for (let i = 0; i < 10; i++) {
            const particle = this.add.circle(x, y, 4, 0x00ffff);
            this.tweens.add({
                targets: particle,
                x: x + Phaser.Math.Between(-50, 50),
                y: y + Phaser.Math.Between(-50, 50),
                alpha: 0,
                scale: 0,
                duration: 500,
                onComplete: () => particle.destroy()
            });
        }
    }

    createSplatterParticles(x, y) {
        for (let i = 0; i < 15; i++) {
            const particle = this.add.circle(x, y, Phaser.Math.Between(3, 8), 0xff6b35);
            this.tweens.add({
                targets: particle,
                x: x + Phaser.Math.Between(-40, 40),
                y: y + Phaser.Math.Between(-20, 20),
                alpha: 0,
                duration: 1000,
                onComplete: () => particle.destroy()
            });
        }
    }

    createSuccessParticles(x, y) {
        for (let i = 0; i < 20; i++) {
            const particle = this.add.circle(x, y, 5, 0x00ff88);
            this.tweens.add({
                targets: particle,
                x: x + Phaser.Math.Between(-60, 60),
                y: y - Phaser.Math.Between(50, 100),
                alpha: 0,
                scale: { from: 1, to: 0 },
                duration: 800,
                ease: 'Quad.easeOut',
                onComplete: () => particle.destroy()
            });
        }
    }

    playerHit() {
        if (this.gameOver) return;
        if (this.player.isInvincible) return;

        this.player.lives--;
        this.player.isInvincible = true;
        this.player.invincibleTimer = GAME_CONFIG.PLAYER_INVINCIBLE_TIME;

        // Drop carried newts
        this.player.carrying.forEach(newt => {
            newt.isCarried = false;
            newt.x = this.player.x + Phaser.Math.Between(-30, 30);
            newt.y = this.player.y + Phaser.Math.Between(-30, 30);
        });
        this.player.carrying = [];

        // Screen shake for damage feedback (removed flash as it gets stuck on some browsers)
        this.cameras.main.shake(250, 0.015);

        // Quick hit flash (red) + brief pause, then resume if lives remain
        this.cameras.main.flash(120, 255, 0, 60);
        this.setGameplayPaused(true);

        // Vibrate on mobile
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }

        if (this.player.lives <= 0) {
            // Let the hit feedback land, then end cleanly
            this.time.delayedCall(350, () => {
                this.setGameplayPaused(false);
                this.endGame();
            });
            return;
        }

        this.time.delayedCall(350, () => {
            this.resetPlayerPosition();
            this.setGameplayPaused(false);
        });
    }

    spawnCar() {
        const direction = Math.random() < 0.5 ? 1 : -1;
        const lane = Phaser.Math.Between(0, GAME_CONFIG.LANE_COUNT - 1);

        const laneHeight = GAME_CONFIG.ROAD_HEIGHT / GAME_CONFIG.LANE_COUNT;
        const y = GAME_CONFIG.ROAD_Y + (lane * laneHeight) + laneHeight / 2;

        const isMotorcycle = Math.random() < 0.3;
        const carWidth = isMotorcycle ? 40 : GAME_CONFIG.CAR_WIDTH;
        const carHeight = isMotorcycle ? 25 : GAME_CONFIG.CAR_HEIGHT;

        const x = direction === 1 ? -carWidth : this.scale.width + carWidth;

        const speed = Phaser.Math.Between(
            GAME_CONFIG.CAR_MIN_SPEED,
            GAME_CONFIG.CAR_MAX_SPEED
        ) * this.difficulty * (isMotorcycle ? 1.3 : 1);

        // Create car container
        const car = this.add.container(x, y);

        // Car graphics
        const graphics = this.add.graphics();

        // Colors
        const colors = [
            [0xe74c3c, 0xc0392b],
            [0x3498db, 0x2980b9],
            [0x2ecc71, 0x27ae60],
            [0x9b59b6, 0x8e44ad],
            [0xf39c12, 0xd68910],
            [0x1abc9c, 0x16a085]
        ];
        const colorPair = colors[Phaser.Math.Between(0, colors.length - 1)];

        if (isMotorcycle) {
            // Motorcycle body
            graphics.fillStyle(colorPair[0]);
            graphics.fillEllipse(0, 2, carWidth / 1.5, carHeight / 2);

            // Rider
            graphics.fillStyle(0x2d2d2d);
            graphics.fillCircle(-5, -8, 8);
            graphics.fillStyle(colorPair[1]);
            graphics.fillCircle(-5, -16, 6);

            // Wheels
            graphics.fillStyle(0x0a0a0a);
            graphics.fillCircle(carWidth / 2 - 8, carHeight / 2 - 2, 8);
            graphics.fillCircle(-carWidth / 2 + 8, carHeight / 2 - 2, 8);

            // Headlight
            graphics.fillStyle(0xfff9c4);
            graphics.fillCircle(carWidth / 2 - 3, 0, 3);
        } else {
            // Car body
            graphics.fillStyle(colorPair[0]);
            graphics.fillRoundedRect(-carWidth / 2, -carHeight / 2 + 8, carWidth, carHeight - 8, 6);

            // Roof
            graphics.fillStyle(colorPair[1]);
            graphics.fillRoundedRect(-carWidth / 2 + 15, -carHeight / 2, carWidth - 35, carHeight - 10, 6);

            // Windows
            graphics.fillStyle(0x1a2530);
            graphics.fillRect(-carWidth / 2 + 20, -carHeight / 2 + 4, 18, 16);
            graphics.fillRect(-carWidth / 2 + 42, -carHeight / 2 + 4, 18, 16);

            // Headlight
            graphics.fillStyle(0xfff9c4);
            graphics.fillCircle(carWidth / 2 - 5, 0, 5);

            // Tail light
            graphics.fillStyle(0xff5252);
            graphics.fillCircle(-carWidth / 2 + 5, 0, 4);

            // Wheels
            graphics.fillStyle(0x0a0a0a);
            graphics.fillCircle(-carWidth / 2 + 15, carHeight / 2, 8);
            graphics.fillCircle(carWidth / 2 - 15, carHeight / 2, 8);
        }

        // Headlight beam glow
        const beamLength = isMotorcycle ? 80 : 150;
        const beam = this.add.graphics();
        beam.fillStyle(0xffff99, 0.1);
        beam.beginPath();
        beam.moveTo(carWidth / 2 - 3, -3);
        beam.lineTo(carWidth / 2 + beamLength, -30);
        beam.lineTo(carWidth / 2 + beamLength, 30);
        beam.lineTo(carWidth / 2 - 3, 3);
        beam.closePath();
        beam.fillPath();

        car.add(beam);
        car.add(graphics);

        // Flip if going left
        if (direction === -1) {
            car.scaleX = -1;
        }

        car.speed = speed;
        car.direction = direction;
        car.carWidth = carWidth;
        car.carHeight = carHeight;
        car.isMotorcycle = isMotorcycle;

        this.cars.add(car);
    }

    spawnNewt() {
        const startSide = Math.random() < 0.5 ? 'forest' : 'lake';
        const moveDirection = startSide === 'forest' ? 1 : -1;

        const x = Phaser.Math.Between(100, this.scale.width - 100);
        const y = startSide === 'forest'
            ? Phaser.Math.Between(20, GAME_CONFIG.ROAD_Y - 20)
            : Phaser.Math.Between(
                GAME_CONFIG.ROAD_Y + GAME_CONFIG.ROAD_HEIGHT + 20,
                this.scale.height - 20
            );

        // Create newt container
        const newt = this.add.container(x, y);

        const graphics = this.add.graphics();

        // Shadow
        graphics.fillStyle(0x000000, 0.4);
        graphics.fillEllipse(2, 2, 16, 6);

        // Body (California Newt - Dark Brown Top)
        graphics.fillStyle(0x4e342e);
        graphics.fillEllipse(0, 0, 16, 10);

        // Orange underside (California Newt distinctive feature)
        graphics.fillStyle(0xff6d00);
        graphics.fillEllipse(0, 0, 14, 8);

        // Back texture
        graphics.fillStyle(0x3e2723);
        graphics.fillEllipse(0, -1, 12, 6);

        // Head
        graphics.fillStyle(0x5d4037);
        graphics.fillEllipse(10, 0, 6, 5);

        // Eyes
        graphics.fillStyle(0x000000);
        graphics.fillCircle(11, -3, 2);
        graphics.fillCircle(11, 3, 2);

        newt.add(graphics);

        // Separate leg graphics for animation
        const legGraphics = this.add.graphics();
        legGraphics.lineStyle(2, 0xff6d00);
        legGraphics.lineBetween(5, -5, 10, -10);
        legGraphics.lineBetween(5, 5, 10, 10);
        legGraphics.lineBetween(-5, -5, -10, -10);
        legGraphics.lineBetween(-5, 5, -10, 10);

        newt.add(legGraphics);
        newt.legGraphics = legGraphics;
        newt.legAnimTime = 0;

        // Rotate to face direction
        newt.rotation = moveDirection === 1 ? Math.PI / 2 : -Math.PI / 2;

        newt.startSide = startSide;
        newt.destination = startSide === 'forest' ? 'lake' : 'forest';
        newt.moveDirection = moveDirection;
        newt.isCarried = false;
        newt.isSquished = false;
        newt.squishedTime = 0;

        this.newts.add(newt);
    }

    updateHUD() {
        // Lives
        let hearts = '';
        for (let i = 0; i < this.player.lives; i++) hearts += '❤️';
        for (let i = this.player.lives; i < GAME_CONFIG.PLAYER_LIVES; i++) hearts += '🖤';
        this.livesText.setText(hearts);

        // Score
        this.scoreText.setText(`SCORE: ${Math.floor(this.score)}`);

        // Carrying (simple readable boxes)
        const carried = this.player.carrying.length;
        const carriedBoxes = '[x]'.repeat(carried) || '[\u00A0]';
        this.carryingText.setText(`CARRYING: ${carriedBoxes}`);

        // Stats
        this.statsText.setText(`💚 Saved: ${this.saved}  💀 Lost: ${this.lost}`);
    }

    togglePause() {
        this.paused = !this.paused;

        if (this.paused) {
            this.pauseText = this.add.text(
                this.scale.width / 2,
                this.scale.height / 2,
                'PAUSED',
                {
                    fontFamily: 'Fredoka, Arial',
                    fontSize: '64px',
                    color: '#ffffff',
                    stroke: GAME_CONFIG.COLORS.neonCyan,
                    strokeThickness: 4,
                    shadow: { offsetX: 0, offsetY: 0, color: GAME_CONFIG.COLORS.neonCyan, blur: 20, fill: true }
                }
            );
            this.pauseText.setOrigin(0.5);
        } else if (this.pauseText) {
            this.pauseText.destroy();
        }
    }

    endGame() {
        this.gameOver = true;

        // Stop spawning
        this.carSpawnTimer.destroy();
        this.newtSpawnTimer.destroy();

        // Transition to game over
        this.cameras.main.fadeOut(1000, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameOverScene', {
                score: Math.floor(this.score),
                saved: this.saved,
                lost: this.lost
            });
        });
    }
}

// ===== GAME OVER SCENE =====
class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        this.finalScore = data.score || 0;
        this.saved = data.saved || 0;
        this.lost = data.lost || 0;
    }

    create() {
        const { width, height } = this.scale;

        // Background
        this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0a);

        // Add scanlines
        const graphics = this.add.graphics();
        graphics.setAlpha(0.05);
        for (let y = 0; y < height; y += 3) {
            graphics.lineStyle(1, 0xffffff, 0.3);
            graphics.lineBetween(0, y, width, y);
        }

        // Game Over title with neon effect
        const title = this.add.text(width / 2, height * 0.2, 'GAME OVER', {
            fontFamily: 'Fredoka, Arial',
            fontSize: '72px',
            fontStyle: 'bold',
            color: '#ff0066',
            stroke: '#ff0066',
            strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: '#ff0066', blur: 30, fill: true }
        });
        title.setOrigin(0.5);

        // Pulse animation
        this.tweens.add({
            targets: title,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Stats
        const statsY = height * 0.4;

        this.add.text(width / 2, statsY, `SCORE: ${this.finalScore}`, {
            fontFamily: 'Outfit, Arial',
            fontSize: '36px',
            color: '#00ffff',
            shadow: { offsetX: 0, offsetY: 0, color: '#00ffff', blur: 15, fill: true }
        }).setOrigin(0.5);

        this.add.text(width / 2, statsY + 50, `Newts Saved: ${this.saved}`, {
            fontFamily: 'Outfit, Arial',
            fontSize: '24px',
            color: '#00ff88'
        }).setOrigin(0.5);

        this.add.text(width / 2, statsY + 85, `Newts Lost: ${this.lost}`, {
            fontFamily: 'Outfit, Arial',
            fontSize: '24px',
            color: '#ff6666'
        }).setOrigin(0.5);

        // Name input
        this.createNameInput(width / 2, statsY + 150);

        // Play Again button
        const button = this.add.text(width / 2, height * 0.85, '[ PLAY AGAIN ]', {
            fontFamily: 'Fredoka, Arial',
            fontSize: '32px',
            color: '#ffffff',
            stroke: GAME_CONFIG.COLORS.neonPink,
            strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: GAME_CONFIG.COLORS.neonPink, blur: 15, fill: true }
        });
        button.setOrigin(0.5);
        button.setInteractive({ useHandCursor: true });

        button.on('pointerover', () => {
            button.setScale(1.1);
        });

        button.on('pointerout', () => {
            button.setScale(1);
        });

        button.on('pointerdown', () => {
            this.cameras.main.fadeOut(500, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('GameScene');
            });
        });

        // Keyboard shortcut
        this.input.keyboard.once('keydown-SPACE', () => {
            this.cameras.main.fadeOut(500, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('GameScene');
            });
        });

        // Fade in
        this.cameras.main.fadeIn(500, 0, 0, 0);
    }

    createNameInput(x, y) {
        // Create a simple text-based name entry
        this.playerName = '';

        const inputBg = this.add.rectangle(x, y, 300, 50, 0x1a1a1a);
        inputBg.setStrokeStyle(2, 0x00ffff);

        this.nameText = this.add.text(x, y, 'Enter name...', {
            fontFamily: 'Outfit, Arial',
            fontSize: '20px',
            color: '#666666'
        });
        this.nameText.setOrigin(0.5);

        // Make it interactive
        inputBg.setInteractive({ useHandCursor: true });
        inputBg.on('pointerdown', () => {
            // Use browser prompt for simplicity
            const name = prompt('Enter your name:', '');
            if (name && name.trim()) {
                this.playerName = name.trim().substring(0, 15);
                this.nameText.setText(this.playerName);
                this.nameText.setColor('#ffffff');
            }
        });

        // Submit button
        const submitBtn = this.add.text(x + 180, y, 'SUBMIT', {
            fontFamily: 'Outfit, Arial',
            fontSize: '18px',
            color: '#00ff88',
            backgroundColor: '#1a1a1a',
            padding: { x: 15, y: 10 }
        });
        submitBtn.setOrigin(0.5);
        submitBtn.setInteractive({ useHandCursor: true });

        submitBtn.on('pointerdown', () => {
            if (this.playerName) {
                // Would submit to leaderboard here
                submitBtn.setText('✓ SAVED');
                submitBtn.setColor('#88ff88');
            }
        });
    }
}

// ===== PHASER GAME CONFIGURATION =====
const config = {
    type: Phaser.AUTO,
    width: GAME_CONFIG.CANVAS_WIDTH,
    height: GAME_CONFIG.CANVAS_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [SplashScene, GameScene, GameOverScene]
};

// ===== INITIALIZE GAME =====
window.addEventListener('DOMContentLoaded', () => {
    new Phaser.Game(config);
});
