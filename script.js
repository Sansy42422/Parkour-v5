const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const heightDisplay = document.getElementById('heightDisplay');
const powerBarFill = document.getElementById('power-fill');
const powerText = document.getElementById('power-text');
const gameOverScreen = document.getElementById('game-over-screen');
const finalHeightDisplay = document.getElementById('finalHeightDisplay');
const mobileControls = document.getElementById('mobile-controls');
const timeSlowOverlay = document.createElement('div');
timeSlowOverlay.id = 'time-slow-overlay';
document.getElementById('game-container').appendChild(timeSlowOverlay);
const checkpointHeightDisplay = document.getElementById('checkpointHeightDisplay');


// Buttons
const restartGameButton = document.getElementById('restartGameButton');
const continueFromCheckpointButton = document.getElementById('continueFromCheckpointButton'); // New Checkpoint button
const leftButton = document.getElementById('leftButton');
const jumpButton = document.getElementById('jumpButton');
const rightButton = document.getElementById('rightButton');
const timeSlowButton = document.getElementById('timeSlowButton');
const fullscreenButton = document.getElementById('fullscreenButton'); // New Fullscreen button

// Game Settings
const gameContainer = document.getElementById('game-container'); // Get game container for fullscreen
canvas.width = 600;
canvas.height = 800;
const GRAVITY = 0.8;
const PLAYER_MAX_SPEED = 6;
const PLAYER_JUMP_FORCE = -16;
const PLATFORM_GAP_MIN_Y = 100; // Minimum vertical space between platforms
const PLATFORM_GAP_MAX_Y = 250; // Maximum vertical space
const PLATFORM_WIDTH_MIN = 80;
const PLATFORM_WIDTH_MAX = 200;
const PLATFORM_HORIZONTAL_BUFFER = 50; // Minimum horizontal distance between platforms
const CAMERA_SCROLL_THRESHOLD_Y = canvas.height * 0.4; // When player's Y (relative to camera) goes above this, camera scrolls
const FALL_THRESHOLD_Y = canvas.height + 100; // How far player can fall below the visible canvas before game over

// Time Slow Power Settings
const TIME_SLOW_DURATION = 180; // frames (approx 3 seconds at 60fps)
const TIME_SLOW_COOLDOWN = 600; // frames (approx 10 seconds)
const TIME_SLOW_FACTOR = 0.4; // 0.4 means 40% of normal game speed

let gameRunning = false;
let gameFrame = 0; // Tracks total frames for animations/timers

// Game Objects
let player = {};
let platforms = [];
let cameraY = 0; // Represents the global Y coordinate of the top-left corner of the visible canvas

// Time Slow Variables
let timeSlowActive = false;
let timeSlowTimer = 0;
let timeSlowCooldownTimer = 0; // Starts at 0, meaning it's initially ready
let gameSpeedMultiplier = 1; // Applied to gravity, platform scrolling, etc.

// Checkpoint Variables
const CHECKPOINT_INTERVAL = 1000; // meters
let lastCheckpointHeight = 0;
let savedPlayerGlobalY = null; // Global Y coordinate of player at checkpoint
let savedCameraGlobalY = null; // Global Y coordinate of camera at checkpoint

// Assets
const ASSET_PATHS = {
    player_idle: 'assets/player_idle.png',
    player_jump: 'assets/player_jump.png',
    platform_default: 'assets/platform_default.png',
    bg_layer1: 'assets/bg_layer1.png',
    bg_layer2: 'assets/bg_layer2.png',
    bg_layer3: 'assets/bg_layer3.png',
};

const images = {}; // Stores loaded Image objects

// Asset Loading Function
async function loadAssets() {
    const promises = [];
    for (const key in ASSET_PATHS) {
        const img = new Image();
        img.src = ASSET_PATHS[key];
        images[key] = img; // Store image object directly
        promises.push(new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = () => {
                console.warn(`Failed to load image: ${ASSET_PATHS[key]}. Using fallback color.`);
                images[key] = null; // Mark as failed to load
                resolve(); // Resolve anyway so game can start even with missing assets
            };
        }));
    }
    await Promise.all(promises);
    console.log("All assets loaded or failed gracefully.");
}

