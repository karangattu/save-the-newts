/* ===================================
   SAVE THE NEWTS - PHASER.JS GAME
   Arcade-Style Neon Graphics Edition
   =================================== */

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    // Reference/Base dimensions
    BASE_WIDTH: 1000,
    BASE_HEIGHT: 700,

    // Road (Base values)
    BASE_ROAD_HEIGHT: 480,
    LANE_COUNT: 4,

    // Player
    PLAYER_SPEED: 320,
    PLAYER_SIZE: 40,
    MAX_CARRY: 2,
    PLAYER_LIVES: 3,
    PLAYER_INVINCIBLE_TIME: 2000,

    // Cars reference speeds (scaled by width)
    CAR_MIN_SPEED: 140,
    CAR_MAX_SPEED: 260,
    CAR_SPAWN_RATE: 1800,
    CAR_WIDTH: 80,
    CAR_HEIGHT: 40,

    // Newts
    NEWT_SPEED: 42,
    NEWT_SPAWN_RATE: 2400,
    NEWT_SIZE: 25,

    // Neon Arcade Colors
    COLORS: {
        neonPink: '#ff00ff',
        neonCyan: '#00ffff',
        neonPurple: '#bf00ff',
        neonBlue: '#0080ff',
        neonGreen: '#00ff80',
        neonYellow: '#ffff00',
        neonOrange: '#ff8000',
        forest: '#0a2a1a',
        lake: '#0a1a2a',
        road: '#0a0a0a',
        roadLine: '#ffaa00',
    },

    MIN_ZONE_HEIGHT: 80, // Minimum height for forest/lake zones
};

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SplashScene' });
    }

    preload() {
        // Use full URLs or absolute-relative paths if needed, but 'assets/...' should work
        this.load.image('poster', 'assets/poster.jpg');
        this.load.image('newt', 'assets/newt.png');
    }

    create() {
        const { width, height } = this.scale;

        // Ensure we have a valid size
        if (width === 0 || height === 0) {
            this.time.delayedCall(100, () => this.create());
            return;
        }

        // Add poster - centered
        this.poster = this.add.image(width / 2, height / 2, 'poster');
        this.updatePosterScale();

        this.poster.setAlpha(0);
        this.tweens.add({
            targets: this.poster,
            alpha: 1,
            duration: 1000,
            ease: 'Power2'
        });

        const startText = this.add.text(width / 2, height - 60, 'TAP TO START', {
            fontFamily: 'Fredoka, Arial',
            fontSize: '24px',
            color: '#00ffff',
            stroke: '#000',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.tweens.add({
            targets: startText,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1
        });

        // Resize handler
        this.scale.on('resize', () => {
            const { width, height } = this.scale;
            this.poster.setPosition(width / 2, height / 2);
            this.updatePosterScale();
            startText.setPosition(width / 2, height - 60);
        });

        this.input.once('pointerdown', () => this.startTransition());
        this.input.keyboard.once('keydown', () => this.startTransition());
    }

    updatePosterScale() {
        const { width, height } = this.scale;
        const scaleX = width / this.poster.width;
        const scaleY = height / this.poster.height;

        // Fix for "zoomed in": Use 'contain' if it looks weird, but 'cover' is usually desired.
        // Let's use 'contain' for mobile portrait if the image is too wide, 
        // but for now let's just use a better Math.min or fixed scale to avoid extreme zooms.
        const scale = Math.max(scaleX, scaleY);
        this.poster.setScale(scale);
    }

    startTransition() {
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
        // Internal State
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.difficulty = 1;
        this.gameOver = false;
        this.paused = false;

        // Initialize Layout
        this.calculateLayout();

        // Environment Groups
        this.bgGraphics = this.add.graphics();
        this.roadGraphics = this.add.graphics();
        this.drawEnvironment();

        // Labels
        this.createEnvironmentLabels();

        // Game Groups
        this.cars = this.add.group();
        this.newts = this.add.group();

        // Player
        this.createPlayer();

        // Weather
        this.createWeather();

        // UI
        this.createHUD();

        // Mobile Controls
        this.createMobileControls();

        // Event: Resize
        this.scale.on('resize', () => {
            this.calculateLayout();
            this.drawEnvironment();
            this.updateLabels();
            this.layoutUI();
            this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.scale.width - 20);
            this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.scale.height - 20);
        });

        // Setup Timers
        this.carTimer = this.time.addEvent({
            delay: GAME_CONFIG.CAR_SPAWN_RATE,
            callback: this.spawnCar,
            callbackScope: this,
            loop: true
        });

        this.newtTimer = this.time.addEvent({
            delay: GAME_CONFIG.NEWT_SPAWN_RATE,
            callback: this.spawnNewt,
            callbackScope: this,
            loop: true
        });

        this.spawnNewt();

        // Keyboard
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');

        this.cameras.main.fadeIn(500);
    }

    calculateLayout() {
        const { width, height } = this.scale;

        // Base road height, but ensure it doesn't eat the whole screen on small height phones
        const availableHeight = height - (GAME_CONFIG.MIN_ZONE_HEIGHT * 2);
        this.roadHeight = Math.min(GAME_CONFIG.BASE_ROAD_HEIGHT, availableHeight);

        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / GAME_CONFIG.LANE_COUNT;

        this.forestBoundary = this.roadY;
        this.lakeBoundary = this.roadY + this.roadHeight;

        // Speed scaling relative to standard 1000px width
        this.speedScale = Math.max(0.6, width / 1000);
    }

    drawEnvironment() {
        const { width, height } = this.scale;

        // Background
        this.bgGraphics.clear();
        this.bgGraphics.setDepth(-10);

        // Forest (Top)
        this.bgGraphics.fillGradientStyle(0x0a2a1a, 0x0a2a1a, 0x152a20, 0x152a20);
        this.bgGraphics.fillRect(0, 0, width, this.roadY);

        // Forest Ridge
        this.bgGraphics.fillStyle(0x06150f, 0.9);
        for (let x = 0; x < width + 60; x += 60) {
            this.bgGraphics.fillTriangle(x, this.roadY, x + 30, this.roadY - 20, x + 60, this.roadY);
        }

        // Lake (Bottom)
        this.bgGraphics.fillGradientStyle(0x152535, 0x152535, 0x0a1a2a, 0x0a1a2a);
        this.bgGraphics.fillRect(0, this.lakeBoundary, width, height - this.lakeBoundary);

        // Road
        this.roadGraphics.clear();
        this.roadGraphics.setDepth(-5);
        this.roadGraphics.fillStyle(0x0a0a0a);
        this.roadGraphics.fillRect(0, this.roadY, width, this.roadHeight);

        // Edges
        this.roadGraphics.lineStyle(2, 0xff00ff, 0.5);
        this.roadGraphics.lineBetween(0, this.roadY, width, this.roadY);
        this.roadGraphics.lineBetween(0, this.lakeBoundary, width, this.lakeBoundary);

        // Lanes
        for (let i = 1; i < GAME_CONFIG.LANE_COUNT; i++) {
            const laneY = this.roadY + (i * this.laneHeight);
            for (let lx = 0; lx < width; lx += 60) {
                this.roadGraphics.fillStyle(0xffaa00, 0.6);
                this.roadGraphics.fillRect(lx, laneY - 2, 30, 4);
            }
        }
    }

    createEnvironmentLabels() {
        this.forestLabel = this.add.text(this.scale.width / 2, this.roadY - 30, 'FOREST (SAFE)', {
            fontFamily: 'Outfit, Arial', fontSize: '16px', color: '#88ff88'
        }).setOrigin(0.5).setDepth(-1);

        this.lakeLabel = this.add.text(this.scale.width / 2, this.lakeBoundary + 30, 'LAKE (SAFE)', {
            fontFamily: 'Outfit, Arial', fontSize: '16px', color: '#88ccff'
        }).setOrigin(0.5).setDepth(-1);
    }

    updateLabels() {
        this.forestLabel.setPosition(this.scale.width / 2, this.roadY - 30);
        this.lakeLabel.setPosition(this.scale.width / 2, this.lakeBoundary + 30);
    }

    createPlayer() {
        this.player = this.add.container(this.scale.width / 2, this.scale.height - 100);
        this.player.setDepth(10);

        const g = this.add.graphics();
        // Drawing a simplified volunteer sprite
        g.fillStyle(0x000000, 0.3); g.fillEllipse(0, 20, 25, 8); // Shadow
        g.fillStyle(0x34495e); g.fillRect(-8, 5, 6, 15); g.fillRect(2, 5, 6, 15); // Legs
        g.fillStyle(0xf1c40f); g.fillRoundedRect(-12, -12, 24, 24, 4); // Vest
        g.fillStyle(0xfce4d6); g.fillCircle(0, -18, 8); // Head
        g.fillStyle(0xe74c3c); g.fillEllipse(0, -23, 12, 5); // Hat

        this.player.add(g);
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.size = GAME_CONFIG.PLAYER_SIZE;
        this.player.carrying = [];
        this.player.lives = GAME_CONFIG.PLAYER_LIVES;
        this.player.isInvincible = false;
        this.player.invincibleTimer = 0;
    }

    createWeather() {
        this.weatherState = 'CLEAR';
        this.rainGraphics = this.add.graphics().setDepth(5);
        this.rainDrops = [];
        for (let i = 0; i < 150; i++) {
            this.rainDrops.push({
                x: Math.random() * 2000,
                y: Math.random() * 2000,
                s: 10 + Math.random() * 10
            });
        }
    }

    createHUD() {
        const padding = 20;
        this.livesText = this.add.text(padding, padding, '', { fontSize: '24px' }).setDepth(100);
        this.scoreText = this.add.text(this.scale.width - padding, padding, '', {
            fontFamily: 'Fredoka, Arial', fontSize: '24px', color: '#fff'
        }).setOrigin(1, 0).setDepth(100);

        this.carryingText = this.add.text(this.scale.width / 2, padding, '', {
            fontSize: '18px', color: '#ff00ff'
        }).setOrigin(0.5, 0).setDepth(100);

        this.statsText = this.add.text(padding, this.scale.height - padding, '', {
            fontSize: '14px', color: '#888'
        }).setOrigin(0, 1).setDepth(100);

        this.updateHUD();
    }

    layoutUI() {
        const padding = 20;
        this.scoreText.setPosition(this.scale.width - padding, padding);
        this.carryingText.setPosition(this.scale.width / 2, padding);
        this.statsText.setPosition(padding, this.scale.height - padding);
    }

    updateHUD() {
        let h = '';
        for (let i = 0; i < this.player.lives; i++) h += '❤️';
        for (let i = this.player.lives; i < GAME_CONFIG.PLAYER_LIVES; i++) h += '🖤';
        this.livesText.setText(h);

        this.scoreText.setText(`SCORE: ${Math.floor(this.score)}`);

        const count = this.player.carrying.length;
        this.carryingText.setText(`CARRYING: ${'🦎'.repeat(count) || '[ ]'}`);

        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
    }

    createMobileControls() {
        this.joystick = { active: false, x: 0, y: 0, baseX: 0, baseY: 0 };

        this.joyBase = this.add.circle(0, 0, 50, 0xffffff, 0.1).setStrokeStyle(2, 0x00ffff, 0.5).setVisible(false).setDepth(1000);
        this.joyThumb = this.add.circle(0, 0, 25, 0x00ffff, 0.4).setVisible(false).setDepth(1001);

        this.input.on('pointerdown', (p) => {
            if (p.y < 100) return; // Ignore HUD area
            this.joystick.active = true;
            this.joystick.baseX = p.x;
            this.joystick.baseY = p.y;
            this.joyBase.setPosition(p.x, p.y).setVisible(true);
            this.joyThumb.setPosition(p.x, p.y).setVisible(true);
        });

        this.input.on('pointermove', (p) => {
            if (this.joystick.active) {
                const dx = p.x - this.joystick.baseX;
                const dy = p.y - this.joystick.baseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const max = 40;
                const scale = dist > max ? max / dist : 1;

                this.joyThumb.setPosition(this.joystick.baseX + dx * scale, this.joystick.baseY + dy * scale);
                this.joystick.x = (dx * scale) / max;
                this.joystick.y = (dy * scale) / max;
            }
        });

        this.input.on('pointerup', () => {
            this.joystick.active = false;
            this.joystick.x = 0;
            this.joystick.y = 0;
            this.joyBase.setVisible(false);
            this.joyThumb.setVisible(false);
        });
    }

    update(time, delta) {
        if (this.gameOver || this.paused) return;

        this.updatePlayer(delta);
        this.updateCars(delta);
        this.updateNewts(delta);
        this.updateRain(delta);
        this.checkCollisions();
    }

    updatePlayer(delta) {
        let mx = 0, my = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) mx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown) mx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) my = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown) my = 1;

        if (this.joystick.active) {
            mx = this.joystick.x;
            my = this.joystick.y;
        }

        if (mx !== 0 || my !== 0) {
            const mag = Math.sqrt(mx * mx + my * my);
            this.player.x += (mx / mag) * this.player.speed * (delta / 1000);
            this.player.y += (my / mag) * this.player.speed * (delta / 1000);

            if (mx !== 0) this.player.scaleX = mx > 0 ? 1 : -1;
        }

        this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.scale.width - 20);
        this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.scale.height - 20);

        // Invincibility
        if (this.player.isInvincible) {
            this.player.invincibleTimer -= delta;
            this.player.alpha = (Math.floor(time / 100) % 2 === 0) ? 0.3 : 0.8;
            if (this.player.invincibleTimer <= 0) {
                this.player.isInvincible = false;
                this.player.alpha = 1;
            }
        }
    }

    spawnCar() {
        const lane = Phaser.Math.Between(0, GAME_CONFIG.LANE_COUNT - 1);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = this.roadY + (lane * this.laneHeight) + this.laneHeight / 2;
        const x = dir === 1 ? -100 : this.scale.width + 100;

        const speed = (dir * (150 + Math.random() * 120) * this.difficulty) * this.speedScale;

        const car = this.add.container(x, y);
        const g = this.add.graphics();
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6];
        const color = colors[Phaser.Math.Between(0, colors.length - 1)];

        g.fillStyle(color);
        g.fillRoundedRect(-40, -15, 80, 30, 6);
        g.fillStyle(0x1a1a1a);
        g.fillRect(-15, -12, 40, 24); // Windows
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 35 : -35, 0, 5); // Headlight

        car.add(g);
        car.speed = speed;
        this.cars.add(car);
    }

    updateCars(delta) {
        this.cars.getChildren().forEach(car => {
            car.x += car.speed * (delta / 1000);
            if (car.x < -200 || car.x > this.scale.width + 200) car.destroy();
        });
    }

    spawnNewt() {
        const fromTop = Math.random() < 0.5;
        const x = Phaser.Math.Between(50, this.scale.width - 50);
        const y = fromTop ? Phaser.Math.Between(20, this.forestBoundary - 20) : Phaser.Math.Between(this.lakeBoundary + 20, this.scale.height - 20);

        const newt = this.add.image(x, y, 'newt').setDisplaySize(30, 30);
        newt.dir = fromTop ? 1 : -1;
        newt.destination = fromTop ? 'lake' : 'forest';
        newt.isCarried = false;
        this.newts.add(newt);
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried) {
                newt.y += newt.dir * GAME_CONFIG.NEWT_SPEED * (delta / 1000);
                newt.rotation = (newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.time.now * 0.01) * 0.2;

                // Spontaneous arrival
                if ((newt.dir === 1 && newt.y > this.lakeBoundary + 20) || (newt.dir === -1 && newt.y < this.forestBoundary - 20)) {
                    newt.destroy();
                }
            } else {
                // Follow player
                const idx = this.player.carrying.indexOf(newt);
                newt.x = this.player.x + (idx === 0 ? -10 : 10);
                newt.y = this.player.y - 10;
            }
        });
    }

    updateRain(delta) {
        if (this.weatherState === 'RAINING') {
            this.rainGraphics.clear();
            this.rainGraphics.lineStyle(2, 0xaec2e0, 0.4);
            this.rainDrops.forEach(d => {
                d.y += d.s;
                if (d.y > this.scale.height) { d.y = -20; d.x = Math.random() * this.scale.width; }
                this.rainGraphics.lineBetween(d.x, d.y, d.x, d.y + 10);
            });
        }
        if (Math.random() < 0.001) this.weatherState = this.weatherState === 'CLEAR' ? 'RAINING' : 'CLEAR';
        if (this.weatherState === 'CLEAR') this.rainGraphics.clear();
    }

    checkCollisions() {
        // Player vs Car
        this.cars.getChildren().forEach(car => {
            if (!this.player.isInvincible && Phaser.Math.Distance.Between(this.player.x, this.player.y, car.x, car.y) < 40) {
                this.hitPlayer();
            }
            // Car vs Newt
            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Phaser.Math.Distance.Between(newt.x, newt.y, car.x, car.y) < 30) {
                    this.lost++;
                    newt.destroy();
                    this.updateHUD();
                }
            });
        });

        // Player vs Newt (Pickup)
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && this.player.carrying.length < GAME_CONFIG.MAX_CARRY) {
                if (Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y) < 40) {
                    newt.isCarried = true;
                    this.player.carrying.push(newt);
                    this.updateHUD();
                }
            }
        });

        // Delivery
        if (this.player.carrying.length > 0) {
            const inForest = this.player.y < this.forestBoundary;
            const inLake = this.player.y > this.lakeBoundary;
            if (inForest || inLake) {
                this.player.carrying.forEach(newt => {
                    const success = (newt.destination === 'forest' && inForest) || (newt.destination === 'lake' && inLake);
                    if (success) {
                        this.saved++;
                        this.score += 10 * this.difficulty;
                    }
                    newt.destroy();
                });
                this.player.carrying = [];
                this.updateHUD();
                this.difficulty = Math.min(2.5, 1 + (this.saved * 0.05));
                this.carTimer.delay = GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty;
            }
        }
    }

    hitPlayer() {
        this.player.lives--;
        this.player.isInvincible = true;
        this.player.invincibleTimer = 2000;
        this.cameras.main.shake(200, 0.01);
        this.player.carrying.forEach(n => n.destroy());
        this.player.carrying = [];
        this.updateHUD();

        if (this.player.lives <= 0) {
            this.gameOver = true;
            this.scene.start('GameOverScene', { score: this.score });
        } else {
            this.player.x = this.scale.width / 2;
            this.player.y = this.scale.height - 50;
        }
    }
}

