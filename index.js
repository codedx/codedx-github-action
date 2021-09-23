const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const analyze = require('./analyze')

// most @actions toolkit packages have async methods
async function run() {
    try {
        await analyze()
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
