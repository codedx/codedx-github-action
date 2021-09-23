const core = require('@actions/core');

class Config {
    constructor() {
        this.serverUrl = core.getInput('serverUrl', { required: true })
        this.apiKey = core.getInput('apiKey', { required: true })
        this.projectId = core.getInput('projectId', { required: true })
        this.inputGlobs = core.getInput('sourceAndBinariesGlob', { required: true })
        this.scanGlobs = core.getInput('toolOutputsGlob')

        this.waitForCompletion = core.getInput('waitForCompletion')

        // debug vars
        this.tmpDir = ""
    }

    sanitize() {
        if (typeof this.waitForCompletion != 'boolean') {
            const newValue = typeof this.waitForCompletion == 'string' ? this.waitForCompletion == "true" : !!this.waitForCompletion
            core.warning("waitForCompletion was not a boolean, interpreting as " + newValue)
            this.waitForCompletion = newValue
        }

        if (typeof this.projectId != 'number') {
            try {
                this.projectId = parseInt(this.projectId)
            } catch (e) {
                throw new Error("Invalid value for projectId, expected a number but got a " + (typeof this.projectId))
            }
        }
    }
}

let usedConfig = null

module.exports = {
    Config,
    get: function() {
        if (!usedConfig) {
            usedConfig = new Config()
            usedConfig.sanitize()
        }
        return usedConfig
    },
    set: function(customConfig) {
        if (!customConfig instanceof Config) {
            const realConfig = new Config()
            Object.keys(customConfig).forEach(k => realConfig[k] = customConfig[k])
            customConfig = realConfig
        }
        usedConfig = customConfig
    }
}