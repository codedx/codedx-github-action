const axios = require('axios').default
const _ = require('underscore')
const AxiosLogger = require('axios-logger')
const https = require('https')

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

function rethrowError(err) {
    throw parseError(err)
}

function checkIfBranchPresent(branches, branchName) {
    for (const branch of branches) {
        if (branch.name == branchName) return true
    }
    return false
}

class SrmApiClient {
    constructor(baseUrl, apiKey, caCert) {
        const httpsAgent = caCert ? new https.Agent({ ca: caCert }) : undefined

        const baseConfig = {
            baseURL: baseUrl,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,

            httpsAgent
        }

        this.anonymousHttp = axios.create(baseConfig)

        this.http = axios.create({
            ...baseConfig,
            headers: {
                'API-Key': apiKey
            }
        })
    }

    // WARNING: This logging will emit Header data, which contains the SRM API key. This should not be exposed and should only
    //          be used for internal testing.
    useLogging() {
        AxiosLogger.setGlobalConfig({
            headers: true
        })

        this.anonymousHttp.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)
        this.http.interceptors.request.use(AxiosLogger.requestLogger, AxiosLogger.errorLogger)

        this.anonymousHttp.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
        this.http.interceptors.response.use(AxiosLogger.responseLogger, AxiosLogger.errorLogger)
    }

    async testConnection() {
        const response = await this.anonymousHttp.get('/x/system-info').catch(e => {
            if (axios.isAxiosError(e) && e.response) {
                throw new Error(`Expected OK response, got ${e.response.status}. Is this an SRM instance?`)
            } else {
                throw e
            }
        })

        if (typeof response.data != 'object') {
            throw new Error(`Expected JSON Object response, got ${typeof response.data}. Is this an SRM instance?`)
        }

        const expectedFields = ['version', 'date']
        const unexpectedFields = _.without(_.keys(response.data), ...expectedFields)
        if (unexpectedFields.length > 0) {
            throw new Error(`Received unexpected fields ${unexpectedFields.join(', ')}. Is this an SRM instance?`)
        }

        return response.data.version
    }

    async getSrmProjects() {
        const projectsResponse = await this.http.get(`/x/projects`).catch(rethrowError)
        return projectsResponse.data
    }

    async createSrmProject(config) {
        const requestBodyData = { "name": config.projectName }
        if (config.baseBranchName && config.targetBranchName)
            requestBodyData.defaultBranchName = config.baseBranchName
        else if (!!config.baseBranchName != !!config.targetBranchName)
            throw Error(`New project creation failed because branch config is specified but incomplete. ` +
                `Make sure to specify both 'base-branch-name' and 'target-branch-name', or neither, for project creation.`
            )

        const projectsResponse = await this.http.post(`/api/projects`, requestBodyData).catch(rethrowError)
        return projectsResponse.data
    }

    async validatePermissions(projectId) {
        const cleanNeededPermissions = [
            'analysis:create'
        ]

        const neededPermissions = cleanNeededPermissions.map(p => `${p}:${projectId}`)

        const response = await this.http.post('/x/check-permissions', neededPermissions).catch(e => {
            if (axios.isAxiosError(e) && e.response.status == 403) {
                throw new Error("Permissions check responded with HTTP 403, is the API key valid?")
            } else {
                throw parseError(e)
            }
        })
        
        const permissions = response.data
        const missingPermissions = neededPermissions.filter(p => !permissions[p])
        if (missingPermissions.length > 0) {
            const cleanMissingPermissions = missingPermissions.map(p => {
                const parts = p.split(':')
                return parts.slice(0, -1).join(':')
            })
            const summary = cleanMissingPermissions.join(', ')
            throw new Error("The following permissions were missing for the given API Key: " + summary)
        }
    }

    async getProjectBranches(projectId) {
        const branchesResponse = await this.http.get(`/x/projects/${projectId}/branches`).catch(rethrowError)
        return branchesResponse.data
    }

    async runAnalysis(projectId, baseBranchName, targetBranchName, formData) {
        // If base branch is defined, add the base branch name in the project URL part or just add the project id directly
        const projectSpecifier = baseBranchName ? `${projectId};branch=${baseBranchName}` : projectId

        // If target branch is defined, add the branch name to the query param. Or else, keep it blank; it will work on the default branch
        const queryParamsPart = targetBranchName ? `?branchName=${targetBranchName}` : ''

        const response = await this.http.post(`/api/projects/${projectSpecifier}/analysis${queryParamsPart}`, formData, { headers: formData.getHeaders() }).catch(rethrowError)
        return response.data
    }

    async checkJobStatus(jobId) {
        const response = await this.http.get('/api/jobs/' + jobId).catch(rethrowError)
        return response.data.status
    }
}

module.exports = {
    SrmApiClient,
    checkIfBranchPresent
}