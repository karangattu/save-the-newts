/* ===================================
   SAVE THE NEWTS
   Alma Bridge Road - Help Newts Cross!
   =================================== */

// ===== SUPABASE CONFIG =====
const supabaseUrl = window.SUPABASE_URL;
const supabaseKey = window.SUPABASE_ANON_KEY;
let supabaseClient = null;

if (supabaseUrl && supabaseKey && window.supabase) {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    console.log("Supabase initialized for leaderboard");
} else {
    console.log("Supabase not configured. Leaderboard disabled.");
}

async function submitScore(name, score) {
    if (!supabaseClient) return false;
    try {
        const { error } = await supabaseClient
            .from('leaderboard')
            .insert([{ player_name: name, score: score }]);
        if (error) {
            console.error("Error submitting score:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.error("Exception submitting score:", e);
        return false;
    }
}

async function getLeaderboard() {
    if (!supabaseClient) return [];
    try {
        const { data, error } = await supabaseClient
            .from('leaderboard')
            .select('*')
            .order('score', { ascending: false })
            .limit(5);
        if (error) return [];
        return data || [];
    } catch (e) {
        return [];
    }
}

// ===== ICON UTILITY (Lucide Style) =====
const Icons = {
    drawHeart(g, x, y, size = 20, color = 0xff3366, stroke = 2) {
        const s = size / 2;
        // Draw heart using two circles and a triangle
        g.fillStyle(color);
        g.fillCircle(x - s * 0.3, y - s * 0.1, s * 0.45);
        g.fillCircle(x + s * 0.3, y - s * 0.1, s * 0.45);
        g.fillTriangle(x - s * 0.7, y, x + s * 0.7, y, x, y + s * 0.8);
    },
    drawMapPin(g, x, y, size = 20, color = 0xffffff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.arc(x, y - s * 0.3, s * 0.7, Math.PI * 0.8, Math.PI * 0.2, true);
        g.lineTo(x, y + s);
        g.closePath();
        g.strokePath();
        g.strokeCircle(x, y - s * 0.3, s * 0.25);
    },
    drawTrophy(g, x, y, size = 24, color = 0xffcc00, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Cup
        g.beginPath();
        g.moveTo(x - s * 0.6, y - s);
        g.lineTo(x + s * 0.6, y - s);
        g.lineTo(x + s * 0.5, y);
        g.arc(x, y, s * 0.5, 0, Math.PI, false);
        g.lineTo(x - s * 0.5, y);
        g.closePath();
        g.strokePath();
        // Base
        g.lineBetween(x, y + s * 0.5, x, y + s * 0.8);
        g.lineBetween(x - s * 0.4, y + s * 0.8, x + s * 0.4, y + s * 0.8);
        // Handles
        g.beginPath();
        g.arc(x - s * 0.6, y - s * 0.4, s * 0.3, Math.PI * 0.5, Math.PI * 1.5, false);
        g.strokePath();
        g.beginPath();
        g.arc(x + s * 0.6, y - s * 0.4, s * 0.3, Math.PI * 1.5, Math.PI * 0.5, false);
        g.strokePath();
    },
    drawSend(g, x, y, size = 20, color = 0x00ff00, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.moveTo(x + s, y - s);
        g.lineTo(x - s * 0.8, y - s * 0.2);
        g.lineTo(x - s * 0.2, y + s * 0.2);
        g.closePath();
        g.strokePath();
        g.lineBetween(x + s, y - s, x - s * 0.2, y + s * 0.2);
    },
    drawRefresh(g, x, y, size = 20, color = 0x00ffff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.arc(x, y, s * 0.8, Math.PI * 0.2, Math.PI * 1.7, false);
        g.strokePath();
        // Arrow head
        const ax = x + Math.cos(Math.PI * 0.2) * s * 0.8;
        const ay = y + Math.sin(Math.PI * 0.2) * s * 0.8;
        g.lineBetween(ax, ay, ax - 5, ay);
        g.lineBetween(ax, ay, ax, ay - 5);
    },
    drawExternalLink(g, x, y, size = 18, color = 0x00ff88, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.strokeRect(x - s, y - s * 0.4, s * 1.4, s * 1.4);
        g.lineBetween(x, y - s, x + s, y - s * 1);
        g.lineBetween(x + s, y - s, x + s, y - s * 0.4);
        g.lineBetween(x + s, y - s, x + s * 0.4, y - s * 1);
        // Clear box corner
        g.fillStyle(0x000000); // Usually matched to background
        g.fillRect(x, y - s * 0.5, s + 2, s + 2);
    }
};

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    PLAYER_SPEED: 300,
    PLAYER_LIVES: 3,

    CAR_SPAWN_RATE: 1500,
    CAR_MIN_SPEED: 200,
    CAR_MAX_SPEED: 380,

    NEWT_SPAWN_RATE: 1800,
    NEWT_SPEED: 55,
    NEWT_SIZE: 50,

    // Progressive difficulty thresholds
    DIFFICULTY_THRESHOLD: 1000,

    COLORS: {
        forest: 0x0a1d0a,
        lake: 0x0a1a2d,
        road: 0x111111,
        laneMarker: 0xffcc33,
        neonCyan: 0x00ffff,
        neonPink: 0xff00ff
    }
};

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() { super({ key: 'SplashScene' }); }

    preload() {
        this.load.image('poster', 'assets/poster.jpg');
        this.load.image('newt', 'assets/newt.png');
    }

    create() {
        const { width, height } = this.scale;

        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        const poster = this.add.image(width / 2, height / 2, 'poster');
        const scale = Math.min(width / poster.width, height / poster.height);
        poster.setScale(scale);
        poster.setAlpha(0);

        this.tweens.add({
            targets: poster,
            alpha: 1,
            duration: 800,
            ease: 'Power2'
        });

        // Start prompt
        const startText = this.add.text(width / 2, height - 70, 'TAP TO START', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '28px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.tweens.add({
            targets: startText,
            alpha: 0.4,
            duration: 600,
            yoyo: true,
            repeat: -1
        });

        // Robust transition handling
        let started = false;
        const startGame = () => {
            if (started) return;
            started = true;
            console.log("Starting GameScene...");

            // Fallback: Start scene directly if fade takes too long or fails
            const fallback = this.time.delayedCall(500, () => {
                if (this.scene.isActive('SplashScene')) {
                    console.warn("Fade transition timed out, starting GameScene directly.");
                    this.scene.start('GameScene');
                }
            });

            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                fallback.destroy();
                this.scene.start('GameScene');
            });
        };

        // Clickable area (full screen)
        const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0)
            .setOrigin(0)
            .setInteractive({ useHandCursor: true });

        // Ensure we can start even before the delay if the user is fast
        hitArea.on('pointerdown', startGame);
        this.input.keyboard.on('keydown', startGame);

        console.log("SplashScene ready. Waiting for input...");
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() {
        this.load.image('newt', 'assets/newt.png');
        this.load.image('newtXing', 'assets/newt_Xing.png');
    }

    create() {
        console.log("GameScene.create started");
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.lives = GAME_CONFIG.PLAYER_LIVES;
        this.gameOver = false;
        this.difficulty = 1;

        this.calculateLayout();

        this.cars = this.add.group();
        this.newts = this.add.group();

        this.createEnvironment();
        this.createPlayer();
        this.createHUD();
        this.createControls();

        this.scale.on('resize', () => this.scene.restart());

        this.carTimer = this.time.addEvent({
            delay: GAME_CONFIG.CAR_SPAWN_RATE,
            callback: this.spawnCar,
            callbackScope: this,
            loop: true
        });
        this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });

        this.spawnNewt();
        this.cameras.main.fadeIn(300);

        // Rain effect
        this.raindrops = [];
        for (let i = 0; i < 80; i++) {
            this.raindrops.push({
                x: Phaser.Math.Between(0, this.scale.width),
                y: Phaser.Math.Between(0, this.scale.height),
                speed: Phaser.Math.Between(300, 600),
                length: Phaser.Math.Between(8, 18)
            });
        }
        this.rainGraphics = this.add.graphics().setDepth(100);
    }

    calculateLayout() {
        const { width, height } = this.scale;
        this.roadHeight = Math.min(height * 0.55, 450);
        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / 4;
        this.topSafe = this.roadY;
        this.botSafe = this.roadY + this.roadHeight;
    }

    createEnvironment() {
        const { width, height } = this.scale;
        const g = this.add.graphics();

        // Open Space Preserve (top)
        g.fillGradientStyle(0x0a1d0a, 0x0a1d0a, 0x153015, 0x153015);
        g.fillRect(0, 0, width, this.topSafe);

        g.fillStyle(0x051005, 0.8);
        for (let x = 0; x < width + 80; x += 70) {
            const h = 20 + Math.random() * 15;
            g.fillTriangle(x, this.topSafe, x + 35, this.topSafe - h, x + 70, this.topSafe);
        }

        // Lexington Reservoir (bottom)
        g.fillGradientStyle(0x0a1a2d, 0x0a1a2d, 0x152840, 0x152840);
        g.fillRect(0, this.botSafe, width, height - this.botSafe);

        g.lineStyle(1, 0x3388aa, 0.2);
        for (let y = this.botSafe + 15; y < height; y += 12) {
            g.lineBetween(0, y, width, y);
        }

        // Road
        g.fillStyle(0x111111);
        g.fillRect(0, this.roadY, width, this.roadHeight);

        g.lineStyle(3, 0x00ffff, 0.4);
        g.lineBetween(0, this.roadY, width, this.roadY);
        g.lineBetween(0, this.botSafe, width, this.botSafe);

        // Lane dividers
        for (let i = 1; i < 4; i++) {
            const y = this.roadY + i * this.laneHeight;
            for (let x = 20; x < width; x += 70) {
                g.fillStyle(0xffcc33, 0.7);
                g.fillRoundedRect(x, y - 3, 35, 6, 3);
            }
        }

        // Road name - subtle in center
        this.add.text(width / 2, this.roadY + this.roadHeight / 2, 'ALMA BRIDGE ROAD', {
            fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#333333', fontStyle: 'italic'
        }).setOrigin(0.5).setAlpha(0.5);

        // Location labels with MapPing icons
        // Fancy styling as requested
        const fancyStyle = {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '18px',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4,
            shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true }
        };

        const topText = this.add.text(width / 2 + 12, this.topSafe - 25, 'OPEN SPACE PRESERVE', { ...fancyStyle, color: '#44dd66' }).setOrigin(0.5);
        const topIcon = this.add.graphics();
        Icons.drawMapPin(topIcon, topText.x - topText.width / 2 - 18, this.topSafe - 26, 18, 0x44dd66);

        const botText = this.add.text(width / 2 + 12, this.botSafe + 25, 'LEXINGTON RESERVOIR', { ...fancyStyle, color: '#44aadd' }).setOrigin(0.5);
        const botIcon = this.add.graphics();
        Icons.drawMapPin(botIcon, botText.x - botText.width / 2 - 18, this.botSafe + 24, 18, 0x44aadd);

        // Newt crossing signs - diagonally opposite (top-left and bottom-right at road edges)
        this.add.image(45, this.topSafe - 25, 'newtXing').setDisplaySize(50, 50);
        this.add.image(width - 45, this.botSafe - 25, 'newtXing').setDisplaySize(50, 50);
    }

    createCrossingSign(x, y) {
        const g = this.add.graphics();
        // Yellow diamond background
        g.fillStyle(0xffcc00);
        g.beginPath();
        g.moveTo(x, y - 22);
        g.lineTo(x + 18, y);
        g.lineTo(x, y + 22);
        g.lineTo(x - 18, y);
        g.closePath();
        g.fillPath();
        // Black border
        g.lineStyle(2, 0x000000, 1);
        g.beginPath();
        g.moveTo(x, y - 22);
        g.lineTo(x + 18, y);
        g.lineTo(x, y + 22);
        g.lineTo(x - 18, y);
        g.closePath();
        g.strokePath();
        // Newt silhouette
        g.lineStyle(2, 0x000000, 1);
        g.beginPath();
        g.moveTo(x - 8, y); g.lineTo(x + 8, y);
        g.moveTo(x + 8, y); g.lineTo(x + 10, y - 2);
        g.moveTo(x + 8, y); g.lineTo(x + 10, y + 2);
        g.moveTo(x - 8, y); g.lineTo(x - 12, y + 4);
        g.moveTo(x + 4, y); g.lineTo(x + 6, y - 6);
        g.moveTo(x + 4, y); g.lineTo(x + 6, y + 6);
        g.moveTo(x - 4, y); g.lineTo(x - 6, y - 6);
        g.moveTo(x - 4, y); g.lineTo(x - 6, y + 6);
        g.strokePath();
    }

    createPlayer() {
        const { width } = this.scale;
        this.player = this.add.container(width / 2, this.botSafe + 60);
        this.player.setDepth(50);
        const g = this.add.graphics();
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        g.fillStyle(0xf1c40f); g.fillRoundedRect(-18, -18, 36, 32, 5);
        g.fillStyle(0xffffff, 0.9); g.fillRect(-18, -8, 36, 5); g.fillRect(-18, 4, 36, 5);
        g.fillStyle(0xff6b00); g.fillRect(-18, -2, 36, 3);
        g.fillStyle(0xfce4d6); g.fillCircle(0, -26, 14);
        g.fillStyle(0x000000); g.fillCircle(-5, -28, 2.5); g.fillCircle(5, -28, 2.5);
        g.fillStyle(0xcc9988); g.fillEllipse(0, -22, 4, 2);
        // More prominent cap/hat
        g.fillStyle(0xff0000); g.fillEllipse(0, -40, 26, 14); // Main cap
        g.fillStyle(0xcc0000); g.fillRect(-13, -42, 26, 6); // Cap brim
        this.player.add(g);
        this.player.graphics = g;
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.carried = [];
        this.player.invincible = false;
        this.walkTime = 0;
    }

    createHUD() {
        const padding = 20;
        const style = { fontFamily: 'Fredoka, sans-serif', fontSize: '20px', color: '#ffffff', stroke: '#000', strokeThickness: 3 };

        this.livesIconGroup = this.add.group();
        this.scoreText = this.add.text(this.scale.width - padding, padding, '', style).setOrigin(1, 0).setDepth(200);
        this.carryText = this.add.text(this.scale.width / 2, padding, '', { ...style, color: '#00ffff' }).setOrigin(0.5, 0).setDepth(200);
        this.statsText = this.add.text(padding, this.scale.height - padding, '', { ...style, fontSize: '15px', color: '#aaa' }).setOrigin(0, 1).setDepth(200);

        this.updateHUD();
    }

    updateHUD() {
        if (this.gameOver) return;

        // Update Heart Icons
        this.livesIconGroup.clear(true, true);
        for (let i = 0; i < GAME_CONFIG.PLAYER_LIVES; i++) {
            const g = this.add.graphics().setDepth(200);
            const color = i < this.lives ? 0xff3366 : 0x333333;
            Icons.drawHeart(g, 30 + i * 28, 32, 20, color, 2.5);
            this.livesIconGroup.add(g);
        }

        this.scoreText.setText(`${this.score}`);

        // Update carrying display (Text based - Reverted per user request)
        if (this.carryIconGroup) {
            this.carryIconGroup.clear(true, true);
            this.carryIconGroup.destroy();
            this.carryIconGroup = null;
        }
        const c = this.player.carried.length;
        let carryStr = '[ ]';
        if (c === 1) carryStr = '[X]';
        if (c === 2) carryStr = '[X][X]';
        this.carryText.setText(`CARRYING: ${carryStr}`);

        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
    }

    updateDifficulty() {
        if (this.score >= GAME_CONFIG.DIFFICULTY_THRESHOLD) {
            const excess = this.score - GAME_CONFIG.DIFFICULTY_THRESHOLD;
            this.difficulty = 1 + (excess / 1000) * 0.5;
            this.difficulty = Math.min(this.difficulty, 2.5);
            const newDelay = Math.max(600, GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty);
            if (this.carTimer) this.carTimer.delay = newDelay;
        }
    }

    createControls() {
        this.inputData = { active: false, x: 0, y: 0, sx: 0, sy: 0 };
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        this.joyBase = this.add.circle(0, 0, 55, 0xffffff, 0.15).setStrokeStyle(2, 0x00ffff, 0.5).setVisible(false).setDepth(500);
        this.joyThumb = this.add.circle(0, 0, 28, 0x00ffff, 0.4).setVisible(false).setDepth(501);
        this.input.on('pointerdown', p => {
            if (p.y < 100 || this.gameOver) return;
            this.inputData.active = true;
            this.inputData.sx = p.x;
            this.inputData.sy = p.y;
            this.joyBase.setPosition(p.x, p.y).setVisible(true);
            this.joyThumb.setPosition(p.x, p.y).setVisible(true);
        });
        this.input.on('pointermove', p => {
            if (!this.inputData.active) return;
            const dx = p.x - this.inputData.sx;
            const dy = p.y - this.inputData.sy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const max = 45;
            const clamped = Math.min(dist, max);
            if (dist > 0) {
                this.inputData.x = (dx / dist) * (clamped / max);
                this.inputData.y = (dy / dist) * (clamped / max);
                this.joyThumb.setPosition(this.inputData.sx + dx * (clamped / dist), this.inputData.sy + dy * (clamped / dist));
            }
        });
        this.input.on('pointerup', () => {
            this.inputData.active = false;
            this.inputData.x = 0;
            this.inputData.y = 0;
            this.joyBase.setVisible(false);
            this.joyThumb.setVisible(false);
        });
    }

    update(time, delta) {
        if (this.gameOver) return;
        this.updatePlayer(time, delta);
        this.updateCars(delta);
        this.updateNewts(delta);
        this.checkCollisions();
        this.updateRain(delta);
    }

    updateRain(delta) {
        this.rainGraphics.clear();
        this.rainGraphics.lineStyle(1, 0x6688aa, 0.4);

        this.raindrops.forEach(drop => {
            drop.y += drop.speed * (delta / 1000);
            if (drop.y > this.scale.height) {
                drop.y = -drop.length;
                drop.x = Phaser.Math.Between(0, this.scale.width);
            }
            this.rainGraphics.lineBetween(drop.x, drop.y, drop.x - 2, drop.y + drop.length);
        });
    }

    updatePlayer(time, delta) {
        // Skip WASD input if game is over (allows typing in name input)
        if (this.gameOver) return;

        let dx = 0, dy = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1; else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1; else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
        if (this.inputData.active) { dx = this.inputData.x; dy = this.inputData.y; }
        if (dx !== 0 || dy !== 0) {
            const mag = Math.sqrt(dx * dx + dy * dy);
            this.player.x += (dx / mag) * this.player.speed * (delta / 1000);
            this.player.y += (dy / mag) * this.player.speed * (delta / 1000);
            if (dx !== 0) this.player.scaleX = dx > 0 ? 1 : -1;
            this.walkTime += delta * 0.015;
            this.player.graphics.y = Math.sin(this.walkTime) * 3;
        } else {
            this.player.graphics.y = Math.sin(time * 0.003) * 1.5;
        }
        this.player.x = Phaser.Math.Clamp(this.player.x, 25, this.scale.width - 25);
        this.player.y = Phaser.Math.Clamp(this.player.y, 25, this.scale.height - 25);
        this.player.carried.forEach((n, i) => {
            n.x = this.player.x + (i === 0 ? -22 : 22);
            n.y = this.player.y - 18;
        });
        if (this.player.invincible) {
            this.player.alpha = (Math.floor(time / 100) % 2 === 0) ? 0.4 : 0.9;
        }
    }

    spawnCar() {
        if (this.gameOver) return;

        const typeRoll = Math.random();
        let type = 'car';
        if (typeRoll > 0.85) type = 'motorbike';
        else if (typeRoll > 0.65) type = 'truck';

        // Lane Logic: 0,1 go RIGHT. 2,3 go LEFT.
        const lane = Phaser.Math.Between(0, 3);
        const dir = lane < 2 ? 1 : -1;

        const y = this.roadY + lane * this.laneHeight + this.laneHeight / 2;
        const x = dir === 1 ? -150 : this.scale.width + 150;

        // Check for overlap with existing cars in this lane near the spawn point
        const safeDistance = 250;
        let safeToSpawn = true;
        this.cars.getChildren().forEach(c => {
            if (Math.abs(c.y - y) < 10) { // Same lane
                // If car is too close to spawn point (considering direction)
                if (dir === 1 && c.x < -150 + safeDistance) safeToSpawn = false;
                if (dir === -1 && c.x > this.scale.width + 150 - safeDistance) safeToSpawn = false;
            }
        });

        if (!safeToSpawn) return; // Skip this spawn cycle

        const baseSpeed = Phaser.Math.Between(GAME_CONFIG.CAR_MIN_SPEED, GAME_CONFIG.CAR_MAX_SPEED);
        let speedMultiplier = 1;
        if (type === 'motorbike') speedMultiplier = 1.4;
        if (type === 'truck') speedMultiplier = 0.8;

        const speed = baseSpeed * this.difficulty * dir * speedMultiplier;

        const container = this.add.container(x, y);
        container.setDepth(30);

        const g = this.add.graphics();
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c, 0xbdc3c7, 0x34495e];
        const mainColor = colors[Phaser.Math.Between(0, colors.length - 1)];

        if (type === 'car') this.draw3DCar(g, mainColor, dir);
        else if (type === 'truck') this.draw3DTruck(g, mainColor, dir);
        else if (type === 'motorbike') this.draw3DMotorbike(g, mainColor, dir);

        container.add(g);
        container.speed = speed;
        container.type = type;

        // Dynamic hitboxes
        if (type === 'truck') { container.w = 140; container.h = 45; }
        else if (type === 'motorbike') { container.w = 50; container.h = 20; }
        else { container.w = 90; container.h = 35; }

        this.cars.add(container);
    }

    draw3DCar(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(30).color;
        const bright = Phaser.Display.Color.ValueToColor(color).lighten(20).color;

        // Shadow
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 22, 95, 18);

        // Body base (3D side depth)
        g.fillStyle(dark);
        g.fillRoundedRect(-48, -16, 96, 36, 10);

        // Main body (Top surface)
        g.fillGradientStyle(color, color, bright, bright);
        g.fillRoundedRect(-48, -20, 96, 34, 10);

        // Roof
        g.fillStyle(bright);
        g.fillRoundedRect(-15, -16, 45, 26, 6);
        g.fillStyle(color);
        g.fillRoundedRect(-12, -14, 39, 22, 5);

        // Windshieds
        g.fillStyle(0x1a2530);
        g.fillRect(dir === 1 ? 18 : -32, -12, 14, 18); // Front
        g.fillRect(dir === 1 ? -22 : 8, -12, 8, 18); // Back

        // Windows (sides)
        g.fillRect(-10, -13, 22, 2);
        g.fillRect(-10, 7, 22, 2);

        // Lights
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 44 : -44, -10, 5);
        g.fillCircle(dir === 1 ? 44 : -44, 4, 5);
        g.fillStyle(0xff3333);
        g.fillCircle(dir === 1 ? -44 : 44, -12, 4);
        g.fillCircle(dir === 1 ? -44 : 44, 6, 4);

        // Wheels
        g.fillStyle(0x111111);
        g.fillRoundedRect(-35, 14, 16, 6, 2);
        g.fillRoundedRect(20, 14, 16, 6, 2);
        g.fillRoundedRect(-35, -24, 16, 6, 2);
        g.fillRoundedRect(20, -24, 16, 6, 2);
    }

    draw3DTruck(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(40).color;
        const bright = Phaser.Display.Color.ValueToColor(color).lighten(15).color;

        // Shadow
        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(0, 25, 145, 25);

        // Trailer (Main box)
        g.fillStyle(0xd5d5d5);
        g.fillRoundedRect(-20, -24, 90, 48, 4);
        g.fillStyle(0xeeeeee);
        g.fillRoundedRect(-20, -24, 90, 44, 4);

        // Cab (Front part)
        const cabX = dir === 1 ? 70 : -70;
        g.fillStyle(dark);
        g.fillRoundedRect(dir === 1 ? 65 : -115, -22, 50, 44, 6);
        g.fillStyle(color);
        g.fillRoundedRect(dir === 1 ? 65 : -115, -22, 50, 40, 6);

        // Cab Windows
        g.fillStyle(0x1a2530);
        g.fillRect(dir === 1 ? 95 : -110, -18, 12, 32); // Front
        g.fillRect(dir === 1 ? 75 : -85, -19, 15, 3); // Sides
        g.fillRect(dir === 1 ? 75 : -85, 12, 15, 3);

        // Wheels (6 wheels)
        g.fillStyle(0x111111);
        const wheelY = [18, -28];
        const wheelX = [-10, 25, 60, 95];
        wheelY.forEach(wy => {
            wheelX.forEach(wx => {
                const finalX = dir === 1 ? wx : -wx - 50;
                g.fillRoundedRect(finalX, wy, 18, 8, 2);
            });
        });

        // Details
        g.fillStyle(0xffcc00);
        g.fillCircle(dir === 1 ? 110 : -110, -15, 6);
        g.fillCircle(dir === 1 ? 110 : -110, 11, 6);
    }

    draw3DMotorbike(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(30).color;

        // Shadow
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(0, 15, 50, 10);

        // Body
        g.lineStyle(6, 0x222222);
        g.lineBetween(-20, 0, 20, 0); // Frame

        g.fillStyle(color);
        g.fillEllipse(0, 0, 25, 10); // Fuel tank/Body

        // Rider (Top down)
        g.fillStyle(0x333333);
        g.fillCircle(-5, 0, 10); // Helmet/Body
        g.fillStyle(0xddccbb);
        g.fillCircle(-2, 0, 7); // Arms/Hands area

        // Handlebars
        g.lineStyle(2, 0x555555);
        g.lineBetween(10, -10, 10, 10);

        // Wheels
        g.fillStyle(0x111111);
        g.fillRoundedRect(-22, -3, 10, 6, 2);
        g.fillRoundedRect(12, -3, 10, 6, 2);

        // Headlight
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 22 : -22, 0, 4);
    }

    updateCars(delta) {
        this.cars.getChildren().forEach(car => {
            car.x += car.speed * (delta / 1000);
            if (car.x < -200 || car.x > this.scale.width + 200) car.destroy();
        });
    }

    spawnNewt() {
        if (this.gameOver) return;
        const fromTop = Math.random() < 0.5;
        const x = Phaser.Math.Between(60, this.scale.width - 60);
        const y = fromTop ? this.topSafe - 25 : this.botSafe + 25;
        const newt = this.add.image(x, y, 'newt');
        newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
        newt.setDepth(25);
        newt.dir = fromTop ? 1 : -1;
        newt.dest = fromTop ? 'LAKE' : 'FOREST';
        newt.isCarried = false;
        newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.newts.add(newt);
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried) {
                newt.y += newt.dir * GAME_CONFIG.NEWT_SPEED * (delta / 1000);
                newt.rotation = (newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.time.now * 0.01) * 0.15;
                if ((newt.dir === 1 && newt.y > this.botSafe + 30) || (newt.dir === -1 && newt.y < this.topSafe - 30)) { newt.destroy(); }
            } else {
                const idx = this.player.carried.indexOf(newt);
                newt.x = this.player.x + (idx === 0 ? -25 : 25);
                newt.y = this.player.y - 15;
                newt.setDepth(55);
                newt.rotation = Math.sin(this.time.now * 0.008) * 0.2;
            }
        });
    }

    checkCollisions() {
        if (this.gameOver) return;
        this.cars.getChildren().forEach(car => {
            if (!this.player.invincible && Math.abs(this.player.x - car.x) < car.w / 2 && Math.abs(this.player.y - car.y) < car.h / 2) { this.hitPlayer(); }
            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Math.abs(newt.x - car.x) < car.w / 2 && Math.abs(newt.y - car.y) < car.h / 2) { this.splatterNewt(newt); }
            });
        });
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && this.player.carried.length < 2) {
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y);
                if (dist < 50) { newt.isCarried = true; this.player.carried.push(newt); this.updateHUD(); }
            }
        });
        if (this.player.carried.length > 0) {
            const inForest = this.player.y < this.topSafe;
            const inLake = this.player.y > this.botSafe;
            if (inForest || inLake) {
                this.player.carried.forEach(newt => {
                    const correct = (newt.dest === 'FOREST' && inForest) || (newt.dest === 'LAKE' && inLake);
                    if (correct) { this.saved++; this.score += 100; this.createSuccessEffect(newt.x, newt.y); this.updateDifficulty(); }
                    newt.destroy();
                });
                this.player.carried = [];
                this.updateHUD();
            }
        }
    }

    splatterNewt(newt) {
        this.lost++;
        for (let i = 0; i < 10; i++) {
            const p = this.add.circle(newt.x, newt.y, Phaser.Math.Between(3, 6), 0xff3366, 0.8);
            this.tweens.add({
                targets: p, x: newt.x + Phaser.Math.Between(-40, 40), y: newt.y + Phaser.Math.Between(-40, 40),
                alpha: 0, scale: 0.3, duration: 500 + Math.random() * 300, onComplete: () => p.destroy()
            });
        }
        newt.destroy(); this.updateHUD();
    }

    createSuccessEffect(x, y) {
        for (let i = 0; i < 12; i++) {
            const star = this.add.star(x, y, 5, 4, 8, 0x00ff88);
            star.setAlpha(0.9);
            this.tweens.add({
                targets: star, x: x + Phaser.Math.Between(-50, 50), y: y - Phaser.Math.Between(30, 80),
                rotation: 2, alpha: 0, scale: 0.4, duration: 600 + Math.random() * 400, onComplete: () => star.destroy()
            });
        }
    }

    hitPlayer() {
        if (this.gameOver) return;
        this.lives--; this.updateHUD();
        this.player.carried.forEach(n => n.destroy()); this.player.carried = [];
        this.cameras.main.flash(150, 255, 50, 50, false);
        this.player.invincible = true;
        this.time.delayedCall(2000, () => { this.player.invincible = false; this.player.alpha = 1; });
        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;
        if (this.lives <= 0) { this.gameOver = true; this.showGameOver(); }
    }

    async showGameOver() {
        const { width, height } = this.scale;
        this.add.rectangle(0, 0, width, height, 0x000000, 0.92).setOrigin(0).setDepth(300);
        this.add.text(width / 2, height * 0.08, 'GAME OVER', {
            fontFamily: 'Fredoka, sans-serif', fontSize: '44px', color: '#ff3366', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(301);
        this.add.text(width / 2, height * 0.16, `FINAL SCORE: ${this.score}`, {
            fontFamily: 'Fredoka, sans-serif', fontSize: '26px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(301);

        if (supabaseClient) {
            this.add.text(width / 2, height * 0.24, 'Enter your name:', {
                fontFamily: 'Outfit, sans-serif', fontSize: '16px', color: '#aaaaaa'
            }).setOrigin(0.5).setDepth(301);

            const inputEl = document.createElement('input');
            inputEl.type = 'text'; inputEl.placeholder = 'Your Name'; inputEl.maxLength = 15;
            inputEl.style.cssText = `position: fixed; left: 50%; top: 30%; transform: translate(-50%, -50%); padding: 10px 18px; font-size: 16px; font-family: 'Fredoka', sans-serif; border: 2px solid #00ffff; border-radius: 8px; background: #111; color: #fff; text-align: center; width: 180px; z-index: 10000; outline: none;`;
            document.body.appendChild(inputEl); inputEl.focus();

            const submitBtnText = this.add.text(width / 2 + 15, height * 0.38, 'SUBMIT SCORE', {
                fontFamily: 'Fredoka, sans-serif', fontSize: '20px', color: '#00ff00', backgroundColor: '#222', padding: { left: 45, right: 18, top: 8, bottom: 8 }
            }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

            const submitIcon = this.add.graphics().setDepth(302);
            Icons.drawSend(submitIcon, submitBtnText.x - submitBtnText.width / 2 + 22, height * 0.38, 18, 0x00ff00);

            let submitted = false;
            submitBtnText.on('pointerdown', async () => {
                if (submitted) return;
                const name = inputEl.value.trim() || 'Anonymous';
                submitted = true;
                submitBtnText.setText('Submitting...');
                submitBtnText.disableInteractive();
                const success = await submitScore(name, this.score);
                if (success) { submitBtnText.setText('Submitted!'); inputEl.remove(); submitIcon.clear(); this.refreshLeaderboard(); }
                else { submitBtnText.setText('Error - Try Again'); submitted = false; submitBtnText.setInteractive({ useHandCursor: true }); }
            });
            this.events.once('shutdown', () => { if (inputEl.parentNode) inputEl.remove(); });

            this.leaderboardY = height * 0.46;
            await this.showLeaderboard();
        } else {
            this.add.text(width / 2, height * 0.35, '(Leaderboard not configured)', {
                fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#555'
            }).setOrigin(0.5).setDepth(301);
            this.leaderboardY = height * 0.40;
        }

        const volunteerY = supabaseClient ? height * 0.78 : height * 0.60;
        const volunteerBg = this.add.rectangle(width / 2, volunteerY, width * 0.85, 60, 0x004422, 0.9).setStrokeStyle(2, 0x00ff88).setOrigin(0.5).setDepth(301);
        this.add.text(width / 2, volunteerY - 10, 'Want to help real newts?', { fontFamily: 'Fredoka, sans-serif', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5).setDepth(302);
        const volunteerLink = this.add.text(width / 2 + 10, volunteerY + 12, 'Volunteer at bioblitz.club/newts', { fontFamily: 'Fredoka, sans-serif', fontSize: '18px', color: '#00ff88', fontStyle: 'bold' }).setOrigin(0.5).setDepth(302).setInteractive({ useHandCursor: true });
        const volunteerIcon = this.add.graphics().setDepth(303);
        Icons.drawExternalLink(volunteerIcon, volunteerLink.x - volunteerLink.width / 2 - 18, volunteerY + 12, 16, 0x00ff88);
        volunteerLink.on('pointerdown', () => { window.open('https://bioblitz.club/newts', '_blank'); });

        const retryBtnText = this.add.text(width / 2 + 15, height * 0.92, 'TRY AGAIN', {
            fontFamily: 'Fredoka, sans-serif', fontSize: '24px', color: '#00ffff', backgroundColor: '#222', padding: { left: 45, right: 22, top: 10, bottom: 10 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });
        const retryIcon = this.add.graphics().setDepth(302);
        Icons.drawRefresh(retryIcon, retryBtnText.x - retryBtnText.width / 2 + 22, height * 0.92, 22, 0x00ffff);
        retryBtnText.on('pointerdown', () => this.scene.restart());
    }

    async showLeaderboard() {
        const { width } = this.scale;
        const startY = this.leaderboardY;
        const trophyIcon = this.add.graphics().setDepth(301);
        Icons.drawTrophy(trophyIcon, width / 2 - 75, startY, 20, 0xffcc00);
        this.add.text(width / 2 + 10, startY, 'TOP SCORES', { fontFamily: 'Fredoka, sans-serif', fontSize: '18px', color: '#ffcc00' }).setOrigin(0.5).setDepth(301);

        const scores = await getLeaderboard();
        if (scores.length === 0) {
            this.add.text(width / 2, startY + 30, 'Be the first to set a high score!', { fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#666' }).setOrigin(0.5).setDepth(301);
        } else {
            scores.forEach((s, i) => {
                const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
                this.add.text(width / 2, startY + 35 + (i * 22), `${medal}  ${s.player_name} — ${s.score}`, { fontFamily: 'Outfit, sans-serif', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(301);
            });
        }
    }

    async refreshLeaderboard() {
        this.scene.restart(); // Simple refresh for now to clear graphics
    }
}

const config = {
    type: Phaser.AUTO, backgroundColor: '#000000', scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container' },
    dom: { createContainer: true }, scene: [SplashScene, GameScene]
};
window.addEventListener('load', () => new Phaser.Game(config));
