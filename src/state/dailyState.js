const fs = require('fs');

const STATE_FILE = './data/completed.json';

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        return { lastRun: null };
    }

    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { lastRun: null };
    }
}

function saveState(state) {
    fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(state, null, 2)
    );
}

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function isCompletedToday() {
    const state = loadState();
    return state.lastRun === getToday();
}

function markCompleted() {
    saveState({
        lastRun: getToday()
    });
}

module.exports = {
    isCompletedToday,
    markCompleted
};
