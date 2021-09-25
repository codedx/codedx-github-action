const core = require('@actions/core')
const analyze = require('./analyze')

analyze().catch(err => {
    core.info("Caught an error!")
    core.setFailed(err.message)
})
