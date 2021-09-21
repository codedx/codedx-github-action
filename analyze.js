const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const archiver = require('archiver')
const fs = require('fs')
const FormData = require('form-data')
const CodeDxApiClient = require('./codedx')

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

  for await (const file of inputFilesGlob.globGenerator()) {
    archive.file(file);
  }

  await archive.finalize();
}

// most @actions toolkit packages have async methods
module.exports = async function run({
  // common inputs
  serverUrl, apiKey, projectId, inputGlobs, scanGlobs,

  // config options for testing
  tmpDir, 
}) {
  const client = new CodeDxApiClient(serverUrl, apiKey)
  core.info("Checking connection to Code Dx...")

  await client.testConnection()

  core.info("Checking API key permissions...")
  await client.validatePermissions(projectId)

  core.info("Connection to Code Dx server is OK.")

  // const separatedResultsGlobs = commaSeparated(toolResultsGlob)
  // const resultsFilesGlob = await buildGlobObject(separatedResultsGlobs)

  const zipTarget = "codedx-inputfiles.zip"

  core.info("Preparing source/binaries ZIP...")
  const inputFilesZip = await prepareInputsZip(inputGlobs, zipTarget)

  core.info("Uploading to Code Dx...")
  const formData = new FormData()
  formData.append('source-and-binaries.zip', fs.createReadStream(zipTarget))

  const { analysisId, jobId } = await client.runAnalysis(projectId, formData)
  core.info("Started analysis #" + analysisId)

  core.info("Waiting for job to finish...")
  let lastStatus = null
  do {
    await wait(1000)
    lastStatus = await client.checkJobStatus(jobId)
  } while (lastStatus != JobStatus.COMPLETED && lastStatus != JobStatus.FAILED)

  core.info("Analysis finished! Completed with status: " + lastStatus)

  // const ms = core.getInput('milliseconds');
  // core.info(`Waiting ${ms} milliseconds ...`);

  // core.debug((new Date()).toTimeString()); // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
  // await wait(parseInt(ms));
  // core.info((new Date()).toTimeString());

  // core.setOutput('time', new Date().toTimeString());
}