// --- Game Initialization ---
function initGame() {
    player = {
        x: canvas.width / 2 - 25,
        y: canvas.height - 100, // Starting near bottom of the canvas
        width: 50,
        height: 80,
        dx: 0,
        dy: 0,
        isJumping: false,
        heightReached: 0, // In game units (e.g., meters)
        state: 'idle', // For player sprite state
        keys: { left: false, right: false } // For continuous horizontal movement
    };

    platforms = [];
    cameraY = 0; // Reset camera to the very bottom of the game world (global Y 0)
    gameFrame = 0;

    timeSlowActive = false;
    timeSlowTimer = 0;
    timeSlowCooldownTimer = 0; // Initially ready
    gameSpeedMultiplier = 1;
    timeSlowOverlay.classList.remove('active'); // Ensure overlay is hidden
    updatePowerUI(); // Update UI to show READY state

    lastCheckpointHeight = 0; // Reset checkpoints for a new game
    savedPlayerGlobalY = null;
    savedCameraGlobalY = null;
    continueFromCheckpointButton.classList.add('hidden'); // Hide button initially

    generateInitialPlatforms(); // Create the starting platforms

    gameRunning = true;
    showScreen(null); // Hide all UI screens to show the game canvas
    gameLoop(); // Start the game loop
}

function restartFromCheckpoint() {
    // Only proceed if a checkpoint was actually saved
    if (savedPlayerGlobalY === null || savedCameraGlobalY === null) {
        console.warn("Attempted to restart from checkpoint, but no checkpoint saved. Starting new game.");
        initGame(); // Fallback to starting a new game
        return;
    }

    player = {
        x: canvas.width / 2 - 25, // Player horizontally centered
        y: savedPlayerGlobalY, // Restore player's global Y position
        width: 50,
        height: 80,
        dx: 0,
        dy: 0,
        isJumping: false,
        heightReached: lastCheckpointHeight, // Restore height to checkpoint
        state: 'idle',
        keys: { left: false, right: false }
    };

    cameraY = savedCameraGlobalY; // Restore camera's global Y position

    platforms = []; // Clear current platforms
    // Regenerate platforms to fill the screen starting from the restored camera position
    let currentY = cameraY + canvas.height; // Start generation from bottom of current viewport
    // We need to generate enough platforms to fill the screen and extend slightly above it.
    // The player's restored Y position is relative to global Y, so platforms should be relative to cameraY too.
    for (let i = 0; i < 20; i++) { // Generate enough to fill screen and slightly beyond
        currentY -= (Math.random() * (PLATFORM_GAP_MAX_Y - PLATFORM_GAP_MIN_Y) + PLATFORM_GAP_MIN_Y);
        generatePlatformAtY(currentY);
    }
    // Ensure the player starts on a valid platform upon respawn.
    // We can add a simple platform directly under the player if no existing one is suitable.
    const playerRelativeY = player.y - cameraY; // Player's Y position relative to canvas
    const platformYForPlayer = cameraY + canvas.height - 20; // Y for a platform at the bottom of the screen (global Y)
    
    // Create a new starting platform at the very bottom of the player's restored screen
    // This ensures player always has a base to land on, even if higher platforms are random.
    platforms.push({ x: 0, y: platformYForPlayer, width: canvas.width, height: 20, type: 'start' });
    
    // After adding the new platform, sort platforms by Y-coordinate ascending for consistent generation logic
    platforms.sort((a,b) => a.y - b.y);

    gameFrame = 0; // Reset frame for timers (optional)
    timeSlowActive = false;
    timeSlowTimer = 0;
    timeSlowCooldownTimer = 0;
    gameSpeedMultiplier = 1;
    timeSlowOverlay.classList.remove('active');
    updatePowerUI();

    gameRunning = true;
    showScreen(null);
    gameLoop();
}


