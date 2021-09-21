const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const analyze = require('./analyze')

// most @actions toolkit packages have async methods
async function run() {
    try {
        analyze({
            serverUrl: core.getInput('serverUrl'),
            apiKey: core.getInput('apiKey'),
            projectId: core.getInput('projectId'),
            inputGlobs: core.getInput('sourceAndBinariesGlob'),
            scanGlobs: core.getInput('toolOutputsGlob')
        })
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
