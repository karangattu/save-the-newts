/* ===================================
   SAVE THE NEWTS - ATARI EDITION
   Retro 8-Bit Mobile Game
   =================================== */

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    // Reference dimensions (used for logic, rendered in pixel perfect scaling)
    BASE_WIDTH: 800,
    BASE_HEIGHT: 600,

    PLAYER_SPEED: 280,
    PLAYER_LIVES: 3,

    // Cars
    CAR_SPAWN_RATE: 1600,
    CAR_MIN_SPEED: 180,
    CAR_MAX_SPEED: 320,

    // Newts
    NEWT_SPAWN_RATE: 2000,
    NEWT_SPEED: 50,

    // Retro Palette
    COLORS: {
        bg: '#000000',
        text: '#00ff00',
        road: '#000000',
        safe: '#002200', // Deep green for safe zones
        safeText: '#00cc00',
        player: '#ffff00', // Yellow
        newt: '#ff00ff',   // Magenta
        car1: '#00ffff',   // Cyan
        car2: '#ff0000',   // Red
        car3: '#0000ff',   // Blue
        white: '#ffffff'
    },
};

// ===== PIXEL ART DATA =====
// 1 = primary, 0 = transparent
const SPRITES = {
    player: [
        '..1111..',
        '.111111.',
        '.111111.',
        '..1111..',
        '.111111.',
        '11111111',
        '1.1111.1',
        '..1..1..'
    ],
    newt: [
        '..1..',
        '11111',
        '.111.',
        '.111.',
        '1.1.1'
    ],
    car: [
        '..11111111..',
        '.1111111111.',
        '111111111111',
        '111111111111',
        '010000010000' // 0 represents wheels in a different way in logic
    ]
};

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() { super({ key: 'SplashScene' }); }

    create() {
        const { width, height } = this.scale;

        // Retro Background
        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        // Scanlines
        this.createScanlines();

        // Title
        const title = this.add.text(width / 2, height * 0.4, 'SAVE THE\nNEWTS', {
            fontFamily: '"Courier New", Courier, monospace',
            fontSize: '48px',
            fontStyle: 'bold',
            color: '#00ff00',
            align: 'center'
        }).setOrigin(0.5);

        // Blinking Text
        const startText = this.add.text(width / 2, height * 0.7, 'INSERT COIN\n(TAP TO START)', {
            fontFamily: '"Courier New", Courier, monospace',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: startText,
            alpha: 0,
            duration: 500,
            yoyo: true,
            repeat: -1,
            hold: 200
        });

        this.input.once('pointerdown', () => this.scene.start('GameScene'));
    }

    createScanlines() {
        const { width, height } = this.scale;
        const g = this.add.graphics();
        g.lineStyle(2, 0x00ff00, 0.1);
        for (let y = 0; y < height; y += 4) {
            g.lineBetween(0, y, width, y);
        }
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    create() {
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.lives = GAME_CONFIG.PLAYER_LIVES;
        this.gameOver = false;
        this.isCarrying = 0;

        // Texture Generation (Run once)
        if (!this.textures.exists('pixel_player')) this.generateTextures();

        this.calculateLayout();

        // Groups
        this.cars = this.add.group();
        this.newts = this.add.group();

        // Visuals
        this.createEnvironment();
        this.createPlayer();
        this.createHUD();
        this.createControls();
        this.createScanlines();

        // Resize Handler
        this.scale.on('resize', () => {
            this.scene.restart(); // Simplest way to handle layout changes for arcade style
        });

        // Loopers
        this.time.addEvent({ delay: GAME_CONFIG.CAR_SPAWN_RATE, callback: this.spawnCar, callbackScope: this, loop: true });
        this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });

        // Initial entities
        this.spawnNewt();
    }

    generateTextures() {
        // Simple scaling helper
        const pixelScale = 4; // Makes pixels big and chunky

        const createTex = (key, rows, color) => {
            const canvas = document.createElement('canvas');
            const w = rows[0].length;
            const h = rows.length;
            canvas.width = w * pixelScale;
            canvas.height = h * pixelScale;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = color;

            rows.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] === '1') {
                        ctx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
                    }
                }
            });
            this.textures.addCanvas(key, canvas);
        };

        createTex('pixel_player', SPRITES.player, GAME_CONFIG.COLORS.player);
        createTex('pixel_newt', SPRITES.newt, GAME_CONFIG.COLORS.newt);

        // Cars (Create a generic white one we can tint)
        createTex('pixel_car', SPRITES.car, '#ffffff');
    }

    calculateLayout() {
        const { width, height } = this.scale;

        // Retro sizing logic
        this.roadHeight = Math.min(height * 0.6, 500);
        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / 4;

        this.topSafe = this.roadY;
        this.botSafe = this.roadY + this.roadHeight;
    }

    createEnvironment() {
        const { width, height } = this.scale;
        const g = this.add.graphics();

        // Safe Zones (Solid Colors)
        g.fillStyle(0x002200);
        g.fillRect(0, 0, width, this.topSafe);
        g.fillRect(0, this.botSafe, width, height - this.botSafe);

        // Road
        g.fillStyle(0x000000);
        g.fillRect(0, this.roadY, width, this.roadHeight);

        // Lane Markers (Dashed Lines)
        g.fillStyle(0xffffff, 0.5);
        for (let i = 1; i < 4; i++) {
            const y = this.roadY + i * this.laneHeight;
            for (let x = 20; x < width; x += 60) {
                g.fillRect(x, y - 2, 30, 4);
            }
        }

        // Labels
        const style = { fontFamily: '"Courier New", Courier, monospace', fontSize: '20px', color: '#00ff00' };
        this.add.text(width / 2, this.topSafe - 30, 'FOREST', style).setOrigin(0.5);
        this.add.text(width / 2, this.botSafe + 30, 'LAKE', style).setOrigin(0.5);
    }

    createScanlines() {
        const { width, height } = this.scale;
        // Overlay texture
        const texture = this.add.graphics().setDepth(1000);
        texture.fillStyle(0x000000, 0.1); // Darken every other line
        for (let y = 0; y < height; y += 4) {
            texture.fillRect(0, y, width, 2);
        }
    }

    createPlayer() {
        const { width, height } = this.scale;
        // Player is just a sprite now
        this.player = this.physics.add.sprite(width / 2, this.botSafe + 50, 'pixel_player');
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(10);
        this.player.setScale(1.5); // Chunky

        // Custom props
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.carried = []; // Array of newt sprites
        this.player.invincible = false;
    }

    createHUD() {
        const style = { fontFamily: '"Courier New", Courier, monospace', fontSize: '24px', color: '#ffffff' };
        this.scoreText = this.add.text(20, 20, 'SCORE: 0', style).setDepth(200);
        this.livesText = this.add.text(20, 60, 'LIVES: 3', style).setDepth(200);
        this.statusText = this.add.text(this.scale.width - 20, 20, 'CARRY: [ ]', style).setOrigin(1, 0).setDepth(200);
    }

    updateHUD() {
        this.scoreText.setText(`SCORE: ${this.score}`);
        this.livesText.setText(`LIVES: ${this.lives}`);

        let carryStr = '[ ]';
        if (this.player.carried.length === 1) carryStr = '[X]';
        if (this.player.carried.length === 2) carryStr = '[X][X]';
        this.statusText.setText(`CARRY: ${carryStr}`);
    }

    createControls() {
        // Touch Anywhere Joystick
        this.inputData = { active: false, x: 0, y: 0, sx: 0, sy: 0 };
        this.cursors = this.input.keyboard.createCursorKeys();

        this.input.on('pointerdown', p => {
            this.inputData.active = true;
            this.inputData.sx = p.x;
            this.inputData.sy = p.y;
        });

        this.input.on('pointermove', p => {
            if (!this.inputData.active) return;
            const dx = p.x - this.inputData.sx;
            const dy = p.y - this.inputData.sy;
            // Normalize
            const dist = Math.sqrt(dx * dx + dy * dy);
            const max = 40;
            const clamped = Math.min(dist, max);
            this.inputData.x = (dx / dist) * (clamped / max) || 0;
            this.inputData.y = (dy / dist) * (clamped / max) || 0;
        });

        this.input.on('pointerup', () => {
            this.inputData.active = false;
            this.inputData.x = 0;
            this.inputData.y = 0;
        });
    }

    update(time, delta) {
        if (this.gameOver) return;

        // Player Move
        let dx = 0, dy = 0;

        // Keyboard
        if (this.cursors.left.isDown) dx = -1;
        else if (this.cursors.right.isDown) dx = 1;
        if (this.cursors.up.isDown) dy = -1;
        else if (this.cursors.down.isDown) dy = 1;

        // Touch Override
        if (this.inputData.active) {
            dx = this.inputData.x;
            dy = this.inputData.y;
        }

        if (dx !== 0 || dy !== 0) {
            this.player.setVelocity(dx * this.player.speed, dy * this.player.speed);
        } else {
            this.player.setVelocity(0, 0);
        }

        // Clamp manually if needed (physics world bounds handles mostly)
        // Update carried newt positions
        this.player.carried.forEach((n, i) => {
            n.x = this.player.x + (i === 0 ? -15 : 15);
            n.y = this.player.y - 15;
        });

        // Loop Entities
        this.cars.getChildren().forEach(c => {
            if (c.active) {
                if (c.x < -100 || c.x > this.scale.width + 100) c.destroy();
            }
        });

        this.newts.getChildren().forEach(n => {
            if (n.active && !n.isCarried) {
                // Move towards destination
                n.y += n.dir * (GAME_CONFIG.NEWT_SPEED * delta / 1000);
                if (n.y < this.topSafe || n.y > this.botSafe + 50) {
                    if (!this.physics.overlap(this.player, n)) n.destroy(); // Only destroy if not being touched
                }
            }
        });
    }

    spawnCar() {
        if (this.gameOver) return;
        const lane = Phaser.Math.Between(0, 3);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = this.roadY + (lane * this.laneHeight) + (this.laneHeight / 2);
        const x = dir === 1 ? -50 : this.scale.width + 50;

        const car = this.physics.add.sprite(x, y, 'pixel_car');
        car.setScale(2.5); // Big blocky cars
        car.setVelocityX(dir * Phaser.Math.Between(GAME_CONFIG.CAR_MIN_SPEED, GAME_CONFIG.CAR_MAX_SPEED));

        // Color tint
        const tints = [0x00ffff, 0xff0000, 0x0000ff, 0xffff00];
        car.setTint(tints[Phaser.Math.Between(0, 3)]);

        if (dir === -1) car.flipX = true;
        this.cars.add(car);

        // Add overlap here to avoid calculating in update loop (performance)
        this.physics.add.overlap(this.player, car, this.hitPlayer, null, this);
        this.physics.add.overlap(this.newts, car, this.splatterNewt, null, this);
    }

    spawnNewt() {
        if (this.gameOver) return;
        const fromTop = Math.random() < 0.5;
        const x = Phaser.Math.Between(50, this.scale.width - 50);
        const y = fromTop ? this.topSafe - 20 : this.botSafe + 20;

        const newt = this.physics.add.sprite(x, y, 'pixel_newt');
        newt.setScale(2);
        newt.dir = fromTop ? 1 : -1;
        newt.dest = fromTop ? 'LAKE' : 'FOREST';
        newt.isCarried = false;

        this.newts.add(newt);

        this.physics.add.overlap(this.player, newt, this.pickupNewt, null, this);
    }

    hitPlayer(player, car) {
        if (this.player.invincible) return;

        // CRASH FIX: Simple logic, no complex camera shakes or loops
        this.lives--;
        this.updateHUD();

        // Lose newts
        this.player.carried.forEach(n => n.destroy());
        this.player.carried = [];
        this.updateHUD();

        // Invincibility
        this.player.invincible = true;
        this.player.setAlpha(0.5);
        this.time.delayedCall(2000, () => {
            this.player.invincible = false;
            this.player.setAlpha(1);
        });

        // Push back slightly
        player.y += (player.y < car.y ? -50 : 50);

        if (this.lives <= 0) {
            this.gameOver = true;
            this.physics.pause();
            this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER', {
                fontFamily: '"Courier New", monospace', fontSize: '60px', color: '#ff0000', backgroundColor: '#000000'
            }).setOrigin(0.5).setDepth(300);

            this.time.delayedCall(2000, () => this.scene.start('SplashScene'));
        }
    }

    pickupNewt(player, newt) {
        if (newt.isCarried) return;
        if (this.player.carried.length >= 2) return;

        newt.isCarried = true;
        newt.body.enable = false; // Stop physics
        this.player.carried.push(newt);
        this.updateHUD();
    }

    splatterNewt(newt, car) {
        if (newt.isCarried) return;
        // Simple pixel splatter
        const p = this.add.rectangle(newt.x, newt.y, 40, 10, 0xff00ff);
        this.tweens.add({ targets: p, scaleX: 2, scaleY: 0.2, alpha: 0, duration: 500, onComplete: () => p.destroy() });
        newt.destroy();
        this.lost++;
        this.updateHUD();
    }

    // Checking delivery manually in update is messy, let's use a zone check 
    // Actually, just check Y position of player
}