// --- Player Functions ---
function drawPlayer() {
    // Determine which player image to draw based on state
    const img = images[player.state === 'jumping' || player.dy !== 0 ? 'player_jump' : 'player_idle'];
    if (img && img.complete && img.naturalWidth > 0) {
        // Draw image at player's position relative to the camera
        ctx.drawImage(img, player.x, player.y - cameraY, player.width, player.height);
    } else {
        // Fallback to drawing a colored rectangle if image fails to load
        ctx.fillStyle = '#ff6347'; // Tomato color
        ctx.fillRect(player.x, player.y - cameraY, player.width, player.height);
    }
}

function updatePlayer() {
    // Apply horizontal movement based on pressed keys
    if (player.keys.left) player.dx = -PLAYER_MAX_SPEED;
    else if (player.keys.right) player.dx = PLAYER_MAX_SPEED;
    else player.dx = 0;

    player.x += player.dx;

    // Apply gravity
    player.dy += GRAVITY * gameSpeedMultiplier; // Gravity is affected by time slow
    player.y += player.dy;

    // Keep player within horizontal canvas bounds
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > canvas.width) player.x = canvas.width - player.width;

    // Check for falling off the screen (below camera's view)
    if (player.y - cameraY > FALL_THRESHOLD_Y) {
        endGame();
    }
}

function playerJump() {
    if (!player.isJumping) {
        player.dy = PLAYER_JUMP_FORCE;
        player.isJumping = true;
        player.state = 'jumping';
    }
}

// --- Platform Functions ---
function generateInitialPlatforms() {
    // Create a wide starting platform at the bottom
    platforms.push({ x: 0, y: canvas.height - 20, width: canvas.width, height: 20, type: 'start' });

    // Generate platforms upwards to fill the initial screen
    let currentY = canvas.height - 100; // Start generation above the starting platform
    for (let i = 0; i < 15; i++) { // Generate enough to fill initial screen and slightly beyond
        currentY -= (Math.random() * (PLATFORM_GAP_MAX_Y - PLATFORM_GAP_MIN_Y) + PLATFORM_GAP_MIN_Y);
        generatePlatformAtY(currentY);
    }
}

function generatePlatformAtY(y) {
    const width = Math.random() * (PLATFORM_WIDTH_MAX - PLATFORM_WIDTH_MIN) + PLATFORM_WIDTH_MIN;
    let x = Math.random() * (canvas.width - width); // Random X position within canvas width

    // Optional: Add logic to ensure platforms are reachable and not too clustered horizontally
    // For a basic "Only Up" game, simply generating them randomly is often sufficient
    // but we can add a simple check to spread them out a bit.
    if (platforms.length > 0) {
        const highestPlatform = platforms.reduce((acc, p) => p.y < acc.y ? p : acc, platforms[0]); // Get truly highest
        const centerHighest = highestPlatform.x + highestPlatform.width / 2;
        const centerNew = x + width / 2;

        // If the new platform is horizontally close to the last one (and vertically close too),
        // try to push it to the other side to encourage horizontal movement
        if (Math.abs(centerNew - centerHighest) < PLATFORM_HORIZONTAL_BUFFER + Math.max(width, highestPlatform.width) / 2 &&
            Math.abs(y - highestPlatform.y) < PLATFORM_GAP_MIN_Y + 50) { // Only apply if somewhat vertically close
            if (centerNew < canvas.width / 2) {
                x = Math.random() * (canvas.width / 2 - width); // Try left half
            } else {
                x = canvas.width / 2 + Math.random() * (canvas.width / 2 - width); // Try right half
            }
            x = Math.max(0, Math.min(x, canvas.width - width)); // Ensure it's still in bounds
        }
    }


    platforms.push({
        x: x,
        y: y,
        width: width,
        height: 20, // All platforms have a fixed height
        type: 'normal' // Could add different types later (e.g., moving, crumbling)
    });
}