// ===== GAME OVER SCENE =====
class GameOverScene extends Phaser.Scene {
    constructor() { super({ key: 'GameOverScene' }); }
    init(data) { this.finalScore = data.score || 0; }
    create() {
        const { width, height } = this.scale;
        this.add.rectangle(0, 0, width, height, 0x000, 0.8).setOrigin(0);
        this.add.text(width / 2, height * 0.3, 'GAME OVER', { fontSize: '64px', color: '#f06' }).setOrigin(0.5);
        this.add.text(width / 2, height * 0.45, `SCORE: ${Math.floor(this.finalScore)}`, { fontSize: '32px' }).setOrigin(0.5);

        const btn = this.add.text(width / 2, height * 0.7, 'RESTART', {
            fontSize: '32px', color: '#0ff', backgroundColor: '#222', padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive();

        btn.on('pointerdown', () => this.scene.start('GameScene'));

        // Simple name entry
        const nameBtn = this.add.text(width / 2, height * 0.8, 'SUBMIT SCORE', {
            fontSize: '18px', color: '#aaa'
        }).setOrigin(0.5).setInteractive();

        nameBtn.on('pointerdown', () => {
            const name = prompt('Enter your name (max 12 chars):');
            if (name) nameBtn.setText(`SAVED: ${name.substring(0, 12)}`);
        });
    }
}

// ===== PHASER INITIALIZATION =====
const config = {
    type: Phaser.AUTO,
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container',
        width: 1000, // Base width used for coordinate setup
        height: 700  // Base height
    },
    scene: [SplashScene, GameScene, GameOverScene]
};

window.addEventListener('load', () => {
    const game = new Phaser.Game(config);
});