// Attach delivery check to update loop since it depends on player pos
// Note: We extended the class above but missed this, adding it prototype style or just inside update
GameScene.prototype.update = function (time, delta) {
    if (this.gameOver) return;

    // ... Copied movement logic from above ...
    // Note: To avoid duplication error in this WriteToFile, I will put the FULL update logic here inside the class correctly
};

// Re-defining the FULL update method correctly just to be safe and clean:
GameScene.prototype.update = function (time, delta) {
    if (this.gameOver) return;

    // Player Move
    let dx = 0, dy = 0;
    if (this.cursors.left.isDown) dx = -1; else if (this.cursors.right.isDown) dx = 1;
    if (this.cursors.up.isDown) dy = -1; else if (this.cursors.down.isDown) dy = 1;

    if (this.inputData.active) { dx = this.inputData.x; dy = this.inputData.y; }

    if (dx !== 0 || dy !== 0) this.player.setVelocity(dx * this.player.speed, dy * this.player.speed);
    else this.player.setVelocity(0, 0);

    // Update Carried Positions
    this.player.carried.forEach((n, i) => {
        n.x = this.player.x + (i === 0 ? -20 : 20); // Wider spacing for chonky pixels
        n.y = this.player.y - 20;
    });

    // Delivery Logic
    if (this.player.carried.length > 0) {
        const inTop = this.player.y < this.topSafe;
        const inBot = this.player.y > this.botSafe;

        if (inTop || inBot) {
            const delivered = [];
            this.player.carried = this.player.carried.filter(n => {
                const correct = (n.dest === 'FOREST' && inTop) || (n.dest === 'LAKE' && inBot);
                if (correct) {
                    this.score += 100;
                    this.saved++;
                    n.destroy();
                    delivered.push(true);
                    return false; // Remove from array
                }
                return true; // Keep
            });
            if (delivered.length > 0) this.updateHUD();
        }
    }
}


// ===== PHASER INIT =====
const config = {
    type: Phaser.AUTO,
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container',
        width: 800,
        height: 600
    },
    physics: {
        default: 'arcade',
        arcade: { debug: false }
    },
    render: { pixelArt: true }, // IMPORTANT for retro look
    scene: [SplashScene, GameScene]
};

window.addEventListener('load', () => new Phaser.Game(config));
