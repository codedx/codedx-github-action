const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const archiver = require('archiver')
const fs = require('fs')
const FormData = require('form-data')
const CodeDxApiClient = require('./codedx')
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
  return str.split(',').map(s => s.trim()).filter(s => s.length > 0)
}

async function buildGlobObject(globsArray) {
  if (!globsArray || globsArray.length == 0) return null
  return glob.create(globsArray.join('\n'))
}

async function prepareInputsZip(inputsGlob, targetFile) {
  const separatedInputGlobs = commaSeparated(inputsGlob);
  core.debug("Got input file globs: " + separatedInputGlobs)

  const inputFilesGlob = await buildGlobObject(separatedInputGlobs);

  const output = fs.createWriteStream(targetFile);
  const archive = archiver('zip');
  archive.on('end', () => console.log("Finished writing ZIP"))
  archive.on('warning', (err) => console.log("Warning: ", err))
  archive.on('error', (err) => console.log("Error: ", err))

  archive.pipe(output);

  let numWritten = 0
  for await (const file of inputFilesGlob.globGenerator()) {
    archive.file(file);
    numWritten += 1
  }

  await archive.finalize();
  return numWritten
}

// most @actions toolkit packages have async methods
module.exports = async function run() {
  const config = getConfig()

  const client = new CodeDxApiClient(config.serverUrl, config.apiKey)
  core.info("Checking connection to Code Dx...")
  const codedxVersion = await client.testConnection()
  core.info("Confirmed - using Code Dx " + codedxVersion)

  core.info("Checking API key permissions...")
  await client.validatePermissions(config.projectId)

  core.info("Connection to Code Dx server is OK.")

  // const separatedResultsGlobs = commaSeparated(toolResultsGlob)
  // const resultsFilesGlob = await buildGlobObject(separatedResultsGlobs)

  const zipTarget = path.join(config.tmpDir, "codedx-inputfiles.zip")

  core.info("Preparing source/binaries ZIP...")
  const numFiles = await prepareInputsZip(inputGlobs, zipTarget)
  if (numFiles == 0) {
    throw new Error("No files were matched by the source/binary glob(s)")
  }

  core.info("Uploading to Code Dx...")
  const formData = new FormData()
  formData.append('source-and-binaries.zip', fs.createReadStream(zipTarget))

  const { analysisId, jobId } = await client.runAnalysis(config.projectId, formData)
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
      throw new Error("Analysis finished with non-complete status: " + lastStatus)
    }
  }
}