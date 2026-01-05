/* ===================================
   SAVE THE NEWTS - GAME ENGINE
   Mobile-friendly with Lives System
   =================================== */

// ===== GAME CONFIGURATION =====
const CONFIG = {
    // Canvas - will be scaled for mobile
    CANVAS_WIDTH: 1000,
    CANVAS_HEIGHT: 700,

    // Road
    ROAD_Y: 250,
    ROAD_HEIGHT: 200,
    LANE_COUNT: 4,

    // Player
    PLAYER_SPEED: 5,
    PLAYER_SIZE: 40,
    MAX_CARRY: 2,
    PLAYER_LIVES: 3,
    PLAYER_INVINCIBLE_TIME: 2000, // ms of invincibility after hit

    // Cars
    CAR_MIN_SPEED: 2,
    CAR_MAX_SPEED: 4,
    CAR_SPAWN_RATE: 1800, // ms (starting rate)
    CAR_WIDTH: 80,
    CAR_HEIGHT: 40,

    // Newts
    NEWT_SPEED: 0.8,
    NEWT_SPAWN_RATE: 2500, // ms
    NEWT_SIZE: 25,

    // Scoring
    POINTS_PER_SAVE: 10,
    COMBO_MULTIPLIER: 1.5,

    // Difficulty - Progressive after 5 newts saved
    DIFFICULTY_START_THRESHOLD: 5, // Start increasing difficulty after this many saved
    DIFFICULTY_INCREMENT: 0.08, // How much to increase per newt saved after threshold
    MAX_DIFFICULTY: 2.5, // Cap on difficulty multiplier

    // Colors
    COLORS: {
        forest: ['#1a3d1a', '#2d5a2d', '#3d7a3d'],
        lake: ['#1a4d6d', '#2d6a8a', '#4d8aaa'],
        road: '#3a3a3a',
        roadLine: '#f0c040',
        roadEdge: '#555',
    }
};

// ===== UTILITY FUNCTIONS =====
const Utils = {
    random(min, max) {
        return Math.random() * (max - min) + min;
    },

    randomInt(min, max) {
        return Math.floor(this.random(min, max + 1));
    },

    distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    },

    rectCollision(r1, r2) {
        return r1.x < r2.x + r2.width &&
            r1.x + r1.width > r2.x &&
            r1.y < r2.y + r2.height &&
            r1.y + r1.height > r2.y;
    },

    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    isMobile() {
        return window.matchMedia('(max-width: 768px)').matches ||
            window.matchMedia('(pointer: coarse)').matches;
    }
};

