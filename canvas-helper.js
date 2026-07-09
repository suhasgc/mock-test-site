/**
 * canvas-helper.js
 * Manages drawing canvases for freehand responses in the exam console.
 * Supports mouse and touch events, undo/redo actions, customizable colors/brush size, and image exports.
 */

export class CanvasHelper {
    /**
     * Initializes the canvas helper for a given container element.
     * @param {HTMLCanvasElement} canvasEl - The canvas element to draw on.
     * @param {HTMLElement} toolbarEl - The parent element of the canvas toolbar.
     */
    constructor(canvasEl, toolbarEl) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
        this.toolbar = toolbarEl;
        
        // Drawing state variables
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentSize = 3;
        this.tool = 'brush'; // 'brush' or 'eraser'
        
        // Undo and Redo History
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 30;
        
        // Bind functions
        this.startDrawing = this.startDrawing.bind(this);
        this.draw = this.draw.bind(this);
        this.stopDrawing = this.stopDrawing.bind(this);
        this.handleResize = this.handleResize.bind(this);
        
        this.init();
    }

    init() {
        // Setup scaling for Retina/High-DPI screens
        this.setupScale();
        
        // Event Listeners for drawing (Mouse)
        this.canvas.addEventListener('mousedown', this.startDrawing);
        this.canvas.addEventListener('mousemove', this.draw);
        this.canvas.addEventListener('mouseup', this.stopDrawing);
        this.canvas.addEventListener('mouseleave', this.stopDrawing);
        
        // Event Listeners for drawing (Touch - Tablet/Stylus support)
        this.canvas.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
            e.preventDefault();
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
            e.preventDefault();
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
        }, { passive: false });
        
        // Setup Toolbar controls
        this.setupToolbar();
        
        // Listen to window resizing
        window.addEventListener('resize', this.handleResize);
        
        // Push initial blank state to undo stack
        this.saveState();
    }

    setupScale() {
        const rect = this.canvas.getBoundingClientRect();
        // Set canvas buffer sizes
        this.canvas.width = rect.width || 400;
        this.canvas.height = rect.height || 240;
        
        // Set basic drawing context configuration
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Fill canvas with white background (crucial for exports)
        this.clearCanvasRaw();
    }

    clearCanvasRaw() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    handleResize() {
        // Debounce or temporarily save current state before resizing
        const tempImage = this.canvas.toDataURL();
        
        // Reset canvas sizes
        this.setupScale();
        
        // Draw the image back
        const img = new Image();
        img.onload = () => {
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        };
        img.src = tempImage;
    }

    startDrawing(e) {
        this.isDrawing = true;
        this.redoStack = []; // Clear redo stack on new action
        
        // Find click coordinates relative to canvas
        const coords = this.getCoords(e);
        this.ctx.beginPath();
        this.ctx.moveTo(coords.x, coords.y);
        
        // Set context properties based on current values
        this.ctx.strokeStyle = this.tool === 'eraser' ? '#ffffff' : this.currentColor;
        this.ctx.lineWidth = this.tool === 'eraser' ? this.currentSize * 4 : this.currentSize;
    }

    draw(e) {
        if (!this.isDrawing) return;
        
        const coords = this.getCoords(e);
        this.ctx.lineTo(coords.x, coords.y);
        this.ctx.stroke();
    }

    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.ctx.closePath();
            this.saveState();
        }
    }

    getCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Calculate coordinate scaled to the backing store size
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    setupToolbar() {
        if (!this.toolbar) return;
        
        // Color Swatches
        const colorSwatches = this.toolbar.querySelectorAll('.color-swatch');
        colorSwatches.forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                colorSwatches.forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                
                // Get color from class or style
                if (swatch.classList.contains('black')) this.currentColor = '#000000';
                else if (swatch.classList.contains('blue')) this.currentColor = '#2563eb';
                else if (swatch.classList.contains('red')) this.currentColor = '#dc2626';
                else if (swatch.classList.contains('green')) this.currentColor = '#16a34a';
                
                // Switch back to brush tool if color clicked
                this.setTool('brush');
            });
        });
        
        // Brush Size Slider
        const sizeSlider = this.toolbar.querySelector('.brush-size-slider');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', (e) => {
                this.currentSize = parseInt(e.target.value);
            });
        }
        
        // Eraser Toggle Button
        const eraserBtn = this.toolbar.querySelector('.btn-eraser');
        const brushBtn = this.toolbar.querySelector('.btn-brush');
        
        if (eraserBtn) {
            eraserBtn.addEventListener('click', () => {
                this.setTool('eraser');
                eraserBtn.classList.add('active');
                if (brushBtn) brushBtn.classList.remove('active');
            });
        }
        
        if (brushBtn) {
            brushBtn.addEventListener('click', () => {
                this.setTool('brush');
                brushBtn.classList.add('active');
                if (eraserBtn) eraserBtn.classList.remove('active');
            });
        }
        
        // Action Buttons: Undo, Redo, Clear
        const undoBtn = this.toolbar.querySelector('.btn-undo');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undo());
        }
        
        const redoBtn = this.toolbar.querySelector('.btn-redo');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => this.redo());
        }
        
        const clearBtn = this.toolbar.querySelector('.btn-clear-canvas');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearCanvas());
        }
    }

    setTool(toolName) {
        this.tool = toolName;
        // Adjust display settings depending on eraser vs brush
    }

    saveState() {
        const state = this.canvas.toDataURL();
        this.undoStack.push(state);
        
        // Keep undo stack within limit
        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }
    }

    undo() {
        if (this.undoStack.length > 1) {
            // Move current state to redo
            const currentState = this.undoStack.pop();
            this.redoStack.push(currentState);
            
            // Draw previous state
            const prevState = this.undoStack[this.undoStack.length - 1];
            this.restoreState(prevState);
        }
    }

    redo() {
        if (this.redoStack.length > 0) {
            const nextState = this.redoStack.pop();
            this.undoStack.push(nextState);
            this.restoreState(nextState);
        }
    }

    restoreState(dataURL) {
        const img = new Image();
        img.onload = () => {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        };
        img.src = dataURL;
    }

    clearCanvas() {
        if (confirm('Clear entire drawing?')) {
            this.clearCanvasRaw();
            this.redoStack = [];
            this.saveState();
        }
    }

    /**
     * Loads a drawing from base64 dataURL.
     * @param {string} dataURL - The image dataURL to draw.
     */
    loadImage(dataURL) {
        if (!dataURL) {
            this.clearCanvasRaw();
            this.undoStack = [];
            this.saveState();
            return;
        }
        this.restoreState(dataURL);
        this.undoStack = [dataURL];
        this.redoStack = [];
    }

    /**
     * Exports the current canvas contents as base64 string.
     * @returns {string} - The canvas contents.
     */
    exportImage() {
        return this.canvas.toDataURL('image/png');
    }

    /**
     * Checks if the canvas is blank/untouched.
     * @returns {boolean} - True if blank.
     */
    isCanvasBlank() {
        // Easy heuristic: Check if it's the exact same length as initial blank state
        if (this.undoStack.length <= 1) return true;
        
        // Hard check: Compare pixel data
        const buffer = new Uint32Array(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data.buffer);
        // White is 0xFFFFFFFF, check if all pixels are white
        return !buffer.some(color => color !== 0xFFFFFFFF);
    }
}
