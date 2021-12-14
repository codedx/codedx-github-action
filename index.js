const core = require('@actions/core')
const analyze = require('./analyze')

analyze().catch(err => core.setFailed(err.message))