function updatePlatforms() {
    // Collision detection between player and platforms
    platforms.forEach(platform => {
        // Only check for collision if player is falling (dy > 0)
        if (player.dy > 0 && checkCollision(player, platform)) {
            // Player lands on platform
            player.dy = 0;
            player.y = platform.y - player.height; // Snap player to the top of the platform
            player.isJumping = false;
            player.state = 'idle'; // Reset player state to idle
        }
    });

    // Remove platforms that are far below the camera's view
    platforms = platforms.filter(platform => platform.y - cameraY < canvas.height + 50); // Keep platforms slightly off-screen for smooth transition

    // Generate new platforms as player goes up
    // Find the highest (lowest Y value) platform currently in the game world
    // Reduce function ensures we find the lowest Y (highest in game world) among existing platforms.
    // If no platforms exist, it returns a high value (canvas.height + 100) to ensure generation starts immediately.
    const highestPlatformY = platforms.reduce((minY, p) => Math.min(minY, p.y), cameraY + canvas.height + 100);
    
    // Generate new platforms if the highest existing platform is approaching the top of the screen
    // We generate platforms ahead of time (2*PLATFORM_GAP_MAX_Y) to ensure a smooth flow.
    while (highestPlatformY - cameraY > -PLATFORM_GAP_MAX_Y * 2) {
        // Calculate new Y for the next platform, ensuring it's above the current highest
        const newY = highestPlatformY - (Math.random() * (PLATFORM_GAP_MAX_Y - PLATFORM_GAP_MIN_Y) + PLATFORM_GAP_MIN_Y);
        generatePlatformAtY(newY);
        // Update highestPlatformY to the newly created platform's Y for the next iteration of the while loop
        // This ensures generation continues upwards from the very last platform added.
        platforms.sort((a,b) => a.y - b.y); // Keep platforms sorted by Y for consistent highestPlatformY retrieval
        highestPlatformY = platforms[0].y; // After sorting, platforms[0] is the highest (lowest Y)
    }
}


function drawPlatforms() {
    const platformImg = images['platform_default'];
    platforms.forEach(platform => {
        if (platformImg && platformImg.complete && platformImg.naturalWidth > 0) {
            // Draw image at platform's position relative to the camera
            ctx.drawImage(platformImg, platform.x, platform.y - cameraY, platform.width, platform.height);
        } else {
            // Fallback to colored rectangle
            ctx.fillStyle = '#8B4513'; // SaddleBrown
            ctx.fillRect(platform.x, platform.y - cameraY, platform.width, platform.height);
        }
    });
}

// --- Camera / Scrolling ---
function updateCamera() {
    // If player goes above a certain threshold (e.g., 40% from top of canvas),
    // scroll the camera upwards (i.e., decrease cameraY)
    if (player.y - cameraY < CAMERA_SCROLL_THRESHOLD_Y) {
        cameraY = player.y - CAMERA_SCROLL_THRESHOLD_Y;
    }
    // Calculate and update the height reached (score)
    // The player's height increases as cameraY decreases (player.y is global)
    // We subtract player.y from cameraY to get player's position relative to global 0, then convert to meters.
    player.heightReached = Math.max(player.heightReached, Math.floor((Math.abs(cameraY) + (canvas.height - (player.y - cameraY))) / 10)); // Convert game units to "meters"

    // Check for new checkpoints
    const currentCheckpointTarget = lastCheckpointHeight + CHECKPOINT_INTERVAL;
    if (player.heightReached >= currentCheckpointTarget) {
        lastCheckpointHeight = currentCheckpointTarget;
        savedPlayerGlobalY = player.y; // Save player's current global Y
        savedCameraGlobalY = cameraY; // Save camera's current global Y
        console.log(`Checkpoint reached at ${lastCheckpointHeight}m!`);
        // Optionally display a temporary message on screen
        checkpointHeightDisplay.textContent = lastCheckpointHeight; // Update text for checkpoint button on game over screen
        // No need to show button here, only on game over
    }
}

// --- Time Slow Power ---
function activateTimeSlow() {
    // Only activate if not already active and cooldown is finished
    if (timeSlowCooldownTimer <= 0 && !timeSlowActive && gameRunning) {
        timeSlowActive = true;
        timeSlowTimer = TIME_SLOW_DURATION; // Set active duration
        gameSpeedMultiplier = TIME_SLOW_FACTOR; // Apply slow-down factor
        timeSlowOverlay.classList.add('active'); // Show visual effect
        updatePowerUI(); // Update UI
    }
}

