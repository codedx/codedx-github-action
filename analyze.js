const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const archiver = require('archiver')
const fs = require('fs')
const FormData = require('form-data')
const { SrmApiClient, checkIfBranchPresent } = require('./srm')
const path = require('path')

const getConfig = require('./config').get

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms)
  });
};

const JobStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
}

function commaSeparated(str) {
  return (str || '').split(',').map(s => s.trim()).filter(s => s.length > 0)
}

function areGlobsValid(globsArray) {
  return !!globsArray && globsArray.length
}

function buildGlobObject(globsArray) {
  return glob.create(globsArray.join('\n'), { matchDirectories: false })
}

function makeRelative(workingDir, path) {
  if (path.indexOf(workingDir) == 0) {
    let relative = path.substr(workingDir.length)
    if (relative[0] == '/') relative = relative.substr(1)
    return relative
  } else {
    return path
  }
}

async function prepareInputsZip(inputsGlob, targetFile) {
  const separatedInputGlobs = commaSeparated(inputsGlob);
  core.debug("Got input file globs: " + separatedInputGlobs)
  if (!areGlobsValid(separatedInputGlobs)) {
    throw new Error("No globs specified for source/binary input files")
  }

  const inputFilesGlob = await buildGlobObject(separatedInputGlobs)
  const output = fs.createWriteStream(targetFile);
  const archive = archiver('zip');
  archive.on('end', () => core.info("Finished writing ZIP"))
  archive.on('warning', (err) => core.warning("Warning when writing ZIP: " + err))
  archive.on('error', (err) => core.error("Error when writing ZIP: " + err))

  archive.pipe(output);

  let numWritten = 0
  const workingDir = process.cwd()
  for await (const file of inputFilesGlob.globGenerator()) {
    const relPath = makeRelative(workingDir, file)
    if (file == targetFile || relPath == targetFile) continue
    
    archive.file(relPath)
    numWritten += 1
  }
  await archive.finalize()
  return numWritten
}

async function attachInputsZip(inputGlobs, formData, tmpDir) {
  const zipTarget = path.join(tmpDir, "srm-inputfiles.zip")
  const numFiles = await prepareInputsZip(inputGlobs, zipTarget)
  if (numFiles == 0) {
    core.warning("No files were matched by the 'source-and-binaries-glob' values, skipping source/binaries ZIP attachment")
  } else {
    core.info(`Added ${numFiles} files`)
    formData.append('source-and-binaries.zip', fs.createReadStream(zipTarget))
  }
}

async function attachScanFiles(scanGlobs, formData) {
  const separatedScanGlobs = commaSeparated(scanGlobs)
  core.debug("Got scan file globs: " + separatedScanGlobs)

  if (areGlobsValid(separatedScanGlobs)) {
    const scanFilesGlob = await buildGlobObject(separatedScanGlobs)
    core.info("Searching with globs...")
    let numWritten = 0
    for await (const file of scanFilesGlob.globGenerator()) {
      numWritten += 1
      core.info('- Adding ' + file)
      const name = path.basename(file)
      formData.append(`${numWritten}-${name}`, fs.createReadStream(file))
    }
    core.info(`Found and added ${numWritten} scan files`)
  } else {
    core.info("(Scan files skipped as no globs were specified)")
  }
}

async function validateBranches(branches, config) {
  const baseBranchPresent = checkIfBranchPresent(branches, config.baseBranchName)
  const targetBranchPresent = checkIfBranchPresent(branches, config.targetBranchName)

  if (targetBranchPresent) {
    core.info("Using existing SRM branch: " + config.targetBranchName);
    // Not necessary, base branch is currently ignored in the backend if the target
    // branch already exists. just setting to null to safeguard in case of future changes
    config.baseBranchName = null
  } else {
    // Base branch is not defined; throw error
    if (!config.baseBranchName) {
      throw new Error("A parent branch must be specified when using a new target branch");
    }

    // Base branch is defined but is not present; cannot create target branch, so throw error
    if (!baseBranchPresent) {
      throw new Error("The specified parent branch does not exist: " + config.baseBranchName);
    }

    // If base branch is defined and present, create the target branch off the base
    core.info(`Analysis will create a new branch named '${config.targetBranchName}' based on the branch '${config.baseBranchName}'`);
  }
}

