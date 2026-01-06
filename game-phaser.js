/* ===================================
   SAVE THE NEWTS - ENHANCED EDITION
   Smooth Gameplay + Better Graphics
   =================================== */

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    PLAYER_SPEED: 300,
    PLAYER_LIVES: 3,

    CAR_SPAWN_RATE: 1500,
    CAR_MIN_SPEED: 200,
    CAR_MAX_SPEED: 380,

    NEWT_SPAWN_RATE: 1800,
    NEWT_SPEED: 55,
    NEWT_SIZE: 50, // Display size for newt sprite

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

        // Poster background - scaled to cover
        const poster = this.add.image(width / 2, height / 2, 'poster');
        const scaleX = width / poster.width;
        const scaleY = height / poster.height;
        poster.setScale(Math.max(scaleX, scaleY));
        poster.setAlpha(0);

        // Fade in poster
        this.tweens.add({
            targets: poster,
            alpha: 1,
            duration: 800,
            ease: 'Power2'
        });

        // Start prompt (positioned at bottom)
        const startText = this.add.text(width / 2, height - 80, 'TAP TO START', {
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

        this.input.once('pointerdown', () => this.scene.start('GameScene'));
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

        // Resize
        this.scale.on('resize', () => this.scene.restart());

        // Spawn timers
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

        // Forest (Top safe zone)
        g.fillGradientStyle(0x0a1d0a, 0x0a1d0a, 0x153015, 0x153015);
        g.fillRect(0, 0, width, this.topSafe);

        // Tree silhouettes
        g.fillStyle(0x051005, 0.8);
        for (let x = 0; x < width + 80; x += 70) {
            const h = 20 + Math.random() * 15;
            g.fillTriangle(x, this.topSafe, x + 35, this.topSafe - h, x + 70, this.topSafe);
        }

        // Lake (Bottom safe zone)
        g.fillGradientStyle(0x0a1a2d, 0x0a1a2d, 0x152840, 0x152840);
        g.fillRect(0, this.botSafe, width, height - this.botSafe);

        // Water ripples
        g.lineStyle(1, 0x3388aa, 0.2);
        for (let y = this.botSafe + 15; y < height; y += 12) {
            g.lineBetween(0, y, width, y);
        }

        // Road
        g.fillStyle(0x111111);
        g.fillRect(0, this.roadY, width, this.roadHeight);

        // Glowing edges
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

        // Labels
        const labelStyle = { fontFamily: 'Arial', fontSize: '18px', color: '#44dd66', fontStyle: 'bold' };
        this.add.text(width / 2, this.topSafe - 25, '🌲 FOREST (SAFE)', labelStyle).setOrigin(0.5);
        this.add.text(width / 2, this.botSafe + 25, '💧 LAKE (SAFE)', { ...labelStyle, color: '#44aadd' }).setOrigin(0.5);
    }

    createPlayer() {
        const { width } = this.scale;
        this.player = this.add.container(width / 2, this.botSafe + 60);
        this.player.setDepth(50);

        const g = this.add.graphics();

        // Shadow
        g.fillStyle(0x000000, 0.4);
        g.fillEllipse(0, 28, 35, 12);

        // Legs
        g.fillStyle(0x2c3e50);
        g.fillRoundedRect(-12, 8, 10, 22, 3);
        g.fillRoundedRect(2, 8, 10, 22, 3);

        // Body - High visibility vest
        g.fillStyle(0xf1c40f); // Yellow vest
        g.fillRoundedRect(-18, -18, 36, 32, 5);

        // Reflective stripes on vest
        g.fillStyle(0xffffff, 0.9);
        g.fillRect(-18, -8, 36, 5);
        g.fillRect(-18, 4, 36, 5);

        // Orange accent stripes
        g.fillStyle(0xff6b00);
        g.fillRect(-18, -2, 36, 3);

        // Head
        g.fillStyle(0xfce4d6);
        g.fillCircle(0, -26, 14);

        // Face details
        g.fillStyle(0x000000);
        g.fillCircle(-5, -28, 2.5); // Left eye
        g.fillCircle(5, -28, 2.5);  // Right eye
        g.fillStyle(0xcc9988);
        g.fillEllipse(0, -22, 4, 2); // Nose hint

        // Hard hat
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

        // Touch joystick visuals
        this.joyBase = this.add.circle(0, 0, 55, 0xffffff, 0.15).setStrokeStyle(2, 0x00ffff, 0.5).setVisible(false).setDepth(500);
        this.joyThumb = this.add.circle(0, 0, 28, 0x00ffff, 0.4).setVisible(false).setDepth(501);

        this.input.on('pointerdown', p => {
            if (p.y < 100) return;
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

        // Keyboard
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;

        // Touch
        if (this.inputData.active) {
            dx = this.inputData.x;
            dy = this.inputData.y;
        }

        if (dx !== 0 || dy !== 0) {
            const mag = Math.sqrt(dx * dx + dy * dy);
            this.player.x += (dx / mag) * this.player.speed * (delta / 1000);
            this.player.y += (dy / mag) * this.player.speed * (delta / 1000);

            if (dx !== 0) this.player.scaleX = dx > 0 ? 1 : -1;

            // Walk bobbing
            this.walkTime += delta * 0.015;
            this.player.graphics.y = Math.sin(this.walkTime) * 3;
        } else {
            // Idle breathing
            this.player.graphics.y = Math.sin(time * 0.003) * 1.5;
        }

        // Clamp
        this.player.x = Phaser.Math.Clamp(this.player.x, 25, this.scale.width - 25);
        this.player.y = Phaser.Math.Clamp(this.player.y, 25, this.scale.height - 25);

        // Update carried newts
        this.player.carried.forEach((n, i) => {
            n.x = this.player.x + (i === 0 ? -22 : 22);
            n.y = this.player.y - 18;
        });

        // Invincibility
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

        // Car colors
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c];
        const mainColor = colors[Phaser.Math.Between(0, colors.length - 1)];
        const darkColor = Phaser.Display.Color.ValueToColor(mainColor).darken(30).color;

        // Shadow
        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(0, 25, 100, 20);

        // Body
        g.fillStyle(mainColor);
        g.fillRoundedRect(-50, -20, 100, 40, 8);

        // Roof
        g.fillStyle(darkColor);
        g.fillRoundedRect(-25, -22, 55, 44, 6);

        // Windows
        g.fillStyle(0x1a2530);
        g.fillRect(-18, -18, 22, 36);
        g.fillRect(8, -18, 22, 36);

        // Window glare
        g.fillStyle(0xffffff, 0.15);
        g.fillRect(-15, -18, 6, 36);

        // Headlights
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 45 : -45, 0, 7);
        g.fillStyle(0xffffcc, 0.2);
        g.fillCircle(dir === 1 ? 45 : -45, 0, 12);

        // Taillights
        g.fillStyle(0xff3333);
        g.fillCircle(dir === 1 ? -45 : 45, -8, 5);
        g.fillCircle(dir === 1 ? -45 : 45, 8, 5);

        // Wheels
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

                // Self-crossed
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

        // Player vs Cars
        this.cars.getChildren().forEach(car => {
            if (!this.player.invincible && Math.abs(this.player.x - car.x) < 50 && Math.abs(this.player.y - car.y) < 30) {
                this.hitPlayer();
            }

            // Car vs Newt
            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Math.abs(newt.x - car.x) < 45 && Math.abs(newt.y - car.y) < 25) {
                    this.splatterNewt(newt);
                }
            });
        });

        // Pickup newts
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

        // Delivery
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

        // Splatter particles
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

        // Drop carried newts
        this.player.carried.forEach(n => n.destroy());
        this.player.carried = [];

        // Flash effect (simple, no complex shake)
        this.cameras.main.flash(150, 255, 50, 50, false);

        // Invincibility
        this.player.invincible = true;
        this.time.delayedCall(2000, () => {
            this.player.invincible = false;
            this.player.alpha = 1;
        });

        // Reset position
        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;

        if (this.lives <= 0) {
            this.gameOver = true;

            // Simple game over overlay
            const { width, height } = this.scale;
            this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0).setDepth(300);

            this.add.text(width / 2, height * 0.35, 'GAME OVER', {
                fontFamily: 'Arial Black', fontSize: '52px', color: '#ff3366'
            }).setOrigin(0.5).setDepth(301);

            this.add.text(width / 2, height * 0.5, `FINAL SCORE: ${this.score}`, {
                fontFamily: 'Arial', fontSize: '28px', color: '#ffffff'
            }).setOrigin(0.5).setDepth(301);

            const btn = this.add.text(width / 2, height * 0.7, 'TRY AGAIN', {
                fontFamily: 'Arial', fontSize: '28px', color: '#00ffff', backgroundColor: '#222', padding: { x: 25, y: 12 }
            }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

            btn.on('pointerdown', () => this.scene.start('GameScene'));
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
    scene: [SplashScene, GameScene]
};

window.addEventListener('load', () => new Phaser.Game(config));
