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
    ROAD_Y: 150,
    ROAD_HEIGHT: 500,
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
        forest: ['#0a150a', '#152515', '#253d25'],
        lake: ['#0a151f', '#152535', '#253d4d'],
        road: '#151515',
        roadLine: '#b08d2f',
        roadEdge: '#333',
    },

    // Zones
    ZONE_HEIGHT: 60, // Height of the safe zones at top/bottom
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
    },

    vibrate(pattern) {
        if (navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    }
};

// ===== WEATHER SYSTEM =====
class RainDrop {
    constructor() {
        this.reset();
        // Start at random y to fill screen initially
        this.y = Utils.random(-50, CONFIG.CANVAS_HEIGHT);
    }

    reset() {
        this.x = Utils.random(-100, CONFIG.CANVAS_WIDTH + 100);
        this.y = Utils.random(-50, -10);
        this.len = Utils.random(10, 20);
        this.speed = Utils.random(8, 15);
        this.wind = Utils.random(-1, 2);
    }

    update() {
        this.y += this.speed;
        this.x += this.wind;

        if (this.y > CONFIG.CANVAS_HEIGHT) {
            this.reset();
        }
    }

    draw(ctx) {
        ctx.strokeStyle = 'rgba(174, 194, 224, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.wind, this.y + this.len);
        ctx.stroke();
    }
}

class WeatherSystem {
    constructor() {
        this.drops = [];
        this.intensity = 0; // 0 = Clear, 1 = Heavy Rain
        this.targetIntensity = 0;
        this.timer = 0;
        this.state = 'CLEAR'; // CLEAR, RAINING, STORM

        // Pool of drops
        for (let i = 0; i < 200; i++) {
            this.drops.push(new RainDrop());
        }
    }

    update() {
        // State Machine
        this.timer++;
        if (this.timer > 1200) { // Change weather every ~20 seconds (shortened for demo)
            this.timer = 0;
            if (this.state === 'CLEAR') {
                if (Math.random() < 0.6) this.changeState('RAINING');
            } else if (this.state === 'RAINING') {
                if (Math.random() < 0.4) this.changeState('STORM');
                else this.changeState('CLEAR');
            } else {
                this.changeState('CLEAR');
            }
        }

        // Smooth transition
        if (this.intensity < this.targetIntensity) this.intensity += 0.005;
        if (this.intensity > this.targetIntensity) this.intensity -= 0.005;

        // Update drops
        const activeDrops = Math.floor(this.drops.length * this.intensity);
        for (let i = 0; i < activeDrops; i++) {
            this.drops[i].update();
        }
    }

    changeState(newState) {
        this.state = newState;
        console.log(`Weather changing to: ${newState}`);

        switch (newState) {
            case 'CLEAR':
                this.targetIntensity = 0;
                break;
            case 'RAINING':
                this.targetIntensity = 0.5;
                break;
            case 'STORM':
                this.targetIntensity = 1.0;
                break;
        }
    }

    draw(ctx) {
        if (this.intensity <= 0.01) return;

        const activeDrops = Math.floor(this.drops.length * this.intensity);

        ctx.save();
        // Make rain a bit brighter/glowy
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < activeDrops; i++) {
            this.drops[i].draw(ctx);
        }
        ctx.restore();
    }
}

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
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; // Additive blending for glow
        ctx.fillStyle = this.color;

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        ctx.globalAlpha = 1;
    }
}

