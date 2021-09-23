const axios = require('axios').default
const _ = require('underscore')
const AxiosLogger = require('axios-logger')

AxiosLogger.setGlobalConfig({
    headers: true
})

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
    }

    useLogging() {
        this.anonymousHttp.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)
        this.http.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)

        this.anonymousHttp.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
        this.http.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
    }

    async testConnection() {
        const response = await this.anonymousHttp.get('/x/system-info')
        if (typeof response.data != 'object') {
            throw new Error(`Expected JSON Object response, got ${typeof response.data}. Is this a Code Dx instance?`)
        }

        const expectedFields = ['version', 'date']
        const unexpectedFields = _.without(_.keys(response.data), ...expectedFields)
        if (unexpectedFields.length > 0) {
            throw new Error(`Received unexpected fields ${unexpectedFields.join(', ')}. Is this a Code Dx instance?`)
        }

        return response.data.version
    }

    async validatePermissions(projectId) {
        const neededPermissions = [
            `analysis:create:${projectId}`
        ]

        let response = null
        try {
            response = await this.http.post('/x/check-permissions', neededPermissions)
        } catch (e) {
            if (axios.isAxiosError(e) && e.response.status == 403) {
                throw new Error("Permissions check responded with HTTP 403, is the API key valid?")
            } else {
                throw e
            }
        }
        const permissions = response.data
        const missingPermissions = neededPermissions.filter(p => !permissions[p])
        if (missingPermissions.length > 0) {
            const summary = missingPermissions.join(', ')
            throw new Error("The following permissions were missing for the given API Key: " + summary)
        }
    }

    async runAnalysis(projectId, formData) {
        const result = await this.http.post(`/api/projects/${projectId}/analysis`, formData, {
            headers: {
                ...formData.getHeaders()
            }
        })
        return result.data
    }

    async checkJobStatus(jobId) {
        const result = await this.http.get('/api/jobs/' + jobId)
        return result.data.status
    }
}

module.exports = CodeDxApiClient