// ===== PARTICLE SYSTEM =====
class Particle {
    constructor(x, y, color, velocity, life = 60) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = velocity.x;
        this.vy = velocity.y;
        this.life = life;
        this.maxLife = life;
        this.size = Utils.random(3, 8);
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.1; // gravity
        this.life--;
        return this.life > 0;
    }

    draw(ctx) {
        const alpha = this.life / this.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// ===== CAR CLASS =====
class Car {
    constructor(direction, lane, speed) {
        this.direction = direction; // 1 = right, -1 = left
        this.lane = lane;
        this.speed = speed;
        this.width = CONFIG.CAR_WIDTH;
        this.height = CONFIG.CAR_HEIGHT;

        // Position
        const laneHeight = CONFIG.ROAD_HEIGHT / CONFIG.LANE_COUNT;
        this.y = CONFIG.ROAD_Y + (lane * laneHeight) + (laneHeight - this.height) / 2;
        this.x = direction === 1 ? -this.width : CONFIG.CANVAS_WIDTH;

        // Appearance
        this.carType = Utils.randomInt(0, 3);
        this.colors = [
            ['#e74c3c', '#c0392b'], // Red
            ['#3498db', '#2980b9'], // Blue
            ['#2ecc71', '#27ae60'], // Green
            ['#9b59b6', '#8e44ad'], // Purple
            ['#f39c12', '#d68910'], // Orange
            ['#1abc9c', '#16a085'], // Teal
        ];
        this.colorPair = this.colors[Utils.randomInt(0, this.colors.length - 1)];
    }

    get bounds() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
    }

    update() {
        this.x += this.speed * this.direction;
    }

    isOffScreen() {
        return (this.direction === 1 && this.x > CONFIG.CANVAS_WIDTH + 50) ||
            (this.direction === -1 && this.x < -this.width - 50);
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        if (this.direction === -1) {
            ctx.scale(-1, 1);
        }
        ctx.translate(-this.width / 2, -this.height / 2);

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(4, 4, this.width, this.height);

        // Car body
        ctx.fillStyle = this.colorPair[0];
        ctx.beginPath();
        ctx.roundRect(0, 8, this.width, this.height - 8, 6);
        ctx.fill();

        // Car roof
        ctx.fillStyle = this.colorPair[1];
        ctx.beginPath();
        ctx.roundRect(15, 0, this.width - 35, this.height - 10, 6);
        ctx.fill();

        // Windows
        ctx.fillStyle = '#a8d8ea';
        ctx.fillRect(20, 4, 18, 16);
        ctx.fillRect(42, 4, 18, 16);

        // Front light
        ctx.fillStyle = '#fff9c4';
        ctx.beginPath();
        ctx.arc(this.width - 5, this.height / 2, 5, 0, Math.PI * 2);
        ctx.fill();

        // Rear light
        ctx.fillStyle = '#ff5252';
        ctx.beginPath();
        ctx.arc(5, this.height / 2, 4, 0, Math.PI * 2);
        ctx.fill();

        // Wheels
        ctx.fillStyle = '#2d2d2d';
        ctx.beginPath();
        ctx.arc(15, this.height, 8, 0, Math.PI * 2);
        ctx.arc(this.width - 15, this.height, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ===== NEWT CLASS =====
class Newt {
    constructor(startSide) {
        this.startSide = startSide; // 'forest' or 'lake'
        this.direction = startSide === 'forest' ? 1 : -1;
        this.size = CONFIG.NEWT_SIZE;
        this.speed = CONFIG.NEWT_SPEED + Utils.random(-0.2, 0.2);

        // Position
        if (startSide === 'forest') {
            this.x = Utils.random(20, 80);
        } else {
            this.x = CONFIG.CANVAS_WIDTH - Utils.random(20, 80);
        }
        this.y = Utils.random(CONFIG.ROAD_Y - 20, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT + 20);

        // State
        this.isBeingCarried = false;
        this.isSquished = false;
        this.squishedTime = 0;
        this.targetX = this.direction === 1 ? CONFIG.CANVAS_WIDTH - 60 : 60;

        // Animation
        this.animFrame = 0;
        this.animTimer = 0;
        this.wobble = Utils.random(0, Math.PI * 2);
    }

    get destination() {
        return this.startSide === 'forest' ? 'lake' : 'forest';
    }

    get bounds() {
        return {
            x: this.x - this.size / 2,
            y: this.y - this.size / 2,
            width: this.size,
            height: this.size
        };
    }

    update() {
        if (this.isSquished) {
            this.squishedTime++;
            return this.squishedTime < 120; // Remove after 2 seconds
        }

        if (!this.isBeingCarried) {
            this.x += this.speed * this.direction;
            this.wobble += 0.1;
            this.animTimer++;
            if (this.animTimer > 10) {
                this.animFrame = (this.animFrame + 1) % 2;
                this.animTimer = 0;
            }
        }
        return true;
    }

    reachedDestination() {
        if (this.direction === 1) {
            return this.x >= CONFIG.CANVAS_WIDTH - 80;
        } else {
            return this.x <= 80;
        }
    }

    squish() {
        this.isSquished = true;
    }

    draw(ctx) {
        if (this.isSquished) {
            this.drawSquished(ctx);
            return;
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.direction === -1) {
            ctx.scale(-1, 1);
        }

        // Wobble animation
        if (!this.isBeingCarried) {
            ctx.translate(0, Math.sin(this.wobble) * 2);
        }

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(2, this.size / 2 + 2, this.size / 2, this.size / 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size / 2);
        gradient.addColorStop(0, '#ff8c5a');
        gradient.addColorStop(1, '#ff6b35');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size / 2, this.size / 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.fillStyle = '#ff7043';
        ctx.beginPath();
        ctx.ellipse(this.size / 3, 0, this.size / 4, this.size / 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tail
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.moveTo(-this.size / 2, 0);
        ctx.quadraticCurveTo(-this.size * 0.8, -3, -this.size * 0.7, 0);
        ctx.quadraticCurveTo(-this.size * 0.8, 3, -this.size / 2, 0);
        ctx.fill();

        // Spots
        ctx.fillStyle = '#e64a19';
        ctx.beginPath();
        ctx.arc(-5, -4, 3, 0, Math.PI * 2);
        ctx.arc(3, 3, 2, 0, Math.PI * 2);
        ctx.arc(-8, 2, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(this.size / 3, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(this.size / 3 + 1, -3, 2, 0, Math.PI * 2);
        ctx.fill();

        // Legs (animated)
        ctx.strokeStyle = '#ff6b35';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        const legOffset = this.animFrame === 0 ? 3 : -3;

        // Front legs
        ctx.beginPath();
        ctx.moveTo(5, -6);
        ctx.lineTo(10 + legOffset, -12);
        ctx.moveTo(5, 6);
        ctx.lineTo(10 - legOffset, 12);
        ctx.stroke();

        // Back legs
        ctx.beginPath();
        ctx.moveTo(-8, -6);
        ctx.lineTo(-12 - legOffset, -12);
        ctx.moveTo(-8, 6);
        ctx.lineTo(-12 + legOffset, 12);
        ctx.stroke();

        // Direction indicator (small arrow showing where newt wants to go)
        if (!this.isBeingCarried) {
            ctx.fillStyle = this.destination === 'lake' ? '#4fc3f7' : '#81c784';
            ctx.beginPath();
            ctx.moveTo(this.size / 2 + 8, 0);
            ctx.lineTo(this.size / 2 + 3, -4);
            ctx.lineTo(this.size / 2 + 3, 4);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    }

    drawSquished(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalAlpha = 1 - (this.squishedTime / 120);

        // Splat mark
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 8, Utils.random(-0.3, 0.3), 0, Math.PI * 2);
        ctx.fill();

        // Splatter particles
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const dist = 15 + Utils.random(5, 15);
            ctx.beginPath();
            ctx.arc(
                Math.cos(angle) * dist,
                Math.sin(angle) * dist * 0.5,
                3,
                0, Math.PI * 2
            );
            ctx.fill();
        }

        ctx.restore();
    }
}

// ===== PLAYER CLASS =====
class Player {
    constructor() {
        this.x = CONFIG.CANVAS_WIDTH / 2;
        this.y = CONFIG.CANVAS_HEIGHT - 100;
        this.size = CONFIG.PLAYER_SIZE;
        this.speed = CONFIG.PLAYER_SPEED;
        this.carrying = [];
        this.direction = 1;
        this.lives = CONFIG.PLAYER_LIVES;

        // Invincibility
        this.isInvincible = false;
        this.invincibleTimer = 0;
        this.blinkTimer = 0;

        // Animation
        this.animFrame = 0;
        this.animTimer = 0;
        this.isMoving = false;

        // Mobile input
        this.mobileInputX = 0;
        this.mobileInputY = 0;
    }

    get bounds() {
        return {
            x: this.x - this.size / 2,
            y: this.y - this.size / 2,
            width: this.size,
            height: this.size
        };
    }

    update(keys, deltaTime) {
        this.isMoving = false;
        let dx = 0, dy = 0;

        // Keyboard input
        if (keys.ArrowUp || keys.KeyW) dy -= 1;
        if (keys.ArrowDown || keys.KeyS) dy += 1;
        if (keys.ArrowLeft || keys.KeyA) dx -= 1;
        if (keys.ArrowRight || keys.KeyD) dx += 1;

        // Mobile joystick input
        if (this.mobileInputX !== 0 || this.mobileInputY !== 0) {
            dx = this.mobileInputX;
            dy = this.mobileInputY;
        }

        // Normalize diagonal movement
        if (dx !== 0 || dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;

            this.x += dx * this.speed;
            this.y += dy * this.speed;
            this.isMoving = true;

            if (dx !== 0) this.direction = dx > 0 ? 1 : -1;
        }

        // Keep in bounds
        this.x = Math.max(this.size, Math.min(CONFIG.CANVAS_WIDTH - this.size, this.x));
        this.y = Math.max(this.size, Math.min(CONFIG.CANVAS_HEIGHT - this.size, this.y));

        // Animation
        if (this.isMoving) {
            this.animTimer++;
            if (this.animTimer > 8) {
                this.animFrame = (this.animFrame + 1) % 4;
                this.animTimer = 0;
            }
        } else {
            this.animFrame = 0;
        }

        // Update carried newts position
        this.carrying.forEach((newt, i) => {
            newt.x = this.x + (i === 0 ? -15 : 15);
            newt.y = this.y - 5;
        });

        // Update invincibility
        if (this.isInvincible) {
            this.invincibleTimer -= deltaTime;
            this.blinkTimer += deltaTime;
            if (this.invincibleTimer <= 0) {
                this.isInvincible = false;
                this.invincibleTimer = 0;
            }
        }
    }

    hit() {
        if (this.isInvincible) return false;

        this.lives--;
        this.isInvincible = true;
        this.invincibleTimer = CONFIG.PLAYER_INVINCIBLE_TIME;

        // Drop any carried newts when hit
        this.carrying.forEach(newt => {
            newt.isBeingCarried = false;
        });
        this.carrying = [];

        return true;
    }

    canPickup() {
        return this.carrying.length < CONFIG.MAX_CARRY;
    }

    pickup(newt) {
        if (this.canPickup()) {
            newt.isBeingCarried = true;
            this.carrying.push(newt);
            return true;
        }
        return false;
    }

    dropOff() {
        const delivered = [...this.carrying];
        this.carrying = [];
        delivered.forEach(newt => {
            newt.isBeingCarried = false;
        });
        return delivered;
    }

    isInForestZone() {
        return this.x < 100;
    }

    isInLakeZone() {
        return this.x > CONFIG.CANVAS_WIDTH - 100;
    }

    draw(ctx) {
        // Blink when invincible
        if (this.isInvincible && Math.floor(this.blinkTimer / 100) % 2 === 0) {
            ctx.globalAlpha = 0.4;
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.direction === -1) {
            ctx.scale(-1, 1);
        }

        // Walking animation offset
        const bobOffset = this.isMoving ? Math.sin(this.animTimer * 0.5) * 2 : 0;
        ctx.translate(0, bobOffset);

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(0, this.size / 2 + 5, this.size / 2, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        ctx.fillStyle = '#34495e';
        const legSpread = this.isMoving ? Math.sin(this.animFrame * Math.PI / 2) * 5 : 0;
        ctx.fillRect(-10 - legSpread, 10, 8, 20);
        ctx.fillRect(2 + legSpread, 10, 8, 20);

        // Body (safety vest)
        const vestGradient = ctx.createLinearGradient(-15, -10, 15, 10);
        vestGradient.addColorStop(0, '#ff9800');
        vestGradient.addColorStop(0.5, '#ffb74d');
        vestGradient.addColorStop(1, '#ff9800');
        ctx.fillStyle = vestGradient;
        ctx.beginPath();
        ctx.roundRect(-15, -15, 30, 30, 5);
        ctx.fill();

        // Reflective stripes on vest
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(-15, -5, 30, 4);
        ctx.fillRect(-15, 5, 30, 4);

        // Glow effect for vest
        ctx.shadowColor = '#ff9800';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ffc107';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-15, -15, 30, 30, 5);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Head
        ctx.fillStyle = '#ffccbc';
        ctx.beginPath();
        ctx.arc(0, -22, 12, 0, Math.PI * 2);
        ctx.fill();

        // Hair
        ctx.fillStyle = '#5d4037';
        ctx.beginPath();
        ctx.arc(0, -26, 10, Math.PI, Math.PI * 2);
        ctx.fill();

        // Face
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(-4, -23, 2, 0, Math.PI * 2);
        ctx.arc(4, -23, 2, 0, Math.PI * 2);
        ctx.fill();

        // Smile
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, -20, 5, 0.2, Math.PI - 0.2);
        ctx.stroke();

        // Arms
        ctx.fillStyle = '#ff9800';
        const armWave = this.isMoving ? Math.sin(this.animFrame * Math.PI / 2) * 0.3 : 0;
        ctx.save();
        ctx.translate(-18, -5);
        ctx.rotate(-0.3 + armWave);
        ctx.fillRect(0, 0, 8, 18);
        ctx.restore();
        ctx.save();
        ctx.translate(10, -5);
        ctx.rotate(0.3 - armWave);
        ctx.fillRect(0, 0, 8, 18);
        ctx.restore();

        ctx.restore();

        ctx.globalAlpha = 1;

        // Draw carrying indicator
        if (this.carrying.length > 0) {
            ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size + 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// ===== FLOATING TEXT =====
class FloatingText {
    constructor(x, y, text, color = '#4caf50') {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.life = 60;
        this.maxLife = 60;
    }

    update() {
        this.y -= 1.5;
        this.life--;
        return this.life > 0;
    }

    draw(ctx) {
        const alpha = this.life / this.maxLife;
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 24px Fredoka';
        ctx.fillStyle = this.color;
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x, this.y);

        // Outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeText(this.text, this.x, this.y);

        ctx.globalAlpha = 1;
    }
}

// ===== VIRTUAL JOYSTICK =====
class VirtualJoystick {
    constructor(game) {
        this.game = game;
        this.container = document.getElementById('joystick-container');
        this.base = document.getElementById('joystick-base');
        this.knob = document.getElementById('joystick-knob');

        this.active = false;
        this.startX = 0;
        this.startY = 0;
        this.maxDistance = 35;

        this.setupEvents();
    }

    setupEvents() {
        // Touch events
        this.base.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });

        // Mouse events (for testing on desktop)
        this.base.addEventListener('mousedown', (e) => this.onStart(e));
        document.addEventListener('mousemove', (e) => this.onMove(e));
        document.addEventListener('mouseup', (e) => this.onEnd(e));
    }

    onStart(e) {
        e.preventDefault();
        this.active = true;

        const rect = this.base.getBoundingClientRect();
        this.startX = rect.left + rect.width / 2;
        this.startY = rect.top + rect.height / 2;
    }

    onMove(e) {
        if (!this.active) return;
        e.preventDefault();

        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        let dx = clientX - this.startX;
        let dy = clientY - this.startY;

        // Limit to max distance
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.maxDistance) {
            dx = (dx / distance) * this.maxDistance;
            dy = (dy / distance) * this.maxDistance;
        }

        // Move knob
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

        // Update player input (-1 to 1)
        this.game.player.mobileInputX = dx / this.maxDistance;
        this.game.player.mobileInputY = dy / this.maxDistance;
    }

    onEnd(e) {
        this.active = false;
        this.knob.style.transform = 'translate(0, 0)';
        this.game.player.mobileInputX = 0;
        this.game.player.mobileInputY = 0;
    }
}

// ===== MAIN GAME CLASS =====
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Handle responsive canvas sizing
        this.setupCanvas();
        window.addEventListener('resize', () => this.setupCanvas());

        // Game state
        this.state = 'start'; // start, playing, paused, gameover
        this.score = 0;
        this.savedCount = 0;
        this.lostCount = 0;
        this.difficulty = 1;

        // Entities
        this.player = new Player();
        this.cars = [];
        this.newts = [];
        this.particles = [];
        this.floatingTexts = [];

        // Timers
        this.carSpawnTimer = 0;
        this.newtSpawnTimer = 0;
        this.lastTime = 0;

        // Input
        this.keys = {};

        // Background elements
        this.trees = this.generateTrees();
        this.waves = this.generateWaves();

        // Bind methods
        this.update = this.update.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);

        // Setup
        this.setupEventListeners();
        this.setupUI();

        // Mobile joystick
        if (Utils.isMobile()) {
            this.joystick = new VirtualJoystick(this);
        }

        // Start game loop
        requestAnimationFrame(this.update);
    }

    setupCanvas() {
        const container = document.getElementById('game-container');
        const maxWidth = Math.min(window.innerWidth - 20, CONFIG.CANVAS_WIDTH);
        const maxHeight = Math.min(window.innerHeight - (Utils.isMobile() ? 180 : 100), CONFIG.CANVAS_HEIGHT);

        const scale = Math.min(maxWidth / CONFIG.CANVAS_WIDTH, maxHeight / CONFIG.CANVAS_HEIGHT);

        this.canvas.width = CONFIG.CANVAS_WIDTH;
        this.canvas.height = CONFIG.CANVAS_HEIGHT;
        this.canvas.style.width = `${CONFIG.CANVAS_WIDTH * scale}px`;
        this.canvas.style.height = `${CONFIG.CANVAS_HEIGHT * scale}px`;
    }

    generateTrees() {
        const trees = [];
        for (let i = 0; i < 30; i++) {
            trees.push({
                x: Utils.random(10, 90),
                y: Utils.random(30, CONFIG.CANVAS_HEIGHT - 30),
                size: Utils.random(15, 35),
                shade: Utils.random(0.8, 1.2)
            });
        }
        return trees.sort((a, b) => a.y - b.y);
    }

    generateWaves() {
        const waves = [];
        for (let i = 0; i < 5; i++) {
            waves.push({
                y: CONFIG.ROAD_Y - 20 + (i * 50),
                offset: Utils.random(0, Math.PI * 2),
                amplitude: Utils.random(3, 6)
            });
        }
        return waves;
    }

    setupEventListeners() {
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);

        // Prevent scrolling on mobile
        document.addEventListener('touchmove', (e) => {
            if (this.state === 'playing') {
                e.preventDefault();
            }
        }, { passive: false });
    }

    setupUI() {
        const startBtn = document.getElementById('start-btn');
        const restartBtn = document.getElementById('restart-btn');

        startBtn.addEventListener('click', () => this.startGame());
        restartBtn.addEventListener('click', () => this.restartGame());

        // Make buttons work on touch
        startBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.startGame();
        });
        restartBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.restartGame();
        });
    }

    handleKeyDown(e) {
        this.keys[e.code] = true;

        if (e.code === 'KeyP' && this.state === 'playing') {
            this.togglePause();
        }

        if (e.code === 'Space' && this.state === 'start') {
            this.startGame();
        }
    }

    handleKeyUp(e) {
        this.keys[e.code] = false;
    }

    startGame() {
        this.state = 'playing';
        document.getElementById('start-screen').classList.add('hidden');
        this.reset();
    }

    restartGame() {
        document.getElementById('game-over-screen').classList.add('hidden');
        this.startGame();
    }

    togglePause() {
        if (this.state === 'playing') {
            this.state = 'paused';
            document.getElementById('pause-indicator').classList.remove('hidden');
        } else if (this.state === 'paused') {
            this.state = 'playing';
            document.getElementById('pause-indicator').classList.add('hidden');
        }
    }

    reset() {
        this.score = 0;
        this.savedCount = 0;
        this.lostCount = 0;
        this.difficulty = 1;
        this.player = new Player();
        this.cars = [];
        this.newts = [];
        this.particles = [];
        this.floatingTexts = [];
        this.carSpawnTimer = 0;
        this.newtSpawnTimer = 0;

        // Re-setup joystick reference
        if (this.joystick) {
            this.joystick.game = this;
        }

        this.updateUI();
    }

    // Calculate progressive difficulty based on newts saved
    calculateDifficulty() {
        if (this.savedCount <= CONFIG.DIFFICULTY_START_THRESHOLD) {
            return 1;
        }

        const newtsAfterThreshold = this.savedCount - CONFIG.DIFFICULTY_START_THRESHOLD;
        const difficultyIncrease = newtsAfterThreshold * CONFIG.DIFFICULTY_INCREMENT;

        return Math.min(1 + difficultyIncrease, CONFIG.MAX_DIFFICULTY);
    }

    update(currentTime) {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;

        if (this.state === 'playing') {
            this.gameUpdate(deltaTime);
        }

        this.render();
        requestAnimationFrame(this.update);
    }

    gameUpdate(deltaTime) {
        // Update difficulty based on saved newts
        this.difficulty = this.calculateDifficulty();

        // Spawn cars (more frequently as difficulty increases)
        this.carSpawnTimer += deltaTime;
        const spawnRate = CONFIG.CAR_SPAWN_RATE / this.difficulty;
        if (this.carSpawnTimer >= spawnRate) {
            this.spawnCar();
            this.carSpawnTimer = 0;
        }

        // Spawn newts
        this.newtSpawnTimer += deltaTime;
        if (this.newtSpawnTimer >= CONFIG.NEWT_SPAWN_RATE) {
            this.spawnNewt();
            this.newtSpawnTimer = 0;
        }

        // Update player
        this.player.update(this.keys, deltaTime);

        // Update cars and check player collision
        this.cars = this.cars.filter(car => {
            car.update();

            // Check player-car collision
            if (!this.player.isInvincible) {
                if (Utils.rectCollision(this.player.bounds, car.bounds)) {
                    this.playerHit();
                }
            }

            return !car.isOffScreen();
        });

        // Update newts
        this.newts = this.newts.filter(newt => {
            const alive = newt.update();

            // Check for car collision (if newt is on road and not carried)
            if (!newt.isBeingCarried && !newt.isSquished) {
                const onRoad = newt.y > CONFIG.ROAD_Y &&
                    newt.y < CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT;

                if (onRoad) {
                    for (const car of this.cars) {
                        if (Utils.rectCollision(newt.bounds, car.bounds)) {
                            this.newtHit(newt);
                            break;
                        }
                    }
                }

                // Check if newt reached destination on its own
                if (newt.reachedDestination()) {
                    this.newtSavedByItself(newt);
                    return false;
                }
            }

            return alive;
        });

        // Check player pickup
        if (this.player.canPickup()) {
            for (const newt of this.newts) {
                if (!newt.isBeingCarried && !newt.isSquished) {
                    const dist = Utils.distance(
                        this.player.x, this.player.y,
                        newt.x, newt.y
                    );
                    if (dist < this.player.size / 2 + newt.size / 2) {
                        this.player.pickup(newt);
                        this.updateUI();
                    }
                }
            }
        }

        // Check player dropoff
        if (this.player.carrying.length > 0) {
            const inForest = this.player.isInForestZone();
            const inLake = this.player.isInLakeZone();

            if (inForest || inLake) {
                const delivered = this.player.carrying.filter(newt => {
                    const correctZone = (newt.destination === 'forest' && inForest) ||
                        (newt.destination === 'lake' && inLake);
                    return correctZone;
                });

                if (delivered.length > 0) {
                    delivered.forEach(newt => {
                        const index = this.player.carrying.indexOf(newt);
                        if (index > -1) {
                            this.player.carrying.splice(index, 1);
                        }
                        this.newtSaved(newt);
                        const newtIndex = this.newts.indexOf(newt);
                        if (newtIndex > -1) {
                            this.newts.splice(newtIndex, 1);
                        }
                    });
                    this.updateUI();
                }
            }
        }

        // Update particles
        this.particles = this.particles.filter(p => p.update());

        // Update floating texts
        this.floatingTexts = this.floatingTexts.filter(t => t.update());

        // Check game over (no lives left)
        if (this.player.lives <= 0) {
            this.gameOver();
        }
    }

    spawnCar() {
        const direction = Math.random() > 0.5 ? 1 : -1;
        const lanesForDirection = direction === 1 ? [0, 1] : [2, 3];
        const lane = lanesForDirection[Utils.randomInt(0, 1)];

        // Speed increases with difficulty
        const speed = Utils.random(
            CONFIG.CAR_MIN_SPEED * this.difficulty,
            CONFIG.CAR_MAX_SPEED * this.difficulty
        );

        this.cars.push(new Car(direction, lane, speed));
    }

    spawnNewt() {
        const startSide = Math.random() > 0.5 ? 'forest' : 'lake';
        this.newts.push(new Newt(startSide));
    }

    playerHit() {
        if (this.player.hit()) {
            // Show hit flash
            const flash = document.getElementById('hit-flash');
            flash.classList.remove('hidden');
            setTimeout(() => flash.classList.add('hidden'), 300);

            // Create particles at player location
            for (let i = 0; i < 10; i++) {
                this.particles.push(new Particle(
                    this.player.x, this.player.y,
                    '#ff9800',
                    { x: Utils.random(-5, 5), y: Utils.random(-5, 5) },
                    30
                ));
            }

            this.floatingTexts.push(new FloatingText(
                this.player.x, this.player.y - 30,
                '💥 OUCH!',
                '#f44336'
            ));

            this.updateUI();
        }
    }

    newtHit(newt) {
        newt.squish();
        this.lostCount++;

        // Create splat particles
        for (let i = 0; i < 15; i++) {
            this.particles.push(new Particle(
                newt.x, newt.y,
                '#ff6b35',
                { x: Utils.random(-4, 4), y: Utils.random(-5, 2) },
                45
            ));
        }

        this.floatingTexts.push(new FloatingText(
            newt.x, newt.y - 20,
            '💀',
            '#f44336'
        ));

        this.updateUI();
    }

    newtSaved(newt) {
        const points = CONFIG.POINTS_PER_SAVE;
        this.score += points;
        this.savedCount++;

        // Celebration particles
        for (let i = 0; i < 10; i++) {
            this.particles.push(new Particle(
                newt.x, newt.y,
                Utils.random(0, 1) > 0.5 ? '#4caf50' : '#8bc34a',
                { x: Utils.random(-3, 3), y: Utils.random(-5, -1) },
                40
            ));
        }

        this.floatingTexts.push(new FloatingText(
            newt.x, newt.y - 20,
            `+${points}`,
            '#4caf50'
        ));

        this.updateUI();
    }

    newtSavedByItself(newt) {
        const points = Math.floor(CONFIG.POINTS_PER_SAVE / 2);
        this.score += points;
        this.savedCount++;

        this.floatingTexts.push(new FloatingText(
            newt.x, newt.y - 20,
            `+${points}`,
            '#8bc34a'
        ));

        this.updateUI();
    }

    gameOver() {
        this.state = 'gameover';

        document.getElementById('final-score').textContent = this.score;
        document.getElementById('final-saved').textContent = this.savedCount;
        document.getElementById('final-lost').textContent = this.lostCount;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }

    updateUI() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('saved-count').textContent = this.savedCount;
        document.getElementById('lost-count').textContent = this.lostCount;

        // Update lives display
        const hearts = document.querySelectorAll('#lives-display .heart');
        hearts.forEach((heart, i) => {
            if (i < this.player.lives) {
                heart.classList.remove('lost');
            } else {
                heart.classList.add('lost');
            }
        });

        // Update carrying slots
        const slots = document.querySelectorAll('#carrying-slots .slot');
        slots.forEach((slot, i) => {
            if (i < this.player.carrying.length) {
                slot.classList.add('active');
                slot.classList.remove('empty');
            } else {
                slot.classList.remove('active');
                slot.classList.add('empty');
            }
        });
    }

    render() {
        const ctx = this.ctx;

        // Clear canvas
        ctx.clearRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        // Draw background
        this.drawBackground(ctx);

        // Draw road
        this.drawRoad(ctx);

        // Draw entities (sorted by y position for proper layering)
        const entities = [
            ...this.cars,
            ...this.newts.filter(n => !n.isBeingCarried),
            this.player
        ].sort((a, b) => a.y - b.y);

        entities.forEach(entity => entity.draw(ctx));

        // Draw carried newts on top
        this.newts.filter(n => n.isBeingCarried).forEach(n => n.draw(ctx));

        // Draw particles
        this.particles.forEach(p => p.draw(ctx));

        // Draw floating texts
        this.floatingTexts.forEach(t => t.draw(ctx));

        // Draw zone indicators
        this.drawZoneIndicators(ctx);

        // Draw difficulty indicator (subtle)
        if (this.state === 'playing' && this.difficulty > 1) {
            this.drawDifficultyIndicator(ctx);
        }
    }

    drawBackground(ctx) {
        // Forest (left side)
        const forestGradient = ctx.createLinearGradient(0, 0, 120, 0);
        forestGradient.addColorStop(0, '#1a3d1a');
        forestGradient.addColorStop(1, '#2d5a2d');
        ctx.fillStyle = forestGradient;
        ctx.fillRect(0, 0, 120, CONFIG.CANVAS_HEIGHT);

        // Draw trees
        this.trees.forEach(tree => {
            this.drawTree(ctx, tree.x, tree.y, tree.size, tree.shade);
        });

        // Lake (right side)
        const lakeGradient = ctx.createLinearGradient(CONFIG.CANVAS_WIDTH - 120, 0, CONFIG.CANVAS_WIDTH, 0);
        lakeGradient.addColorStop(0, '#2d6a8a');
        lakeGradient.addColorStop(1, '#1a4d6d');
        ctx.fillStyle = lakeGradient;
        ctx.fillRect(CONFIG.CANVAS_WIDTH - 120, 0, 120, CONFIG.CANVAS_HEIGHT);

        // Lake waves
        const time = Date.now() / 1000;
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
        ctx.lineWidth = 2;

        this.waves.forEach(wave => {
            ctx.beginPath();
            for (let x = CONFIG.CANVAS_WIDTH - 110; x < CONFIG.CANVAS_WIDTH - 10; x += 5) {
                const y = wave.y + Math.sin((x * 0.05) + time + wave.offset) * wave.amplitude;
                if (x === CONFIG.CANVAS_WIDTH - 110) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        });

        // Lake lillies
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.ellipse(CONFIG.CANVAS_WIDTH - 80, 150, 12, 8, 0.2, 0, Math.PI * 2);
        ctx.ellipse(CONFIG.CANVAS_WIDTH - 40, 350, 10, 7, -0.3, 0, Math.PI * 2);
        ctx.ellipse(CONFIG.CANVAS_WIDTH - 70, 550, 11, 7, 0.1, 0, Math.PI * 2);
        ctx.fill();

        // Grass areas
        const grassGradient = ctx.createLinearGradient(0, 0, 0, CONFIG.CANVAS_HEIGHT);
        grassGradient.addColorStop(0, '#3d7a3d');
        grassGradient.addColorStop(1, '#2d5a2d');
        ctx.fillStyle = grassGradient;

        // Top grass
        ctx.fillRect(120, 0, CONFIG.CANVAS_WIDTH - 240, CONFIG.ROAD_Y);
        // Bottom grass
        ctx.fillRect(120, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT,
            CONFIG.CANVAS_WIDTH - 240,
            CONFIG.CANVAS_HEIGHT - CONFIG.ROAD_Y - CONFIG.ROAD_HEIGHT);
    }

    drawTree(ctx, x, y, size, shade) {
        // Trunk
        ctx.fillStyle = `rgb(${Math.floor(70 * shade)}, ${Math.floor(50 * shade)}, ${Math.floor(30 * shade)})`;
        ctx.fillRect(x - size * 0.15, y - size * 0.3, size * 0.3, size * 0.6);

        // Foliage layers
        const greens = [
            `rgb(${Math.floor(40 * shade)}, ${Math.floor(100 * shade)}, ${Math.floor(40 * shade)})`,
            `rgb(${Math.floor(50 * shade)}, ${Math.floor(120 * shade)}, ${Math.floor(50 * shade)})`,
            `rgb(${Math.floor(60 * shade)}, ${Math.floor(140 * shade)}, ${Math.floor(60 * shade)})`
        ];

        greens.forEach((color, i) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y - size * (0.3 + i * 0.25), size * (0.5 - i * 0.1), 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawRoad(ctx) {
        // Road base
        ctx.fillStyle = CONFIG.COLORS.road;
        ctx.fillRect(120, CONFIG.ROAD_Y, CONFIG.CANVAS_WIDTH - 240, CONFIG.ROAD_HEIGHT);

        // Road edges
        ctx.fillStyle = '#555';
        ctx.fillRect(120, CONFIG.ROAD_Y, CONFIG.CANVAS_WIDTH - 240, 4);
        ctx.fillRect(120, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT - 4, CONFIG.CANVAS_WIDTH - 240, 4);

        // Center line (dashed)
        ctx.strokeStyle = CONFIG.COLORS.roadLine;
        ctx.lineWidth = 4;
        ctx.setLineDash([30, 20]);
        ctx.beginPath();
        ctx.moveTo(120, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT / 2);
        ctx.lineTo(CONFIG.CANVAS_WIDTH - 120, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Lane dividers
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.setLineDash([20, 30]);

        const laneHeight = CONFIG.ROAD_HEIGHT / CONFIG.LANE_COUNT;
        for (let i = 1; i < CONFIG.LANE_COUNT; i++) {
            if (i === 2) continue; // Skip center line
            ctx.beginPath();
            ctx.moveTo(120, CONFIG.ROAD_Y + i * laneHeight);
            ctx.lineTo(CONFIG.CANVAS_WIDTH - 120, CONFIG.ROAD_Y + i * laneHeight);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Road sign
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.roundRect(CONFIG.CANVAS_WIDTH / 2 - 80, CONFIG.ROAD_Y - 60, 160, 40, 5);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText('ALMA BRIDGE ROAD', CONFIG.CANVAS_WIDTH / 2, CONFIG.ROAD_Y - 35);
    }

    drawZoneIndicators(ctx) {
        // Forest zone
        if (this.player.isInForestZone()) {
            ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
            ctx.fillRect(0, 0, 120, CONFIG.CANVAS_HEIGHT);
        }

        // Lake zone  
        if (this.player.isInLakeZone()) {
            ctx.fillStyle = 'rgba(33, 150, 243, 0.2)';
            ctx.fillRect(CONFIG.CANVAS_WIDTH - 120, 0, 120, CONFIG.CANVAS_HEIGHT);
        }

        // Zone labels
        ctx.font = 'bold 14px Fredoka';
        ctx.textAlign = 'center';

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.save();
        ctx.translate(25, CONFIG.CANVAS_HEIGHT / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('🌲 FOREST', 0, 0);
        ctx.restore();

        ctx.save();
        ctx.translate(CONFIG.CANVAS_WIDTH - 25, CONFIG.CANVAS_HEIGHT / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText('🌊 LAKE', 0, 0);
        ctx.restore();
    }

    drawDifficultyIndicator(ctx) {
        // Show subtle difficulty indicator in corner
        const diffPercent = ((this.difficulty - 1) / (CONFIG.MAX_DIFFICULTY - 1)) * 100;
        if (diffPercent > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '12px Outfit';
            ctx.textAlign = 'right';
            ctx.fillText(`Speed: ${Math.round(100 + diffPercent)}%`, CONFIG.CANVAS_WIDTH - 130, 20);
        }
    }
}

// ===== INITIALIZE GAME =====
window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
