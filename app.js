/**
 * app.js
 * Core application controller.
 * Manages routing, state, storage databases, OMR setup, split-screen PDF loading,
 * proctoring, scoring rules (CAT/XAT), charts, and the Error Log vault.
 */

import { mockExams, sectionalMocks, dailyDrills } from './questions-data.js';
import { CanvasHelper } from './canvas-helper.js';

// ==========================================================================
// STATE MANAGEMENT & DATABASES
// ==========================================================================
const state = {
    // Current Active View in Dashboard
    activeView: 'dashboard',
    
    // Loaded Mocks Database (built-in + imported)
    mocks: [...mockExams, ...sectionalMocks, ...dailyDrills],
    
    // User attempts (loaded from localStorage)
    attempts: [],
    
    // Error log items (loaded from localStorage)
    errors: [],
    
    // Current running test state
    runningTest: {
        testId: null,
        testName: '',
        type: 'cat', // 'cat' or 'xat'
        category: 'full', // 'full', 'sectional', 'daily', 'pdf'
        mode: 'timed', // 'timed' or 'practice'
        
        currentSection: null,
        currentQuestionIndex: 0,
        
        // Maps questionId -> Array of selected options or text string
        answers: {},
        // Maps questionId -> Base64 dataURL for drawings
        drawings: {},
        
        // Timer tracking
        totalTimeSpent: 0,
        sectionTimeLeft: {}, // seconds left per section (for sectional timed)
        overallTimeLeft: 0, // overall seconds left (for non-sectional timed)
        timeSpentPerQuestion: {}, // maps questionId -> seconds
        
        // Proctoring infractions
        infractions: 0,
        isFullscreenActive: false,
        
        // Question states mapping (visited, answered, marked, answered_marked)
        questionStates: {}, // questionId -> 'not-visited'|'not-answered'|'answered'|'marked'|'answered-marked'
        
        // Interactive Canvas helper instance
        canvasHelper: null
    },
    
    // Temp PDF settings
    pdfConfig: {
        file: null,
        fileName: '',
        template: 'cat',
        customSections: []
    }
};

// ==========================================================================
// INITIALIZATION & MAIN ENTRY POINT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadDatabase();
    initRouting();
    initDashboard();
    initLibrary();
    initErrorLog();
    initCalculator();
    initImporter();
    initProctoring();
    initSplitter();
    preloadMocks();
});

// Load stats and values from localStorage
function loadDatabase() {
    try {
        state.attempts = JSON.parse(localStorage.getItem('theMBAroom_attempts')) || [];
        state.errors = JSON.parse(localStorage.getItem('theMBAroom_errors')) || [];
    } catch (e) {
        console.error("Failed to load local database, resetting", e);
        state.attempts = [];
        state.errors = [];
    }
    updateGlobalBadges();
}

// Fetch and load heavy offline mocks automatically
function preloadMocks() {
    const mockFiles = [
        'simcat19_data.json',
        'simcat18_data.json',
        'simcat17_data.json',
        'simcat16_data.json',
        'simcat15_data.json',
        'simcat13_data.json',
        'simcat12_data.json',
        'simcat11_data.json',
        'simcat9_data.json',
        'simcat8_data.json',
        'simcat7_data.json',
        'simcat6_data.json',
        'simcat5_data.json',
        'simcat4_data.json',
        'simcat3_data.json',
        'simcat2_data.json',
        'simcat1_data.json'
    ];
    
    const clFiles = [
        'cl_lrdi_1_exam_portal.json', 'cl_lrdi_2_exam_portal.json', 'cl_lrdi_3_exam_portal.json', 'cl_lrdi_4_exam_portal.json', 'cl_lrdi_5_exam_portal.json',
        'cl_lrdi_6_exam_portal.json', 'cl_lrdi_7_exam_portal.json', 'cl_lrdi_8_exam_portal.json', 'cl_lrdi_9_exam_portal.json', 'cl_lrdi_10_exam_portal.json',
        'cl_lrdi_11_exam_portal.json', 'cl_lrdi_12_exam_portal.json', 'cl_lrdi_13_exam_portal.json', 'cl_lrdi_14_exam_portal.json', 'cl_lrdi_15_exam_portal.json',
        'cl_qa_1_exam_portal.json', 'cl_qa_2_exam_portal.json', 'cl_qa_3_exam_portal.json', 'cl_qa_4_exam_portal.json', 'cl_qa_5_exam_portal.json',
        'cl_qa_6_exam_portal.json', 'cl_qa_7_exam_portal.json', 'cl_qa_8_exam_portal.json', 'cl_qa_9_exam_portal.json', 'cl_qa_10_exam_portal.json',
        'cl_qa_11_exam_portal.json', 'cl_qa_12_exam_portal.json', 'cl_qa_13_exam_portal.json', 'cl_qa_14_exam_portal.json', 'cl_qa_15_exam_portal.json',
        'cl_varc_1_exam_portal.json', 'cl_varc_2_exam_portal.json', 'cl_varc_3_exam_portal.json', 'cl_varc_4_exam_portal.json', 'cl_varc_5_exam_portal.json',
        'cl_varc_6_exam_portal.json', 'cl_varc_7_exam_portal.json', 'cl_varc_8_exam_portal.json', 'cl_varc_9_exam_portal.json', 'cl_varc_10_exam_portal.json',
        'cl_varc_11_exam_portal.json', 'cl_varc_12_exam_portal.json', 'cl_varc_13_exam_portal.json', 'cl_varc_14_exam_portal.json', 'cl_varc_15_exam_portal.json'
    ];
    
    const allFiles = [...mockFiles, ...clFiles];
    
    allFiles.forEach(file => {
        fetch(file)
            .then(res => {
                if (!res.ok) throw new Error("HTTP error " + res.status);
                return res.json();
            })
            .then(data => {
                const duration = data.sections && Object.keys(data.sections).length * 40 || 120;
                const sectionTimes = {};
                if (data.sections) {
                    Object.keys(data.sections).forEach(secName => {
                        sectionTimes[secName] = 40; // Default CAT 40 mins per section
                    });
                }
                
                const isCl = file.startsWith('cl_');
                const mockObject = {
                    id: file.replace('_data.json', '').replace('.json', ''),
                    name: data.name || file.replace('_data.json', '').replace('.json', '').toUpperCase(),
                    type: (data.name && data.name.toLowerCase().includes('xat')) ? 'xat' : 'cat',
                    category: isCl ? 'sectional' : 'full',
                    description: `Official offline mock containing ${Object.keys(data.questions || {}).length} questions across ${Object.keys(data.sections || {}).length} sections.`,
                    duration: duration,
                    isSectionalTimed: !(data.name && data.name.toLowerCase().includes('xat')),
                    sections: data.sections || {},
                    sectionTimes: sectionTimes,
                    questions: data.questions || {}
                };
                
                if (!state.mocks.some(m => m.id === mockObject.id)) {
                    state.mocks.push(mockObject);
                }
                
                // Re-render views if active
                if (state.activeView === 'library') renderLibrary();
                if (state.activeView === 'dashboard') renderDashboardMocks();
            })
            .catch(err => {
                console.warn(`Could not preload ${file}:`, err);
            });
    });
    
    // Fetch TIME OMR PDF Mocks
    fetch('time_mocks_data.json')
        .then(res => {
            if (!res.ok) throw new Error("HTTP error " + res.status);
            return res.json();
        })
        .then(dataList => {
            dataList.forEach(mockObject => {
                if (!state.mocks.some(m => m.id === mockObject.id)) {
                    state.mocks.push(mockObject);
                }
            });
            // Re-render views if active
            if (state.activeView === 'library') renderLibrary();
            if (state.activeView === 'dashboard') renderDashboardMocks();
        })
        .catch(err => {
            console.warn("Could not preload TIME OMR PDF mocks:", err);
        });
        
    // Fetch consolidated IMS & Career Launcher 2023 Mocks
    fetch('ims_cl_2023_data.json')
        .then(res => {
            if (!res.ok) throw new Error("HTTP error " + res.status);
            return res.json();
        })
        .then(dataList => {
            dataList.forEach(mockObject => {
                if (!state.mocks.some(m => m.id === mockObject.id)) {
                    state.mocks.push(mockObject);
                }
            });
            // Re-render views if active
            if (state.activeView === 'library') renderLibrary();
            if (state.activeView === 'dashboard') renderDashboardMocks();
        })
        .catch(err => {
            console.warn("Could not preload IMS/CL 2023 mocks:", err);
        });
}

function saveDatabase() {
    localStorage.setItem('theMBAroom_attempts', JSON.stringify(state.attempts));
    localStorage.setItem('theMBAroom_errors', JSON.stringify(state.errors));
    updateGlobalBadges();
}

function updateGlobalBadges() {
    const errorBadge = document.getElementById('error-badge');
    const statError = document.getElementById('stat-error-items');
    const statTotal = document.getElementById('stat-total-tests');
    const statAvgScore = document.getElementById('stat-avg-score');
    
    const activeErrors = state.errors.filter(e => !e.solved).length;
    if (errorBadge) errorBadge.textContent = activeErrors;
    if (statError) statError.textContent = activeErrors;
    if (statTotal) statTotal.textContent = state.attempts.length;
    
    if (statAvgScore && state.attempts.length > 0) {
        const sum = state.attempts.reduce((acc, curr) => acc + curr.accuracy, 0);
        statAvgScore.textContent = (sum / state.attempts.length).toFixed(1) + '%';
    }
}

// ==========================================================================
// ROUTING & VIEW CONTROLLERS
// ==========================================================================
function initRouting() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetView = item.getAttribute('data-view');
            switchView(targetView);
            
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
    
    // Light/Dark Theme toggle
    const themeBtn = document.getElementById('global-theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theMBAroom_theme', newTheme);
        });
        
        // Restore theme
        const savedTheme = localStorage.getItem('theMBAroom_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
}

function switchView(viewName) {
    state.activeView = viewName;
    
    // Toggle main content sections
    document.querySelectorAll('.view-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    const activePanel = document.getElementById(`view-${viewName}`);
    if (activePanel) activePanel.classList.add('active');
    
    // Trigger view-specific refreshes
    if (viewName === 'dashboard') renderDashboardActivity();
    if (viewName === 'library') renderLibrary();
    if (viewName === 'error-log') renderErrorLog();
    if (viewName === 'analytics') renderAnalytics();
}

// ==========================================================================
// IMPORTER ENGINE (.html or .pdf files)
// ==========================================================================
function initImporter() {
    const importHtmlBtn = document.getElementById('btn-import-html');
    const filePicker = document.getElementById('html-file-picker');
    
    if (importHtmlBtn && filePicker) {
        importHtmlBtn.addEventListener('click', () => filePicker.click());
        filePicker.addEventListener('change', handleHTMLImport);
    }
    
    // Modal split-screen PDF Setup
    const importPdfBtn = document.getElementById('btn-import-pdf');
    const closePdfBtn = document.getElementById('btn-close-pdf-config');
    const cancelPdfBtn = document.getElementById('btn-cancel-pdf-config');
    const pdfModal = document.getElementById('pdf-config-modal');
    
    if (importPdfBtn && pdfModal) {
        importPdfBtn.addEventListener('click', () => {
            pdfModal.style.display = 'flex';
        });
    }
    
    const closeModal = () => { if (pdfModal) pdfModal.style.display = 'none'; };
    if (closePdfBtn) closePdfBtn.addEventListener('click', closeModal);
    if (cancelPdfBtn) cancelPdfBtn.addEventListener('click', closeModal);
    
    // File Selector inside OMR PDF Setup Modal
    const pdfModalBtn = document.getElementById('btn-select-pdf-modal');
    const pdfPicker = document.getElementById('pdf-file-picker');
    if (pdfModalBtn && pdfPicker) {
        pdfModalBtn.addEventListener('click', () => pdfPicker.click());
        pdfPicker.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                state.pdfConfig.file = file;
                state.pdfConfig.fileName = file.name;
                const modalLabel = document.getElementById('pdf-modal-file-label');
                if (modalLabel) modalLabel.textContent = file.name;
            }
        });
    }
    
    // Start split-screen button in setup modal
    const startPdfBtn = document.getElementById('btn-start-pdf-practice');
    if (startPdfBtn) {
        startPdfBtn.addEventListener('click', startPDFPractice);
    }
}

function handleHTMLImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        
        // Find testData JSON in the HTML code robustly using flexible regex
        const regex = /(?:const|let|var|window\.)?\s*testData\s*=\s*/;
        const match = text.match(regex);
        
        if (match) {
            const startIdx = match.index;
            const braceIdx = text.indexOf('{', startIdx + match[0].length - 2);
            
            if (braceIdx !== -1) {
                let braces = 1;
                let endIdx = braceIdx + 1;
                let inString = null; // null or '"' or "'" or '`'
                let isEscaped = false;
                
                while (braces > 0 && endIdx < text.length) {
                    const char = text[endIdx];
                    
                    if (isEscaped) {
                        isEscaped = false;
                    } else if (char === '\\') {
                        isEscaped = true;
                    } else if (inString) {
                        if (char === inString) {
                            inString = null; // Exit string
                        }
                    } else if (char === '"' || char === "'" || char === '`') {
                        inString = char; // Enter string
                    } else if (char === '{') {
                        braces++;
                    } else if (char === '}') {
                        braces--;
                    }
                    endIdx++;
                }
                
                if (braces === 0) {
                    try {
                        const rawJson = text.substring(braceIdx, endIdx);
                        const parsed = JSON.parse(rawJson);
                        importMockData(parsed);
                        return;
                    } catch (parseErr) {
                        alert("Import Error: Found the testData block, but failed to parse JSON: " + parseErr.message);
                        console.error(parseErr);
                        return;
                    }
                } else {
                    alert("Import Error: Found 'testData = {', but could not find the matching closing brace. The file may be truncated.");
                    return;
                }
            }
        }
        
        alert("Import Error: Could not locate 'testData = { ... }' in this HTML file. Please verify it is a valid offline mock HTML file.");
    };
    reader.readAsText(file);
}

function importMockData(data) {
    // Check format compatibility
    if (!data.name || !data.questions || !data.sections) {
        alert("Import Error: Invalid data structure. Requires name, questions, and sections keys.");
        return;
    }
    
    const newMockId = "imported-" + Date.now();
    const duration = data.sections && Object.keys(data.sections).length * 40 || 120;
    
    // Parse times
    const sectionTimes = {};
    Object.keys(data.sections).forEach(secName => {
        sectionTimes[secName] = 40; // Default CAT standard 40m
    });
    
    const mockObject = {
        id: newMockId,
        name: data.name,
        type: data.name.toLowerCase().includes('xat') ? 'xat' : 'cat',
        description: `Imported offline HTML mock containing ${Object.keys(data.questions).length} questions across ${Object.keys(data.sections).length} sections.`,
        duration: duration,
        isSectionalTimed: !data.name.toLowerCase().includes('xat'),
        sections: data.sections,
        sectionTimes: sectionTimes,
        questions: data.questions
    };
    
    // Save to state mocks
    state.mocks.push(mockObject);
    alert(`Successfully imported "${data.name}"! You can now start it from the Mock Library.`);
    
    // Shift view to library
    switchView('library');
}

function startPDFPractice() {
    const pdfConfig = state.pdfConfig;
    if (!pdfConfig.file) {
        alert("Please select a PDF mock document file first.");
        return;
    }
    
    // Build a mock PDF test object based on template
    const template = document.getElementById('pdf-select-template').value;
    const testId = "pdf-mock-" + Date.now();
    const fileUrl = URL.createObjectURL(pdfConfig.file);
    
    let mockObject = {
        id: testId,
        name: "OMR Practice: " + pdfConfig.fileName,
        type: template === 'xat' ? 'xat' : 'cat',
        category: 'pdf',
        description: `Split-screen OMR answering sheet for PDF document.`,
        duration: template === 'xat' ? 175 : 120,
        isSectionalTimed: template !== 'xat',
        fileUrl: fileUrl,
        sections: {},
        sectionTimes: {},
        questions: {}
    };
    
    if (template === 'cat') {
        mockObject.sections = {
            "Verbal Ability & Reading Comprehension": Array.from({length: 24}, (_, i) => `pdf-q-${i+1}`),
            "Data Interpretation & Logical Reasoning": Array.from({length: 22}, (_, i) => `pdf-q-${i+25}`),
            "Quantitative Ability": Array.from({length: 22}, (_, i) => `pdf-q-${i+47}`)
        };
        mockObject.sectionTimes = {
            "Verbal Ability & Reading Comprehension": 40,
            "Data Interpretation & Logical Reasoning": 40,
            "Quantitative Ability": 40
        };
        
        // Generate blank/dummy questions
        generateDummyQuestions(mockObject, 1, 24, false); // MCQ VARC
        generateDummyQuestions(mockObject, 25, 46, false); // MCQ DILR
        generateDummyQuestions(mockObject, 47, 68, true);  // TITA QA
    } else if (template === 'xat') {
        mockObject.sections = {
            "Verbal & Logical Ability": Array.from({length: 26}, (_, i) => `pdf-q-${i+1}`),
            "Decision Making": Array.from({length: 21}, (_, i) => `pdf-q-${i+27}`),
            "Quantitative Ability & DI": Array.from({length: 28}, (_, i) => `pdf-q-${i+48}`)
        };
        mockObject.sectionTimes = {
            "Verbal & Logical Ability": 60,
            "Decision Making": 50,
            "Quantitative Ability & DI": 65
        };
        generateDummyQuestions(mockObject, 1, 75, false); // All MCQs for XAT
    }
    
    state.mocks.push(mockObject);
    
    // Close modal
    document.getElementById('pdf-config-modal').style.display = 'none';
    
    // Prompt to start this mock
    promptTestStart(mockObject);
}

function generateDummyQuestions(mockObj, start, end, isTitaDefault) {
    for (let i = start; i <= end; i++) {
        const qId = `pdf-q-${i}`;
        // Alternating MCQ and TITA for custom tests
        const isTita = isTitaDefault || (i % 8 === 0 || i % 9 === 0);
        mockObj.questions[qId] = {
            id: qId,
            marks: mockObj.type === 'xat' ? 1 : 3,
            negative_marks: mockObj.type === 'xat' ? 0.25 : (isTita ? 0.0 : 1.0),
            is_input_type: isTita,
            instructions: `<p>Refer to Question ${i} in your PDF document.</p>`,
            question_text: `Select or type your answer for Question ${i} corresponding to the PDF mock text.`,
            options: isTita ? [] : ["Option A", "Option B", "Option C", "Option D", "Option E"],
            correct_response: isTita ? [["DUMMY"]] : [["1"]], // Dummy answer (user grades their own OMR later)
            solution: `<p>Refer to the answer sheet supplied with your PDF document to verify this solution.</p>`
        };
    }
}

// ==========================================================================
// DASHBOARD VIEW RENDERING
// ==========================================================================
function initDashboard() {
    renderDashboardMocks();
    renderDashboardErrors();
    
    document.getElementById('btn-see-all-mocks').addEventListener('click', () => {
        switchView('library');
    });
    document.getElementById('btn-go-to-errors').addEventListener('click', () => {
        switchView('error-log');
    });
}

function renderDashboardMocks() {
    const container = document.getElementById('dashboard-mock-list');
    if (!container) return;
    container.innerHTML = '';
    
    // Pick first 3 mocks
    const displayMocks = state.mocks.filter(m => m.category !== 'daily').slice(0, 3);
    
    if (displayMocks.length === 0) {
        container.innerHTML = '<div class="no-data">No mocks available. Click Import HTML to add one.</div>';
        return;
    }
    
    displayMocks.forEach(mock => {
        const card = document.createElement('div');
        card.className = 'mock-compact-card';
        
        let metaHtml = `
            <span><i class="fa-regular fa-clock"></i> ${mock.duration} mins</span>
            <span><i class="fa-solid fa-list-check"></i> ${Object.keys(mock.questions).length} Qs</span>
        `;
        if (mock.category === 'pdf') {
            metaHtml += `<span><i class="fa-solid fa-file-pdf"></i> PDF mode</span>`;
        }
        
        card.innerHTML = `
            <div class="mock-info-side">
                <h4>${mock.name}</h4>
                <div class="meta">${metaHtml}</div>
            </div>
            <div class="mock-action-side">
                <button class="action-btn secondary small btn-start-mock" data-id="${mock.id}" data-mode="practice">Practice</button>
                <button class="action-btn primary small btn-start-mock" data-id="${mock.id}" data-mode="timed">Take Exam</button>
            </div>
        `;
        container.appendChild(card);
    });
    
    // Add event listeners to start buttons
    container.querySelectorAll('.btn-start-mock').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = btn.getAttribute('data-id');
            const mode = btn.getAttribute('data-mode');
            const targetMock = state.mocks.find(m => m.id === id);
            if (targetMock) startExamConsole(targetMock, mode);
        });
    });
}

function renderDashboardErrors() {
    const container = document.getElementById('dashboard-error-list');
    if (!container) return;
    
    const activeErrors = state.errors.filter(e => !e.solved).slice(0, 4);
    if (activeErrors.length === 0) {
        container.innerHTML = '<div class="no-data" style="padding: 20px; text-align: center; color: var(--text-secondary);">Your Error Log is clean! Any incorrect/flagged question appears here.</div>';
        return;
    }
    
    let html = `<table class="data-table" style="font-size: 0.8rem;">
        <thead>
            <tr>
                <th>Test</th>
                <th>Subject</th>
                <th>Error Snippet</th>
            </tr>
        </thead>
        <tbody>`;
        
    activeErrors.forEach(err => {
        const cleanText = err.questionText.replace(/<[^>]*>/g, '').substring(0, 40) + '...';
        html += `
            <tr style="cursor: pointer;" onclick="window.appNavigateToErrors()">
                <td><strong>${err.testName.substring(0, 15)}...</strong></td>
                <td><span class="badge-solid reviewing">${err.sectionName}</span></td>
                <td>${cleanText}</td>
            </tr>
        `;
    });
    
    html += `</tbody></table>`;
    container.innerHTML = html;
    
    // Bind global trigger
    window.appNavigateToErrors = () => switchView('error-log');
}

function renderDashboardActivity() {
    const svg = document.getElementById('activity-svg');
    if (!svg) return;
    svg.innerHTML = '';
    
    const width = svg.clientWidth || 500;
    const height = 200;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    // Handle empty data
    if (state.attempts.length === 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', (width / 2).toString());
        text.setAttribute('y', (height / 2).toString());
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--text-muted)');
        text.textContent = 'No test activity recorded yet.';
        svg.appendChild(text);
        return;
    }
    
    // Render score progression line chart using SVG
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const data = state.attempts.slice(-7); // Last 7 attempts
    const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
    
    let points = [];
    data.forEach((att, idx) => {
        const x = padding + idx * xStep;
        // accuracy scale 0 to 100
        const y = padding + chartHeight - (att.accuracy / 100) * chartHeight;
        points.push({x, y, accuracy: att.accuracy, name: att.testName});
    });
    
    // Draw background grid lines
    for (let i = 0; i <= 4; i++) {
        const yVal = padding + (chartHeight / 4) * i;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padding.toString());
        line.setAttribute('y1', yVal.toString());
        line.setAttribute('x2', (width - padding).toString());
        line.setAttribute('y2', yVal.toString());
        line.setAttribute('stroke', 'var(--border-color)');
        line.setAttribute('stroke-dasharray', '4 4');
        svg.appendChild(line);
        
        // Label
        const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelText.setAttribute('x', (padding - 10).toString());
        labelText.setAttribute('y', (yVal + 4).toString());
        labelText.setAttribute('text-anchor', 'end');
        labelText.setAttribute('fill', 'var(--text-muted)');
        labelText.setAttribute('font-size', '10');
        labelText.textContent = (100 - i * 25) + '%';
        svg.appendChild(labelText);
    }
    
    // Draw line
    if (points.length > 0) {
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
            d += ` L ${points[i].x} ${points[i].y}`;
        }
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--primary)');
        path.setAttribute('stroke-width', '3');
        svg.appendChild(path);
        
        // Draw points and values
        points.forEach(pt => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', pt.x.toString());
            circle.setAttribute('cy', pt.y.toString());
            circle.setAttribute('r', '5');
            circle.setAttribute('fill', 'var(--bg-app)');
            circle.setAttribute('stroke', 'var(--primary)');
            circle.setAttribute('stroke-width', '2');
            svg.appendChild(circle);
            
            // Value text overlay
            const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            valText.setAttribute('x', pt.x.toString());
            valText.setAttribute('y', (pt.y - 10).toString());
            valText.setAttribute('text-anchor', 'middle');
            valText.setAttribute('fill', 'var(--text-primary)');
            valText.setAttribute('font-size', '10');
            valText.setAttribute('font-weight', '600');
            valText.textContent = pt.accuracy.toFixed(0) + '%';
            svg.appendChild(valText);
        });
    }
}

