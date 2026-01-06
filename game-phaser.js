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
    CAR_WIDTH: 90,
    CAR_HEIGHT: 45,

    // Newts
    NEWT_SPEED: 42,
    NEWT_SPAWN_RATE: 2400,
    newt_size: 60,

    // Neon colors for premium vibe
    COLORS: {
        neonPink: '#ff00ff',
        neonCyan: '#00ffff',
        neonGreen: '#00ff80',
        neonYellow: '#ffff00',
        neonOrange: '#ff8000',
        forest: '#041a0f',
        lake: '#040d1a',
        road: '#080808',
        roadLine: '#ffcc33',
    },

    MIN_ZONE_HEIGHT: 80,
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

        if (width === 0 || height === 0) {
            this.time.delayedCall(100, () => this.create());
            return;
        }

        // Dark background first
        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        this.poster = this.add.image(width / 2, height / 2, 'poster');
        this.updatePosterScale();

        this.poster.setAlpha(0);
        this.tweens.add({
            targets: this.poster,
            alpha: 1,
            duration: 1000,
            ease: 'Power2'
        });

        const startText = this.add.text(width / 2, height - 70, 'TAP TO START', {
            fontFamily: 'Fredoka, Arial',
            fontSize: '28px',
            color: '#fff',
            stroke: '#ff00ff',
            strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: '#ff00ff', blur: 15, fill: true }
        }).setOrigin(0.5);

        this.tweens.add({
            targets: startText,
            scale: 1.1,
            alpha: 0.6,
            duration: 800,
            yoyo: true,
            repeat: -1
        });

        this.scale.on('resize', () => {
            const { width, height } = this.scale;
            if (this.poster) {
                this.poster.setPosition(width / 2, height / 2);
                this.updatePosterScale();
            }
            startText.setPosition(width / 2, height - 70);
        });

        this.input.once('pointerdown', () => this.startTransition());
        this.input.keyboard.once('keydown', () => this.startTransition());
    }

    updatePosterScale() {
        if (!this.poster) return;
        const { width, height } = this.scale;
        const scaleX = width / this.poster.width;
        const scaleY = height / this.poster.height;
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
        // State
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.difficulty = 1;
        this.gameOver = false;
        this.isEnding = false;
        this.paused = false;

        this.calculateLayout();

        // Layering Groups
        this.backgroundGroup = this.add.group();
        this.roadGroup = this.add.group();
        this.mainGroup = this.add.group(); // For cars, player, newts
        this.uiGroup = this.add.group();

        this.bgGraphics = this.add.graphics();
        this.roadGraphics = this.add.graphics();
        this.backgroundGroup.add(this.bgGraphics);
        this.roadGroup.add(this.roadGraphics);

        this.drawEnvironment();
        this.createEnvironmentLabels();

        this.cars = this.physics ? this.add.group() : this.add.group();
        this.newts = this.add.group();

        this.createPlayer();
        this.createWeather();
        this.createHUD();
        this.createMobileControls();

        // Global Resize
        this.scale.on('resize', () => {
            this.calculateLayout();
            this.drawEnvironment();
            this.updateLabels();
            this.layoutUI();
            if (this.player) {
                this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.scale.width - 20);
                this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.scale.height - 20);
            }
        });

        // Spawning
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

        // Inputs
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');

        this.physicsInit = true;
        this.cameras.main.fadeIn(500);
    }

    calculateLayout() {
        const { width, height } = this.scale;
        const availableHeight = height - (GAME_CONFIG.MIN_ZONE_HEIGHT * 2);
        this.roadHeight = Math.min(GAME_CONFIG.BASE_ROAD_HEIGHT, availableHeight);
        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / GAME_CONFIG.LANE_COUNT;
        this.forestBoundary = this.roadY;
        this.lakeBoundary = this.roadY + this.roadHeight;
        this.speedScale = Math.max(0.7, width / 1000);
        this.newtSize = GAME_CONFIG.newt_size * (width < 600 ? 1.4 : 1);
    }

    drawEnvironment() {
        const { width, height } = this.scale;
        this.bgGraphics.clear();
        this.bgGraphics.setDepth(-20);

        // Forest
        this.bgGraphics.fillGradientStyle(0x041a0f, 0x041a0f, 0x0a2a1a, 0x0a2a1a);
        this.bgGraphics.fillRect(0, 0, width, this.roadY);

        // Forest Detail (subtle triangles)
        this.bgGraphics.fillStyle(0x020d08, 0.8);
        for (let x = 0; x < width + 100; x += 80) {
            this.bgGraphics.fillTriangle(x, this.roadY, x + 40, this.roadY - 25, x + 80, this.roadY);
        }

        // Lake
        this.bgGraphics.fillGradientStyle(0x0a1a2a, 0x0a1a2a, 0x040d1a, 0x040d1a);
        this.bgGraphics.fillRect(0, this.lakeBoundary, width, height - this.lakeBoundary);

        // Lake Ripples (subtle lines)
        this.bgGraphics.lineStyle(2, 0x00ffff, 0.05);
        for (let y = this.lakeBoundary + 20; y < height; y += 15) {
            this.bgGraphics.beginPath();
            this.bgGraphics.moveTo(0, y);
            this.bgGraphics.lineTo(width, y + Math.sin(y) * 10);
            this.bgGraphics.strokePath();
        }

        // Road
        this.roadGraphics.clear();
        this.roadGraphics.setDepth(-10);
        this.roadGraphics.fillStyle(0x080808);
        this.roadGraphics.fillRect(0, this.roadY, width, this.roadHeight);

        // Cyan Neon Edges
        this.roadGraphics.lineStyle(3, 0x00ffff, 0.3);
        this.roadGraphics.lineBetween(0, this.roadY, width, this.roadY);
        this.roadGraphics.lineBetween(0, this.lakeBoundary, width, this.lakeBoundary);

        // Lane Stickers
        for (let i = 1; i < GAME_COUNT_LANE_COUNT_CHECK(); i++) {
            const laneY = this.roadY + (i * this.laneHeight);
            for (let lx = 0; lx < width; lx += 80) {
                this.roadGraphics.fillStyle(0xffcc33, 0.5);
                this.roadGraphics.fillRoundedRect(lx, laneY - 2, 40, 4, 2);
            }
        }

        function GAME_COUNT_LANE_COUNT_CHECK() { return GAME_CONFIG.LANE_COUNT; }
    }

    createEnvironmentLabels() {
        this.forestLabel = this.add.text(this.scale.width / 2, this.roadY - 40, 'SAFE FOREST', {
            fontFamily: 'Outfit, Arial', fontSize: '18px', color: '#00ff80', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(-1);

        this.lakeLabel = this.add.text(this.scale.width / 2, this.lakeBoundary + 40, 'SAFE LAKE', {
            fontFamily: 'Outfit, Arial', fontSize: '18px', color: '#00ffff', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(-1);
    }

    updateLabels() {
        if (this.forestLabel) this.forestLabel.setPosition(this.scale.width / 2, this.roadY - 40);
        if (this.lakeLabel) this.lakeLabel.setPosition(this.scale.width / 2, this.lakeBoundary + 40);
    }

    createPlayer() {
        this.player = this.add.container(this.scale.width / 2, this.scale.height - 100);
        this.player.setDepth(50);

        const g = this.add.graphics();

        // Shadow
        g.fillStyle(0x000000, 0.4);
        g.fillEllipse(0, 20, 28, 10);

        // Character Body (Volunteer)
        // High-vis vest with detail
        g.fillStyle(0x333333); // Pants
        g.fillRect(-10, 5, 8, 16); g.fillRect(2, 5, 8, 16);

        g.fillStyle(0xf1c40f); // High-vis yellow
        g.fillRoundedRect(-15, -15, 30, 30, 5);

        // Reflective Stripes (Cyan glow)
        g.fillStyle(0x00ffff, 0.8);
        g.fillRect(-15, -5, 30, 4);
        g.fillRect(-15, 5, 30, 4);

        // Head
        g.fillStyle(0xfce4d6);
        g.fillCircle(0, -22, 11);

        // Eyes (looking forward)
        g.fillStyle(0x000000);
        g.fillCircle(-4, -24, 2);
        g.fillCircle(4, -24, 2);

        // Red Helmet
        g.fillStyle(0xe74c3c);
        g.fillEllipse(0, -30, 16, 8);

        this.player.add(g);
        this.player.graphics = g;
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.size = GAME_CONFIG.PLAYER_SIZE;
        this.player.carrying = [];
        this.player.lives = GAME_CONFIG.PLAYER_LIVES;
        this.player.isInvincible = false;
        this.player.invincibleTimer = 0;

        // Walk animation variables
        this.walkTimer = 0;
    }

    createWeather() {
        this.weatherState = 'CLEAR';
        this.rainGraphics = this.add.graphics().setDepth(100);
        this.rainDrops = [];
        for (let i = 0; i < 200; i++) {
            this.rainDrops.push({
                x: Math.random() * 1500,
                y: Math.random() * 1000,
                s: 12 + Math.random() * 10,
                len: 15 + Math.random() * 10
            });
        }
    }

    createHUD() {
        const padding = 25;
        this.livesText = this.add.text(padding, padding, '', {
            fontFamily: 'Outfit, Arial', fontSize: '28px'
        }).setDepth(200);

        this.scoreText = this.add.text(this.scale.width - padding, padding, '', {
            fontFamily: 'Fredoka, Arial', fontSize: '26px', color: '#fff',
            stroke: '#ff00ff', strokeThickness: 2,
            shadow: { offsetX: 0, offsetY: 0, color: '#ff00ff', blur: 10, fill: true }
        }).setOrigin(1, 0).setDepth(200);

        this.carryingText = this.add.text(this.scale.width / 2, padding, '', {
            fontFamily: 'Fredoka, Arial', fontSize: '22px', color: '#00ffff',
            stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5, 0).setDepth(200);

        this.statsText = this.add.text(padding, this.scale.height - padding, '', {
            fontFamily: 'Outfit, Arial', fontSize: '15px', color: '#aaa'
        }).setOrigin(0, 1).setDepth(200);

        this.updateHUD();
    }

    layoutUI() {
        if (!this.scoreText) return;
        const padding = 25;
        this.scoreText.setPosition(this.scale.width - padding, padding);
        this.carryingText.setPosition(this.scale.width / 2, padding);
        this.statsText.setPosition(padding, this.scale.height - padding);
    }

    updateHUD() {
        if (this.isEnding) return;
        let h = '';
        for (let i = 0; i < this.player.lives; i++) h += '❤️';
        for (let i = this.player.lives; i < GAME_CONFIG.PLAYER_LIVES; i++) h += '🖤';
        this.livesText.setText(h);
        this.scoreText.setText(`SCORE: ${Math.floor(this.score)}`);

        const count = this.player.carrying.length;
        let cText = '[ ]';
        if (count === 1) cText = '[X]';
        else if (count === 2) cText = '[X][X]';
        this.carryingText.setText(`CARRYING: ${cText}`);
        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
    }

    createMobileControls() {
        this.joystick = { active: false, x: 0, y: 0, baseX: 0, baseY: 0 };

        this.joyBase = this.add.circle(0, 0, 60, 0xffffff, 0.05).setStrokeStyle(3, 0x00ffff, 0.4).setVisible(false).setDepth(1000);
        this.joyThumb = this.add.circle(0, 0, 30, 0x00ffff, 0.3).setStrokeStyle(1, 0xffffff, 0.3).setVisible(false).setDepth(1001);

        this.input.on('pointerdown', (p) => {
            if (this.isEnding) return;
            if (p.y < 120) return;
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
                const max = 50;
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
        if (this.isEnding || this.paused) return;

        this.updatePlayer(time, delta);
        this.updateCars(delta);
        this.updateNewts(delta);
        this.updateRain(delta);
        this.checkCollisions();
    }

    updatePlayer(time, delta) {
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

            // Wobble walk animation
            this.walkTimer += delta * 0.012;
            this.player.graphics.y = Math.sin(this.walkTimer) * 4;
            this.player.graphics.rotation = Math.sin(this.walkTimer * 0.5) * 0.08;
        } else {
            // Idle breath
            this.player.graphics.y = Math.sin(time * 0.003) * 2;
            this.player.graphics.rotation = 0;
        }

        this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.scale.width - 20);
        this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.scale.height - 20);

        // Invincibility flicker
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
        if (this.isEnding) return;
        const lane = Phaser.Math.Between(0, GAME_CONFIG.LANE_COUNT - 1);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = this.roadY + (lane * this.laneHeight) + this.laneHeight / 2;
        const x = dir === 1 ? -150 : this.scale.width + 150;

        const speed = (dir * (160 + Math.random() * 100) * this.difficulty) * this.speedScale;

        const car = this.add.container(x, y);
        car.setDepth(40);

        const g = this.add.graphics();

        // Car Body Colors (Neonish)
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xff8c00, 0x00ffff];
        const primaryColor = colors[Phaser.Math.Between(0, colors.length - 1)];

        // Shadow
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 22, 90, 15);

        // Body
        g.fillStyle(primaryColor);
        g.fillRoundedRect(-45, -18, 90, 36, 8);

        // Roof
        g.fillStyle(0x000000, 0.2);
        g.fillRoundedRect(-20, -18, 45, 36, 6);

        // Windows
        g.fillStyle(0x1a1a1a);
        g.fillRect(-12, -14, 18, 28);
        g.fillRect(10, -14, 18, 28);

        // Glare on window
        g.fillStyle(0xffffff, 0.1);
        g.fillRect(-8, -14, 5, 28);

        // Headlights
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 40 : -40, 0, 6);

        // Fake Beam Glow
        g.fillStyle(0xffffcc, 0.15);
        const beamX = dir === 1 ? 40 : -40;
        g.beginPath();
        g.moveTo(beamX, -10);
        g.lineTo(beamX + (dir * 120), -40);
        g.lineTo(beamX + (dir * 120), 40);
        g.lineTo(beamX, 10);
        g.fillPath();

        // Wheels
        g.fillStyle(0x111111);
        g.fillCircle(-25, 18, 8);
        g.fillCircle(25, 18, 8);

        car.add(g);
        car.speed = speed;
        this.cars.add(car);
    }

    updateCars(delta) {
        this.cars.getChildren().forEach(car => {
            car.x += car.speed * (delta / 1000);
            if (car.x < -300 || car.x > this.scale.width + 300) car.destroy();
        });
    }

    spawnNewt() {
        if (this.isEnding) return;
        const fromTop = Math.random() < 0.5;
        const x = Phaser.Math.Between(50, this.scale.width - 50);
        const y = fromTop ? Phaser.Math.Between(20, this.forestBoundary - 20) : Phaser.Math.Between(this.lakeBoundary + 20, this.scale.height - 20);

        const newt = this.add.image(x, y, 'newt').setDisplaySize(this.newtSize, this.newtSize);
        newt.setDepth(30);
        newt.dir = fromTop ? 1 : -1;
        newt.destination = fromTop ? 'lake' : 'forest';
        newt.isCarried = false;
        this.newts.add(newt);
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried) {
                newt.y += newt.dir * GAME_CONFIG.NEWT_SPEED * (delta / 1000);
                newt.rotation = (newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.time.now * 0.01) * 0.25;
                if ((newt.dir === 1 && newt.y > this.lakeBoundary + 25) || (newt.dir === -1 && newt.y < this.forestBoundary - 25)) {
                    newt.destroy();
                }
            } else {
                const idx = this.player.carrying.indexOf(newt);
                newt.x = this.player.x + (idx === 0 ? -20 : 20);
                newt.y = this.player.y - 12;
                newt.setDepth(55);
                newt.rotation = Math.sin(this.time.now * 0.015) * 0.2;
                newt.setScale((this.newtSize * 0.75) / newt.width);
            }
        });
    }

    updateRain(delta) {
        if (this.weatherState === 'RAINING') {
            this.rainGraphics.clear();
            this.rainGraphics.lineStyle(1.5, 0x00ffff, 0.3);
            this.rainDrops.forEach(d => {
                d.y += d.s;
                if (d.y > this.scale.height) { d.y = -40; d.x = Math.random() * this.scale.width; }
                this.rainGraphics.lineBetween(d.x, d.y, d.x, d.y + d.len);
            });
        }
        if (Math.random() < 0.0008) {
            this.weatherState = this.weatherState === 'CLEAR' ? 'RAINING' : 'CLEAR';
            if (this.weatherState === 'CLEAR') this.rainGraphics.clear();
        }
    }

    checkCollisions() {
        if (this.isEnding) return;

        // Player vs Car
        this.cars.getChildren().forEach(car => {
            if (!this.player.isInvincible && Phaser.Math.Distance.Between(this.player.x, this.player.y, car.x, car.y) < 45) {
                this.hitPlayer();
            }
            // Car vs Newt
            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Phaser.Math.Distance.Between(newt.x, newt.y, car.x, car.y) < 40) {
                    this.lost++;
                    this.createSplatter(newt.x, newt.y);
                    newt.destroy();
                    this.updateHUD();
                }
            });
        });

        // Pickup
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && this.player.carrying.length < GAME_CONFIG.MAX_CARRY) {
                if (Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y) < 50) {
                    newt.isCarried = true;
                    this.player.carrying.push(newt);
                    this.updateHUD();
                }
            }
        });

        // Delivery
        if (this.player.carrying.length > 0) {
            const inF = this.player.y < this.forestBoundary;
            const inL = this.player.y > this.lakeBoundary;
            if (inF || inL) {
                this.player.carrying.forEach(newt => {
                    const success = (newt.destination === 'forest' && inF) || (newt.destination === 'lake' && inL);
                    if (success) {
                        this.saved++;
                        this.score += 15 * this.difficulty;
                        this.createSuccessEffect(newt.x, newt.y);
                    } else {
                        // Just drop them if it's the wrong side (or they die?)
                        // For now we count as drop but no points
                    }
                    newt.destroy();
                });
                this.player.carrying = [];
                this.updateHUD();
                this.difficulty = Math.min(2.5, 1 + (this.saved * 0.04));
                this.carTimer.delay = Math.max(800, GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty);
            }
        }
    }

    createSplatter(x, y) {
        for (let i = 0; i < 12; i++) {
            const p = this.add.circle(x, y, Phaser.Math.Between(2, 6), 0xff3333, 0.8);
            this.tweens.add({
                targets: p,
                x: x + Phaser.Math.Between(-50, 50),
                y: y + Phaser.Math.Between(-50, 50),
                alpha: 0,
                scale: 0.2,
                duration: 600 + Math.random() * 400,
                onComplete: () => p.destroy()
            });
        }
    }

    createSuccessEffect(x, y) {
        for (let i = 0; i < 15; i++) {
            const p = this.add.star(x, y, 5, 4, 8, 0x00ff88);
            p.setAlpha(0.8);
            this.tweens.add({
                targets: p,
                x: x + Phaser.Math.Between(-60, 60),
                y: y - Phaser.Math.Between(40, 100),
                rotation: 2,
                alpha: 0,
                scale: 0.5,
                duration: 800 + Math.random() * 500,
                onComplete: () => p.destroy()
            });
        }
    }

    hitPlayer() {
        if (this.isEnding) return;

        this.player.lives--;
        this.player.isInvincible = true;
        this.player.invincibleTimer = GAME_CONFIG.PLAYER_INVINCIBLE_TIME;

        this.cameras.main.shake(300, 0.02);
        this.cameras.main.flash(200, 255, 0, 0, 0.4);

        // Clear carried newts
        this.player.carrying.forEach(n => { if (n) n.destroy(); });
        this.player.carrying = [];
        this.updateHUD();

        if (this.player.lives <= 0) {
            this.isEnding = true;
            this.time.delayedCall(500, () => {
                this.scene.start('GameOverScene', { score: this.score });
            });
        } else {
            // Respawn position
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
        this.add.rectangle(0, 0, width, height, 0x000, 0.9).setOrigin(0);

        this.add.text(width / 2, height * 0.2, 'MISSION ENDED', {
            fontFamily: 'Fredoka, Arial', fontSize: '60px', color: '#ff0066', fontStyle: 'bold',
            shadow: { offsetX: 0, offsetY: 0, color: '#ff0066', blur: 20, fill: true }
        }).setOrigin(0.5);

        this.add.text(width / 2, height * 0.4, `FINAL SCORE: ${Math.floor(this.finalScore)}`, {
            fontFamily: 'Outfit, Arial', fontSize: '38px', color: '#00ffff'
        }).setOrigin(0.5);

        const btn = this.add.text(width / 2, height * 0.7, 'RETRY MISSION', {
            fontFamily: 'Fredoka, Arial', fontSize: '32px', color: '#fff',
            backgroundColor: '#ff00ff', padding: { x: 30, y: 15 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        btn.on('pointerdown', () => this.scene.start('GameScene'));

        this.tweens.add({
            targets: btn,
            scale: 1.05,
            duration: 600,
            yoyo: true,
            repeat: -1
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
        width: 1000,
        height: 700
    },
    physics: {
        default: 'arcade',
        arcade: { debug: false }
    },
    render: {
        pixelArt: false,
        antialias: true
    },
    scene: [SplashScene, GameScene, GameOverScene]
};
window.addEventListener('load', () => { new Phaser.Game(config); });
