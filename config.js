const core = require('@actions/core');

function isYamlTrue(value) {
    value = value.toLowerCase().trim()
    return ["yes", "on", "true"].indexOf(value) >= 0
}

function fixBoolean(target, field) {
    const value = target[field]
    if (typeof value == 'string') {
        target[field] = isYamlTrue(value)
    }
}

class Config {
    constructor() {
        this.serverUrl = core.getInput('server-url', { required: true })
        this.apiKey = core.getInput('api-key', { required: true })
        this.projectId = core.getInput('project-id', { required: true })
        this.inputGlobs = core.getInput('source-and-binaries-glob', { required: true })
        this.scanGlobs = core.getInput('tool-outputs-glob')

        this.waitForCompletion = core.getInput('wait-for-completion')
        this.caCert = core.getInput('ca-cert')
        this.dryRun = core.getInput('dry-run')

        // debug vars
        this.tmpDir = ""
    }

    sanitize() {
        fixBoolean(this, 'waitForCompletion')
        fixBoolean(this, 'dryRun')

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