// ==========================================================================
// MOCK LIBRARY RENDERING
// ==========================================================================

// Library state — active exam filter and active section tab
const libraryState = { filter: 'all', tab: 'full' };

function initLibrary() {
    // Exam-type filter buttons (All / CAT / XAT / PDF)
    const filterBtns = document.querySelectorAll('[data-exam-filter]');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            libraryState.filter = btn.getAttribute('data-exam-filter');
            renderLibrary();
        });
    });

    // Section tab buttons (Full / Sectional / Daily / PDF)
    const tabBtns = document.querySelectorAll('[data-section-tab]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            libraryState.tab = btn.getAttribute('data-section-tab');
            renderLibrary();
        });
    });
}

function renderLibrary() {
    const grid = document.getElementById('library-mocks-grid');
    if (!grid) return;

    const { filter, tab } = libraryState;

    // Step 1: apply exam-type filter (all / cat / xat / pdf)
    let base = state.mocks;
    if (filter === 'cat')       base = state.mocks.filter(m => m.type === 'cat' && m.category !== 'pdf');
    else if (filter === 'xat')  base = state.mocks.filter(m => m.type === 'xat' && m.category !== 'pdf');
    else if (filter === 'pdf')  base = state.mocks.filter(m => m.category === 'pdf');

    // Step 2: update tab counts based on filtered base
    const countFull      = base.filter(m => !['sectional','daily','pdf'].includes(m.category)).length;
    const countSectional = base.filter(m => m.category === 'sectional').length;
    const countDaily     = base.filter(m => m.category === 'daily').length;
    const countPdf       = base.filter(m => m.category === 'pdf').length;
    const setCount = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setCount('tab-count-full',      countFull);
    setCount('tab-count-sectional', countSectional);
    setCount('tab-count-daily',     countDaily);
    setCount('tab-count-pdf',       countPdf);

    // Step 3: apply section tab filter
    let filteredMocks;
    if (tab === 'full')           filteredMocks = base.filter(m => !['sectional','daily','pdf'].includes(m.category));
    else if (tab === 'sectional') filteredMocks = base.filter(m => m.category === 'sectional');
    else if (tab === 'daily')     filteredMocks = base.filter(m => m.category === 'daily');
    else if (tab === 'pdf')       filteredMocks = base.filter(m => m.category === 'pdf');
    else                          filteredMocks = base;

    // Sort by id descending
    filteredMocks.sort((a, b) => b.id.toString().localeCompare(a.id.toString()));

    grid.innerHTML = '';

    if (filteredMocks.length === 0) {
        grid.innerHTML = '<div class="no-data" style="grid-column:span 3;padding:40px;text-align:center;color:var(--text-secondary);">No mock tests found in this section.</div>';
        renderScoreboard();
        return;
    }

    filteredMocks.forEach(mock => {
        const card = document.createElement('div');
        card.className = 'library-card';

        // Badge
        let typeBadge = `<span class="exam-type-badge ${mock.type}">${mock.type.toUpperCase()}</span>`;
        if (mock.category === 'pdf')       typeBadge = `<span class="exam-type-badge pdf">PDF</span>`;
        else if (mock.category === 'sectional') typeBadge = `<span class="exam-type-badge sectional">Sectional</span>`;
        else if (mock.category === 'daily')     typeBadge = `<span class="exam-type-badge daily">Daily</span>`;

        // Best attempt badge
        const pastAttempts = state.attempts.filter(a => a.testId === mock.id);
        const bestAttempt  = pastAttempts.length > 0
            ? pastAttempts.reduce((best, a) => a.score > best.score ? a : best, pastAttempts[0])
            : null;

        const attemptedHtml = bestAttempt
            ? `<div class="card-best-score"><i class="fa-solid fa-medal"></i> Best: <strong>${bestAttempt.score.toFixed(1)} / ${bestAttempt.maxScore}</strong> &nbsp;&middot;&nbsp; ${bestAttempt.accuracy.toFixed(0)}% acc</div>`
            : `<div class="card-not-attempted"><i class="fa-regular fa-circle"></i> Not attempted</div>`;

        card.innerHTML = `
            ${typeBadge}
            <h4>${mock.name}</h4>
            <p class="description">${mock.description}</p>
            <div class="meta-details">
                <div class="meta-row"><i class="fa-regular fa-clock"></i> ${mock.duration} minutes</div>
                <div class="meta-row"><i class="fa-solid fa-list-check"></i> ${Object.keys(mock.questions).length} questions</div>
                <div class="meta-row"><i class="fa-solid fa-layer-group"></i> ${Object.keys(mock.sections).join(', ')}</div>
            </div>
            ${attemptedHtml}
            <div class="card-actions">
                <button class="action-btn secondary btn-start" data-id="${mock.id}" data-mode="practice">Practice</button>
                <button class="action-btn primary btn-start"   data-id="${mock.id}" data-mode="timed">Exam Mode</button>
            </div>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.btn-start').forEach(btn => {
        btn.addEventListener('click', () => {
            const id   = btn.getAttribute('data-id');
            const mode = btn.getAttribute('data-mode');
            const targetMock = state.mocks.find(m => m.id === id);
            if (targetMock) promptTestStart(targetMock, mode);
        });
    });

    renderScoreboard();
}

// --------------------------------------------------------------------------
// SCOREBOARD — left sidebar showing all past attempts with percentile
// --------------------------------------------------------------------------
function renderScoreboard() {
    const summaryEl = document.getElementById('scoreboard-summary');
    const listEl    = document.getElementById('scoreboard-list');
    if (!summaryEl || !listEl) return;

    const attempts = [...state.attempts].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (attempts.length === 0) {
        summaryEl.innerHTML = `<div class="scoreboard-empty"><i class="fa-solid fa-chart-bar"></i><p>No tests taken yet.<br>Complete a mock to see your scores here.</p></div>`;
        listEl.innerHTML = '';
        return;
    }

    const avgScore  = attempts.reduce((s, a) => s + a.accuracy, 0) / attempts.length;
    const totalFull = attempts.filter(a => !['sectional','daily','pdf'].includes(a.category)).length;
    const totalSect = attempts.filter(a => a.category === 'sectional').length;

    summaryEl.innerHTML = `
        <div class="sb-stat"><span class="sb-stat-val">${attempts.length}</span><span class="sb-stat-lbl">Total</span></div>
        <div class="sb-stat"><span class="sb-stat-val">${avgScore.toFixed(0)}%</span><span class="sb-stat-lbl">Avg Acc</span></div>
        <div class="sb-stat"><span class="sb-stat-val">${totalFull}</span><span class="sb-stat-lbl">Full</span></div>
        <div class="sb-stat"><span class="sb-stat-val">${totalSect}</span><span class="sb-stat-lbl">Sect</span></div>
    `;

    listEl.innerHTML = '';
    attempts.forEach(att => {
        // Percentile among same mock attempts
        const peers  = state.attempts.filter(a => a.testId === att.testId);
        const beaten = peers.filter(a => a.score < att.score).length;
        const pct    = peers.length > 1 ? Math.round((beaten / (peers.length - 1)) * 100) : 100;
        const pctClass = pct >= 90 ? 'excellent' : pct >= 75 ? 'good' : pct >= 50 ? 'average' : 'low';

        let sectionHtml = '';
        if (att.sectionalReport && att.sectionalReport.length > 0) {
            sectionHtml = att.sectionalReport.map(r =>
                `<span class="sb-sec">${r.section.substring(0,4)}: <strong>${r.score.toFixed(0)}</strong></span>`
            ).join('');
        }

        const row = document.createElement('div');
        row.className = 'scoreboard-item';
        row.innerHTML = `
            <div class="sb-item-top">
                <div class="sb-name" title="${att.testName}">${att.testName}</div>
                <div class="sb-percentile ${pctClass}">${pct}th %ile</div>
            </div>
            <div class="sb-item-scores">
                <span class="sb-score">${att.score.toFixed(1)} / ${att.maxScore}</span>
                <span class="sb-acc">${att.accuracy.toFixed(0)}% acc</span>
                <span class="sb-mode">${att.mode}</span>
            </div>
            ${sectionHtml ? `<div class="sb-sections">${sectionHtml}</div>` : ''}
            <div class="sb-date">${att.date}</div>
        `;
        listEl.appendChild(row);
    });
}

function promptTestStart(mock, preselectedMode = null) {
    if (preselectedMode) {
        startExamConsole(mock, preselectedMode);
    } else {
        // Simple confirm logic
        const mode = confirm(`Start "${mock.name}" in Strict Timed Exam Mode?\n\n- Click OK for Timed Exam Mode (strict layout, countdown timers, fullscreen proctoring simulation).\n- Click CANCEL for Practice Mode (untimed, free subject jumping, answer solutions visible instantly).`) ? 'timed' : 'practice';
        startExamConsole(mock, mode);
    }
}

// ==========================================================================
// THE EXAM CONSOLE MODULE
// ==========================================================================
function startExamConsole(mock, mode) {
    const consoleView = document.getElementById('exam-console');
    if (!consoleView) return;
    
    // Setup running state
    state.runningTest = {
        testId: mock.id,
        testName: mock.name,
        type: mock.type,
        category: mock.category || 'full',
        mode: mode,
        
        currentSection: Object.keys(mock.sections)[0],
        currentQuestionIndex: 0,
        
        answers: {},
        drawings: {},
        
        totalTimeSpent: 0,
        sectionTimeLeft: {},
        overallTimeLeft: mock.duration * 60,
        timeSpentPerQuestion: {},
        
        infractions: 0,
        isFullscreenActive: false,
        questionStates: {},
        canvasHelper: null
    };
    
    // Initialize section times left
    Object.keys(mock.sections).forEach(secName => {
        const secMins = mock.sectionTimes[secName] || 40;
        state.runningTest.sectionTimeLeft[secName] = secMins * 60;
    });
    
    // Initialize question status states
    Object.keys(mock.questions).forEach(qId => {
        state.runningTest.questionStates[qId] = 'not-visited';
    });
    
    // Mark first question as not-answered (viewed)
    const firstQ = mock.sections[state.runningTest.currentSection][0];
    state.runningTest.questionStates[firstQ] = 'not-answered';
    
    // Enter Fullscreen if Exam Mode
    if (mode === 'timed') {
        requestFullscreenConsole();
    }
    
    // Set UI elements
    document.getElementById('exam-title-display').textContent = mock.name;
    document.getElementById('console-mode-label').textContent = mode === 'timed' ? 'Strict Timed' : 'Untimed Practice';
    document.getElementById('exam-badge-type').textContent = (mock.category === 'pdf' ? 'PDF OMR' : mock.type.toUpperCase()) + " MOCK";
    
    // Setup Split screen (Passage vs PDF)
    const leftPanelPassage = document.getElementById('passage-viewer-container');
    const leftPanelPdf = document.getElementById('pdf-viewer-container');
    
    if (mock.category === 'pdf' || mock.fileUrl) {
        if (leftPanelPassage) leftPanelPassage.style.display = 'none';
        if (leftPanelPdf) leftPanelPdf.style.display = 'flex';
        
        // Bind PDF iframe source
        const iframe = document.getElementById('pdf-iframe');
        const placeholder = document.getElementById('pdf-placeholder');
        const fileNameLabel = document.getElementById('loaded-pdf-name');
        
        if (mock.fileUrl) {
            iframe.src = mock.fileUrl;
            iframe.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            if (fileNameLabel) fileNameLabel.textContent = mock.name;
        } else {
            iframe.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
            if (fileNameLabel) fileNameLabel.textContent = 'Select PDF Mock';
            
            // Allow loading local PDF inside console
            const loadPdfBtn = document.getElementById('btn-load-pdf-placeholder');
            const picker = document.getElementById('pdf-file-picker');
            if (loadPdfBtn && picker) {
                const triggerPicker = () => picker.click();
                loadPdfBtn.removeEventListener('click', triggerPicker);
                loadPdfBtn.addEventListener('click', triggerPicker);
                
                picker.onchange = (evt) => {
                    const file = evt.target.files[0];
                    if (file) {
                        const url = URL.createObjectURL(file);
                        iframe.src = url;
                        iframe.style.display = 'block';
                        placeholder.style.display = 'none';
                        fileNameLabel.textContent = file.name;
                    }
                };
            }
        }
    } else {
        if (leftPanelPassage) leftPanelPassage.style.display = 'flex';
        if (leftPanelPdf) leftPanelPdf.style.display = 'none';
    }
    
    // Build section navigation tabs
    renderConsoleSectionTabs(mock);
    
    // Show Console view overlay
    consoleView.style.display = 'flex';
    
    // Load question UI
    loadConsoleQuestion();
    
    // Start timing clock loops
    startConsoleTimers();
    
    // Start webcam scanning feeds
    startWebcamSimulation();
    
    // Bind workspace navigation buttons
    bindConsoleNavButtons();
}

function requestFullscreenConsole() {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) docEl.requestFullscreen();
    else if (docEl.mozRequestFullScreen) docEl.mozRequestFullScreen();
    else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
    else if (docEl.msRequestFullscreen) docEl.msRequestFullscreen();
    state.runningTest.isFullscreenActive = true;
}

function exitFullscreenConsole() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
    state.runningTest.isFullscreenActive = false;
}

// Render tabs VARC, DILR, QA
function renderConsoleSectionTabs(mock) {
    const container = document.getElementById('exam-sections-tabs-container');
    if (!container) return;
    container.innerHTML = '';
    
    Object.keys(mock.sections).forEach(secName => {
        const tab = document.createElement('button');
        tab.className = 'section-tab';
        if (secName === state.runningTest.currentSection) tab.classList.add('active');
        tab.textContent = secName.replace('Ability & Reading Comprehension', 'RC').replace('Interpretation & Logical Reasoning', 'LR');
        
        // Locked linear progress logic in timed mode
        const isCat = mock.type === 'cat';
        const isLocked = state.runningTest.mode === 'timed' && isCat && secName !== state.runningTest.currentSection;
        
        if (isLocked) {
            tab.classList.add('locked');
            tab.title = "Sections are locked in linear sequence for CAT Exam Mode.";
        } else {
            tab.addEventListener('click', () => {
                // Save current question timers
                saveCurrentQuestionTimeSpent();
                
                state.runningTest.currentSection = secName;
                state.runningTest.currentQuestionIndex = 0;
                
                // Update active tabs
                container.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                loadConsoleQuestion();
            });
        }
        
        container.appendChild(tab);
    });
}

function loadConsoleQuestion() {
    const mock = state.mocks.find(m => m.id === state.runningTest.testId);
    const run = state.runningTest;
    const currentQuestions = mock.sections[run.currentSection];
    const qId = currentQuestions[run.currentQuestionIndex];
    const question = mock.questions[qId];
    
    // Update labels
    document.getElementById('current-q-num').textContent = (run.currentQuestionIndex + 1).toString();
    document.getElementById('q-positive-mark').textContent = `+${question.marks} Correct`;
    document.getElementById('q-negative-mark').textContent = `-${question.negative_marks} Incorrect`;
    
    // Update PDF Split-Screen source if sectional PDF is defined
    if (mock.category === 'pdf' && mock.pdfFiles && mock.pdfFiles[run.currentSection]) {
        const iframe = document.getElementById('pdf-iframe');
        const placeholder = document.getElementById('pdf-placeholder');
        const fileNameLabel = document.getElementById('loaded-pdf-name');
        
        const targetPdf = mock.pdfFiles[run.currentSection];
        // Only update if it is different to prevent iframe reloading/flickering
        if (iframe && iframe.src !== window.location.origin + '/' + targetPdf && iframe.getAttribute('src') !== targetPdf) {
            iframe.src = targetPdf;
            iframe.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            if (fileNameLabel) fileNameLabel.textContent = `TIME Mock Section: ${run.currentSection}`;
        }
    }
    
    // Set Question Context passage
    const passageViewer = document.getElementById('passage-body-content');
    if (passageViewer) {
        if (question.instructions) {
            passageViewer.innerHTML = question.instructions;
            document.getElementById('passage-viewer-container').style.display = 'flex';
        } else {
            passageViewer.innerHTML = '<div class="no-data">No specific passage context for this section. Questions are self-contained.</div>';
            // In interactive mode, if no instruction context exists, we can hide the left panel or keep it blank
        }
    }
    
    // Set Question text
    const textContainer = document.getElementById('interactive-question-text');
    if (textContainer) {
        textContainer.innerHTML = question.question_text;
    }
    
    // Set Inputs
    const inputContainer = document.getElementById('question-answers-container');
    if (inputContainer) {
        inputContainer.innerHTML = '';
        
        if (question.is_drawing_type) {
            // Freehand Canvas Input
            renderDrawingInput(inputContainer, qId);
        } else if (question.is_input_type) {
            // TITA numerical/text response input
            renderTitaInput(inputContainer, qId);
        } else {
            // Multiple Choice Options
            renderMcqInput(inputContainer, qId, question.options);
        }
    }
    
    // Check if we are in practice mode, show solution toggle box
    const solutionBox = document.getElementById('practice-solution-box');
    const revealedSolution = document.getElementById('revealed-solution-content');
    if (solutionBox && revealedSolution) {
        if (run.mode === 'practice') {
            solutionBox.style.display = 'block';
            revealedSolution.style.display = 'none';
            revealedSolution.innerHTML = `
                <div class="correct-answer" style="margin-top: 0; margin-bottom: 12px;">
                    <strong>Correct Answer:</strong> ${getFormattedCorrectAnswer(question)}
                </div>
                <div>${question.solution || 'No explanation provided.'}</div>
            `;
            
            // Re-bind click
            const revealBtn = document.getElementById('btn-reveal-solution');
            revealBtn.onclick = () => {
                revealedSolution.style.display = revealedSolution.style.display === 'none' ? 'block' : 'none';
                revealBtn.innerHTML = revealedSolution.style.display === 'none' ? 
                    '<i class="fa-solid fa-eye"></i> Reveal Explanation' : 
                    '<i class="fa-solid fa-eye-slash"></i> Hide Explanation';
            };
        } else {
            solutionBox.style.display = 'none';
        }
    }
    
    // Render palette side buttons grid
    renderPaletteGrid(mock);
    
    // Log start time of question
    run.questionStartTime = Date.now();
    
    // Update navigation buttons status (disable prev if first Q)
    const prevBtn = document.getElementById('btn-prev-question');
    if (prevBtn) {
        prevBtn.disabled = run.currentQuestionIndex === 0;
    }
}

function getFormattedCorrectAnswer(question) {
    if (question.is_input_type) return question.correct_response[0][0];
    const correctIndices = question.correct_response[0].map(Number);
    return correctIndices.map(idx => {
        // Return letter option matching index
        const alphabet = ['A', 'B', 'C', 'D', 'E', 'F'];
        return alphabet[idx - 1] || idx;
    }).join(', ');
}

function renderMcqInput(parent, qId, options) {
    options.forEach((optText, index) => {
        const optionEl = document.createElement('div');
        optionEl.className = 'mcq-option';
        
        const optionVal = index.toString();
        const savedAnswer = state.runningTest.answers[qId] || [];
        const isSelected = savedAnswer.includes(optionVal);
        
        if (isSelected) optionEl.classList.add('selected');
        
        const alphabet = ['A', 'B', 'C', 'D', 'E', 'F'];
        const letter = alphabet[index] || (index + 1);
        
        optionEl.innerHTML = `
            <div class="option-letter">${letter}</div>
            <div class="option-text">${optText}</div>
        `;
        
        optionEl.addEventListener('click', () => {
            const currentSelected = parent.querySelector('.mcq-option.selected');
            if (currentSelected) currentSelected.classList.remove('selected');
            
            optionEl.classList.add('selected');
            state.runningTest.answers[qId] = [optionVal];
            
            // Mark state as answered
            state.runningTest.questionStates[qId] = 'answered';
            saveCurrentQuestionTimeSpent();
            renderPaletteGrid(state.mocks.find(m => m.id === state.runningTest.testId));
        });
        
        parent.appendChild(optionEl);
    });
}

function renderTitaInput(parent, qId) {
    const container = document.createElement('div');
    container.className = 'tita-container';
    
    const savedVal = state.runningTest.answers[qId] ? state.runningTest.answers[qId][0] : '';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tita-input';
    input.id = 'console-tita-input';
    input.value = savedVal;
    input.placeholder = 'Type response using layout below...';
    
    // Save response immediately when typing
    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val) {
            state.runningTest.answers[qId] = [val];
            state.runningTest.questionStates[qId] = 'answered';
        } else {
            delete state.runningTest.answers[qId];
            state.runningTest.questionStates[qId] = 'not-answered';
        }
    });
    
    // Build custom interactive on-screen numpad popover
    const keyb = document.createElement('div');
    keyb.className = 'keyboard-layout';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', '-', 'Clear', 'Back'];
    
    keys.forEach(k => {
        const kEl = document.createElement('button');
        kEl.className = 'kbd-key';
        kEl.textContent = k;
        
        kEl.addEventListener('click', () => {
            if (k === 'Clear') {
                input.value = '';
            } else if (k === 'Back') {
                input.value = input.value.slice(0, -1);
            } else {
                input.value += k;
            }
            
            // Dispatch input event to save values
            input.dispatchEvent(new Event('input'));
        });
        
        keyb.appendChild(kEl);
    });
    
    container.appendChild(input);
    container.appendChild(keyb);
    parent.appendChild(container);
}

function renderDrawingInput(parent, qId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'drawing-response-container';
    
    wrapper.innerHTML = `
        <div class="canvas-toolbar" id="toolbar-${qId}">
            <div class="toolbar-group">
                <label>Brush:</label>
                <div class="color-swatch black active" title="Black"></div>
                <div class="color-swatch blue" title="Blue"></div>
                <div class="color-swatch red" title="Red"></div>
                <div class="color-swatch green" title="Green"></div>
            </div>
            <div class="toolbar-group">
                <input type="range" class="brush-size-slider" min="1" max="10" value="3" title="Brush Size">
                <button class="toolbar-btn btn-brush active" title="Draw brush"><i class="fa-solid fa-paintbrush"></i></button>
                <button class="toolbar-btn btn-eraser" title="Eraser tool"><i class="fa-solid fa-eraser"></i></button>
            </div>
            <div class="toolbar-group">
                <button class="toolbar-btn btn-undo" title="Undo"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                <button class="toolbar-btn btn-redo" title="Redo"><i class="fa-solid fa-arrow-rotate-right"></i></button>
                <button class="toolbar-btn btn-clear-canvas" title="Clear All"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
        <div class="canvas-viewport">
            <canvas class="drawing-canvas" id="canvas-${qId}"></canvas>
        </div>
    `;
    parent.appendChild(wrapper);
    
    // Wait for insertion in DOM to fetch correct client bounding boxes
    setTimeout(() => {
        const canvas = document.getElementById(`canvas-${qId}`);
        const toolbar = document.getElementById(`toolbar-${qId}`);
        if (canvas) {
            state.runningTest.canvasHelper = new CanvasHelper(canvas, toolbar);
            
            // Restore saved strokes
            const savedDrawing = state.runningTest.drawings[qId];
            if (savedDrawing) {
                state.runningTest.canvasHelper.loadImage(savedDrawing);
            }
        }
    }, 50);
}

function saveCanvasDrawing() {
    const run = state.runningTest;
    const mock = state.mocks.find(m => m.id === run.testId);
    const qList = mock.sections[run.currentSection];
    const qId = qList[run.currentQuestionIndex];
    const q = mock.questions[qId];
    
    if (q.is_drawing_type && run.canvasHelper) {
        if (!run.canvasHelper.isCanvasBlank()) {
            const dataUrl = run.canvasHelper.exportImage();
            run.drawings[qId] = dataUrl;
            run.answers[qId] = ["drawing"];
            run.questionStates[qId] = 'answered';
        } else {
            delete run.drawings[qId];
            delete run.answers[qId];
            run.questionStates[qId] = 'not-answered';
        }
    }
}

function saveCurrentQuestionTimeSpent() {
    const run = state.runningTest;
    const mock = state.mocks.find(m => m.id === run.testId);
    const qList = mock.sections[run.currentSection];
    const qId = qList[run.currentQuestionIndex];
    
    if (run.questionStartTime) {
        const diff = Math.floor((Date.now() - run.questionStartTime) / 1000);
        run.timeSpentPerQuestion[qId] = (run.timeSpentPerQuestion[qId] || 0) + diff;
        run.totalTimeSpent += diff;
        run.questionStartTime = Date.now(); // reset
    }
}

// Side palette display buttons
function renderPaletteGrid(mock) {
    const grid = document.getElementById('palette-buttons-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const run = state.runningTest;
    const qIds = mock.sections[run.currentSection];
    
    qIds.forEach((qId, idx) => {
        const btn = document.createElement('button');
        const qState = run.questionStates[qId] || 'not-visited';
        
        btn.className = `palette-btn ${qState}`;
        if (run.currentQuestionIndex === idx) btn.classList.add('active');
        btn.textContent = (idx + 1).toString();
        
        btn.addEventListener('click', () => {
            // Save time and answers of current question
            saveCanvasDrawing();
            saveCurrentQuestionTimeSpent();
            
            run.currentQuestionIndex = idx;
            
            // Toggle visited states
            if (run.questionStates[qId] === 'not-visited') {
                run.questionStates[qId] = 'not-answered';
            }
            
            loadConsoleQuestion();
        });
        
        grid.appendChild(btn);
    });
}

function bindConsoleNavButtons() {
    const nextBtn = document.getElementById('btn-next-question');
    const prevBtn = document.getElementById('btn-prev-question');
    const reviewBtn = document.getElementById('btn-mark-review');
    const clearBtn = document.getElementById('btn-clear-response');
    const submitBtn = document.getElementById('btn-console-submit');
    
    const handleNext = () => {
        saveCanvasDrawing();
        saveCurrentQuestionTimeSpent();
        
        const run = state.runningTest;
        const mock = state.mocks.find(m => m.id === run.testId);
        const qList = mock.sections[run.currentSection];
        
        // Mark as answered if answer key exists and is not empty
        const qId = qList[run.currentQuestionIndex];
        if (run.questionStates[qId] === 'not-visited' || run.questionStates[qId] === 'not-answered') {
            if (run.answers[qId] && run.answers[qId].length > 0) {
                run.questionStates[qId] = 'answered';
            }
        }
        
        if (run.currentQuestionIndex < qList.length - 1) {
            run.currentQuestionIndex++;
            if (run.questionStates[qList[run.currentQuestionIndex]] === 'not-visited') {
                run.questionStates[qList[run.currentQuestionIndex]] = 'not-answered';
            }
            loadConsoleQuestion();
        } else {
            // End of section behavior
            const sectionNames = Object.keys(mock.sections);
            const currentSecIdx = sectionNames.indexOf(run.currentSection);
            
            if (currentSecIdx < sectionNames.length - 1) {
                const nextSection = sectionNames[currentSecIdx + 1];
                
                if (run.mode === 'timed' && mock.type === 'cat') {
                    // Strict locking - can't skip ahead without submitting current section
                    alert("This is the last question of this section. Submit the section or wait for the section timer to proceed.");
                } else {
                    // Free navigation in practice or XAT overall timer
                    if (confirm(`Do you want to proceed to the next section: "${nextSection}"?`)) {
                        run.currentSection = nextSection;
                        run.currentQuestionIndex = 0;
                        renderConsoleSectionTabs(mock);
                        loadConsoleQuestion();
                    }
                }
            } else {
                alert("This is the final question of the exam. Click 'Submit Exam' in the header to view results.");
            }
        }
    };
    
    const handlePrev = () => {
        saveCanvasDrawing();
        saveCurrentQuestionTimeSpent();
        const run = state.runningTest;
        if (run.currentQuestionIndex > 0) {
            run.currentQuestionIndex--;
            loadConsoleQuestion();
        }
    };
    
    const handleReview = () => {
        saveCanvasDrawing();
        saveCurrentQuestionTimeSpent();
        
        const run = state.runningTest;
        const mock = state.mocks.find(m => m.id === run.testId);
        const qList = mock.sections[run.currentSection];
        const qId = qList[run.currentQuestionIndex];
        
        // Determine whether Answered & Marked or just Marked
        const hasAnswer = run.answers[qId] && run.answers[qId].length > 0;
        run.questionStates[qId] = hasAnswer ? 'answered-marked' : 'marked';
        
        // Go next
        handleNext();
    };
    
    const handleClear = () => {
        const run = state.runningTest;
        const mock = state.mocks.find(m => m.id === run.testId);
        const qList = mock.sections[run.currentSection];
        const qId = qList[run.currentQuestionIndex];
        
        // Clear variables
        delete run.answers[qId];
        delete run.drawings[qId];
        
        // If drawing helper exists, wipe it
        if (run.canvasHelper) {
            run.canvasHelper.clearCanvasRaw();
            run.canvasHelper.undoStack = [];
            run.canvasHelper.saveState();
        }
        
        run.questionStates[qId] = 'not-answered';
        
        // Reload inputs
        loadConsoleQuestion();
    };
    
    const handleSubmit = () => {
        if (confirm("Are you sure you want to finish and submit the entire test? You will see your detailed reports instantly.")) {
            submitExamConsole();
        }
    };
    
    nextBtn.onclick = handleNext;
    prevBtn.onclick = handlePrev;
    reviewBtn.onclick = handleReview;
    clearBtn.onclick = handleClear;
    submitBtn.onclick = handleSubmit;
}

// Timing Clock Intervals
function startConsoleTimers() {
    if (window.consoleTimerInterval) clearInterval(window.consoleTimerInterval);
    
    const timerText = document.getElementById('console-timer-text');
    const timerWidget = document.getElementById('console-timer-widget');
    
    window.consoleTimerInterval = setInterval(() => {
        const run = state.runningTest;
        const mock = state.mocks.find(m => m.id === run.testId);
        
        if (run.mode === 'practice') {
            // Count up stopwatch in Practice Mode
            run.totalTimeSpent++;
            
            const hrs = Math.floor(run.totalTimeSpent / 3600).toString().padStart(2, '0');
            const mins = Math.floor((run.totalTimeSpent % 3600) / 60).toString().padStart(2, '0');
            const secs = (run.totalTimeSpent % 60).toString().padStart(2, '0');
            timerText.textContent = `${hrs}:${mins}:${secs}`;
        } else {
            // Count down in Timed Exam Mode
            let isTimeUp = false;
            let displaySecs = 0;
            
            const isCatSectional = mock.isSectionalTimed;
            
            if (isCatSectional) {
                // Sectional Countdown
                run.sectionTimeLeft[run.currentSection]--;
                displaySecs = run.sectionTimeLeft[run.currentSection];
                
                if (displaySecs <= 0) {
                    isTimeUp = true;
                }
            } else {
                // Overall Countdown (XAT / Custom Mocks)
                run.overallTimeLeft--;
                displaySecs = run.overallTimeLeft;
                
                if (displaySecs <= 0) {
                    isTimeUp = true;
                }
            }
            
            // Update UI timer text
            const hrs = Math.floor(displaySecs / 3600).toString().padStart(2, '0');
            const mins = Math.floor((displaySecs % 3600) / 60).toString().padStart(2, '0');
            const secs = (displaySecs % 60).toString().padStart(2, '0');
            timerText.textContent = `${hrs}:${mins}:${secs}`;
            
            // Red warning overlay when less than 2 mins
            if (displaySecs < 120) {
                timerWidget.classList.add('warning');
            } else {
                timerWidget.classList.remove('warning');
            }
            
            if (isTimeUp) {
                if (isCatSectional) {
                    // Auto-submit section and lock it
                    alert(`Time is up for section: ${run.currentSection}! Auto-submitting this section...`);
                    
                    const sections = Object.keys(mock.sections);
                    const idx = sections.indexOf(run.currentSection);
                    
                    if (idx < sections.length - 1) {
                        run.currentSection = sections[idx + 1];
                        run.currentQuestionIndex = 0;
                        
                        renderConsoleSectionTabs(mock);
                        loadConsoleQuestion();
                    } else {
                        // End of last section -> complete test
                        submitExamConsole();
                    }
                } else {
                    // XAT overall time complete
                    alert("Exam duration limit reached! Auto-submitting your scorecard.");
                    submitExamConsole();
                }
            }
        }
    }, 1000);
}

// Submit test scorecard compilation
function submitExamConsole() {
    clearInterval(window.consoleTimerInterval);
    
    // Save last question state
    saveCanvasDrawing();
    saveCurrentQuestionTimeSpent();
    
    const run = state.runningTest;
    const mock = state.mocks.find(m => m.id === run.testId);
    
    // Compile scores
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    let earnedMarks = 0;
    let maxMarks = 0;
    
    const sectionalReport = [];
    const incorrectQuestionsList = [];
    
    Object.keys(mock.sections).forEach(secName => {
        let secCorrect = 0;
        let secIncorrect = 0;
        let secUnattempted = 0;
        let secScore = 0;
        
        mock.sections[secName].forEach(qId => {
            const q = mock.questions[qId];
            const ans = run.answers[qId];
            maxMarks += q.marks;
            
            if (!ans || ans.length === 0) {
                secUnattempted++;
                unattempted++;
                
                // If user flagged it as marked but unattempted, add it to error log too
                if (run.questionStates[qId] === 'marked') {
                    incorrectQuestionsList.push({ qId, secName, reason: 'flagged' });
                }
            } else {
                // Grade response
                let isCorrect = false;
                if (q.is_input_type) {
                    // Exact text compare
                    isCorrect = ans[0].toString().trim().toLowerCase() === q.correct_response[0][0].toString().trim().toLowerCase();
                } else if (q.is_drawing_type) {
                    // Drawing answer - requires user manual review later, defaults to true for score placeholder
                    isCorrect = true; 
                } else {
                    // MCQ
                    const correctIdx = (parseInt(q.correct_response[0][0]) - 1).toString();
                    isCorrect = ans[0] === correctIdx;
                }
                
                if (isCorrect) {
                    secCorrect++;
                    correct++;
                    secScore += q.marks;
                } else {
                    secIncorrect++;
                    incorrect++;
                    secScore -= q.negative_marks;
                    
                    // Add wrong answer to errors registry
                    incorrectQuestionsList.push({ qId, secName, reason: 'incorrect' });
                }
            }
        });
        
        sectionalReport.push({
            section: secName,
            correct: secCorrect,
            incorrect: secIncorrect,
            unattempted: secUnattempted,
            score: secScore
        });
        earnedMarks += secScore;
    });
    
    // Special XAT Penalty Calculations
    let xatPenalty = 0;
    if (mock.type === 'xat' && run.mode === 'timed') {
        if (unattempted > 8) {
            const excessSkips = unattempted - 8;
            xatPenalty = excessSkips * 0.10;
            earnedMarks -= xatPenalty;
        }
    }
    
    const accuracy = (correct + incorrect) > 0 ? (correct / (correct + incorrect)) * 100 : 0;
    
    // Save attempt record
    const attemptId = "attempt-" + Date.now();
    const attemptRecord = {
        attemptId: attemptId,
        testId: mock.id,
        testName: mock.name,
        type: mock.type,
        category: mock.category || 'full',
        mode: run.mode,
        score: earnedMarks,
        maxScore: maxMarks,
        accuracy: accuracy,
        correct: correct,
        incorrect: incorrect,
        unattempted: unattempted,
        sectionalReport: sectionalReport,
        xatPenalty: xatPenalty,
        timeSpent: run.totalTimeSpent,
        infractions: run.infractions,
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        answers: run.answers,
        drawings: run.drawings,
        timeSpentPerQuestion: run.timeSpentPerQuestion
    };
    
    state.attempts.push(attemptRecord);
    
    // Add incorrect/flagged items to local Error Log vault
    incorrectQuestionsList.forEach(item => {
        const q = mock.questions[item.qId];
        const alreadyInLog = state.errors.some(err => err.qId === item.qId);
        
        if (!alreadyInLog) {
            const userAnsText = q.is_input_type ? 
                (run.answers[item.qId] ? run.answers[item.qId][0] : 'No Answer') : 
                (run.answers[item.qId] ? q.options[parseInt(run.answers[item.qId][0])] : 'No Answer');
                
            const correctAnsText = q.is_input_type ? 
                q.correct_response[0][0] : 
                q.options[parseInt(q.correct_response[0][0]) - 1];
                
            state.errors.push({
                id: "err-" + Date.now() + Math.random().toString(36).substring(2,5),
                qId: item.qId,
                testId: mock.id,
                testName: mock.name,
                sectionName: item.secName,
                instructions: q.instructions || '',
                questionText: q.question_text,
                userAnswerText: userAnsText,
                correctAnswerText: correctAnsText,
                solution: q.solution || '',
                notes: '',
                solved: false,
                date: attemptRecord.date
            });
        }
    });
    
    saveDatabase();
    
    // Exit fullscreen
    if (run.isFullscreenActive) {
        exitFullscreenConsole();
    }
    
    // Close console panel and open Results Overlay
    document.getElementById('exam-console').style.display = 'none';
    showResultsPage(attemptRecord, mock);
}

// ==========================================================================
// RESULTS REPORT PAGE CONTROLLER
// ==========================================================================
function showResultsPage(record, mock) {
    const resultsView = document.getElementById('results-view');
    if (!resultsView) return;
    
    // Set scorecard labels
    document.getElementById('res-score').textContent = `${record.score.toFixed(2)} / ${record.maxScore}`;
    document.getElementById('res-accuracy').textContent = record.accuracy.toFixed(1) + '%';
    document.getElementById('res-accuracy-progress').style.width = record.accuracy + '%';
    
    const minutes = Math.floor(record.timeSpent / 60);
    const seconds = record.timeSpent % 60;
    document.getElementById('res-time-spent').textContent = `${minutes}m ${seconds}s`;
    
    const avgSecs = Object.keys(record.timeSpentPerQuestion).length > 0 ? 
        Math.floor(record.timeSpent / Object.keys(record.timeSpentPerQuestion).length) : 0;
    document.getElementById('res-avg-time').textContent = `Avg. time per question: ${avgSecs}s`;
    
    document.getElementById('res-mode').textContent = record.mode === 'timed' ? 'Strict Timed' : 'Practice (Untimed)';
    document.getElementById('res-infractions').textContent = `Proctor warnings: ${record.infractions}`;
    
    // Estimated percentile mockup based on score ratio
    const scoreRatio = record.score / record.maxScore;
    let percentile = 50;
    if (scoreRatio >= 0.8) percentile = 99.5;
    else if (scoreRatio >= 0.6) percentile = 98.1;
    else if (scoreRatio >= 0.4) percentile = 92.4;
    else if (scoreRatio >= 0.2) percentile = 76.5;
    document.getElementById('res-percentile').textContent = `Estimated Percentile: ~${percentile}%`;
    
    // Check XAT unattempted penalties
    const xatBox = document.getElementById('xat-penalty-report-box');
    if (record.type === 'xat' && record.xatPenalty > 0) {
        xatBox.style.display = 'flex';
        document.getElementById('xat-penalty-details').textContent = `You left ${record.unattempted} questions unattempted. The first 8 skipped questions are free. The remaining ${record.unattempted - 8} questions incurred an unattempted penalty of -0.10 each, totaling a deduction of -${record.xatPenalty.toFixed(2)} marks.`;
    } else {
        xatBox.style.display = 'none';
    }
    
    // Sectional Table Breakdown
    const tbody = document.getElementById('sectional-results-tbody');
    tbody.innerHTML = '';
    
    record.sectionalReport.forEach(sec => {
        const tr = document.createElement('tr');
        const secAccuracy = (sec.correct + sec.incorrect) > 0 ? (sec.correct / (sec.correct + sec.incorrect)) * 100 : 0;
        tr.innerHTML = `
            <td><strong>${sec.section}</strong></td>
            <td class="correct">${sec.correct}</td>
            <td class="incorrect">${sec.incorrect}</td>
            <td>${sec.unattempted}</td>
            <td><strong>${sec.score.toFixed(2)}</strong></td>
            <td>${secAccuracy.toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Print Certificate triggers
    document.getElementById('cert-recipient-name').textContent = "Suhas R.";
    document.getElementById('cert-exam-title').textContent = record.testName;
    document.getElementById('cert-exam-score').textContent = record.score.toFixed(2) + " marks";
    document.getElementById('cert-exam-percentile').textContent = percentile + "%";
    document.getElementById('cert-exam-date').textContent = record.date;
    
    document.getElementById('btn-print-certificate').onclick = () => window.print();
    
    // SVG bar charts rendering
    renderResultsCharts(record, mock);
    
    // Review navigation tabs
    renderResultsReviewTabs(record, mock);
    
    // Go to dashboard button
    document.getElementById('btn-results-to-dashboard').onclick = () => {
        resultsView.style.display = 'none';
        switchView('dashboard');
    };
    
    resultsView.style.display = 'flex';
}

function renderResultsCharts(record, mock) {
    // 1. Time spent per question bar chart
    const svg = document.getElementById('time-spent-chart-svg');
    if (!svg) return;
    svg.innerHTML = '';
    
    const width = svg.clientWidth || 500;
    const height = 250;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    // Flatten question list of attempt
    const questionsList = [];
    Object.keys(mock.sections).forEach(sec => {
        mock.sections[sec].forEach((qId, idx) => {
            const time = record.timeSpentPerQuestion[qId] || 0;
            questionsList.push({ qId, index: idx + 1, time });
        });
    });
    
    if (questionsList.length === 0) return;
    
    const maxTime = Math.max(...questionsList.map(q => q.time), 10);
    const barWidth = Math.max(chartWidth / questionsList.length - 4, 2);
    
    // Draw grid
    for (let i = 0; i <= 4; i++) {
        const yVal = padding + (chartHeight / 4) * i;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padding.toString());
        line.setAttribute('y1', yVal.toString());
        line.setAttribute('x2', (width - padding).toString());
        line.setAttribute('y2', yVal.toString());
        line.setAttribute('stroke', 'var(--border-color)');
        svg.appendChild(line);
    }
    
    // Draw bars
    questionsList.forEach((q, idx) => {
        const barHeight = (q.time / maxTime) * chartHeight;
        const x = padding + idx * (chartWidth / questionsList.length);
        const y = padding + chartHeight - barHeight;
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x.toString());
        rect.setAttribute('y', y.toString());
        rect.setAttribute('width', barWidth.toString());
        rect.setAttribute('height', barHeight.toString());
        rect.setAttribute('fill', 'var(--primary)');
        rect.setAttribute('rx', '2');
        svg.appendChild(rect);
        
        // Add text values
        if (q.time > 15 && questionsList.length < 20) {
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', (x + barWidth / 2).toString());
            txt.setAttribute('y', (y - 5).toString());
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('fill', 'var(--text-secondary)');
            txt.setAttribute('font-size', '8');
            txt.textContent = `${q.time}s`;
            svg.appendChild(txt);
        }
    });
}

function renderResultsReviewTabs(record, mock) {
    const tabsContainer = document.getElementById('review-sections-tabs-container');
    const buttonsGrid = document.getElementById('review-question-buttons-grid');
    if (!tabsContainer || !buttonsGrid) return;
    
    tabsContainer.innerHTML = '';
    
    const sections = Object.keys(mock.sections);
    
    const showSectionReviewButtons = (secName) => {
        buttonsGrid.innerHTML = '';
        const qList = mock.sections[secName];
        
        qList.forEach((qId, idx) => {
            const btn = document.createElement('button');
            btn.className = 'review-q-btn';
            
            // Check correctness
            const ans = record.answers[qId];
            const q = mock.questions[qId];
            
            if (!ans || ans.length === 0) {
                btn.classList.add('unattempted');
            } else {
                let isCorrect = false;
                if (q.is_input_type) {
                    isCorrect = ans[0].toString().trim().toLowerCase() === q.correct_response[0][0].toString().trim().toLowerCase();
                } else if (q.is_drawing_type) {
                    isCorrect = true;
                } else {
                    const correctIdx = (parseInt(q.correct_response[0][0]) - 1).toString();
                    isCorrect = ans[0] === correctIdx;
                }
                
                btn.classList.add(isCorrect ? 'correct' : 'incorrect');
            }
            
            btn.textContent = (idx + 1).toString();
            btn.addEventListener('click', () => openReviewQuestionModal(qId, idx + 1, record, mock));
            buttonsGrid.appendChild(btn);
        });
    };
    
    sections.forEach((secName, idx) => {
        const btn = document.createElement('button');
        btn.className = 'review-tab-btn';
        if (idx === 0) {
            btn.classList.add('active');
            showSectionReviewButtons(secName);
        }
        
        btn.textContent = secName.replace('Ability & Reading Comprehension', 'RC').replace('Interpretation & Logical Reasoning', 'LR');
        btn.addEventListener('click', () => {
            tabsContainer.querySelectorAll('.review-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showSectionReviewButtons(secName);
        });
        
        tabsContainer.appendChild(btn);
    });
}

function openReviewQuestionModal(qId, labelNum, record, mock) {
    const modal = document.getElementById('review-modal');
    if (!modal) return;
    
    const q = mock.questions[qId];
    const userAns = record.answers[qId];
    
    // Status text
    const statusLabel = document.getElementById('review-modal-q-status');
    const marksLabel = document.getElementById('review-modal-q-earned');
    
    statusLabel.className = 'badge';
    let isCorrect = false;
    
    if (!userAns || userAns.length === 0) {
        statusLabel.textContent = 'Unattempted';
        statusLabel.classList.add('unattempted');
        marksLabel.textContent = '0 Marks';
        marksLabel.className = 'badge negative';
    } else {
        if (q.is_input_type) {
            isCorrect = userAns[0].toString().trim().toLowerCase() === q.correct_response[0][0].toString().trim().toLowerCase();
        } else if (q.is_drawing_type) {
            isCorrect = true;
        } else {
            const correctIdx = (parseInt(q.correct_response[0][0]) - 1).toString();
            isCorrect = userAns[0] === correctIdx;
        }
        
        if (isCorrect) {
            statusLabel.textContent = 'Correct';
            statusLabel.classList.add('correct');
            marksLabel.textContent = `+${q.marks} Marks`;
            marksLabel.className = 'badge positive';
        } else {
            statusLabel.textContent = 'Incorrect';
            statusLabel.classList.add('incorrect');
            marksLabel.textContent = `-${q.negative_marks} Marks`;
            marksLabel.className = 'badge negative';
        }
    }
    
    document.getElementById('review-modal-q-num').textContent = labelNum.toString();
    document.getElementById('review-modal-instructions').innerHTML = q.instructions || '';
    document.getElementById('review-modal-question-text').innerHTML = q.question_text;
    
    // Option breakdown comparisons
    const optionsContainer = document.getElementById('review-modal-options-container');
    optionsContainer.innerHTML = '';
    
    if (q.is_input_type) {
        optionsContainer.innerHTML = `
            <div class="error-user-answer">
                <span class="ans-label">Your Response:</span> <span>${userAns ? userAns[0] : 'None'}</span>
            </div>
            <div class="error-correct-answer">
                <span class="ans-label">Correct Key:</span> <span>${q.correct_response[0][0]}</span>
            </div>
        `;
    } else if (q.is_drawing_type) {
        optionsContainer.innerHTML = `<div class="error-correct-answer"><span class="ans-label">Answer Type:</span> <span>Freehand Drawing graph. Self-grade based on solution.</span></div>`;
    } else {
        // MCQ list markup
        const table = document.createElement('div');
        table.className = 'options-container';
        
        q.options.forEach((optText, index) => {
            const optEl = document.createElement('div');
            optEl.className = 'mcq-option';
            
            const isUserSelected = userAns && userAns[0] === index.toString();
            const isCorrectIndex = (parseInt(q.correct_response[0][0]) - 1).toString() === index.toString();
            
            if (isUserSelected) optEl.classList.add('selected');
            
            let statusIcon = '';
            if (isCorrectIndex) {
                optEl.style.borderColor = 'var(--success)';
                optEl.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
                statusIcon = '<span class="badge positive" style="margin-left:auto;">Correct Answer</span>';
            } else if (isUserSelected && !isCorrectIndex) {
                optEl.style.borderColor = 'var(--danger)';
                optEl.style.backgroundColor = 'rgba(239, 68, 68, 0.05)';
                statusIcon = '<span class="badge negative" style="margin-left:auto;">Your Incorrect Selection</span>';
            }
            
            const alphabet = ['A', 'B', 'C', 'D', 'E', 'F'];
            optEl.innerHTML = `
                <div class="option-letter">${alphabet[index]}</div>
                <div class="option-text">${optText}</div>
                ${statusIcon}
            `;
            table.appendChild(optEl);
        });
        optionsContainer.appendChild(table);
    }
    
    // User Drawings snapshot playback
    const drawingBox = document.getElementById('review-modal-drawing-container');
    const drawingImg = document.getElementById('review-modal-drawing-img');
    if (drawingBox && drawingImg) {
        if (q.is_drawing_type && record.drawings[qId]) {
            drawingImg.src = record.drawings[qId];
            drawingBox.style.display = 'block';
        } else {
            drawingBox.style.display = 'none';
        }
    }
    
    document.getElementById('review-modal-solution-text').innerHTML = q.solution || 'No solution text provided.';
    
    // Show Modal
    modal.style.display = 'flex';
    document.getElementById('btn-close-review-modal').onclick = () => {
        modal.style.display = 'none';
    };
}

// ==========================================================================
// ERROR LOG VAULT SYSTEM
// ==========================================================================
function initErrorLog() {
    document.getElementById('error-search').addEventListener('input', renderErrorLog);
    document.getElementById('error-filter-exam').addEventListener('change', renderErrorLog);
    document.getElementById('error-filter-section').addEventListener('change', renderErrorLog);
    document.getElementById('error-filter-status').addEventListener('change', renderErrorLog);
    document.getElementById('btn-clear-errors').addEventListener('click', () => {
        if (confirm("Are you sure you want to clear your entire Error Log history? This action is permanent.")) {
            state.errors = [];
            saveDatabase();
            renderErrorLog();
        }
    });
}

function renderErrorLog() {
    const container = document.getElementById('error-cards-container');
    const examFilterDropdown = document.getElementById('error-filter-exam');
    const searchVal = document.getElementById('error-search').value.toLowerCase();
    const examVal = examFilterDropdown.value;
    const sectionVal = document.getElementById('error-filter-section').value;
    const statusVal = document.getElementById('error-filter-status').value;
    
    if (!container) return;
    container.innerHTML = '';
    
    // Build select dropdown option tags dynamically for source exams
    const sourceExams = [...new Set(state.errors.map(e => e.testName))];
    examFilterDropdown.innerHTML = '<option value="all">All Mocks</option>';
    sourceExams.forEach(ex => {
        const opt = document.createElement('option');
        opt.value = ex;
        opt.textContent = ex;
        if (ex === examVal) opt.selected = true;
        examFilterDropdown.appendChild(opt);
    });
    
    // Apply filters
    const filteredErrors = state.errors.filter(err => {
        const matchesSearch = err.questionText.toLowerCase().includes(searchVal) || err.notes.toLowerCase().includes(searchVal);
        const matchesExam = examVal === 'all' || err.testName === examVal;
        const matchesSection = sectionVal === 'all' || err.sectionName.includes(sectionVal);
        
        let matchesStatus = true;
        if (statusVal === 'solved') matchesStatus = err.solved;
        else if (statusVal === 'reviewing') matchesStatus = !err.solved;
        
        return matchesSearch && matchesExam && matchesSection && matchesStatus;
    });
    
    document.getElementById('error-count-title').textContent = `Error Questions (${filteredErrors.length})`;
    
    if (filteredErrors.length === 0) {
        container.innerHTML = '<div class="no-data" style="padding: 40px; text-align: center; color: var(--text-secondary);">No questions match the current filters. Your preparations are going strong!</div>';
        return;
    }
    
    filteredErrors.forEach(err => {
        const card = document.createElement('div');
        card.className = 'error-card';
        if (err.solved) card.style.opacity = '0.7';
        
        const solvedBadge = err.solved ? 
            '<span class="badge-solid solved"><i class="fa-solid fa-circle-check"></i> Solved</span>' : 
            '<span class="badge-solid reviewing"><i class="fa-solid fa-clock"></i> Reviewing</span>';
            
        card.innerHTML = `
            <div class="error-card-header">
                <span class="q-source">${err.testName} &gt; ${err.sectionName}</span>
                <div class="error-card-meta">
                    ${solvedBadge}
                    <span class="badge-solid font-mono" style="background:rgba(var(--primary-rgb),0.1); color:var(--primary)">Q-ID: ${err.qId}</span>
                </div>
            </div>
            
            <div class="error-question-block">
                <h5>Question Prompt</h5>
                <div class="content">${err.questionText}</div>
            </div>
            
            <div class="error-user-answer">
                <span class="ans-label">Your Response:</span>
                <span>${err.userAnswerText || 'No answer recorded'}</span>
            </div>
            <div class="error-correct-answer">
                <span class="ans-label">Correct Solution:</span>
                <span>${err.correctAnswerText}</span>
            </div>
            
            <div class="error-user-notes">
                <h5>My Study Notes (Concepts / Formulas / Tricks)</h5>
                <textarea class="notes-textarea" data-id="${err.id}" placeholder="Enter notes about why this question went wrong, formulas to remember, or shortcuts...">${err.notes || ''}</textarea>
            </div>
            
            <div class="error-card-actions">
                <button class="action-btn secondary small btn-toggle-solved" data-id="${err.id}">
                    <i class="fa-solid ${err.solved ? 'fa-rotate-left' : 'fa-check'}"></i> 
                    ${err.solved ? 'Mark Reviewing' : 'Mark as Solved'}
                </button>
                <button class="action-btn secondary small btn-toggle-solution" data-id="${err.id}">
                    <i class="fa-solid fa-lightbulb"></i> View Solution & Explanation
                </button>
                <button class="action-btn danger small btn-delete-error" data-id="${err.id}">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </div>
            
            <div class="practice-solution-card glass solution-drawer" id="sol-drawer-${err.id}" style="display: none; margin-top: 15px;">
                <h4>Detailed Explanation</h4>
                <div style="font-size: 0.85rem; line-height: 1.6; color: var(--text-secondary); margin-top: 8px;">${err.solution || 'No detailed solution available.'}</div>
            </div>
        `;
        
        // Save notes when modified
        const textarea = card.querySelector('.notes-textarea');
        textarea.addEventListener('blur', (e) => {
            const id = textarea.getAttribute('data-id');
            const target = state.errors.find(item => item.id === id);
            if (target) {
                target.notes = e.target.value;
                saveDatabase();
            }
        });
        
        // Solved Toggle
        card.querySelector('.btn-toggle-solved').onclick = () => {
            err.solved = !err.solved;
            saveDatabase();
            renderErrorLog();
        };
        
        // Delete item
        card.querySelector('.btn-delete-error').onclick = () => {
            if (confirm("Delete this question from your Error Log?")) {
                state.errors = state.errors.filter(item => item.id !== err.id);
                saveDatabase();
                renderErrorLog();
            }
        };
        
        // Show solution drawer
        card.querySelector('.btn-toggle-solution').onclick = () => {
            const drawer = document.getElementById(`sol-drawer-${err.id}`);
            if (drawer) {
                drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
            }
        };
        
        container.appendChild(card);
    });
}

// ==========================================================================
// ANALYTICS & HISTORY PAGE CONTROLLER
// ==========================================================================
function renderAnalytics() {
    renderAttemptsHistoryTable();
    renderAnalyticsCharts();
}

function renderAttemptsHistoryTable() {
    const tbody = document.getElementById('attempts-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.attempts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No mock exam attempts logged yet. Get started by taking a mock!</td></tr>';
        return;
    }
    
    // Sort attempts reverse chronological
    const sorted = [...state.attempts].reverse();
    
    sorted.forEach(att => {
        const tr = document.createElement('tr');
        
        const min = Math.floor(att.timeSpent / 60);
        const sec = att.timeSpent % 60;
        
        // Generate section details cell string
        let sectionScoresHtml = '';
        if (att.sectionalReport) {
            sectionScoresHtml = att.sectionalReport.map(r => `<strong>${r.section.substring(0, 4)}</strong>: ${r.score.toFixed(1)}`).join(' | ');
        } else {
            sectionScoresHtml = 'N/A';
        }
        
        tr.innerHTML = `
            <td>${att.date}</td>
            <td><strong>${att.testName}</strong></td>
            <td><span class="badge-solid font-mono" style="background:rgba(var(--primary-rgb),0.1); color:var(--primary)">${att.mode.toUpperCase()}</span></td>
            <td>${sectionScoresHtml}</td>
            <td><strong>${att.score.toFixed(2)} / ${att.maxScore}</strong></td>
            <td>${att.accuracy.toFixed(1)}%</td>
            <td style="color:var(--danger)">${att.infractions} flags</td>
            <td>
                <button class="action-btn primary small btn-view-report" data-id="${att.attemptId}">
                    View Scorecard
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    // Bind click listeners for scorecards
    tbody.querySelectorAll('.btn-view-report').forEach(btn => {
        btn.addEventListener('click', () => {
            const attemptId = btn.getAttribute('data-id');
            const record = state.attempts.find(att => att.attemptId === attemptId);
            const mock = state.mocks.find(m => m.id === record.testId) || { sections: {}, questions: {} };
            
            if (record) showResultsPage(record, mock);
        });
    });
}

function renderAnalyticsCharts() {
    // 1. Overall Score Progression Line
    const scoreSvg = document.getElementById('analytics-score-trend-svg');
    if (scoreSvg) {
        scoreSvg.innerHTML = '';
        const width = scoreSvg.clientWidth || 500;
        const height = 180;
        scoreSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        
        if (state.attempts.length === 0) {
            scoreSvg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-muted)">No score history</text>';
        } else {
            const padding = 30;
            const w = width - padding * 2;
            const h = height - padding * 2;
            const records = state.attempts.slice(-5); // Last 5
            const step = w / (records.length - 1 || 1);
            
            let d = '';
            records.forEach((att, index) => {
                const ratio = att.score / att.maxScore;
                const x = padding + index * step;
                const y = padding + h - Math.max(ratio, 0) * h;
                
                if (index === 0) d = `M ${x} ${y}`;
                else d += ` L ${x} ${y}`;
                
                // Draw point circle
                const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                c.setAttribute('cx', x.toString());
                c.setAttribute('cy', y.toString());
                c.setAttribute('r', '4');
                c.setAttribute('fill', 'var(--bg-app)');
                c.setAttribute('stroke', 'var(--primary)');
                c.setAttribute('stroke-width', '2');
                scoreSvg.appendChild(c);
            });
            
            if (records.length > 1) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'var(--primary)');
                path.setAttribute('stroke-width', '2');
                scoreSvg.appendChild(path);
            }
        }
    }
    
    // 2. Accuracy Section Radar/Bar representation
    const accuracySvg = document.getElementById('analytics-accuracy-svg');
    if (accuracySvg) {
        accuracySvg.innerHTML = '';
        const width = accuracySvg.clientWidth || 500;
        const height = 180;
        accuracySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        
        if (state.attempts.length === 0) {
            accuracySvg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-muted)">No accuracy history</text>';
        } else {
            // Render section accuracies (VARC, DILR, QA)
            const sectionStats = { VARC: { c: 0, w: 0 }, DILR: { c: 0, w: 0 }, QA: { c: 0, w: 0 } };
            
            state.attempts.forEach(att => {
                if (att.sectionalReport) {
                    att.sectionalReport.forEach(r => {
                        let tag = 'QA';
                        if (r.section.toLowerCase().includes('verbal') || r.section.toLowerCase().includes('read')) tag = 'VARC';
                        else if (r.section.toLowerCase().includes('data') || r.section.toLowerCase().includes('logical')) tag = 'DILR';
                        
                        sectionStats[tag].c += r.correct;
                        sectionStats[tag].w += r.incorrect;
                    });
                }
            });
            
            const padding = 30;
            const barHeight = 20;
            const barGap = 15;
            
            const keys = Object.keys(sectionStats);
            keys.forEach((key, idx) => {
                const total = sectionStats[key].c + sectionStats[key].w;
                const acc = total > 0 ? (sectionStats[key].c / total) * 100 : 0;
                
                const y = padding + idx * (barHeight + barGap);
                
                // Label
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', padding.toString());
                label.setAttribute('y', (y + 14).toString());
                label.setAttribute('fill', 'var(--text-secondary)');
                label.setAttribute('font-size', '11');
                label.setAttribute('font-weight', '600');
                label.textContent = key;
                accuracySvg.appendChild(label);
                
                // Bar Background
                const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                bg.setAttribute('x', (padding + 50).toString());
                bg.setAttribute('y', y.toString());
                bg.setAttribute('width', (width - padding * 2 - 100).toString());
                bg.setAttribute('height', barHeight.toString());
                bg.setAttribute('fill', 'var(--border-color)');
                bg.setAttribute('rx', '4');
                accuracySvg.appendChild(bg);
                
                // Bar Fill
                const fillWidth = (acc / 100) * (width - padding * 2 - 100);
                const fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                fill.setAttribute('x', (padding + 50).toString());
                fill.setAttribute('y', y.toString());
                fill.setAttribute('width', fillWidth.toString());
                fill.setAttribute('height', barHeight.toString());
                fill.setAttribute('fill', 'var(--success)');
                fill.setAttribute('rx', '4');
                accuracySvg.appendChild(fill);
                
                // Percentage Text
                const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                val.setAttribute('x', (width - padding - 40).toString());
                val.setAttribute('y', (y + 14).toString());
                val.setAttribute('fill', 'var(--text-primary)');
                val.setAttribute('font-size', '11');
                val.setAttribute('font-weight', '600');
                val.textContent = acc.toFixed(0) + '%';
                accuracySvg.appendChild(val);
            });
        }
    }
}

// ==========================================================================
// VIRTUAL CALCULATOR HANDLERS (Drag & Drop + Computation)
// ==========================================================================
function initCalculator() {
    const calcBtn = document.getElementById('btn-toggle-calculator');
    const calcModal = document.getElementById('calculator-modal');
    const closeCalc = document.getElementById('btn-close-calculator');
    
    if (calcBtn && calcModal) {
        calcBtn.addEventListener('click', () => {
            calcModal.style.display = calcModal.style.display === 'none' ? 'flex' : 'none';
        });
    }
    if (closeCalc && calcModal) {
        closeCalc.addEventListener('click', () => {
            calcModal.style.display = 'none';
        });
    }
    
    // Drag and Drop functionality
    if (calcModal) {
        const header = calcModal.querySelector('.calculator-header');
        let active = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
        
        const dragStart = (e) => {
            if (e.type === "touchstart") {
                initialX = e.touches[0].clientX - xOffset;
                initialY = e.touches[0].clientY - yOffset;
            } else {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
            }
            if (e.target === header || header.contains(e.target)) {
                active = true;
            }
        };
        
        const drag = (e) => {
            if (active) {
                e.preventDefault();
                if (e.type === "touchmove") {
                    currentX = e.touches[0].clientX - initialX;
                    currentY = e.touches[0].clientY - initialY;
                } else {
                    currentX = e.clientX - initialX;
                    currentY = e.clientY - initialY;
                }
                xOffset = currentX;
                yOffset = currentY;
                setTranslate(currentX, currentY, calcModal);
            }
        };
        
        const dragEnd = () => {
            initialX = currentX;
            initialY = currentY;
            active = false;
        };
        
        const setTranslate = (xPos, yPos, el) => {
            el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
        };
        
        document.addEventListener("mousedown", dragStart, false);
        document.addEventListener("mousemove", drag, false);
        document.addEventListener("mouseup", dragEnd, false);
        
        document.addEventListener("touchstart", dragStart, false);
        document.addEventListener("touchmove", drag, false);
        document.addEventListener("touchend", dragEnd, false);
    }
    
    // Calculator math computation
    const screen = document.getElementById('calc-display');
    const keys = document.querySelectorAll('.calc-key');
    let memoryVal = 0;
    let pendingOp = '';
    let bufferVal = '';
    
    keys.forEach(key => {
        key.addEventListener('click', () => {
            const op = key.getAttribute('data-calc');
            
            if (key.classList.contains('num')) {
                if (screen.value === '0' || screen.value === 'Error') screen.value = '';
                screen.value += op === 'dot' ? '.' : op;
            } else {
                // Operation key
                if (op === 'c') {
                    screen.value = '0';
                    bufferVal = '';
                    pendingOp = '';
                } else if (op === 'ce') {
                    screen.value = '0';
                } else if (op === 'back') {
                    screen.value = screen.value.slice(0, -1) || '0';
                } else if (op === 'pm') {
                    screen.value = (parseFloat(screen.value) * -1).toString();
                } else if (op === 'sqrt') {
                    const val = parseFloat(screen.value);
                    screen.value = val >= 0 ? Math.sqrt(val).toString() : 'Error';
                } else if (op === 'inv') {
                    const val = parseFloat(screen.value);
                    screen.value = val !== 0 ? (1 / val).toString() : 'Error';
                } else if (op === 'pct') {
                    screen.value = (parseFloat(screen.value) / 100).toString();
                } else if (['add', 'sub', 'mul', 'div'].includes(op)) {
                    bufferVal = screen.value;
                    pendingOp = op;
                    screen.value = '0';
                } else if (op === 'eq') {
                    if (pendingOp && bufferVal) {
                        const v1 = parseFloat(bufferVal);
                        const v2 = parseFloat(screen.value);
                        let result = 0;
                        if (pendingOp === 'add') result = v1 + v2;
                        else if (pendingOp === 'sub') result = v1 - v2;
                        else if (pendingOp === 'mul') result = v1 * v2;
                        else if (pendingOp === 'div') result = v2 !== 0 ? v1 / v2 : 'Error';
                        
                        screen.value = result.toString();
                        pendingOp = '';
                        bufferVal = '';
                    }
                }
                
                // Memory operators
                else if (op === 'mc') memoryVal = 0;
                else if (op === 'mr') screen.value = memoryVal.toString();
                else if (op === 'ms') memoryVal = parseFloat(screen.value);
                else if (op === 'm+') memoryVal += parseFloat(screen.value);
                else if (op === 'm-') memoryVal -= parseFloat(screen.value);
            }
        });
    });
}

// ==========================================================================
// AI PROCTORING SIMULATION CORE
// ==========================================================================
function initProctoring() {
    // Focus lost listener
    document.addEventListener('visibilitychange', () => {
        const run = state.runningTest;
        if (run.testId && run.mode === 'timed' && document.visibilityState === 'hidden') {
            run.infractions++;
            logProctorInfraction("Infraction: Focus switched away from exam console window!");
        }
    });
    
    // Fullscreen changed listener
    document.addEventListener('fullscreenchange', () => {
        const run = state.runningTest;
        if (run.testId && run.mode === 'timed') {
            const isFull = !!document.fullscreenElement;
            if (!isFull) {
                run.infractions++;
                logProctorInfraction("Infraction: Exited fullscreen mode!");
                
                // Show warn modal
                if (run.infractions >= 3) {
                    alert("Proctor Strike 3: Maximum window changes exceeded. Your scorecard is auto-submitting now.");
                    submitExamConsole();
                } else {
                    alert(`PROCTOR INFRACTION WARNING (${run.infractions}/3 STRIKES):\n\nYou must remain in fullscreen mode. Please return to fullscreen. Strike 3 will submit the test.`);
                    // Attempt back to fullscreen
                    requestFullscreenConsole();
                }
            }
        }
    });
}

function logProctorInfraction(msg) {
    const text = document.getElementById('telemetry-badge');
    const strikesEl = document.getElementById('telemetry-strikes');
    const run = state.runningTest;
    
    if (text) {
        text.textContent = "SUSPICIOUS ACTIVITY...";
        text.style.borderColor = 'var(--danger)';
        text.style.color = 'var(--danger)';
    }
    
    if (strikesEl) {
        strikesEl.textContent = `${run.infractions} / 3 strikes`;
    }
    
    console.warn("Proctor Alert: " + msg);
}

function startWebcamSimulation() {
    // Camera proctoring disabled per user request
}

function stopWebcamTrack() {
    // Camera proctoring disabled per user request
}

// Resizable split screen panel controls
function initSplitter() {
    const splitter = document.getElementById('workspace-splitter');
    const leftPanel = document.getElementById('console-left-panel');
    const rightPanel = document.getElementById('console-right-panel');
    
    if (!splitter || !leftPanel || !rightPanel) return;
    
    let isDragging = false;
    
    const onMouseDown = (e) => {
        isDragging = true;
        splitter.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // Prevent text highlights while dragging
    };
    
    const onMouseMove = (e) => {
        if (!isDragging) return;
        
        // Calculate percentages
        const totalWidth = window.innerWidth;
        let percentage = (e.clientX / totalWidth) * 100;
        
        // Boundaries restriction (20% - 80%)
        if (percentage < 20) percentage = 20;
        if (percentage > 80) percentage = 80;
        
        leftPanel.style.width = `${percentage}%`;
        leftPanel.style.flex = 'none';
        rightPanel.style.width = `${100 - percentage}%`;
        rightPanel.style.flex = 'none';
    };
    
    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };
    
    splitter.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}