async function getProjectId(config, client) {
  // If projectId is defined and not name, simply return the id
  if (config.projectId && !config.projectName) {
    return config.projectId
  } else if (!config.projectId && config.projectName) {
    // If project name is defined, retrieve the corresponding project id first.
    // If multiple projects with the same name exist, throw an error since it is ambiguous which project the user wants.
    const projects = await client.getSrmProjects()
    const matchedProjectIds = projects.filter(project => project.name == config.projectName).map(project => project.id)

    if (matchedProjectIds.length == 1) {
      return matchedProjectIds[0]
    } else if (matchedProjectIds.length == 0) {
      if (config.autoCreateProject) {
        core.info(`Found 'auto-create-project: true'`)
        core.info(`No projects with the name '${config.projectName}'. Creating the project...`)
        const createdProject = await client.createSrmProject(config)
        core.info(`Created project '${createdProject.name}' (projectId = ${createdProject.id})`)
        return createdProject.id
      } else {
        core.info(`Found 'auto-create-project: false'`)
        throw new Error(`No projects with the name '${config.projectName}'. Note: If you want SRM to auto-create a project that does not exist, set 'auto-create-project: true' in your workflow file.`)
      }
    } else {
      throw new Error(`Multiple projects with the name '${config.projectName}'. Unable to determine which project to use. Try specifying with 'project-id' instead.`)
    }
  } else if (!config.projectId && !config.projectName) {
    // If neither is defined, throw error
    throw new Error(`No projects specified. Make sure to specify either 'project-id' or 'project-name'.`)
  } else {
    // If both are defined, throw error
    throw new Error(`Both 'project-id' and 'project-name' are specified. Unable to determine which project to use. Make sure to specify either 'project-id' or 'project-name'.`)
  }
}

// most @actions toolkit packages have async methods
module.exports = async function run() {
  const config = getConfig()
  const MinimumVersionForBranching = '2022.4.3'

  const client = new SrmApiClient(config.serverUrl, config.apiKey, config.caCert)
  core.info("Checking connection to SRM...")

  const srmVersion = await client.testConnection()
  core.info("Confirmed - using SRM " + srmVersion)

  const projectId = await getProjectId(config, client)

  core.info("Checking API key permissions...")
  await client.validatePermissions(projectId)
  core.info("Connection to SRM server is OK.")

  const branches = await client.getProjectBranches(projectId)
  if (config.targetBranchName) {
    core.info("Validating branch selection...")
    // First check if the SRM version being used supports branching
    if (srmVersion.localeCompare(MinimumVersionForBranching, undefined, { numeric: true }) < 0) {
      core.info(
          "The connected SRM server with version " + srmVersion + " does not support project branches. " +
          "The minimum required version is " + MinimumVersionForBranching + ". The target branch and base " +
          "branch options will be ignored."
      )
      // Set both branch configs to null since we will be ignoring them
      config.baseBranchName = null
      config.targetBranchName = null
    } else {
      await validateBranches(branches, config)
      core.info("Branch selection is OK.")
    }
  } else {
    // If target branch is not defined, use the default branch. This also ensures even if
    // base branch is defined, the default branch is not created as a child of the base branch
    const defaultBranch = branches.filter(branch => branch.isDefault)[0].name

    core.info(`No target branch was defined. Using default target branch '${defaultBranch}'`)
    config.targetBranchName = defaultBranch
    config.baseBranchName = null
  }

  if (config.dryRun) {
    core.info("dry-run is enabled, exiting without analysis")
    return
  }

  const formData = new FormData()
  
  if (config.inputGlobs) {
    core.info("Preparing source/binaries ZIP...")
    await attachInputsZip(config.inputGlobs, formData, config.tmpDir)
  } else {
    core.info("Source/binary inputs glob not specified, skipping ZIP creation")
  }

  if (config.scanGlobs) {
    core.info("Adding scan files...")
    await attachScanFiles(config.scanGlobs, formData)
  } else {
    core.info("Scan files glob not specified, skipping scan file attachment")
  }

  core.info("Uploading to SRM...")
  const { analysisId, jobId } = await client.runAnalysis(projectId, config.baseBranchName, config.targetBranchName, formData)

  core.info("Started analysis #" + analysisId)

  if (config.waitForCompletion) {
    core.info("Waiting for job to finish...")
    let lastStatus = null
    do {
      await wait(1000)
      lastStatus = await client.checkJobStatus(jobId)
    } while (lastStatus != JobStatus.COMPLETED && lastStatus != JobStatus.FAILED)

    if (lastStatus == JobStatus.COMPLETED) {
      core.info("Analysis finished! Completed with status: " + lastStatus)
    } else {
      throw new Error(`Analysis finished with non-complete status: ${lastStatus}. See SRM server logs/visual log for more details.`)
    }
  }
}