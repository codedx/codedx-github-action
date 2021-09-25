const axios = require('axios').default
const _ = require('underscore')
const AxiosLogger = require('axios-logger')

AxiosLogger.setGlobalConfig({
    headers: true
})

function parseError(e) {
    if (axios.isAxiosError(e) && e.response) {
        let msg = `${e.response.statusText} (HTTP ${e.response.status})`

        if (e.response.data) {
            if (e.response.data.error) {
                msg += `: ${e.response.data.error}`
            } else {
                msg += `: received response ${JSON.stringify(e.response.data)}`
            }
        }

        return new Error(msg)
    } else {
        return e
    }
}

class CodeDxApiClient {
    constructor(baseUrl, apiKey) {
        this.anonymousHttp = axios.create({
            baseURL: baseUrl
        })

        this.http = axios.create({
            baseURL: baseUrl,
            headers: {
                'API-Key': apiKey
            }
        })

        function rethrow(err) { throw err }
        this.anonymousHttp.interceptors.response.use(_.identity, rethrow)
        this.anonymousHttp.interceptors.request.use(_.identity, rethrow)
        this.http.interceptors.response.use(_.identity, rethrow)
        this.http.interceptors.request.use(_.identity, rethrow)
    }

    useLogging() {
        this.anonymousHttp.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)
        this.http.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)

        this.anonymousHttp.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
        this.http.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
    }

    testConnection() {
        return this.anonymousHttp.get('/x/system-info')
            .then(response => new Promise((resolve) => {
                if (typeof response.data != 'object') {
                    throw new Error(`Expected JSON Object response, got ${typeof response.data}. Is this a Code Dx instance?`)
                }
        
                const expectedFields = ['version', 'date']
                const unexpectedFields = _.without(_.keys(response.data), ...expectedFields)
                if (unexpectedFields.length > 0) {
                    throw new Error(`Received unexpected fields ${unexpectedFields.join(', ')}. Is this a Code Dx instance?`)
                }

                resolve(response.data.version)
            }))
            .catch(e => { throw parseError(e) })
    }

    validatePermissions(projectId) {
        const neededPermissions = [
            `analysis:create:${projectId}`
        ]

        return this.http.post('/x/check-permissions', neededPermissions)
            .catch(e => {
                if (axios.isAxiosError(e) && e.response.status == 403) {
                    throw new Error("Permissions check responded with HTTP 403, is the API key valid?")
                } else {
                    throw e
                }
            })
            .then(response => new Promise(resolve => {
                const permissions = response.data
                const missingPermissions = neededPermissions.filter(p => !permissions[p])
                if (missingPermissions.length > 0) {
                    const summary = missingPermissions.join(', ')
                    throw new Error("The following permissions were missing for the given API Key: " + summary)
                }
                resolve()
            }))
    }

    runAnalysis(projectId, formData) {
        return this.http.post(`/api/projects/${projectId}/analysis`, formData, { headers: formData.getHeaders() })
            .catch(ex => { throw parseError(ex) })
            .then(response => new Promise(resolve => resolve(response.data)))
    }

    checkJobStatus(jobId) {
        return this.http.get('/api/jobs/' + jobId)
            .catch(ex => { throw parseError(ex) })
            .then(result => new Promise(resolve => resolve(result.data.status)))
    }
}

module.exports = CodeDxApiClient