/* ===================================
   SAVE THE NEWTS - ENHANCED EDITION
   Smooth Gameplay + Better Graphics + Leaderboard
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
        console.log("Score submitted successfully!");
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
        if (error) {
            console.error("Error fetching leaderboard:", error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error("Exception fetching leaderboard:", e);
        return [];
    }
}

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

        // Black background first
        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        // Poster background - scaled to CONTAIN (fully visible, no cropping)
        const poster = this.add.image(width / 2, height / 2, 'poster');
        const scaleX = width / poster.width;
        const scaleY = height / poster.height;
        const scale = Math.min(scaleX, scaleY); // Use MIN to contain, not crop
        poster.setScale(scale);
        poster.setAlpha(0);

        // Fade in poster
        this.tweens.add({
            targets: poster,
            alpha: 1,
            duration: 800,
            ease: 'Power2'
        });

        // Volunteer Link (Above Start button)
        const volunteerText = this.add.text(width / 2, height - 130, '🌿 Volunteer at bioblitz.club/newts', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '18px',
            color: '#00ff88',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        volunteerText.on('pointerdown', () => {
            window.open('https://bioblitz.club/newts', '_blank');
        });

        // Start prompt
        const startText = this.add.text(width / 2, height - 70, 'TAP TO START', {
            fontFamily: 'Arial, sans-serif',
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

        this.input.once('pointerdown', (p) => {
            // Don't start game if clicking volunteer link
            if (p.y < height - 110) {
                this.scene.start('GameScene');
            }
        });
        this.input.keyboard.once('keydown', () => this.scene.start('GameScene'));
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() {
        this.load.image('newt', 'assets/newt.png');
    }

    create() {
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.lives = GAME_CONFIG.PLAYER_LIVES;
        this.gameOver = false;

        this.calculateLayout();

        this.cars = this.add.group();
        this.newts = this.add.group();

        this.createEnvironment();
        this.createPlayer();
        this.createHUD();
        this.createControls();

        this.scale.on('resize', () => this.scene.restart());

        this.time.addEvent({ delay: GAME_CONFIG.CAR_SPAWN_RATE, callback: this.spawnCar, callbackScope: this, loop: true });
        this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });

        this.spawnNewt();
        this.cameras.main.fadeIn(300);
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

        g.fillGradientStyle(0x0a1d0a, 0x0a1d0a, 0x153015, 0x153015);
        g.fillRect(0, 0, width, this.topSafe);

        g.fillStyle(0x051005, 0.8);
        for (let x = 0; x < width + 80; x += 70) {
            const h = 20 + Math.random() * 15;
            g.fillTriangle(x, this.topSafe, x + 35, this.topSafe - h, x + 70, this.topSafe);
        }

        g.fillGradientStyle(0x0a1a2d, 0x0a1a2d, 0x152840, 0x152840);
        g.fillRect(0, this.botSafe, width, height - this.botSafe);

        g.lineStyle(1, 0x3388aa, 0.2);
        for (let y = this.botSafe + 15; y < height; y += 12) {
            g.lineBetween(0, y, width, y);
        }

        g.fillStyle(0x111111);
        g.fillRect(0, this.roadY, width, this.roadHeight);

        g.lineStyle(3, 0x00ffff, 0.4);
        g.lineBetween(0, this.roadY, width, this.roadY);
        g.lineBetween(0, this.botSafe, width, this.botSafe);

        for (let i = 1; i < 4; i++) {
            const y = this.roadY + i * this.laneHeight;
            for (let x = 20; x < width; x += 70) {
                g.fillStyle(0xffcc33, 0.7);
                g.fillRoundedRect(x, y - 3, 35, 6, 3);
            }
        }

        const labelStyle = { fontFamily: 'Arial', fontSize: '18px', color: '#44dd66', fontStyle: 'bold' };
        this.add.text(width / 2, this.topSafe - 25, '🌲 FOREST (SAFE)', labelStyle).setOrigin(0.5);
        this.add.text(width / 2, this.botSafe + 25, '💧 LAKE (SAFE)', { ...labelStyle, color: '#44aadd' }).setOrigin(0.5);
    }

    createPlayer() {
        const { width } = this.scale;
        this.player = this.add.container(width / 2, this.botSafe + 60);
        this.player.setDepth(50);

        const g = this.add.graphics();

        g.fillStyle(0x000000, 0.4);
        g.fillEllipse(0, 28, 35, 12);

        g.fillStyle(0x2c3e50);
        g.fillRoundedRect(-12, 8, 10, 22, 3);
        g.fillRoundedRect(2, 8, 10, 22, 3);

        g.fillStyle(0xf1c40f);
        g.fillRoundedRect(-18, -18, 36, 32, 5);

        g.fillStyle(0xffffff, 0.9);
        g.fillRect(-18, -8, 36, 5);
        g.fillRect(-18, 4, 36, 5);

        g.fillStyle(0xff6b00);
        g.fillRect(-18, -2, 36, 3);

        g.fillStyle(0xfce4d6);
        g.fillCircle(0, -26, 14);

        g.fillStyle(0x000000);
        g.fillCircle(-5, -28, 2.5);
        g.fillCircle(5, -28, 2.5);
        g.fillStyle(0xcc9988);
        g.fillEllipse(0, -22, 4, 2);

        g.fillStyle(0xe74c3c);
        g.fillEllipse(0, -38, 20, 10);
        g.fillStyle(0xc0392b);
        g.fillRect(-10, -38, 20, 5);

        this.player.add(g);
        this.player.graphics = g;
        this.player.speed = GAME_CONFIG.PLAYER_SPEED;
        this.player.carried = [];
        this.player.invincible = false;
        this.walkTime = 0;
    }

    createHUD() {
        const padding = 20;
        const style = { fontFamily: 'Arial', fontSize: '22px', color: '#ffffff', stroke: '#000', strokeThickness: 3 };

        this.livesText = this.add.text(padding, padding, '', style).setDepth(200);
        this.scoreText = this.add.text(this.scale.width - padding, padding, '', style).setOrigin(1, 0).setDepth(200);
        this.carryText = this.add.text(this.scale.width / 2, padding, '', { ...style, color: '#00ffff' }).setOrigin(0.5, 0).setDepth(200);
        this.statsText = this.add.text(padding, this.scale.height - padding, '', { ...style, fontSize: '16px', color: '#aaa' }).setOrigin(0, 1).setDepth(200);

        this.updateHUD();
    }

    updateHUD() {
        if (this.gameOver) return;

        let hearts = '';
        for (let i = 0; i < this.lives; i++) hearts += '❤️';
        for (let i = this.lives; i < GAME_CONFIG.PLAYER_LIVES; i++) hearts += '🖤';
        this.livesText.setText(hearts);

        this.scoreText.setText(`SCORE: ${this.score}`);

        const c = this.player.carried.length;
        let carryStr = '[ ]';
        if (c === 1) carryStr = '[X]';
        if (c === 2) carryStr = '[X][X]';
        this.carryText.setText(`CARRYING: ${carryStr}`);

        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
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
    }

    updatePlayer(time, delta) {
        let dx = 0, dy = 0;

        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;

        if (this.inputData.active) {
            dx = this.inputData.x;
            dy = this.inputData.y;
        }

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

        const lane = Phaser.Math.Between(0, 3);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = this.roadY + lane * this.laneHeight + this.laneHeight / 2;
        const x = dir === 1 ? -120 : this.scale.width + 120;
        const speed = (Phaser.Math.Between(GAME_CONFIG.CAR_MIN_SPEED, GAME_CONFIG.CAR_MAX_SPEED)) * dir;

        const car = this.add.container(x, y);
        car.setDepth(30);

        const g = this.add.graphics();

        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c];
        const mainColor = colors[Phaser.Math.Between(0, colors.length - 1)];
        const darkColor = Phaser.Display.Color.ValueToColor(mainColor).darken(30).color;

        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(0, 25, 100, 20);

        g.fillStyle(mainColor);
        g.fillRoundedRect(-50, -20, 100, 40, 8);

        g.fillStyle(darkColor);
        g.fillRoundedRect(-25, -22, 55, 44, 6);

        g.fillStyle(0x1a2530);
        g.fillRect(-18, -18, 22, 36);
        g.fillRect(8, -18, 22, 36);

        g.fillStyle(0xffffff, 0.15);
        g.fillRect(-15, -18, 6, 36);

        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 45 : -45, 0, 7);
        g.fillStyle(0xffffcc, 0.2);
        g.fillCircle(dir === 1 ? 45 : -45, 0, 12);

        g.fillStyle(0xff3333);
        g.fillCircle(dir === 1 ? -45 : 45, -8, 5);
        g.fillCircle(dir === 1 ? -45 : 45, 8, 5);

        g.fillStyle(0x1a1a1a);
        g.fillCircle(-30, 20, 10);
        g.fillCircle(30, 20, 10);
        g.fillStyle(0x333333);
        g.fillCircle(-30, 20, 5);
        g.fillCircle(30, 20, 5);

        car.add(g);
        car.speed = speed;
        car.width = 100;
        this.cars.add(car);
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

                if ((newt.dir === 1 && newt.y > this.botSafe + 30) || (newt.dir === -1 && newt.y < this.topSafe - 30)) {
                    newt.destroy();
                }
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
            if (!this.player.invincible && Math.abs(this.player.x - car.x) < 50 && Math.abs(this.player.y - car.y) < 30) {
                this.hitPlayer();
            }

            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Math.abs(newt.x - car.x) < 45 && Math.abs(newt.y - car.y) < 25) {
                    this.splatterNewt(newt);
                }
            });
        });

        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && this.player.carried.length < 2) {
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y);
                if (dist < 50) {
                    newt.isCarried = true;
                    this.player.carried.push(newt);
                    this.updateHUD();
                }
            }
        });

        if (this.player.carried.length > 0) {
            const inForest = this.player.y < this.topSafe;
            const inLake = this.player.y > this.botSafe;

            if (inForest || inLake) {
                this.player.carried.forEach(newt => {
                    const correct = (newt.dest === 'FOREST' && inForest) || (newt.dest === 'LAKE' && inLake);
                    if (correct) {
                        this.saved++;
                        this.score += 100;
                        this.createSuccessEffect(newt.x, newt.y);
                    }
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
                targets: p,
                x: newt.x + Phaser.Math.Between(-40, 40),
                y: newt.y + Phaser.Math.Between(-40, 40),
                alpha: 0,
                scale: 0.3,
                duration: 500 + Math.random() * 300,
                onComplete: () => p.destroy()
            });
        }

        newt.destroy();
        this.updateHUD();
    }

    createSuccessEffect(x, y) {
        for (let i = 0; i < 12; i++) {
            const star = this.add.star(x, y, 5, 4, 8, 0x00ff88);
            star.setAlpha(0.9);
            this.tweens.add({
                targets: star,
                x: x + Phaser.Math.Between(-50, 50),
                y: y - Phaser.Math.Between(30, 80),
                rotation: 2,
                alpha: 0,
                scale: 0.4,
                duration: 600 + Math.random() * 400,
                onComplete: () => star.destroy()
            });
        }
    }

    hitPlayer() {
        if (this.gameOver) return;

        this.lives--;
        this.updateHUD();

        this.player.carried.forEach(n => n.destroy());
        this.player.carried = [];

        this.cameras.main.flash(150, 255, 50, 50, false);

        this.player.invincible = true;
        this.time.delayedCall(2000, () => {
            this.player.invincible = false;
            this.player.alpha = 1;
        });

        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;

        if (this.lives <= 0) {
            this.gameOver = true;
            this.showGameOver();
        }
    }

    async showGameOver() {
        const { width, height } = this.scale;

        this.add.rectangle(0, 0, width, height, 0x000000, 0.9).setOrigin(0).setDepth(300);

        this.add.text(width / 2, height * 0.12, 'GAME OVER', {
            fontFamily: 'Arial Black', fontSize: '48px', color: '#ff3366'
        }).setOrigin(0.5).setDepth(301);

        this.add.text(width / 2, height * 0.22, `FINAL SCORE: ${this.score}`, {
            fontFamily: 'Arial', fontSize: '28px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(301);

        // Name input for leaderboard
        if (supabaseClient) {
            this.add.text(width / 2, height * 0.32, 'Enter your name:', {
                fontFamily: 'Arial', fontSize: '18px', color: '#aaaaaa'
            }).setOrigin(0.5).setDepth(301);

            // Create DOM input
            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.placeholder = 'Your Name';
            inputEl.maxLength = 15;
            inputEl.style.cssText = `
                position: fixed;
                left: 50%;
                top: 38%;
                transform: translate(-50%, -50%);
                padding: 12px 20px;
                font-size: 18px;
                border: 2px solid #00ffff;
                border-radius: 8px;
                background: #111;
                color: #fff;
                text-align: center;
                width: 200px;
                z-index: 10000;
                outline: none;
            `;
            document.body.appendChild(inputEl);
            inputEl.focus();

            const submitBtn = this.add.text(width / 2, height * 0.50, '📤 SUBMIT SCORE', {
                fontFamily: 'Arial', fontSize: '22px', color: '#00ff00', backgroundColor: '#222', padding: { x: 20, y: 10 }
            }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

            let submitted = false;
            submitBtn.on('pointerdown', async () => {
                if (submitted) return;
                const name = inputEl.value.trim() || 'Anonymous';
                submitted = true;
                submitBtn.setText('⏳ Submitting...');
                submitBtn.disableInteractive();

                const success = await submitScore(name, this.score);

                if (success) {
                    submitBtn.setText('✅ Submitted!');
                    inputEl.remove();
                    await this.showLeaderboard();
                } else {
                    submitBtn.setText('❌ Error - Try Again');
                    submitted = false;
                    submitBtn.setInteractive({ useHandCursor: true });
                }
            });

            // Cleanup on scene restart
            this.events.once('shutdown', () => {
                if (inputEl.parentNode) inputEl.remove();
            });

            // Show existing leaderboard
            await this.showLeaderboard();

        } else {
            this.add.text(width / 2, height * 0.4, '(Leaderboard not configured)', {
                fontFamily: 'Arial', fontSize: '16px', color: '#666'
            }).setOrigin(0.5).setDepth(301);
        }

        // Volunteer link
        const volunteerBtn = this.add.text(width / 2, height * 0.78, '🌿 Volunteer at bioblitz.club/newts', {
            fontFamily: 'Arial', fontSize: '18px', color: '#00ff88', backgroundColor: '#1a1a1a', padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

        volunteerBtn.on('pointerdown', () => {
            window.open('https://bioblitz.club/newts', '_blank');
        });

        // Retry button
        const retryBtn = this.add.text(width / 2, height * 0.90, '🔄 TRY AGAIN', {
            fontFamily: 'Arial', fontSize: '26px', color: '#00ffff', backgroundColor: '#222', padding: { x: 25, y: 12 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

        retryBtn.on('pointerdown', () => this.scene.restart());
    }

    async showLeaderboard() {
        const { width, height } = this.scale;

        this.add.text(width / 2, height * 0.58, '🏆 TOP SCORES', {
            fontFamily: 'Arial', fontSize: '20px', color: '#ffcc00'
        }).setOrigin(0.5).setDepth(301);

        const scores = await getLeaderboard();

        if (scores.length === 0) {
            this.add.text(width / 2, height * 0.65, 'No scores yet!', {
                fontFamily: 'Arial', fontSize: '16px', color: '#888'
            }).setOrigin(0.5).setDepth(301);
        } else {
            scores.forEach((s, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
                const entry = `${medal} ${s.player_name} - ${s.score}`;
                this.add.text(width / 2, height * 0.64 + (i * 22), entry, {
                    fontFamily: 'Courier New', fontSize: '16px', color: '#ffffff'
                }).setOrigin(0.5).setDepth(301);
            });
        }
    }
}

// ===== PHASER CONFIG =====
const config = {
    type: Phaser.AUTO,
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container'
    },
    dom: {
        createContainer: true
    },
    scene: [SplashScene, GameScene]
};

window.addEventListener('load', () => new Phaser.Game(config));