function updatePowerUI() { // Added this function to simplify initial UI update
    if (timeSlowActive) {
        powerText.textContent = 'Time Slow: ACTIVE!';
        powerBarFill.style.backgroundColor = '#00f';
    } else if (timeSlowCooldownTimer > 0) {
        powerText.textContent = `Time Slow: COOLDOWN (${Math.ceil(timeSlowCooldownTimer / 60)}s)`; // Display seconds remaining
        powerBarFill.style.backgroundColor = '#888';
    } else {
        powerText.textContent = 'Time Slow: READY';
        powerBarFill.style.backgroundColor = '#0f0';
    }
}

function updateTimeSlow() {
    if (timeSlowActive) {
        timeSlowTimer--;
        if (timeSlowTimer <= 0) {
            // Time slow duration ended
            timeSlowActive = false;
            timeSlowCooldownTimer = TIME_SLOW_COOLDOWN; // Start cooldown
            gameSpeedMultiplier = 1; // Reset game speed to normal
            timeSlowOverlay.classList.remove('active'); // Hide visual effect
            updatePowerUI(); // Update UI
        }
    } else {
        if (timeSlowCooldownTimer > 0) {
            timeSlowCooldownTimer--;
            updatePowerUI();
        } else if (powerText.textContent !== 'Time Slow: READY') { // Prevent constant DOM updates if already ready
            updatePowerUI(); // Cooldown finished
        }
    }

    // Update power bar UI to reflect active time or cooldown progress
    const progress = timeSlowActive ? (timeSlowTimer / TIME_SLOW_DURATION) :
                     (timeSlowCooldownTimer > 0 ? (1 - (timeSlowCooldownTimer / TIME_SLOW_COOLDOWN)) : 1);
    powerBarFill.style.width = `${progress * 100}%`;
}


// --- Utility Functions ---
// Basic AABB collision detection
function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawBackground() {
    // Always draw a base sky color
    ctx.fillStyle = '#87ceeb'; // Sky blue
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Parallax layers: draw multiple times to create a seamless looping effect
    const layers = [
        { img: images['bg_layer3'], speed: 0.1, yOffset: 0 },   // Farthest, slowest (e.g., distant sky patterns)
        { img: images['bg_layer2'], speed: 0.3, yOffset: -50 },  // Mid-distance
        { img: images['bg_layer1'], speed: 0.5, yOffset: -100 } // Closest, fastest (e.g., mountains, closer clouds)
    ];

    layers.forEach(layer => {
        if (layer.img && layer.img.complete && layer.img.naturalWidth > 0) {
            // Calculate how much the layer should scroll based on camera Y
            // The `%` operator makes it loop seamlessly once the image height is passed
            const scrollY = (cameraY * layer.speed) % layer.img.naturalHeight;

            // Draw the image at its current scrolled position
            ctx.drawImage(layer.img, 0, scrollY + layer.yOffset, canvas.width, layer.img.naturalHeight);
            // Draw a second copy above the first to create the seamless loop as it scrolls
            ctx.drawImage(layer.img, 0, scrollY + layer.yOffset - layer.img.naturalHeight, canvas.width, layer.img.naturalHeight);
        }
    });
}

function updateUI() {
    heightDisplay.textContent = player.heightReached;
}

// Manages which screen is visible (game over screen)
function showScreen(screenId) {
    const screens = [gameOverScreen]; // List all possible game screens (only game over for now)
    screens.forEach(screen => screen.classList.remove('active')); // Hide all screens

    if (screenId) {
        document.getElementById(screenId).classList.add('active'); // Show the specified screen
    }

    // Manage mobile controls and fullscreen button visibility based on whether the game is actively running
    if (gameRunning) { // If gameRunning is true, show controls and fullscreen button
        mobileControls.style.display = 'flex';
        fullscreenButton.style.display = 'block';
    } else { // If gameRunning is false (e.g., game over), hide controls and fullscreen button
        mobileControls.style.display = 'none';
        fullscreenButton.style.display = 'none';
    }
}