// ===== CAR CLASS =====
class Car {
    constructor(direction, lane, speed) {
        this.direction = direction; // 1 = right, -1 = left
        this.lane = lane;
        this.speed = speed;

        // 30% chance to be a motorcycle
        this.isMotorcycle = Math.random() < 0.3;

        if (this.isMotorcycle) {
            this.width = 40;
            this.height = 25;
            this.speed = speed * 1.3; // Motorcycles are faster
        } else {
            this.width = CONFIG.CAR_WIDTH;
            this.height = CONFIG.CAR_HEIGHT;
        }

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

        // Headlight beam (Night Mode) - smaller for motorcycles
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const beamLength = this.isMotorcycle ? 80 : 150;
        const beamSpread = this.isMotorcycle ? 20 : 40;
        const gradient = ctx.createLinearGradient(this.width, this.height / 2, this.width + beamLength, this.height / 2);
        gradient.addColorStop(0, 'rgba(255, 255, 200, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 255, 200, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(this.width - 3, this.height / 2 - 3);
        ctx.lineTo(this.width + beamLength, this.height / 2 - beamSpread);
        ctx.lineTo(this.width + beamLength, this.height / 2 + beamSpread);
        ctx.lineTo(this.width - 3, this.height / 2 + 3);
        ctx.fill();
        ctx.restore();

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(3, 3, this.width, this.height);

        if (this.isMotorcycle) {
            // === MOTORCYCLE DRAWING ===

            // Motorcycle body (frame)
            ctx.fillStyle = this.colorPair[0];
            ctx.beginPath();
            ctx.ellipse(this.width / 2, this.height / 2 + 2, this.width / 2.5, this.height / 4, 0, 0, Math.PI * 2);
            ctx.fill();

            // Seat
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.ellipse(this.width / 2.5, this.height / 2 - 2, 10, 5, 0, 0, Math.PI * 2);
            ctx.fill();

            // Rider body
            ctx.fillStyle = '#2d2d2d'; // Dark jacket
            ctx.beginPath();
            ctx.ellipse(this.width / 2.5, this.height / 2 - 8, 6, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // Rider helmet
            ctx.fillStyle = this.colorPair[1];
            ctx.beginPath();
            ctx.arc(this.width / 2.5, this.height / 2 - 16, 6, 0, Math.PI * 2);
            ctx.fill();

            // Front wheel
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.arc(this.width - 8, this.height - 2, 8, 0, Math.PI * 2);
            ctx.fill();

            // Rear wheel
            ctx.beginPath();
            ctx.arc(8, this.height - 2, 8, 0, Math.PI * 2);
            ctx.fill();

            // Headlight
            ctx.fillStyle = '#fff9c4';
            ctx.beginPath();
            ctx.arc(this.width - 3, this.height / 2, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowColor = '#fff9c4';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Tail light
            ctx.fillStyle = '#ff5252';
            ctx.beginPath();
            ctx.arc(3, this.height / 2, 2, 0, Math.PI * 2);
            ctx.fill();

        } else {
            // === CAR DRAWING ===

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
            ctx.fillStyle = '#1a2530'; // Darker windows for night
            ctx.fillRect(20, 4, 18, 16);
            ctx.fillRect(42, 4, 18, 16);

            // Front light (Headlight source)
            ctx.fillStyle = '#fff9c4';
            ctx.beginPath();
            ctx.arc(this.width - 5, this.height / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            // Glow
            ctx.shadowColor = '#fff9c4';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Rear light
            ctx.fillStyle = '#ff5252';
            ctx.beginPath();
            ctx.arc(5, this.height / 2, 4, 0, Math.PI * 2);
            ctx.fill();

            // Wheels
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.arc(15, this.height, 8, 0, Math.PI * 2);
            ctx.arc(this.width - 15, this.height, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

// ===== NEWT CLASS =====
class Newt {
    constructor(startSide) {
        this.startSide = startSide; // 'forest' (TOP) or 'lake' (BOTTOM)
        this.direction = startSide === 'forest' ? 1 : -1; // 1 = down, -1 = up
        this.size = CONFIG.NEWT_SIZE;
        this.speed = CONFIG.NEWT_SPEED + Utils.random(-0.2, 0.2);

        // Position - Top or Bottom spawning
        this.x = Utils.random(50, CONFIG.CANVAS_WIDTH - 50);

        if (startSide === 'forest') {
            this.y = Utils.random(10, CONFIG.ROAD_Y - 20);
        } else {
            this.y = Utils.random(CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT + 20, CONFIG.CANVAS_HEIGHT - 10);
        }

        // State
        this.isBeingCarried = false;
        this.isSquished = false;
        this.squishedTime = 0;
        // Target is just the other side Y coordinate
        this.targetY = this.direction === 1 ? CONFIG.CANVAS_HEIGHT - 50 : 50;

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
            this.y += this.speed * this.direction;
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
        if (this.direction === 1) { // Going Down
            return this.y >= CONFIG.CANVAS_HEIGHT - 80;
        } else { // Going Up
            return this.y <= 80;
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

        // Face the direction of movement (Up or Down)
        if (this.direction === 1) { // Down
            ctx.rotate(Math.PI / 2);
        } else { // Up
            ctx.rotate(-Math.PI / 2);
        }

        // Wobble animation (side to side relative to movement)
        if (!this.isBeingCarried) {
            ctx.translate(0, Math.sin(this.wobble) * 2);
        }

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.ellipse(2, 2, this.size / 2, this.size / 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // California Newt Colors (Taricha torosa)
        // Dark brown/slate back, orange underside

        // Body (Back)
        ctx.fillStyle = '#5d4037'; // Dark Brown/Slate
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size / 2, this.size / 3.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Underside (peeking out)
        ctx.fillStyle = '#ff6d00'; // Bright Orange
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size / 2.2, this.size / 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Re-draw Back to cover center (rough skin texture)
        ctx.fillStyle = '#6d4c41';
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size / 2.2, this.size / 4.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.fillStyle = '#5d4037';
        ctx.beginPath();
        ctx.ellipse(this.size / 2.5, 0, this.size / 4.5, this.size / 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tail
        ctx.fillStyle = '#5d4037';
        ctx.beginPath();
        ctx.moveTo(-this.size / 2, 0);
        ctx.quadraticCurveTo(-this.size * 0.9, -2, -this.size * 1.0, 0);
        ctx.quadraticCurveTo(-this.size * 0.9, 2, -this.size / 2, 0);
        ctx.fill();

        // Eyes (Bulbous)
        ctx.fillStyle = '#8d6e63';
        ctx.beginPath();
        ctx.arc(this.size / 2.5, -3, 3, 0, Math.PI * 2);
        ctx.arc(this.size / 2.5, 3, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(this.size / 2.5 + 1, -3, 1.5, 0, Math.PI * 2);
        ctx.arc(this.size / 2.5 + 1, 3, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Legs (animated)
        ctx.strokeStyle = '#ff6d00'; // Orange legs
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        const legOffset = this.animFrame === 0 ? 3 : -3;

        // Front legs
        ctx.beginPath();
        ctx.moveTo(5, -5);
        ctx.lineTo(10 + legOffset, -14);
        ctx.moveTo(5, 5);
        ctx.lineTo(10 - legOffset, 14);
        ctx.stroke();

        // Back legs
        ctx.beginPath();
        ctx.moveTo(-8, -5);
        ctx.lineTo(-12 - legOffset, -14);
        ctx.moveTo(-8, 5);
        ctx.lineTo(-12 + legOffset, 14);
        ctx.stroke();

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

        // Dynamic size for mobile
        this.size = Utils.isMobile() ? CONFIG.PLAYER_SIZE * 1.5 : CONFIG.PLAYER_SIZE;

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

        this.mobileInputX = 0;
        this.mobileInputY = 0;
        this.inputMagnitude = 0;
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

            // Apply analog speed control if using joystick
            const currentSpeed = this.inputMagnitude > 0
                ? this.speed * this.inputMagnitude
                : this.speed;

            this.x += dx * currentSpeed;
            this.y += dy * currentSpeed;
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
        return this.y < CONFIG.ZONE_HEIGHT; // Top Zone
    }

    isInLakeZone() {
        return this.y > CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT; // Bottom Zone
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

        // Body (Safety Vest - More Prominent)
        // High visibility lime/orange
        const vestGradient = ctx.createLinearGradient(-20, -20, 20, 20);
        vestGradient.addColorStop(0, '#c6ff00'); // Neon Lime
        vestGradient.addColorStop(0.5, '#ffff00'); // Yellow
        vestGradient.addColorStop(1, '#c6ff00');

        ctx.fillStyle = vestGradient;
        ctx.beginPath();
        ctx.roundRect(-20, -20, 40, 40, 8); // Bigger vest
        ctx.fill();

        // Reflective stripes on vest (Silver)
        ctx.fillStyle = '#e0e0e0';
        // Vertical stripes
        ctx.fillRect(-12, -20, 6, 40);
        ctx.fillRect(6, -20, 6, 40);
        // Horizontal band
        ctx.fillRect(-20, -5, 40, 8);



        // Glow effect for vest
        ctx.shadowColor = '#c6ff00';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#c6ff00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-20, -20, 40, 40, 8);
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

// ===== SCREEN SHAKE =====
class ScreenShake {
    constructor() {
        this.intensity = 0;
        this.duration = 0;
        this.offsetX = 0;
        this.offsetY = 0;
    }

    trigger(intensity, duration) {
        this.intensity = intensity;
        this.duration = duration;
    }

    update() {
        if (this.duration > 0) {
            this.offsetX = Utils.random(-this.intensity, this.intensity);
            this.offsetY = Utils.random(-this.intensity, this.intensity);

            // Dampen
            this.intensity *= 0.9;
            this.duration--;
        } else {
            this.offsetX = 0;
            this.offsetY = 0;
        }
    }
}

// ===== VIRTUAL JOYSTICK =====
// ===== TOUCH CONTROLS =====
class TouchControls {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.originX = 0;
        this.originY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.maxDistance = 60; // Max drag distance for full speed

        this.joystickBase = null;
        this.joystickKnob = null;

        this.setupEvents();
    }

    setupEvents() {
        const zone = document.getElementById('game-container'); // Touch anywhere on game container

        zone.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
        zone.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
        zone.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
        zone.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    }

    createVisuals(x, y) {
        // Remove existing if any
        this.removeVisuals();

        this.joystickBase = document.createElement('div');
        this.joystickBase.className = 'dynamic-joystick-base';
        this.joystickBase.style.left = `${x}px`;
        this.joystickBase.style.top = `${y}px`;

        this.joystickKnob = document.createElement('div');
        this.joystickKnob.className = 'dynamic-joystick-knob';

        this.joystickBase.appendChild(this.joystickKnob);
        document.body.appendChild(this.joystickBase);
    }

    removeVisuals() {
        if (this.joystickBase) {
            this.joystickBase.remove();
            this.joystickBase = null;
            this.joystickKnob = null;
        }
    }

    onStart(e) {
        // Don't interfere with buttons
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        e.preventDefault();
        this.active = true;

        const touch = e.touches[0];
        this.originX = touch.clientX;
        this.originY = touch.clientY;
        this.currentX = touch.clientX;
        this.currentY = touch.clientY;

        this.createVisuals(this.originX, this.originY);
        this.updateInput();
    }

    onMove(e) {
        if (!this.active) return;
        e.preventDefault();

        const touch = e.touches[0];
        this.currentX = touch.clientX;
        this.currentY = touch.clientY;

        this.updateVisuals();
        this.updateInput();
    }

    onEnd(e) {
        this.active = false;
        this.removeVisuals();
        this.game.player.mobileInputX = 0;
        this.game.player.mobileInputY = 0;
        this.game.player.inputMagnitude = 0;
    }

    updateVisuals() {
        if (!this.joystickKnob) return;

        let dx = this.currentX - this.originX;
        let dy = this.currentY - this.originY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > this.maxDistance) {
            const ratio = this.maxDistance / distance;
            dx *= ratio;
            dy *= ratio;
        }

        this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    updateInput() {
        let dx = this.currentX - this.originX;
        let dy = this.currentY - this.originY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Normalize
        if (distance > 0) {
            // Cap at maxDistance for input calculation
            const inputDist = Math.min(distance, this.maxDistance);

            // Normalized direction vector
            const normX = dx / distance;
            const normY = dy / distance;

            // Magnitude 0 to 1 based on drag distance
            const magnitude = inputDist / this.maxDistance;

            this.game.player.mobileInputX = normX * magnitude;
            this.game.player.mobileInputY = normY * magnitude;
            this.game.player.inputMagnitude = magnitude;
        } else {
            this.game.player.mobileInputX = 0;
            this.game.player.mobileInputY = 0;
            this.game.player.inputMagnitude = 0;
        }
    }
}

// ===== LEADERBOARD CLASS =====
class Leaderboard {
    constructor() {
        // Mock data for now, would be replaced by Supabase client
        this.scores = [
            { name: "NewtSVR", score: 150 },
            { name: "ForestR", score: 120 },
            { name: "Amphibian", score: 80 }
        ];
    }

    async getScores() {
        // Simulate API call
        return new Promise(resolve => {
            setTimeout(() => resolve(this.scores.sort((a, b) => b.score - a.score).slice(0, 5)), 500);
        });
    }

    async submitScore(name, score) {
        // Simulate submission
        this.scores.push({ name, score });
        return new Promise(resolve => setTimeout(resolve, 500));
    }

    render(elementId) {
        const list = document.getElementById(elementId);
        if (!list) return;

        list.innerHTML = '<li>Loading...</li>';

        this.getScores().then(data => {
            list.innerHTML = '';
            data.forEach((entry, index) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="rank">#${index + 1}</span>
                    <span class="name">${entry.name}</span>
                    <span class="score">${entry.score}</span>
                `;
                list.appendChild(li);
            });

            if (data.length === 0) {
                list.innerHTML = '<li>No scores yet. Be the first!</li>';
            }
        });
    }
}

// ===== MAIN GAME CLASS =====
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Configure layout for mobile
        this.configureLayout();

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
        this.particles = [];
        this.particles = [];
        this.floatingTexts = [];
        this.screenShake = new ScreenShake();
        this.weather = new WeatherSystem();

        // Leaderboard
        this.leaderboard = new Leaderboard();
        this.leaderboard.render('leaderboard-list');

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

        // Mobile touch controls
        if (Utils.isMobile()) {
            this.touchControls = new TouchControls(this);
        }

        // Start game loop
        requestAnimationFrame(this.update);
    }

    setupCanvas() {
        const isMobile = Utils.isMobile();

        // On mobile, use almost the full screen
        const horizontalPadding = isMobile ? 0 : 20;
        const verticalPadding = isMobile ? 100 : 100; // Reserve space for HUD and joystick

        const maxWidth = window.innerWidth - horizontalPadding;
        const maxHeight = window.innerHeight - verticalPadding;

        const scale = Math.min(maxWidth / CONFIG.CANVAS_WIDTH, maxHeight / CONFIG.CANVAS_HEIGHT);

        this.canvas.width = CONFIG.CANVAS_WIDTH;
        this.canvas.height = CONFIG.CANVAS_HEIGHT;
        this.canvas.style.width = `${CONFIG.CANVAS_WIDTH * scale}px`;
        this.canvas.style.height = `${CONFIG.CANVAS_HEIGHT * scale}px`;
    }

    configureLayout() {
        if (!Utils.isMobile()) return;

        const aspect = window.innerHeight / window.innerWidth;

        // Calculate new height to fill more screen space
        // Base aspect ratio is 0.7 (700/1000)
        // Mobile screens are usually > 1.7

        // We calculate height based on the fixed width of 1000
        let newHeight = Math.floor(CONFIG.CANVAS_WIDTH * aspect);

        // Clamp height to reasonable limits
        // Min 700 (original), Max 2000 (very tall phone)
        newHeight = Math.max(700, Math.min(newHeight, 2000));

        CONFIG.CANVAS_HEIGHT = newHeight;

        // === WIDE ROAD LAYOUT ===
        // Minimize forest and lake to just safety zones
        const minZoneHeight = 80;

        CONFIG.ZONE_HEIGHT = minZoneHeight;

        // Road takes up everything else
        CONFIG.ROAD_HEIGHT = CONFIG.CANVAS_HEIGHT - (minZoneHeight * 2) - 40; // 40px padding just in case

        // Center the road
        CONFIG.ROAD_Y = (CONFIG.CANVAS_HEIGHT - CONFIG.ROAD_HEIGHT) / 2;
    }

    generateTrees() {
        const trees = [];
        for (let i = 0; i < 40; i++) {
            // Generate trees mostly in forest zone (top) but some scattered
            const isForest = Math.random() < 0.8;
            trees.push({
                x: Utils.random(20, CONFIG.CANVAS_WIDTH - 20),
                y: isForest ? Utils.random(10, 110) : Utils.random(130, 180),
                size: Utils.random(20, 45),
                shade: Utils.random(0.5, 0.9) // Darker trees for night
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
        const submitBtn = document.getElementById('submit-score-btn');

        startBtn.addEventListener('click', () => this.startGame());
        restartBtn.addEventListener('click', () => this.restartGame());

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.submitScore());
        }

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

    async submitScore() {
        const nameInput = document.getElementById('player-name');
        const name = nameInput.value.trim() || 'Anonymous';
        const submitBtn = document.getElementById('submit-score-btn');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        await this.leaderboard.submitScore(name, this.score);

        // Refresh display
        this.leaderboard.render('game-over-leaderboard-list');

        // Hide input area after submission
        document.getElementById('submit-score-section').style.display = 'none';
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

        // Re-setup controls reference
        if (this.touchControls) {
            this.touchControls.game = this;
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

        // Update Weather
        this.weather.update();

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

            // Juice
            this.screenShake.trigger(20, 20);
            Utils.vibrate([200]); // Heavy vibration

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

        // Juice
        this.screenShake.trigger(5, 10);
        Utils.vibrate(50); // Light vibration

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

        // Juice
        Utils.vibrate([50, 50, 50]); // Pulse vibration

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

        // Reset and show submission form
        document.getElementById('submit-score-section').style.display = 'flex';
        document.getElementById('submit-score-btn').disabled = false;
        document.getElementById('submit-score-btn').textContent = 'Submit Score';
        document.getElementById('player-name').value = '';

        // Show leaderboard
        this.leaderboard.render('game-over-leaderboard-list');

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

        // Apply Screen Shake
        ctx.save();
        if (this.screenShake.duration > 0) {
            this.screenShake.update();
            ctx.translate(this.screenShake.offsetX, this.screenShake.offsetY);
        }

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

        // Apply Atmospheric Lighting (Night Mode)
        this.drawLighting(ctx);

        // Draw Weather (Rain) - On top of lighting for visibility
        this.weather.draw(ctx);

        // Draw particles (Post-lighting for distinct glow)
        this.particles.forEach(p => p.draw(ctx));

        // Draw floating texts
        this.floatingTexts.forEach(t => t.draw(ctx));

        // Draw difficulty indicator (subtle)
        if (this.state === 'playing' && this.difficulty > 1) {
            this.drawDifficultyIndicator(ctx);
        }

        ctx.restore(); // Restore shake
    }

    drawBackground(ctx) {
        // Forest (Top Zone)
        const forestGradient = ctx.createLinearGradient(0, 0, 0, CONFIG.ZONE_HEIGHT);
        forestGradient.addColorStop(0, '#0a150a');
        forestGradient.addColorStop(1, '#152515');
        ctx.fillStyle = forestGradient;
        ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);

        // Draw trees (Top)
        this.trees.forEach(tree => {
            if (tree.y < CONFIG.ZONE_HEIGHT) // Only draw trees meant for top
                this.drawTree(ctx, tree.x, tree.y, tree.size, tree.shade);
        });

        // Lake (Bottom Zone)
        const lakeGradient = ctx.createLinearGradient(0, CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT, 0, CONFIG.CANVAS_HEIGHT);
        lakeGradient.addColorStop(0, '#152535');
        lakeGradient.addColorStop(1, '#0a151f');
        ctx.fillStyle = lakeGradient;
        ctx.fillRect(0, CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);

        // Lake waves (Horizontal waves)
        const time = Date.now() / 1000;
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.1)'; // Fainter for night
        ctx.lineWidth = 2;

        for (let i = 0; i < 3; i++) {
            const waveY = CONFIG.CANVAS_HEIGHT - 100 + (i * 30);
            ctx.beginPath();
            for (let x = 0; x < CONFIG.CANVAS_WIDTH; x += 10) {
                const y = waveY + Math.sin((x * 0.02) + time + i) * 5;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Grass areas (Between Road and Zones)
        const grassGradient = ctx.createLinearGradient(0, 0, 0, CONFIG.CANVAS_HEIGHT);
        grassGradient.addColorStop(0, '#1a331a');
        grassGradient.addColorStop(1, '#0f1f0f');
        ctx.fillStyle = grassGradient;

        // Top grass (Below Forest, Above Road)
        ctx.fillRect(0, CONFIG.ZONE_HEIGHT, CONFIG.CANVAS_WIDTH, CONFIG.ROAD_Y - CONFIG.ZONE_HEIGHT);

        // Bottom grass (Below Road, Above Lake)
        ctx.fillRect(0, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT,
            CONFIG.CANVAS_WIDTH,
            CONFIG.CANVAS_HEIGHT - (CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT) - CONFIG.ZONE_HEIGHT);
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
        ctx.fillRect(0, CONFIG.ROAD_Y, CONFIG.CANVAS_WIDTH, CONFIG.ROAD_HEIGHT);

        // Road edges
        ctx.fillStyle = '#333';
        ctx.fillRect(0, CONFIG.ROAD_Y, CONFIG.CANVAS_WIDTH, 4);
        ctx.fillRect(0, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT - 4, CONFIG.CANVAS_WIDTH, 4);

        // Center line (dashed)
        ctx.strokeStyle = CONFIG.COLORS.roadLine;
        ctx.lineWidth = 4;
        ctx.setLineDash([30, 20]);
        ctx.beginPath();
        ctx.moveTo(0, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT / 2);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, CONFIG.ROAD_Y + CONFIG.ROAD_HEIGHT / 2);
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
            ctx.moveTo(0, CONFIG.ROAD_Y + i * laneHeight);
            ctx.lineTo(CONFIG.CANVAS_WIDTH, CONFIG.ROAD_Y + i * laneHeight);
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

        // Draw Newt Crossing Sign (Right side)
        this.drawNewtCrossingSign(ctx, CONFIG.CANVAS_WIDTH - 100, CONFIG.ROAD_Y - 80);
    }

    drawNewtCrossingSign(ctx, x, y) {
        ctx.save();
        ctx.translate(x, y);

        // Pole
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(-2, 0, 4, 80);

        // Sign (Yellow Diamond)
        ctx.translate(0, -40);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#f1c40f'; // Warning Yellow
        ctx.beginPath();
        ctx.roundRect(-30, -30, 60, 60, 4);
        ctx.fill();

        // Border
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Icon (Black Newt Silhouette)
        ctx.rotate(-Math.PI / 4); // Reset rotation for icon
        ctx.fillStyle = '#000';

        // Simplified newt shape
        ctx.beginPath();
        // Body
        ctx.ellipse(0, 5, 8, 15, 0, 0, Math.PI * 2);
        // Head
        ctx.ellipse(0, -8, 6, 5, 0, 0, Math.PI * 2);
        // Tail
        ctx.moveTo(0, 15);
        ctx.quadraticCurveTo(5, 25, 0, 30);
        ctx.lineTo(-2, 30);
        ctx.quadraticCurveTo(3, 25, -2, 15);

        ctx.fill();

        // Legs
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        // Front
        ctx.moveTo(4, -5); ctx.lineTo(12, -8);
        ctx.moveTo(-4, -5); ctx.lineTo(-12, -8);
        // Back
        ctx.moveTo(4, 10); ctx.lineTo(12, 12);
        ctx.moveTo(-4, 10); ctx.lineTo(-12, 12);
        ctx.stroke();

        ctx.restore();
    }

    drawZoneIndicators(ctx) {
        // Forest zone (Top)
        if (this.player.isInForestZone()) {
            ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
            ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);
        }

        // Lake zone (Bottom)
        if (this.player.isInLakeZone()) {
            ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
            ctx.fillRect(0, CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);
        }

        // Zone labels
        ctx.font = 'bold 20px Fredoka';
        ctx.textAlign = 'center';

        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';

        // Forest Label
        ctx.fillText('🌲 FOREST (SAFE)', CONFIG.CANVAS_WIDTH / 2, 40);

        // Lake Label
        ctx.fillText('🌊 LAKE (SAFE)', CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - 40);
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

    // Atmospheric Lighting
    drawLighting(ctx) {
        if (!this.lightCanvas) {
            this.lightCanvas = document.createElement('canvas');
            this.lightCanvas.width = CONFIG.CANVAS_WIDTH;
            this.lightCanvas.height = CONFIG.CANVAS_HEIGHT;
            this.lightCtx = this.lightCanvas.getContext('2d');
        }

        // Sync sizes if dynamic
        if (this.lightCanvas.height !== CONFIG.CANVAS_HEIGHT) {
            this.lightCanvas.height = CONFIG.CANVAS_HEIGHT;
        }

        const lCtx = this.lightCtx;
        lCtx.clearRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        // Fill with Darkness
        lCtx.globalCompositeOperation = 'source-over';
        lCtx.fillStyle = 'rgba(10, 15, 20, 0.3)'; // Reduced darkness (was 0.75)
        lCtx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        // Cut out lights (Lights become transparent on the mask)
        lCtx.globalCompositeOperation = 'destination-out';

        // Player Light (Flashlight/Glow)
        const pGrad = lCtx.createRadialGradient(this.player.x, this.player.y, 10, this.player.x, this.player.y, 160); // Increased radius
        pGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        pGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        lCtx.fillStyle = pGrad;
        lCtx.beginPath();
        lCtx.arc(this.player.x, this.player.y, 160, 0, Math.PI * 2);
        lCtx.fill();

        // Car Headlights
        this.cars.forEach(car => {
            lCtx.save();
            lCtx.translate(car.x + car.width / 2, car.y + car.height / 2);
            if (car.direction === -1) lCtx.scale(-1, 1);
            lCtx.translate(-car.width / 2, -car.height / 2);

            // Beam
            const beamLength = car.isMotorcycle ? 200 : 300;
            const beamSpread = car.isMotorcycle ? 30 : 50;

            const grad = lCtx.createLinearGradient(car.width, 0, car.width + beamLength, 0);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

            lCtx.fillStyle = grad;
            lCtx.beginPath();
            lCtx.moveTo(car.width, car.height / 2);
            lCtx.lineTo(car.width + beamLength, car.height / 2 - beamSpread);
            lCtx.lineTo(car.width + beamLength, car.height / 2 + beamSpread);
            lCtx.fill();
            lCtx.restore();
        });

        // Safe Zones (Ambient Glow)
        // Forest
        // Safe Zones (Ambient Glow)
        // Forest
        const fGrad = lCtx.createLinearGradient(0, 0, 0, CONFIG.ZONE_HEIGHT);
        fGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)'); // Slightly brighter ambient
        fGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        lCtx.fillStyle = fGrad;
        lCtx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);

        // Lake
        const lGrad = lCtx.createLinearGradient(0, CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT, 0, CONFIG.CANVAS_HEIGHT);
        lGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        lGrad.addColorStop(1, 'rgba(255, 255, 255, 0.5)'); // Slightly brighter ambient
        lCtx.fillStyle = lGrad;
        lCtx.fillRect(0, CONFIG.CANVAS_HEIGHT - CONFIG.ZONE_HEIGHT, CONFIG.CANVAS_WIDTH, CONFIG.ZONE_HEIGHT);

        // Draw the Mask onto the main canvas
        ctx.drawImage(this.lightCanvas, 0, 0);

        ctx.restore();
    }
}

// ===== INITIALIZE GAME =====
// ===== INITIALIZE GAME =====
window.addEventListener('DOMContentLoaded', () => {
    // Preload Assets
    window.newtImage = new Image();
    window.newtImage.src = 'assets/newt.png';

    new Game();
});