// --- Fullscreen Functionality ---
function toggleFullscreen() {
    if (!document.fullscreenElement &&    // standard
        !document.mozFullScreenElement && // Firefox
        !document.webkitFullscreenElement && // Chrome, Safari and Opera
        !document.msFullscreenElement) {  // IE/Edge
        if (gameContainer.requestFullscreen) {
            gameContainer.requestFullscreen();
        } else if (gameContainer.mozRequestFullScreen) {
            gameContainer.mozRequestFullScreen();
        } else if (gameContainer.webkitRequestFullscreen) {
            gameContainer.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT); // Safari specific flag for keyboard input
        } else if (gameContainer.msRequestFullscreen) {
            gameContainer.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// --- Main Game Loop ---
function gameLoop() {
    if (!gameRunning) return; // Stop loop if game is not running

    clearCanvas(); // Clear previous frame
    drawBackground(); // Draw background layers
    updatePlatforms(); // Update platform positions and handle collisions
    drawPlatforms(); // Draw platforms
    updatePlayer(); // Update player position and physics
    drawPlayer(); // Draw player
    updateCamera(); // Adjust camera based on player's height
    updateTimeSlow(); // Handle time slow power logic and cooldown
    updateUI(); // Update score/height display

    gameFrame++; // Increment frame counter
    requestAnimationFrame(gameLoop); // Request next animation frame
}

// --- Game State Management ---
function endGame() {
    gameRunning = false; // Stop the game loop
    finalHeightDisplay.textContent = player.heightReached; // Display final score
    // Show continue from checkpoint button only if a checkpoint was reached
    if (lastCheckpointHeight > 0 && savedPlayerGlobalY !== null) { // Ensure actual data was saved
        continueFromCheckpointButton.classList.remove('hidden');
        checkpointHeightDisplay.textContent = lastCheckpointHeight; // Update text for button
    } else {
        continueFromCheckpointButton.classList.add('hidden'); // Ensure hidden if no checkpoint
    }
    showScreen('game-over-screen'); // Show game over screen
}

// --- Event Listeners ---
restartGameButton.addEventListener('click', initGame);
continueFromCheckpointButton.addEventListener('click', restartFromCheckpoint); // Event Listener for new button

fullscreenButton.addEventListener('click', toggleFullscreen); // Fullscreen button listener

// Keyboard Controls (using `keydown` for continuous movement, `keyup` to stop)
const keys = {}; // Object to track currently pressed keys
window.addEventListener('keydown', (e) => {
    if (gameRunning) {
        if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') player.keys.left = true;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') player.keys.right = true;
        if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w' || e.key === ' ') {
            playerJump();
            e.preventDefault(); // Prevent page scrolling with arrow keys or spacebar
        }
        if (e.key.toLowerCase() === 'f' || e.key === 'Control') { // 'f' or 'Control' for time slow
            activateTimeSlow();
            e.preventDefault();
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (gameRunning) {
        if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') player.keys.left = false;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') player.keys.right = false;
    }
});

// Mobile Controls (using touchstart/touchend for continuous input)
leftButton.addEventListener('touchstart', (e) => { e.preventDefault(); player.keys.left = true; }, { passive: false });
leftButton.addEventListener('touchend', (e) => { e.preventDefault(); player.keys.left = false; });
rightButton.addEventListener('touchstart', (e) => { e.preventDefault(); player.keys.right = true; }, { passive: false });
rightButton.addEventListener('touchend', (e) => { e.preventDefault(); player.keys.right = false; });

jumpButton.addEventListener('touchstart', (e) => { e.preventDefault(); playerJump(); }, { passive: false });
timeSlowButton.addEventListener('touchstart', (e) => { e.preventDefault(); activateTimeSlow(); }, { passive: false });


// Initial setup: Load assets and then start the game immediately
loadAssets().then(() => {
    initGame(); // Directly start the game
});
